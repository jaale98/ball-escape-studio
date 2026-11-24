/** Past exports (from exports/log.csv): show in Finder, re-export, or open as a scene. */
import type { Scene } from '../engine/scene';

export interface ExportRow {
  file: string;
  time: string;
  scene: string;
  seed: string;
  seconds: string;
  size: number;
  hasScene: boolean;
}

export interface ExportsHooks {
  reexport(label: string, fileName: string, scene: Scene): void;
  openAsScene(name: string, scene: Scene): Promise<void>;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let hooks: ExportsHooks;

export function initExports(h: ExportsHooks): void {
  hooks = h;
  $('exports-open').addEventListener('click', () => void reveal(''));
  $('exports-refresh').addEventListener('click', () => void refreshExports());
}

async function reveal(file: string): Promise<void> {
  await fetch('/__studio/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file }) }).catch(() => {});
}

export async function refreshExports(): Promise<void> {
  const list = $<HTMLOListElement>('exports-list');
  let rows: ExportRow[];
  try {
    const res = await fetch('/__studio/exports');
    if (!res.ok) throw new Error();
    rows = await res.json();
  } catch {
    list.innerHTML = '<li class="muted">Needs the dev server (npm run dev).</li>';
    return;
  }
  if (!rows.length) {
    list.innerHTML = '<li class="muted">Nothing exported yet. Export MP4 puts videos here.</li>';
    return;
  }
  list.replaceChildren(
    ...rows.map((r) => {
      const li = document.createElement('li');
      const name = document.createElement('b');
      name.textContent = r.file;
      const meta = document.createElement('span');
      meta.className = 'muted';
      const when = new Date(r.time);
      meta.textContent = `${r.scene} · seed ${r.seed} · ${Number(r.seconds).toFixed(1)}s · ${(r.size / 1e6).toFixed(1)} MB · ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
      const actions = document.createElement('div');
      actions.className = 'g-actions';
      const b = (label: string, fn: () => void, title = '') => {
        const x = document.createElement('button');
        x.textContent = label;
        x.title = title;
        x.onclick = fn;
        return x;
      };
      actions.append(b('Show in Finder', () => void reveal(r.file)));
      if (r.hasScene) {
        const sceneOf = async () => (await (await fetch(`/exports/${encodeURIComponent(r.file.replace(/\.mp4$/, '.scene.json'))}`)).json()) as Scene;
        actions.append(
          b('Export again', async () => hooks.reexport(`${r.scene} · seed ${r.seed} (again)`, r.file.replace(/\.mp4$/, ''), await sceneOf()), 'Render the exact same video again'),
          b('Open as scene', async () => hooks.openAsScene(`${r.scene}-take`, await sceneOf()), 'Make a new scene from exactly what was exported, to change and re-export'),
        );
      }
      li.append(name, meta, actions);
      return li;
    }),
  );
}
