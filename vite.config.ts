import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/pwa-api': 'http://127.0.0.1:5180', '/_AMapService': 'http://127.0.0.1:5180' } },
  build: { chunkSizeWarningLimit: 900, rollupOptions: { output: { manualChunks(id:string) { if(id.includes('/node_modules/')&&id.includes('/three/'))return 'three'; if(id.includes('/node_modules/')&&/\/react(?:-dom)?\//.test(id))return 'react'; } } } },
});
