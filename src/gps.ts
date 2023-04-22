const INCLUDE_UNPARSED = false;

/* In: stream text
      Out: stream parsed gps
      Out: big array
    */
export function parseNMEA(readableStream: ReadableStream) {
  const decoder = new TextDecoder();
  let buffer = '';

  return new ReadableStream({
    async start(controller) {
      const reader = readableStream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) return controller.close();

          buffer += decoder.decode(value);
          const messages = buffer.split(/[\$\s]/);
          buffer = messages.pop()!;

          messages
            .map(parseLine)
            .filter(Boolean)
            .filter((x) =>
              INCLUDE_UNPARSED ? true : Object.keys(x!).length > 2
            )
            .forEach((message) => controller.enqueue(message));
        }
      } catch (error) {
        console.error('parseNMEA.error', error);
        controller.close();
      }
    },
  });
}

export function parseGPS(text) {
  const entries = text
    .split(/\r?\n/)
    .filter((entry) => entry.startsWith('$'))
    .map(parseLine)
    .reverse();
  const types = entries
    .map((a) => a.type)
    .concat('$GNGGA', '$BDGGA', '$GPGGA')
    .filter(uniq)
    .sort((a, b) => a.localeCompare(b));
  const counts = types.map((type) => ({
    type,
    last: entries.find((a) => a.type === type),
    count: entries.filter((a) => a.type === type).length,
  }));

  const course = entries.find((e) => e.course)?.course;
  const times = entries.flatMap(parseTime);
  const distinctTimes = new Set(times).size;
  const relevant = entries
    .filter((e) => e.latitude && e.longitude)
    .slice(0, -1);

  const lats = relevant.map((e) => e.latitude);
  const longs = relevant.map((e) => e.longitude);
  const bounds = {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...longs),
    west: Math.min(...longs),
  };

  const center = averageCoords(relevant);
  const distances = relevant.map((r) => distance(r, center));
  const distancesMeters = relevant.map((r) => distanceMeters(r, center));
  //console.log('distancesMeters', distancesMeters)
  const networks = types
    .map((t) => t.slice(1, 3))
    .map(parseNetwork)
    .filter(uniq)
    .filter(Boolean);
  const understanding =
    entries.filter((e) => Object.keys(e).length > 2).length / entries.length;

  return {
    time: times[0],
    understanding,
    course,
    distinctTimes,
    position: entries.find((r) => r.latitude),
    center,
    bounds,
    distances,
    networks,
    types,
    counts,
    entries,
    relevant,
    var3:
      distancesMeters.length >= 3
        ? variance(distancesMeters.slice(0, 3)).toPrecision(3)
        : null,
    var10:
      distancesMeters.length >= 10
        ? variance(distancesMeters.slice(0, 10)).toPrecision(3)
        : null,
    var30:
      distancesMeters.length >= 30
        ? variance(distancesMeters.slice(0, 30)).toPrecision(3)
        : null,
    variance: variance(distancesMeters).toPrecision(3),
    stddev: standardDeviation(distancesMeters.slice(0, 10)).toPrecision(3),
    rmc: entries.find((r) => r.type.slice(3, 6) === 'RMC'),
    gga: entries.find((r) => r.type.slice(3, 6) === 'GGA'),
    gll: entries.find((r) => r.type.slice(3, 6) === 'GLL'),
  };
}

export function parseLine(raw: string) {
  // Cleanup
  raw = raw.trim();

  // $ is getting list in stream
  if (!raw.startsWith('$')) raw = '$' + raw;

  // Filter out invalid messages
  if (raw[raw.length - 3] !== '*') return;

  // TODO: check if checksum is valid

  const parts = raw.slice(0, -3).split(',');
  return { ...parseKnown(raw, parts), type: parts[0], raw };
}

export function parseTime(line) {
  if (line.raw.startsWith('$GPGGA')) {
    const time = line.raw.split(',')[1];
    return [time.slice(0, 2), time.slice(2, 4), time.slice(4, 6)].join(':');
  }
  if (line.raw.startsWith('$GNRMC')) {
    const time = line.raw.split(',')[1];
    return [time.slice(0, 2), time.slice(2, 4), time.slice(4, 6)].join(':');
  }
  return [];
}

