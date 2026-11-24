/**
 * Dev-server endpoints for the studio (only active under `npm run dev`).
 *
 *   POST /__studio/capture?name=     save an image to captures/
 *   POST /__studio/scene?name=       overwrite scenes/<name>.json ("Save to file")
 *   POST /__studio/ai                run Claude Code on a prompt; streams NDJSON AiEvents
 *   GET  /__studio/history?name=     versions of a scene, newest first
 *   POST /__studio/history/restore   { name, id } write an old version back (as a new version)
 *   POST /__studio/rate              { name, rating, title, summary, note? } append to .studio/taste.md
 *   POST /__studio/song?name=        add a MIDI file to songs/
 *   POST /__studio/export?name=      save an MP4 to exports/
 *   POST /__studio/export-meta       caption, scene and log row for an export
 *   GET  /__studio/exports           past exports (from exports/log.csv)
 *   POST /__studio/reveal            { file } show an export (or the folder) in Finder / Explorer
 *   POST /__studio/scene-op          { op: derive|duplicate|rename|delete, name, to? }
 *
 * Every change to a scene file (from the AI, a slider save, a restore, or your
 * editor) is snapshotted in .studio/history/<scene>/ so nothing is ever lost.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { type AiEvent, isAuthError, runClaude } from './claude';

interface Version {
  id: number;
  time: string;
  label: string;
}

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

function send(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

export function studioPlugin(): Plugin {
  let root = process.cwd();
  const scenesDir = () => resolve(root, 'scenes');
  const historyDir = (name: string) => resolve(root, '.studio', 'history', name);
  /** Why the next change to a scene file happens (consumed by the watcher). */
  const pendingLabels = new Map<string, string>();
  let job: ChildProcess | null = null;
  /** While an AI job runs (and briefly after), scene changes are credited to it. */
  let jobLabel: string | null = null;
  let jobLabelTimer: ReturnType<typeof setTimeout> | undefined;
  /** Claude Code session per scene, so follow-up prompts keep context. */
  const sessions = new Map<string, string>();

  const readIndex = (name: string): Version[] => {
    try {
      return JSON.parse(readFileSync(join(historyDir(name), 'index.json'), 'utf8'));
    } catch {
      return [];
    }
  };

  const snapshot = (file: string, fallbackLabel: string) => {
    const name = basename(file, '.json');
    if (dirname(file) !== scenesDir() || !NAME.test(name) || !existsSync(file)) return;
    const text = readFileSync(file, 'utf8');
    const dir = historyDir(name);
    mkdirSync(dir, { recursive: true });
    const index = readIndex(name);
    const last = index[index.length - 1];
    if (last && readFileSync(join(dir, `${last.id}.json`), 'utf8') === text) return; // unchanged
    const label = pendingLabels.get(file) ?? jobLabel ?? fallbackLabel;
    pendingLabels.delete(file);
    const id = (last?.id ?? 0) + 1;
    writeFileSync(join(dir, `${id}.json`), text);
    index.push({ id, time: new Date().toISOString(), label });
    writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 1));
  };

  return {
    name: 'ball-escape-studio',
    apply: 'serve',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      // Baseline snapshot of every scene, then snapshot every change.
      if (existsSync(scenesDir())) {
        for (const f of readdirSync(scenesDir())) if (f.endsWith('.json') && !readIndex(basename(f, '.json')).length) snapshot(join(scenesDir(), f), 'original');
      }
      const onChange = (file: string) => file.endsWith('.json') && snapshot(file, 'edited in a file');
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);

      server.middlewares.use('/__studio/capture', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        const url = new URL(req.url ?? '', 'http://x');
        const name = (url.searchParams.get('name') ?? 'frame').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'frame';
        const ext = req.headers['content-type'] === 'image/jpeg' ? 'jpg' : 'png';
        const body = await readBody(req);
        mkdirSync(resolve(root, 'captures'), { recursive: true });
        writeFileSync(resolve(root, 'captures', `${name}.${ext}`), body);
        send(res, 200, { file: `captures/${name}.${ext}` });
      });

      server.middlewares.use('/__studio/scene', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        const params = new URL(req.url ?? '', 'http://x').searchParams;
        let name = params.get('name') ?? '';
        if (!NAME.test(name)) return send(res, 400, { error: 'bad scene name' });
        let file = join(scenesDir(), `${name}.json`);
        if (params.get('create')) {
          // New scene (batch remixes, tournament matches): never overwrite.
          const base = name;
          for (let i = 2; existsSync(file); i++) {
            name = `${base}-${i}`;
            file = join(scenesDir(), `${name}.json`);
          }
        } else if (!existsSync(file)) return send(res, 404, { error: `no scene ${name}` });
        let parsed: unknown;
        try {
          parsed = JSON.parse((await readBody(req)).toString('utf8'));
        } catch {
          return send(res, 400, { error: 'body is not JSON' });
        }
        pendingLabels.set(file, params.get('create') ? 'created by a batch' : 'slider tweaks saved');
        writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
        send(res, 200, { file: `scenes/${name}.json`, name });
      });

      server.middlewares.use('/__studio/song', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
        if (!NAME.test(name)) return send(res, 400, { error: 'bad song name' });
        const body = await readBody(req);
        if (body.length < 14 || body.subarray(0, 4).toString('latin1') !== 'MThd') return send(res, 400, { error: 'not a MIDI file' });
        if (body.length > 2_000_000) return send(res, 413, { error: 'MIDI file too large (2 MB max)' });
        mkdirSync(resolve(root, 'songs'), { recursive: true });
        writeFileSync(resolve(root, 'songs', `${name}.mid`), body);
        send(res, 200, { file: `songs/${name}.mid` });
      });

      server.middlewares.use('/__studio/scene-op', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        const { op, name, to } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if (!NAME.test(String(name))) return send(res, 400, { error: 'bad scene name' });
        const file = join(scenesDir(), `${name}.json`);
        if (!existsSync(file)) return send(res, 404, { error: `There is no scene named ${name}.` });
        const all = readdirSync(scenesDir()).filter((f) => f.endsWith('.json'));
        const extenders = all.filter((f) => {
          try {
            return JSON.parse(readFileSync(join(scenesDir(), f), 'utf8')).extends === name;
          } catch {
            return false;
          }
        });
        const freeName = (want: string) => {
          let n = want;
          for (let i = 2; existsSync(join(scenesDir(), `${n}.json`)); i++) n = `${want}-${i}`;
          return n;
        };
        if (op === 'derive' || op === 'duplicate') {
          if (!NAME.test(String(to))) return send(res, 400, { error: 'Pick a name with letters, numbers and dashes.' });
          const made = freeName(to);
          const raw = JSON.parse(readFileSync(file, 'utf8'));
          const out =
            op === 'derive'
              ? { $schema: '../scene.schema.json', extends: name, title: `${raw.title ?? name} (new)` }
              : { ...raw, title: `${raw.title ?? name} (copy)` };
          const dest = join(scenesDir(), `${made}.json`);
          pendingLabels.set(dest, op === 'derive' ? `new, building on ${name}` : `duplicated from ${name}`);
          writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
          return send(res, 200, { name: made });
        }
        if (op === 'rename') {
          if (!NAME.test(String(to))) return send(res, 400, { error: 'Pick a name with letters, numbers and dashes.' });
          if (existsSync(join(scenesDir(), `${to}.json`))) return send(res, 409, { error: `A scene named ${to} already exists.` });
          // Scenes that build on this one follow the new name.
          for (const f of extenders) {
            const p = join(scenesDir(), f);
            const raw = JSON.parse(readFileSync(p, 'utf8'));
            raw.extends = to;
            pendingLabels.set(p, `parent renamed to ${to}`);
            writeFileSync(p, `${JSON.stringify(raw, null, 2)}\n`);
          }
          const dest = join(scenesDir(), `${to}.json`);
          pendingLabels.set(dest, `renamed from ${name}`);
          renameSync(file, dest);
          if (existsSync(historyDir(name)) && !existsSync(historyDir(to))) renameSync(historyDir(name), historyDir(to));
          return send(res, 200, { name: to });
        }
        if (op === 'delete') {
          if (extenders.length) return send(res, 409, { error: `Other scenes build on ${name}: ${extenders.map((f) => f.replace(/\.json$/, '')).join(', ')}. Delete or rename those first.` });
          const trash = resolve(root, '.studio', 'trash');
          mkdirSync(trash, { recursive: true });
          renameSync(file, join(trash, `${name}-${Date.now()}.json`));
          return send(res, 200, { name });
        }
        send(res, 400, { error: 'unknown op' });
      });

      server.middlewares.use('/__studio/exports', (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
        const dir = resolve(root, 'exports');
        const log = join(dir, 'log.csv');
        if (!existsSync(log)) return send(res, 200, []);
        const parse = (line: string) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
        const rows = readFileSync(log, 'utf8')
          .split('\n')
          .slice(1)
          .filter(Boolean)
          .map(parse)
          .filter((c) => c[1] && existsSync(join(dir, c[1])))
          .map(([time, file, scene, seed, , , , seconds]) => ({
            time,
            file,
            scene,
            seed,
            seconds,
            size: statSync(join(dir, file)).size,
            hasScene: existsSync(join(dir, file.replace(/\.mp4$/, '.scene.json'))),
          }))
          .reverse();
        send(res, 200, rows);
      });

      server.middlewares.use('/__studio/reveal', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        const { file } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const dir = resolve(root, 'exports');
        mkdirSync(dir, { recursive: true });
        const target = file ? join(dir, String(file)) : dir;
        if (!target.startsWith(dir) || (file && !/^[a-zA-Z0-9_.-]+$/.test(String(file))) || !existsSync(target)) return send(res, 400, { error: 'not an export' });
        const [cmd, args] =
          process.platform === 'darwin' ? ['open', file ? ['-R', target] : [target]] : process.platform === 'win32' ? ['explorer', file ? [`/select,${target}`] : [target]] : ['xdg-open', [file ? dir : target]];
        spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
        send(res, 200, { ok: true });
      });

      server.middlewares.use('/__studio/export-meta', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        const file = new URL(req.url ?? '', 'http://x').searchParams.get('file') ?? '';
        const m = /^exports\/([a-zA-Z0-9_.-]+)\.mp4$/.exec(file);
        if (!m) return send(res, 400, { error: 'bad file' });
        const { caption, scene, info } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const dir = resolve(root, 'exports');
        if (caption) writeFileSync(join(dir, `${m[1]}.txt`), String(caption));
        if (scene) writeFileSync(join(dir, `${m[1]}.scene.json`), `${JSON.stringify(scene, null, 2)}\n`);
        const log = join(dir, 'log.csv');
        if (!existsSync(log)) writeFileSync(log, 'time,file,scene,seed,speedScale,spinScale,score,seconds,winner\n');
        const i = info ?? {};
        const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        appendFileSync(log, [new Date().toISOString(), `${m[1]}.mp4`, i.scene, i.seed, i.speedScale, i.spinScale, i.score, i.seconds, i.winner].map(cell).join(',') + '\n');
        send(res, 200, { ok: true });
      });

      server.middlewares.use('/__studio/export', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        const raw = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'video';
        const base = raw.replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 100) || 'video';
        const body = await readBody(req);
        mkdirSync(resolve(root, 'exports'), { recursive: true });
        let name = base;
        for (let i = 2; existsSync(resolve(root, 'exports', `${name}.mp4`)); i++) name = `${base}-${i}`;
        writeFileSync(resolve(root, 'exports', `${name}.mp4`), body);
        send(res, 200, { file: `exports/${name}.mp4` });
      });

      server.middlewares.use('/__studio/history/restore', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        const { name, id } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if (!NAME.test(String(name))) return send(res, 400, { error: 'bad scene name' });
        const src = join(historyDir(name), `${Number(id)}.json`);
        if (!existsSync(src)) return send(res, 404, { error: 'no such version' });
        const file = join(scenesDir(), `${name}.json`);
        pendingLabels.set(file, `restored version ${id}`);
        writeFileSync(file, readFileSync(src, 'utf8'));
        send(res, 200, { ok: true });
      });

      server.middlewares.use('/__studio/history', (req, res) => {
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
        if (!NAME.test(name)) return send(res, 400, { error: 'bad scene name' });
        send(res, 200, [...readIndex(name)].reverse());
      });

      server.middlewares.use('/__studio/rate', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        const { name, rating, title, summary, note } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if (!NAME.test(String(name)) || (rating !== 'up' && rating !== 'down')) return send(res, 400, { error: 'bad rating' });
        mkdirSync(resolve(root, '.studio'), { recursive: true });
        const file = resolve(root, '.studio', 'taste.md');
        if (!existsSync(file)) writeFileSync(file, '# Taste notes\n\nLikes and dislikes recorded in the studio. Newest last.\n\n');
        const line = `- ${rating === 'up' ? 'LIKED' : 'DISLIKED'} ${new Date().toISOString().slice(0, 10)} \`${name}\` "${String(title ?? '').slice(0, 80)}": ${String(summary ?? '').slice(0, 400)}${note ? ` Note: ${String(note).slice(0, 300)}` : ''}\n`;
        appendFileSync(file, line);
        send(res, 200, { ok: true });
      });

      server.middlewares.use('/__studio/ai', async (req, res) => {
        if (req.method === 'DELETE') {
          job?.kill('SIGTERM');
          return send(res, 200, { ok: true });
        }
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        if (job) return send(res, 409, { error: 'Claude is already working on something. Stop it first.' });
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const prompt = String(body.prompt ?? '').trim();
        const scene = NAME.test(String(body.scene ?? '')) ? String(body.scene) : undefined;
        if (!prompt) return send(res, 400, { error: 'empty prompt' });

        res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
        const emit = (e: AiEvent) => {
          if (e.type === 'start' && scene) sessions.set(scene, e.session);
          if (e.type === 'done' && !e.ok && isAuthError(e.text)) {
            e = { type: 'error', message: 'Claude Code is not logged in. Run `claude` in a terminal, type /login, then try again.' };
          }
          if (!res.writableEnded) res.write(`${JSON.stringify(e)}\n`);
        };
        const label = `AI: ${prompt.length > 70 ? `${prompt.slice(0, 67)}…` : prompt}`;
        const child = runClaude(
          {
            prompt,
            root,
            scene,
            model: body.model === 'smart' ? 'smart' : 'fast',
            resume: body.fresh || !scene ? undefined : sessions.get(scene),
            onWrite: (abs) => pendingLabels.set(abs, label),
          },
          emit,
        );
        job = child;
        clearTimeout(jobLabelTimer);
        jobLabel = label;
        child.on('close', () => {
          job = null;
          jobLabelTimer = setTimeout(() => (jobLabel = null), 1500);
          if (!res.writableEnded) res.end();
        });
        res.on('close', () => {
          if (job === child) child.kill('SIGTERM'); // browser went away: stop
        });
      });
    },
  };
}
