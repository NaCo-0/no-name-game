import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

function bakeServerPlugin() {
  return {
    name: 'bake-server-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost');

        if (url.pathname === '/api/bake-check') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ supported: true, target: 'dist/' }));
          return;
        }

        if (url.pathname === '/api/bake-clear' && req.method === 'POST') {
          try {
            const distTerrain = path.resolve(__dirname, 'dist', 'terrain');
            if (fs.existsSync(distTerrain)) {
              const files = fs.readdirSync(distTerrain);
              files.forEach((f) => {
                try { fs.unlinkSync(path.join(distTerrain, f)); } catch (e) {}
              });
            }
          } catch (err) {}
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (url.pathname === '/api/bake-file' && req.method === 'POST') {
          const relPath = url.searchParams.get('path');
          if (!relPath) {
            res.statusCode = 400;
            res.end('Missing ?path=');
            return;
          }

          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            const buffer = Buffer.concat(chunks);

            // 1. Write directly to dist/
            const distPath = path.resolve(__dirname, 'dist', relPath);
            fs.mkdirSync(path.dirname(distPath), { recursive: true });
            fs.writeFileSync(distPath, buffer);

            // 2. Also write to public/ if not a junction loop
            try {
              const pubPath = path.resolve(__dirname, 'public', relPath);
              fs.mkdirSync(path.dirname(pubPath), { recursive: true });
              fs.writeFileSync(pubPath, buffer);
            } catch (err) {}

            // 3. Also sync to Desktop copy if it exists
            try {
              const desktopPath = path.resolve('C:/Users/LOQ/Desktop', relPath);
              if (fs.existsSync(path.dirname(desktopPath))) {
                fs.writeFileSync(desktopPath, buffer);
              }
            } catch (err) {}

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: relPath, size: buffer.length }));
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [bakeServerPlugin()],
  server: {
    port: 5173,
    host: true,
  },
});