export function parseCoord(coord, dir) {
  // Latitude can go from 0 to 90; longitude can go from -180 to 180.
  if (coord === '') return null;
  var n,
    sgn = 1;
  switch (dir) {
    case 'S':
      sgn = -1;
    case 'N':
      n = 2;
      break;

    case 'W':
      sgn = -1;
    case 'E':
      n = 3;
      break;
  }
  if (!coord?.slice) {
    console.warn('coo', coord, dir);
    return -1;
  }
  /*
   * Mathematically, but more expensive and not numerical stable:
   *
   * raw = 4807.038
   * deg = Math.floor(raw / 100)
   *
   * dec = (raw - (100 * deg)) / 60
   * res = deg + dec // 48.1173
   */
  return (
    sgn * (parseFloat(coord.slice(0, n)) + parseFloat(coord.slice(n)) / 60)
  );
}
export function averageCoords(relevant) {
  //console.log('rel',relevant);
  let latitude = 0,
    longitude = 0;
  for (const entry of relevant) {
    latitude += entry.latitude;
    longitude += entry.longitude;
  }

  return {
    latitude: latitude / relevant.length,
    longitude: longitude / relevant.length,
  };
}
export function parseNetwork(net) {
  return {
    GN: 'GNSS',
    GP: 'GPS',
    GL: 'Glonass',
    GA: 'Galileo',
    BD: 'Beidou',
    GI: 'Insat',
  }[net];
}
export function parseFAA(faa) {
  switch (faa) {
    case '':
      return null;
    case 'A':
      return 'autonomous';
    case 'D':
      return 'differential';
    case 'E':
      return 'estimated'; // dead reckoning
    case 'M':
      return 'manual input';
    case 'S':
      return 'simulated';
    case 'N':
      return 'not valid';
    case 'P':
      return 'precise';
    case 'R':
      return 'rtk'; // valid (real time kinematic) RTK fix
    case 'F':
      return 'rtk-float'; // valid (real time kinematic) RTK float
  }
  return 'undef';
  throw new Error('INVALID FAA MODE: ' + faa);
}

export function parseGGAFix(fix) {
  if (fix === '') return null;

  switch (parseInt(fix, 10)) {
    case 0:
      return null;
    case 1:
      return 'fix'; // valid SPS fix
    case 2:
      return 'dgps-fix'; // valid DGPS fix
    case 3:
      return 'pps-fix'; // valid PPS fix
    case 4:
      return 'rtk'; // valid (real time kinematic) RTK fix
    case 5:
      return 'rtk-float'; // valid (real time kinematic) RTK float
    case 6:
      return 'estimated'; // dead reckoning
    case 7:
      return 'manual';
    case 8:
      return 'simulated';
  }
  return 'invalid';
}

export function parseKnown(raw, parts) {
  switch (parts[0]) {
    case '$GPGGA':
    case '$GNGGA':
      return parseGGA(raw, parts);
    case '$GPGLL':
    case '$GNGLL':
      return parseGLL(raw, parts);
    case '$GPRMC':
    case '$GNRMC':
      return parseRMC(raw, parts);
    case '$PSTI':
      return parsePSTI(raw, parts);
  }
}

export function parsePSTI(raw, parts) {
  switch (parts[1]) {
    case '030':
      return parsePSTIminimum(raw, parts);
    case '032':
      return parsePSTIbaseline(raw, parts);
  }
}

export function parseGGA(raw, parts) {
  const [
    type,
    time,
    latitude,
    ns,
    longitude,
    ew,
    quality,
    satellites,
    hdop,
    altitude,
    ,
    geoidal,
    ,
    agediff,
    station,
  ] = parts;
  return {
    type,
    time,
    latitude: parseCoord(latitude, ns),
    ns,
    longitude: parseCoord(longitude, ew),
    ew,
    quality: parseGGAFix(quality),
    satellites,
    hdop,
    altitude,
    geoidal,
    agediff,
    station,
  };
}

export function parseGLL(raw, parts) {
  const [type, latitude, ns, longitude, ew, time, status, mode] = parts;
  return {
    type,
    latitude: parseCoord(latitude, ns),
    ns,
    longitude: parseCoord(longitude, ew),
    ew,
    time,
    status,
    mode,
    quality: parseFAA(mode),
  };
}

export function parseRMC(raw, parts) {
  const [
    type,
    time,
    status,
    latitude,
    ns,
    longitude,
    ew,
    speed,
    course,
    date,
    ,
    ,
    mode,
    unknown,
  ] = parts;
  return {
    type,
    time,
    status,
    latitude: parseCoord(latitude, ns),
    ns,
    longitude: parseCoord(longitude, ew),
    ew,
    speed: parseFloat((parseFloat(speed) * 1.852).toPrecision(4)),
    course: parseFloat(course),
    date,
    mode,
    quality: parseFAA(mode),
    unknown,
  };
}

export function parsePSTIminimum(raw, parts) {
  return {};
}
export function parsePSTIbaseline(raw, parts) {
  return {};
}

// Binary

