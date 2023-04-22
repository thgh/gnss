import { defineStore } from 'pinia';

export const useNtripActivator = defineStore('ntrip', ()=>{

})
  export const useNtrip = defineStore('ntrip', {
  state: () => {
    return { socketReconnect: 0, count: 0 } as {
      enabled?: boolean;
      callback?: (x: any) => void;
      center?: string;
      centerAt?: Date;
      socket?: WebSocket;
      socketError?: Error;
      socketReconnect: number;
      socketURL?: string;
      count: number;
    };
  },
  actions: {
    // Manage intent
    enable() {},
    disable() {},

    // Manage socket connection
    // It should turn on when there is a GGA
    async start(raw: string, callback: (x: any) => void) {
      const param = raw.includes('GGA')
        ? 'gga=' + encodeURIComponent(raw)
        : 'str=' + encodeURIComponent(raw.split(',').slice(3, 7).join(','));
      console.log('NTRIP param', param);
      this.callback = callback;
      this.socketURL = 'wss://ntrip.deno.dev/?' + param;
      this.socketReconnect = 1000;
    },

    // Connect or reconnect
    connect() {
      if (!this.socketURL || !this.socketReconnect) {
        this.socket = undefined;
        this.socketReconnect = 0;
        return console.log('Stopped connecting');
      }

      const next = new WebSocket(this.socketURL);
      next.onmessage = this.onmessage;
      next.onclose = () => {
        console.log('NTRIP connection closed', this.socketReconnect);
        if (this.socketReconnect) {
          // Cleanup
          next.onmessage = () => {};
          next.onclose = () => {};

          // Reconnect
          console.log('NTRIP Reconnect in ', this.socketReconnect, 'ms');
          setTimeout(() => {
            const x = this.connect();
            if (x) this.socket = x;
          }, this.socketReconnect);
          this.socketReconnect *= 2;
        }
      };
      return next;
    },

    // Handle messages
    async onmessage(evt: MessageEvent) {
      if (evt.data === 'Welcome') return console.log('NTRIP says welcome!');
      if (evt.data === 'bye') {
        console.log('NTRIP says bye!');
        this.socket?.close();
        return;
      }
      const data = evt.data;
      const callback = this.callback;
      this.count++;
      if (callback) {
        const x = await data.arrayBuffer();
        console.log('ntrip', data, x);
        this.count += x.length;
        callback(x);
      } else console.log('ntrip data going to waste');
    },
    async stop() {
      this.socketReconnect = 0;
      this.socket?.close();
    },
  },
  getters: {
    supportSerial() {
      return 'serial' in navigator;
    },
  },
});
