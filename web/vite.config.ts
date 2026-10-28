import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { loadConfig } from '../src/config.ts';
import { webSourcesHash } from '../src/dist-stamp.ts';

// the server's port: FV_PORT for `serve --port N`, else as `serve` without --port picks it (foreman-vision.conf, else 4780)
const { port } = loadConfig(process.env.FV_PORT ? ['--port', process.env.FV_PORT] : []);

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    react(),
    // web/dist is committed; test/dist.test.ts compares this stamp with the sources
    { name: 'sources-stamp', generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sources.sha256', source: webSourcesHash(fileURLToPath(new URL('..', import.meta.url))) + '\n' });
    } },
  ],
  build: { outDir: 'dist', emptyOutDir: true },
  // changeOrigin: the server's Host check lets only 127.0.0.1:<port> / localhost:<port> in
  server: { proxy: Object.fromEntries(['/events', '/api'].map(p => [p, { target: `http://127.0.0.1:${port}`, changeOrigin: true }])) },
});
