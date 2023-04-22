<script lang="ts">
import { defineComponent } from 'vue';
import { formatNumber, parseGPS, parseNMEA, haversine, distance } from './gps';
import { useReceiver } from './store/receiver';
import { useNtrip } from './store/ntrip';
import { mapStores } from 'pinia';

export default defineComponent({
  setup() {},
  local: [
    'input',
    'data',
    'view',
    'ntrip',
    'scatter',
    'command',
    'commandText',
    'checkpoints',
  ],
  data: () => ({
    // Input
    serialSupport: 'serial' in navigator,
    serialPorts: [],
    serialConnected: false,
    test: null,

    // { type: string, data: '' }
    // { type: webserial }
    // { type: webbluetooth }
    input: null,
    // serialPort:null,
    serialError: null,
    serialStatus: null,
    ntrip: false,
    ntripSubscription: null,
    command: false,
    commandText: '',

    // Process
    data: [],

    // Analyse
    view: 'ascii', // "original" | 'ascii' | 'json'
    scatter: false,

    // Feedback
    checkpoints: [],

    warning: '',
    reading: true,
    readLock: false,
  }),
  computed: {
    ...mapStores(useReceiver, useNtrip),

    // Processing
    dataString() {
      return this.data.join('') || '';
    },
    asciiLines() {
      return this.dataString
        .split('\n')
        .map((line) => line.match(/([$*,.a-zA-Z0-9\n]*)/)[1])
        .filter((line) => line.includes('$') && line.includes('*'));
    },
    parsed() {
      return this.receiverStore.parsed;
    },

    // Analyse
    scatterGraph() {
      if (!this.parsed.bounds) return console.warn('no bounds');
      if (!this.parsed.relevant) return console.warn('no relevant data');
      if (this.parsed.relevant.length < 3) return; // console.log('not enough data');
      const { north, south, west, east } = this.parsed.bounds;
      const bottomLeft = { latitude: south, longitude: west };
      const topLeft = { latitude: north, longitude: west };
      const bottomRight = { latitude: south, longitude: east };
      const count = this.parsed.relevant.length || 1;
      const ratio =
        haversine(bottomLeft, bottomRight) / haversine(topLeft, bottomLeft);
      return {
        vertical: distance(topLeft, bottomLeft),
        horizontal: distance(bottomLeft, bottomRight),
        style: {
          aspectRatio: ratio,
        },
        checkpoints: this.nearbyCheckpoints.map((e, index) => ({
          bottom: (100 * (e.latitude - south)) / (north - south) + '%',
          left: (100 * (e.longitude - west)) / (east - west) + '%',
          background: '#0c0',
          opacity: 1,
          zIndex: 1,
        })),
        points: this.parsed.relevant
          .map((e, index) => ({
            bottom: (100 * (e.latitude - south)) / (north - south) + '%',
            left: (100 * (e.longitude - west)) / (east - west) + '%',
            opacity: (count - index + 3) / count,
            background: index < 5 ? 'red' : 'white',
          }))
          .reverse()
          .concat(),
      };
    },

    // Feedback
    nearbyCheckpoints() {
      if (!this.parsed.position) return []; // this.checkpoints;
      return this.checkpoints
        .map((c) => ({
          ...c,
          distance: haversine(this.parsed.position, c),
        }))
        .filter((c) => c.distance < 1000)
        .sort((a, b) => a.distance - b.distance);
    },
    closestCheckpoint() {
      if (!this.parsed.position) return;
      const distances = this.checkpoints.map((c) =>
        haversine(this.parsed.position, c)
      );
      const min = Math.min(...distances);
      //console.log("min", min, distances);
      return this.checkpoints[distances.indexOf(min)];
    },
  },
  methods: {
    formatNumber,
    async usb() {
      console.log('ex', exports);
      const x = await exports.serial.requestPort(
        {},
        { usbControlInterfaceClass: 255, usbTransferInterfaceClass: 255 }
      );
      console.log('ok', x);
      this.supported = true;
      this.testPort(x);
      return;

      const ok = await navigator.usb.requestDevice({
        filters: [
          {
            classCode: 0,
          },
          {
            classCode: 1,
          },
          {
            classCode: 2,
          },
          {
            classCode: 3,
          },
          {
            classCode: 10,
          },
        ],
      });
    },
    /* Input */
    setExample() {
      this.input = { type: 'example', data: [] };
      this.data = ['yo', 'lo'];
    },
    async startSerial() {
      if (!this.serialSupport) return alert('WebSerial not available');
      this.input = { type: 'serial' };
    },
    clearInput() {
      this.input = null;
      this.data = [];
    },
    rtkOnly() {
      this.data = this.parsed.relevant
        .filter((r) => r.quality === 'rtk' || r.quality === '4')
        .map((r) => r.raw + '\n');
    },

    /* Parse */

    /* Connect */
    async getPorts() {
      if (this.serialSupport) {
        try {
          console.log('getPorts s');
          const x = await navigator.serial.getPorts();
          console.log('getPorts', x);
          this.serialPorts = x.slice();
          setTimeout(() => {
            console.log('qsdf');
          }, 1000);
          setTimeout(() => {
            console.log('qsdf');
          }, 2000);
        } catch (e) {
          console.log('getPorts error', e);
        }
      }
    },

    async getPort(evt) {
      if (!this.serialSupport) return alert('WebSerial not available');

      try {
        this.warning = '';

        // Connect
        this.serialStatus = 'requesting';
        this.serialPort = await navigator.serial.requestPort();
        this.serialStatus = 'received';

        /*
                          this.serialPort.addEventListener("connect", async () => {
                            console.log("connected", this.serialPort);
                            this.serialConnected = true;

                            // Open
                            this.serialStatus = "opening";
                            await this.serialPort.open({ baudRate: 9600 });
                            this.reader = this.serialPort.readable.getReader();
                            this.writer = this.serialPort.writable.getWriter();
                            this.serialStatus = "open";
                            this.readStart();
                          });
                          this.serialPort.addEventListener("disconnect", () => {
                            this.serialConnected = false;
                          });
                          */
        console.log('port', this.serialPort);

        this.testPort(this.serialPort);
      } catch (err) {
        this.serialStatus = 'error';
        this.serialError = err;
        this.readPause();
        console.error('rror opening serial port:', err);
      }
    },
    async readStart() {
      console.log('readStart');
      this.reading = true;
      this.read();
    },
    async readPause() {
      this.reading = false;
      //localStorage.data = JSON.stringify(this.data);
    },
    async closePort() {
      this.reading = false;
      this.serialStatus = 'almost closing';
      if (this.readLock?.catch) await this.readLock.catch(() => {});
      this.serialStatus = 'closing';
      await this.serialPort?.close();
      this.serialPort = null;
      this.serialStatus = null;
      //localStorage.data = JSON.stringify(this.data);
    },
    async read() {
      if (!this.reading) return console.log('not reading');
      if (this.readLock) return console.log('readLock');
      if (this.warning) this.warning = '';

      this.readLock = this.readPromise();
      try {
        this.data.push(await this.readLock);
      } catch (err) {
        const errorMessage = `error reading data: ${err}`;
        console.error(errorMessage);
        return errorMessage;
      }
      this.readLock = false;
      if (!this.reading) return;
      setTimeout(() => this.read(), 10);

      clearTimeout(this.t);
      this.t = setTimeout(() => {
        return; // dont scroll
        document
          .getElementById('bottom')
          .scrollIntoView({ behavior: 'smooth' });
      }, 50);
    },
    async readPromise() {
      return new Promise(async (resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Timeout 4000')), 4000);

        this.reader.read().then((readerData) => {
          clearTimeout(t);
          resolve(decoder.decode(readerData.value));
        });
      });
    },
    async send() {
      const lines = this.commandText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('!HEX') || line.startsWith('!WAIT'));
      for (const line of lines) {
        if (line.startsWith('!HEX')) {
          const msg = Uint8Array.from(
            line
              .trim()
              .split(' ')
              .slice(1)
              .map((str) => parseInt(str, 16))
          );
          const ok = await this.writer.write(msg);
          console.log('ORG', line);
          console.log('CMD', uprint(msg), ok);
          await new Promise((res) => setTimeout(res, 100));
        }
        if (line.startsWith('!WAIT')) {
          const ms = parseFloat(line.slice(6));
          await new Promise((res) => setTimeout(res, ms));
        }
      }
      console.log('All sent!');
    },
    async cfg(type, frequency) {
      if (type.startsWith('$')) type = type.slice(3);

      const result = cfg_msg(type, frequency);

      try {
        const ok = await this.writer.write(result);
        console.log('written', uprint(result), ok);
      } catch (e) {
        console.log('not written', uprint(result));
      }
    },
    async disable(type) {
      if (type.startsWith('$')) type = type.slice(3);

      const result = disable(type);
      try {
        const ok = await this.writer.write(result);
        console.log('written', uprint(result), ok);
      } catch (e) {
        console.log('not written', uprint(result));
      }
    },
    async warn(message) {
      this.warning = message;
    },
    async toggleNtrip() {
      this.ntrip = !this.ntrip;

      if (!this.ntrip && this.ntripSubscription) {
        console.log('Ntrip stop');
        this.ntripSubscription();
        this.ntripSubscription = null;
      } else if (this.ntrip) {
        const info = this.parsed.gga;
        if (!info) {
          return console.log('waiting for parsed gga/rmc', info);
        }
        if (!info.latitude) {
          return console.log('waiting for valid gga/rmc', info);
        }

        if (this.ntripSubscription) {
          this.ntripSubscription();
          await second();
        }

        console.log('start ntripSubscription', this.parsed.gga);
        this.ntripSubscription = ntrip(this.parsed.gga.raw, (data) => {
          if (this.writer) this.writer.write(data);
          else console.log('Subscription goes to waste');
        });

        const same = this.ntripSubscription;
        setTimeout(() => {
          if (this.ntripSubscription === same) {
            this.ntrip = false;
            this.toggleNtrip();
          }
        }, 50 * 1000);
      }
    },

    // Analyse

    // Feedback
    createCheckpoint() {
      const display = prompt('Name for the checkpoint:');
      if (!display) return;
      this.checkpoints.push({
        display,
        data: [this.parsed.position],
        latitude: this.parsed.position.latitude,
        longitude: this.parsed.position.longitude,
      });
    },
  },
  mounted() {
    // if (this.data.length) this.parsed = parseGPS(this.data.join(""));
    // this.getPorts();
    this.receiverStore.init();
  },
  watch: {
    'parsed.gga'(v, o) {
      if (v && !o) {
        if (!this.ntrip) return;
        if (this.ntripSubscription)
          console.warn('unexpected ntripSubscription in gga');
        console.log('start ntripSubscription');
        this.ntripSubscription = ntrip(v.raw, (data) => {
          this.writer.write(data);
        });
        const same = this.ntripSubscription;
        setTimeout(() => {
          if (this.ntripSubscription === same) {
            this.ntrip = false;
            this.toggleNtrip();
          }
        }, 50 * 1000);
      }
      if (!v && this.ntripSubscription) {
        this.ntripSubscription();
        this.ntripSubscription = null;
      }
    },
  },
});

