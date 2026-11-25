/**
 * Export queue: renders kept videos one after another in the background and
 * saves each to exports/ (dev server) or downloads it.
 */
import type { Scene } from '../engine/scene';
import { exportMp4 } from '../export/mp4';
import { DEFAULT_EXPORT, type ExportOptions, exportLabel, exportSuffix, PRESETS } from '../export/presets';

interface Item {
  id: number;
  label: string;
  fileName: string;
  scene: Scene;
  status: 'queued' | 'rendering' | 'saved' | 'failed';
  progress: number;
  detail: string;
  url?: string;
  /** Written next to the video: caption text and run info. */
  meta?: { caption: string; info: Record<string, unknown> };
  /** Preset, frame rate and style. */
  opts: ExportOptions;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const items: Item[] = [];
let nextId = 1;
let running = false;
let setBusy: (busy: boolean) => void = () => {};
let onSaved: () => void = () => {};
const STORE = 'bes:queue';

/** Unfinished exports are kept in the browser so a reload doesn't lose them. */
function persist(): void {
  try {
    const pending = items.filter((i) => i.status === 'queued' || i.status === 'rendering').map(({ label, fileName, scene, meta, opts }) => ({ label, fileName, scene, meta, opts }));
    if (pending.length) localStorage.setItem(STORE, JSON.stringify(pending));
    else localStorage.removeItem(STORE);
  } catch {
    /* storage full or unavailable: the queue still works, it just won't survive a reload */
  }
}

export function initQueue(hooks: { setExporting(busy: boolean): void; onSaved(): void }): number {
  setBusy = hooks.setExporting;
  onSaved = hooks.onSaved;
  $('q-clear').addEventListener('click', () => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].status === 'saved' || items[i].status === 'failed') items.splice(i, 1);
    draw();
  });
  // Resume exports left unfinished last time.
  let resumed: { label: string; fileName: string; scene: Scene; meta?: Item['meta']; opts?: ExportOptions }[] = [];
  try {
    resumed = JSON.parse(localStorage.getItem(STORE) ?? '[]');
  } catch {
    resumed = [];
  }
  // Resumed items already carry their suffix and label.
  for (const r of resumed) push(r.label, r.fileName, r.scene, r.meta, r.opts ?? DEFAULT_EXPORT);
  if (resumed.length) void process();
  return resumed.length;
}

function push(label: string, fileName: string, scene: Scene, meta: Item['meta'], opts: ExportOptions): void {
  items.push({ id: nextId++, label, fileName: fileName.replace(/[^a-zA-Z0-9_.-]+/g, '-'), scene: structuredClone(scene), status: 'queued', progress: 0, detail: '', meta, opts });
  draw();
  persist();
}

/** Queue one export. `opts` picks the preset, frame rate and style (default: the studio preset at 60 fps). */
export function enqueue(label: string, fileName: string, scene: Scene, meta?: Item['meta'], opts: ExportOptions = DEFAULT_EXPORT): void {
  const tag = exportLabel(opts);
  push(opts === DEFAULT_EXPORT ? label : `${label} · ${tag}`, fileName + exportSuffix(opts), scene, meta && { ...meta, info: { ...meta.info, export: tag } }, opts);
  void process();
}

/** Queue several variants of the same run (same scene, same seed): the A/B set. */
export function enqueueVariants(label: string, fileName: string, scene: Scene, meta: Item['meta'] | undefined, variants: ExportOptions[]): void {
  for (const v of variants) {
    push(`${label} · ${exportLabel(v)}`, fileName + exportSuffix(v), scene, meta && { ...meta, info: { ...meta.info, export: exportLabel(v) } }, v);
  }
  void process();
}

let ffmpeg: Promise<boolean> | null = null;
/** Whether the dev server can re-encode with libx264 (false outside the dev server). */
function serverHasFfmpeg(): Promise<boolean> {
  ffmpeg ??= fetch('/__studio/ffmpeg')
    .then((r) => (r.ok ? r.json() : { available: false }))
    .then((j: { available?: boolean }) => !!j.available)
    .catch(() => false);
  return ffmpeg;
}

