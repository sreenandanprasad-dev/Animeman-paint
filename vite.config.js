import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
export default defineConfig({
  base: './', plugins: [react()],
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'], headers },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'], headers },
  build: { target: 'chrome109', chunkSizeWarningLimit: 750, rollupOptions: { output: { manualChunks(id) {
    if (id.includes('/node_modules/three/')) return 'three';
    if (id.includes('/node_modules/@pixiv/')) return 'vrm';
  } } } },
});
