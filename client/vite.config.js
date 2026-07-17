import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [react(), basicSsl()],
  build: {
    rollupOptions: {
      output: {
        // Bundle everything (incl. lazy imports like TopologyScene3D) into ONE
        // JS file. When the app is served through the free ngrok tunnel, a
        // separate dynamic-import chunk request gets ngrok's browser-warning
        // interstitial (HTML) instead of the JS module, so the combined
        // topology failed to load ("Load failed"). A single bundle loads as
        // part of the page (which already cleared the interstitial), so there's
        // no separate chunk request to break. Harmless for the native apps —
        // they load the bundle locally either way.
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    // Allow any Host header so a public tunnel (e.g. *.trycloudflare.com) can
    // reach the dev server — otherwise Vite blocks unknown hosts.
    allowedHosts: true,
    watch: {
      usePolling: true,
      interval: 1000,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/outputs': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