const decoder = new TextDecoder();
function second() {
  return new Promise((res) => setTimeout(res, 1000));
}
</script>

<template>
  <div>
    <div class="controls" v-cloak>
      <h1 class="p-2 font-bold">
        GNSS Debugger {{ receiverStore.serialStatus }}
      </h1>
      <p v-if="!serialSupport">Your browser does not support WebSerial</p>

      <!-- Receiver -->
      <div class="panel flex gap-3 items-center">
        <label>Receiver</label>
        <button
          @click="receiverStore.initSerial"
          :disabled="!receiverStore.supportSerial"
        >
          WebSerial
        </button>
        <button
          @click="receiverStore.initUSB"
          :disabled="!receiverStore.supportUSB"
        >
          WebUSB
        </button>
        <button
          @click="receiverStore.initNative"
          :disabled="!receiverStore.supportNative"
        >
          Native
        </button>
        <button
          @click="receiverStore.initDemo"
          :class="{ active: receiverStore.demoInterval }"
          :disabled="!receiverStore.supportDemo"
        >
          Demo
        </button>
        <span v-if="input">
          <span v-if="input.type === 'serial'">
            Serial

            <span>
              <button @click="readPause" v-if="reading">Pause reading</button>
              <button @click="readStart" v-else>Start reading</button>
              <button @click="closePort" v-if="serialStatus">Close port</button>
              {{ serialStatus }} {{ serialError?.message }}
            </span>
          </span>
          <span v-if="input.type === 'example'">
            <button @click="clearInput()">Close example</button>
            <button @click="clearAllInput()">Close example</button>
          </span>
        </span>
      </div>

      <!-- Serial ports -->
      <div
        class="panel flex gap-3 items-center"
        v-if="receiverStore.serialPorts.data?.length"
      >
        <label>Ports</label>
        <div
          class="button-group"
          :class="{ active: port === receiverStore.serialPort }"
          v-for="(port, index) in receiverStore.serialPorts.data"
        >
          <button @click="receiverStore.toggle(port)">Port {{ index }}</button>
          <button @click="receiverStore.forget(port)">&times;</button>
        </div>
        {{ test }}
        {{ receiverStore.messages.length }}
      </div>

      <!-- Serial ports error -->
      <div
        class="panel flex gap-3 items-center"
        v-if="receiverStore.serialPorts.error"
      >
        <label>Ports</label>
        {{ receiverStore.serialPorts.error.message }}
      </div>

      <!-- NTRIP -->
      <div
        class="panel flex gap-3 items-center"
        v-if="receiverStore.hasRecentData"
      >
        <label>Ntrip</label>
        <button @click="toggleNtrip">Toggle</button>
        {{ ntripSubscription ? 'active' : ntrip ? 'waiting' : 'disabled' }}
        <span v-if="ntripSubscription">
          <label>Subscription!</label>
        </span>
      </div>

      <!-- Send commands to receiver -->
      <div class="panel flex gap-3 items-center" v-if="receiverStore.connected">
        <label>Command</label>
        <span>
          GGA
          <button @click="cfg('GGA', 0)">0</button>
          <button @click="cfg('GGA', 1)">1</button>
          <button @click="cfg('GGA', 5)">5</button>
        </span>
        <span>
          RMC
          <button @click="cfg('RMC', 0)">0</button>
          <button @click="cfg('RMC', 1)">1</button>
          <button @click="cfg('RMC', 5)">5</button>
        </span>
      </div>

      <!-- Checkpoints -->
      <div class="panel flex gap-3 items-center" v-if="parsed.position">
        <label>Checkpoints</label>
        <button v-for="checkpoint in nearbyCheckpoints" class="checkpoint">
          {{ checkpoint.display }} {{ formatNumber(checkpoint.distance) }}m
        </button>
        <button @click="createCheckpoint">add</button>
      </div>

      <!-- Base analysis -->
      <div
        class="panel flex flex-wrap gap-3 items-center params"
        v-if="receiverStore.hasData"
      >
        <span class="time" v-if="parsed.time">{{ parsed.time }}</span>
        <span class="speed" v-if="parsed.rmc">
          {{ parsed.rmc?.speed }}
          <small>m/s</small>
        </span>
        <span
          class="course"
          v-if="parsed.rmc"
          :style="{ transform: 'rotate(' + parsed.rmc.course + 'deg)' }"
          >⬆</span
        >
        <span id="log">{{ parsed.entries?.length }}</span>
        <span id="understanding" v-if="parsed.understanding"
          >{{ (parsed.understanding * 100).toPrecision(3) }}%</span
        >
        <span v-if="parsed.rmc?.course">Course {{ parsed.rmc?.course }}</span>
        <span v-if="parsed.rmc?.quality"
          >QualityRMC: {{ parsed.rmc?.quality }}</span
        >
        &middot;
        <span v-if="parsed.gll?.quality"
          >QualityGLL: {{ parsed.gll?.quality }}</span
        >
        &middot;
        <span v-if="parsed.gga?.quality"
          >QualityGGA: {{ parsed.gga?.quality }}</span
        >
        &middot;
        <span v-if="parsed.var3">Var3: {{ parsed.var3 }}</span> &middot;
        <span v-if="parsed.var10">Var10: {{ parsed.var10 }}</span> &middot;
        <span v-if="parsed.var30">Var30: {{ parsed.var30 }}</span> &middot;
        <span v-if="parsed.variance">Variance: {{ parsed.variance }}</span>
        &middot;
        <span v-if="parsed.stddev">Stddev: {{ parsed.stddev }}</span>
      </div>
      <div class="warning" v-if="warning">{{ warning }}</div>
      <div v-if="receiverStore.hasData">
        <div v-for="(type, t) in parsed.counts">
          <span class="type-name">{{ type.type }}</span>
          <button @click="cfg(type.type, 0)">0</button>
          <button @click="cfg(type.type, 1)">1</button>
          <button @click="cfg(type.type, 5)">5</button>

          {{ type.count }}
        </div>
      </div>

      <div class="output" v-if="receiverStore.hasData">
        View:
        <button @click="command = !command">Command</button>
        <button @click="scatter = !scatter">Scatter</button>
        <button @click="view = 'hidden'">Hidden</button>
        <button @click="view = 'original'">Original</button>
        <button @click="view = 'ascii'">ASCII</button>
        <button @click="view = 'json'">JSON</button>
        <button
          v-if="parsed.gga"
          @click="
            data = [parsed.gga.raw + '\n'];
            warning = '';
          "
        >
          Semi-Clear
        </button>
        <button
          v-if="parsed.gga"
          @click="
            data = [parsed.gga.raw + '\n'];
            warning = '';
          "
        >
          Garden
        </button>
        <button
          @click="
            data = [];
            warning = '';
          "
          v-if="data.length"
        >
          Clear
        </button>
        <button @click="rtkOnly">RTK only</button>
      </div>
    </div>
    <div class="command" v-if="command">
      <textarea
        v-model="commandText"
        placeholder="!HEX F1 D9 06 01 03 00 F0 00 00 FA 0F"
      ></textarea>
      <button @click="send">Execute command</button>
    </div>
    <div class="bg-black flex justify-content h-[200px]">
      <div
        id="scatter"
        v-if="scatter && scatterGraph"
        :style="scatterGraph.style"
      >
        <div>
          ↔ {{ scatterGraph.horizontal }}
          <br />
          ↕ {{ scatterGraph.vertical }}
        </div>
        <div
          class="point"
          v-for="point in scatterGraph.checkpoints"
          :style="point"
        ></div>
        <div
          class="point"
          v-for="point in scatterGraph.points"
          :style="point"
        ></div>
      </div>
    </div>
    <pre id="parsed" v-if="view !== 'hidden'" v-cloak>{{
      view === 'original'
        ? dataString
        : view === 'ascii'
        ? asciiLines.join('\n')
        : parsed
    }}</pre>
  </div>
</template>

<style scoped>
.controls {
  /*  z-index: 2;
position: sticky;
  top: 0;*/
  background: hsl(240, 30%, 14%);
}
.panel {
  padding: 0.5em;
  border-bottom: 1px solid hsla(180, 30%, 80%, 20%);
}
.time {
  font-weight: bold;
  font-size: 20px;
  opacity: 0.5;
}
.speed {
  display: inline-block;
  font-weight: bold;
  font-size: 30px;
  min-width: 3em;
}
.warning {
  font-weight: bold;
  font-size: 30px;
  background: orange;
}
.scatter {
}
#scatter {
  background: #000;
  max-width: 100%;
  max-height: 200px;
  position: relative;
}
.point {
  position: absolute;
  width: 4px;
  height: 4px;
  background: white;
  opacity: 0.3;
  border-radius: 10px;
  transition: all 1s;
}
#parsed {
  border-bottom: 1px solid #555;
  padding: 0.5em;
}
#pardsed {
  padding: 0.5em;
}
.type-name {
  display: inline-block;
  width: 100px;
}
.command textarea {
  display: block;
  width: 100%;
  height: 200px;
}
.checkpoint.active {
  background: #cfc;
  border: 1px solid #090;
}
</style>
