import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'web-dist', sourcemap: false },
  server: { port: 5173, strictPort: true },
});
