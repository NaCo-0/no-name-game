import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dar develop: panel roo-ye 5174 va API ro be backend (3000) proxy mikone
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:3000', '/ws': { target: 'ws://localhost:3000', ws: true } },
  },
});
