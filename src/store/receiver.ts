import { defineStore } from 'pinia';
import { Loadable } from './types';
import {
  formatNumber,
  gneaChecksum,
  parseGPS,
  parseLine,
  parseNMEA,
} from '../gps';

interface NativeDevice {
  id: string;
}

type Tech = 'serial' | 'usb' | 'native';

export const useReceiver = defineStore('receiver', {
  state: () => {
    return {
      tech: '',
      support: [
        'serial' in navigator && 'serial',
        'usb' in navigator && 'usb',
        'gnss' in navigator && 'native',
      ],
      serialStatus: '',
      serialPorts: {},
      usbDevices: {},
      nativeDevices: {},
      messages: [],
      demoInterval: 0,
    } as {
      tech: '' | Tech;
      support: Tech[];
      serialStatus: '' | 'requesting' | 'opening' | 'open' | 'reading';
      serialPort?: SerialPort;
      serialError?: Error;
      serialPorts: Loadable<SerialPort[]>;
      usbDevice?: USBDevice;
      usbDevices: Loadable<USBDevice[]>;
      nativeDevice?: NativeDevice;
      nativeDevices: Loadable<NativeDevice[]>;
      demoInterval?: number;
      messages: any[];
    };
  },
  actions: {
    async init() {
      if ('serial' in navigator) {
        try {
          console.log('getPorts serial');
          this.serialPorts.loading = true;
          const x = await navigator.serial.getPorts();
          this.serialPorts.data = x.slice();
        } catch (e: any) {
          this.serialPorts.error = e;
          console.log('getPorts error', e);
        }
      }
      if ('usb' in navigator) {
        try {
          console.log('getPorts sub');
          this.usbDevices.loading = true;
          const x = await navigator.usb.getDevices();
          this.usbDevices.data = x.slice();
        } catch (e: any) {
          this.usbDevices.error = e;
          console.log('getPorts error', e);
        }
      }
    },
    async initSerial() {
      if (!('serial' in navigator)) return alert('WebSerial not available');

      try {
        if (this.serialPort) {
          await this.close(this.serialPort);
        }
        this.serialStatus = 'requesting';
        this.serialError = undefined;
        const port = await navigator.serial.requestPort();
        this.init();
        this.toggle(port);
      } catch (err: any) {
        this.serialError = err;
        console.error('error opening serial port:', err);
      } finally {
        this.serialStatus = '';
      }
    },
    initUSB() {},
    initNative() {},
    initDemo() {
      if (this.demoInterval) {
        clearInterval(this.demoInterval);
        this.demoInterval = undefined;
        return;
      }
      const tick = () => {
        const date = new Date().toJSON();
        const now = date.slice(11, 19).replace(':', '').replace(':', '');
        const data =
          '$GPGGA,' +
          now +
          '.000,5101.51' +
          Math.floor(Math.random() * 2000)
            .toString()
            .padStart(5, '0') +
          ',N,00346.18' +
          Math.floor(Math.random() * 10000)
            .toString()
            .padStart(5, '0') +
          ',E,1,21,0.6,12.042,M,46.000,M,,0000';
        this.messages.push(parseLine(gneaChecksum(data)));
      };
      tick();
      this.demoInterval = setInterval(tick, 100);
    },

    // Manage serial port
    async close(port: SerialPort) {
      if (this.serialPort === port) {
        console.log('close clear 1');
        this.serialPort = undefined;
        this.serialStatus = '';
      }
      try {
        await port.readable.getReader().releaseLock();
      } catch (e) {}
      try {
        await port.readable.cancel();
      } catch (e) {}
      try {
        await port.writable.close();
      } catch (e) {}
      try {
        await port.writable.abort();
      } catch (e) {}
      try {
        await port.close();
      } catch (e) {}
      if (this.serialPort === port) {
        console.log('close clear 2');
        this.serialPort = undefined;
        this.serialStatus = '';
      }
    },
    async forget(port: SerialPort) {
      console.log(
        'forget',
        !!port,
        !!this.serialPort,
        port === this.serialPort
      );
      if (port === this.serialPort && this.serialOpen) {
        await this.close(port);
      }
      await port.forget();
      this.init();
    },
    async toggle(port: SerialPort) {
      console.log(
        'toggle',
        !!port,
        !!this.serialPort,
        port === this.serialPort
      );
      // Close existing
      if (this.serialPort === port) {
        console.log('Toggle off');
        return this.close(port);
      }

      // Close before making a new connection
      if (this.serialPort) {
        console.log('Close before new');
        await this.close(this.serialPort);
      }

      this.serialPort = port;
      return this.open();
    },
    async open() {
      // Set serialPort before calling open()
      if (!this.serialPort) return alert('Select a serial port first');
      const port = this.serialPort;
      console.log('open', port);
      this.serialStatus = 'opening';

      try {
        // Baudrate doesn't matter, they all work 9600, 115200, ...
        await port.open({ baudRate: 115200 });
        console.log('opened', port);

        // Success!
        this.serialStatus = 'open';

        // Read forever
        this.readStart();
      } catch (e: any) {
        this.serialError = e;
      }
    },
    async readStart() {
      if (!this.serialPort) return alert('Missing port');
      if (this.serialStatus !== 'open') return alert('Wait for open');

      const reader = parseNMEA(this.serialPort.readable).getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            throw new Error('Done with data');
          }
          this.messages.push(value);
        }
      } catch (error: any) {
        console.log('err', error);
        this.serialError = error;
      } finally {
        reader.releaseLock();
      }
    },

    // Message handling
  },
  getters: {
    supportSerial() {
      return 'serial' in navigator;
    },
    supportUSB() {
      return 'usb' in navigator;
    },
    supportNative() {
      return false;
    },
    supportDemo() {
      return true;
    },
    hasData(state) {
      return state.messages.length;
    },
    hasRecentData(state) {
      const timed = state.messages
        .slice()
        .reverse()
        .find((m) => m.time);
      if (!timed) return false;
      const time = timed.time;
      const date = new Date();
      date.setHours(parseFloat(time.slice(0, 2)));
      date.setMinutes(parseFloat(time.slice(2, 4)));
      date.setSeconds(parseFloat(time.slice(4, 6)));
      date.setMilliseconds(0);
      return date.valueOf() > Date.now() - 60 * 1000;
    },
    readable(state) {
      return state.serialPort?.readable;
    },
    connected(state) {
      return state.serialPort?.readable || state.usbDevice?.opened;
    },
    serialOpen(state) {
      return state.serialStatus === 'open' && state.serialPort;
    },
    writer(state) {
      if (this.serialOpen) return state.serialPort!.writable.getWriter();
    },
    parsed(state) {
      return parseGPS(state.messages.map((m) => m.raw).join('\r\n'));
    },
  },
});
