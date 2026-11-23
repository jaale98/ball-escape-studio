/**
 * Version history (every saved state of a scene file, kept by the dev server
 * in .studio/history) and taste feedback (Like / Dislike, appended to
 * .studio/taste.md, which Claude reads before making scenes).
 */

interface Version {
  id: number;
  time: string;
  label: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export async function refreshHistory(name: string | undefined): Promise<void> {
  const list = $<HTMLOListElement>('history-list');
  const undo = $<HTMLButtonElement>('undo');
  list.replaceChildren();
  undo.disabled = true;
  if (!name) return;
  let versions: Version[] = [];
  try {
    const res = await fetch(`/__studio/history?name=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error();
    versions = await res.json();
  } catch {
    list.innerHTML = '<li class="muted">History needs the dev server (npm run dev).</li>';
    return;
  }
  undo.disabled = versions.length < 2;
  undo.onclick = () => void restore(name, versions[1].id);
  versions.forEach((v, i) => {
    const li = document.createElement('li');
    const when = new Date(v.time);
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = `#${v.id} · ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    const label = document.createElement('span');
    label.textContent = v.label;
    li.append(meta, label);
    if (i === 0) {
      const cur = document.createElement('em');
      cur.textContent = 'current';
      li.append(cur);
    } else {
      const btn = document.createElement('button');
      btn.textContent = 'Restore';
      btn.title = 'Write this version back to the file (as a new version, so nothing is lost)';
      btn.onclick = () => void restore(name, v.id);
      li.append(btn);
    }
    list.append(li);
  });
}

async function restore(name: string, id: number): Promise<void> {
  await fetch('/__studio/history/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, id }),
  });
  // The file change arrives as a hot update, which refreshes the scene and this list.
}

export function initRating(current: () => { name: string; title: string; summary: string } | null): void {
  const note = $<HTMLInputElement>('rate-note');
  const msg = $('rate-msg');
  const rate = async (rating: 'up' | 'down') => {
    const c = current();
    if (!c) return;
    try {
      const res = await fetch('/__studio/rate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...c, rating, note: note.value.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      msg.textContent = rating === 'up' ? 'Noted: Claude will lean toward videos like this.' : 'Noted: Claude will steer away from this.';
      note.value = '';
    } catch {
      msg.textContent = 'Rating needs the dev server (npm run dev).';
    }
  };
  $('like').addEventListener('click', () => void rate('up'));
  $('dislike').addEventListener('click', () => void rate('down'));
}
