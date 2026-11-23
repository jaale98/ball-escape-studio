import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev-only endpoint: POST /__studio/capture?name=foo with an image body saves
 * captures/foo.(png|jpg). Lets the studio (and Claude Code in folder mode)
 * save full-resolution stills of the preview to disk.
 */
function captureEndpoint(): Plugin {
  return {
    name: 'studio-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__studio/capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const url = new URL(req.url ?? '', 'http://localhost');
        const name = (url.searchParams.get('name') ?? 'frame').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'frame';
        const ext = req.headers['content-type'] === 'image/jpeg' ? 'jpg' : 'png';
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const dir = resolve(server.config.root, 'captures');
          mkdirSync(dir, { recursive: true });
          const file = resolve(dir, `${name}.${ext}`);
          writeFileSync(file, Buffer.concat(chunks));
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ file: `captures/${name}.${ext}` }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [captureEndpoint()],
});
