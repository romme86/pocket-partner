import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: '/pocket-partner/',
  build: { outDir: 'dist' },
  server: { proxy: { '/pocket-partner/api': 'http://127.0.0.1:4174' } },
});
