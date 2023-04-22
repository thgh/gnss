/* Localstorage helper */

export function ls(key: string | number, value?: undefined) {
  if (typeof key === 'undefined') {
    return window.localStorage;
  }
  if (typeof value === 'undefined') {
    return window.localStorage[key] && JSON.parse(window.localStorage[key]);
  }
  window.localStorage[key] = JSON.stringify(value);
}

export function lsDefault(key: string | number, value: undefined) {
  if (!key || typeof value === 'undefined') {
    return console.warn('lsDefault: key & value expected');
  }
  if (!ls(key)) {
    ls(key, value);
  }
}

export function inert(a: any) {
  return JSON.parse(JSON.stringify(a));
}

export const VueLocal = {
  install(Vue: any) {
    /*
    Vue.mixin({
      created() {
        if (this.$options.local !== undefined) {
          if (!Array.isArray(this.$options.local)) {
            throw new Error('vm.local must be an Array');
          }
          this.$options.local.forEach((path: string) => {
            // Set to saved value or keep default
            this[path] = ls(path) || this[path];

            // Start watcher
            this.$watch(
              path,
              (newVal: any) => {
                ls(path, newVal);
              },
              { deep: true }
            );
          });
        }
      },
    });*/
  },
};