async function process(): Promise<void> {
  if (running) return;
  running = true;
  setBusy(true);
  try {
    for (let item = items.find((i) => i.status === 'queued'); item; item = items.find((i) => i.status === 'queued')) {
      item.status = 'rendering';
      draw();
      try {
        const { opts } = item;
        const transcode = PRESETS[opts.preset].transcode && (await serverHasFfmpeg());
        const result = await exportMp4(
          item.scene,
          (stage, f) => {
            item.progress = stage === 'video' ? f : stage === 'finish' ? 1 : 0;
            item.detail = stage === 'video' ? `${Math.round(f * 100)}%` : stage;
            draw();
          },
          { ...opts, intermediate: transcode },
        );
        if (transcode) {
          item.detail = 'encoding with libx264…';
          draw();
        }
        const q = new URLSearchParams({ name: item.fileName });
        if (transcode) {
          q.set('transcode', 'tiktok');
          q.set('fps', String(result.fps));
          q.set('audio', result.audioCodec);
        }
        const res = await fetch(`/__studio/export?${q}`, { method: 'POST', body: result.blob }).catch(() => null);
        if (res?.ok) {
          const { file, encoder, warning } = await res.json();
          // The saved file (after libx264) is what the Download link should give you.
          const saved = await fetch(`/${file}`).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
          item.url = URL.createObjectURL(saved ?? result.blob);
          const size = saved?.size ?? result.blob.size;
          const enc = encoder === 'libx264' ? 'libx264' : `browser ${Math.round(result.bitrate / 1e6)} Mbps`;
          item.detail = `${file} · ${result.fps} fps · ${enc} · ${result.seconds.toFixed(1)}s · ${(size / 1e6).toFixed(1)} MB${warning ? ` · ${warning}` : ''}`;
          // Sidecars: caption (.txt), the exact scene (.scene.json), and a line in exports/log.csv.
          await fetch(`/__studio/export-meta?file=${encodeURIComponent(file)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ caption: item.meta?.caption ?? '', scene: item.scene, info: { ...item.meta?.info, seconds: Number(result.seconds.toFixed(2)) } }),
          }).catch(() => {});
        } else {
          item.url = URL.createObjectURL(result.blob);
          const a = document.createElement('a');
          a.href = item.url;
          a.download = `${item.fileName}.mp4`;
          a.click();
          item.detail = `downloaded · ${result.seconds.toFixed(1)}s`;
        }
        if (!result.deterministic) item.detail += ' · warning: render diverged';
        item.status = 'saved';
        onSaved();
      } catch (err) {
        item.status = 'failed';
        item.detail = (err as Error).message;
      }
      draw();
      persist();
    }
  } finally {
    running = false;
    setBusy(false);
  }
}

function draw(): void {
  const box = $('queue-box');
  box.hidden = items.length === 0;
  $('q-count').textContent = String(items.filter((i) => i.status === 'queued' || i.status === 'rendering').length || items.length);
  const list = $<HTMLOListElement>('queue-list');
  list.replaceChildren(
    ...items.map((i) => {
      const li = document.createElement('li');
      li.className = i.status;
      const name = document.createElement('span');
      name.textContent = i.label;
      const status = document.createElement('span');
      status.className = 'muted';
      status.textContent = i.status === 'queued' ? 'waiting' : i.status === 'rendering' ? `rendering ${i.detail}` : i.detail;
      li.append(name, status);
      if (i.status === 'rendering') {
        const bar = document.createElement('div');
        bar.className = 'qbar';
        bar.style.width = `${Math.round(i.progress * 100)}%`;
        li.append(bar);
      }
      if (i.url) {
        const a = document.createElement('a');
        a.href = i.url;
        a.download = `${i.fileName}.mp4`;
        a.textContent = 'Download';
        li.append(a);
      }
      return li;
    }),
  );
}
