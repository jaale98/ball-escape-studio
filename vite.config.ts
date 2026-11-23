import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

/**
 * Dev-only endpoint: POST /__studio/scene?name=foo with a JSON body overwrites
 * scenes/foo.json (an existing scene only). Used by "Save to file" in the studio.
 */
function sceneEndpoint(): Plugin {
  return {
    name: 'studio-scene',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__studio/scene', (req, res) => {
        const fail = (code: number, msg: string) => {
          res.statusCode = code;
          res.end(msg);
        };
        if (req.method !== 'POST') return fail(405, 'POST only');
        const url = new URL(req.url ?? '', 'http://localhost');
        const name = url.searchParams.get('name') ?? '';
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return fail(400, 'bad scene name');
        const file = resolve(server.config.root, 'scenes', `${name}.json`);
        if (!existsSync(file)) return fail(404, `no scene ${name}`);
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            return fail(400, 'body is not JSON');
          }
          writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ file: `scenes/${name}.json` }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [captureEndpoint(), sceneEndpoint()],
});