const binlookup = {
  BD: 3,
  GN: 6,
  'CFG-MSG': [6, 1],
  GGA: [0xf0, 0x00],
  GLL: [0xf0, 0x01],
  GRS: [0xf0, 0x03],
  GSA: [0xf0, 0x02],
  GSV: [0xf0, 0x04],
  RMC: [0xf0, 0x05],
  TXT: [0xf0, 0x20],
  VTG: [0xf0, 0x06],
  ZDA: [0xf0, 0x07],
  DTM: [0xf0, 0x0a],
  GAQ: [0xf0, 0x45],
  GBQ: [0xf0, 0x44],
  GBS: [0xf0, 0x09],
  // GGA: [0xf0, 0x00], // Global positioning system fix data (Output)
  // GLL: [0xf0, 0x01], // Latitude and longitude, with time of position fix and status (Output)
  GLQ: [0xf0, 0x43],
  GNQ: [0xf0, 0x42],
  GNS: [0xf0, 0x0d],
  GPQ: [0xf0, 0x40],
  GQQ: [0xf0, 0x47],
  // GRS: [0xf0, 0x06], // GNSS range residuals (Output)
  // GSA: [0xf0, 0x02], // GNSS DOP and active satellites (Output)
  GST: [0xf0, 0x07],
  // GSV: [0xf0, 0x03], // GNSS satellites in view (Output)
  RLM: [0xf0, 0x0b],
  // RMC: [0xf0, 0x04], // Recommended minimum data (Output)
  // TXT: [0xf0, 0x41], // Text transmission (Output)
  VLW: [0xf0, 0x0f], // Dual ground/water distance (Output)
  // VTG: [0xf0, 0x05], // Course over ground and ground speed (Output)
  // ZDA: [0xf0, 0x08], // Time and date (Output)
};
export function bin(id) {
  const ints = binlookup[id.toUpperCase()];
  if (!ints) throw new Error('bin unknown');
  return Uint8Array.from(ints);
}
export function cfg_msg(type, rate) {
  //console.log("cfg_msg", type, rate);
  return msg(
    bin('cfg-msg'),
    Uint8Array.from([...bin(type), rate, 0, 0, 0, 0, 0, 0])
  );
}
export function slow(type) {
  return cfg_msg(type, 5);
}
export function enable(type) {
  return cfg_msg(type, 1);
}
export function disable(type) {
  return cfg_msg(type, 0);
}
export function msg(type, data = Uint8Array.from([])) {
  return check(Uint8Array.from([0xf1, 0xd9, ...type, data.length, 0, ...data]));
}
export function check(data) {
  const content = data.slice(2, 6 + data[4]);
  if (content.length !== data.length - 2) {
    console.log('mismatch length', data.toString('hex'));
    return Uint8Array.from([]);
  }
  let sum1 = 0;
  let sum2 = 0;
  for (const byte of content) {
    sum1 += byte % 256;
    sum2 += sum1 % 256;
  }
  return Uint8Array.from([...data.slice(0, 6 + data[4]), sum1, sum2]);
}
export function uprint(uarray) {
  return (
    '!HEX ' +
    Array.from(uarray)
      .map((n) => n.toString(16).padStart(2, '0').toUpperCase())
      .join(' ')
  );
}

export function gneaChecksum(message: string) {
  // Cleanup existing checksum
  message = message.split('*')[0].split('$').pop()!;

  // Calculate the checksum
  let checksum = 0;
  for (let i = 0; i < message.length; i++) {
    checksum ^= message.charCodeAt(i);
  }
  return `$${message}*${checksum.toString(16).toUpperCase().padStart(2, '0')}`;
}

// Helpers

// items.filter(uniq)
export function uniq(v, i, a) {
  return a.findIndex((b) => b === v) === i;
}
// convert to radians
var toRad = function (num) {
  return (num * Math.PI) / 180;
};
export function haversine(start, end) {
  const dLat = toRad(end.latitude - start.latitude);
  const dLon = toRad(end.longitude - start.longitude);
  const lat1 = toRad(start.latitude);
  const lat2 = toRad(end.latitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c;
}

export function distance(me, object) {
  const meters = haversine(me, object);
  if (meters > 1000) {
    return formatNumber(meters / 1000) + ' km';
  }
  if (meters < 1) {
    // return formatNumber(meters * 100) + " cm";
  }
  return formatNumber(meters) + ' m';
}
export function distanceMeters(me, object) {
  return haversine(me, object);
}
export function formatNumber(num) {
  return parseFloat(num.toPrecision(3)).toString().replace('.', ',');
}
export function variance(array) {
  var aaa = mean(array);
  return mean(
    array.map(function (num) {
      return Math.pow(num - aaa, 2);
    })
  );
}

export function standardDeviation(array) {
  return Math.sqrt(variance(array));
}
export function sum(array) {
  var num = 0;
  for (var i = 0, l = array.length; i < l; i++) num += array[i];
  return num;
}

export function mean(array) {
  return sum(array) / array.length;
}
