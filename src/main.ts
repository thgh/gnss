import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import { VueLocal } from './ls';
import { createPinia } from 'pinia';

VueLocal.install(App);
const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.mount('#app');
