import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { attachRelay } from './server/relay.mjs';

// `npm run dev` and `npm run preview` also run the multiplayer relay at /relay, so rooms work locally with no setup.
const relay = () => ({
  name: 'rewind-relay',
  configureServer(server) { if (server.httpServer) attachRelay(server.httpServer, '/relay'); },
  configurePreviewServer(server) { if (server.httpServer) attachRelay(server.httpServer, '/relay'); },
});

export default defineConfig({
  plugins: [react(), relay()],
});
