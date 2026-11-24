/**
 * The timeline under the preview: progress, markers for the moments that
 * matter (escapes, eliminations, near-misses, the climax), and seeking.
 * Runs are deterministic, so seeking re-simulates to the exact moment.
 */
export interface Marker {
  t: number;
  kind: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let length = 30;
let climax = -1;
let seekTo: (t: number) => void = () => {};

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function initTimeline(seek: (t: number) => void): void {
  seekTo = seek;
  const bar = $('tl');
  const hover = $('tl-hover');
  const timeAt = (e: PointerEvent) => {
    const r = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * length;
  };
  let dragging = false;
  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    $('tl-fill').style.width = `${(timeAt(e) / length) * 100}%`;
  });
  bar.addEventListener('pointermove', (e) => {
    const t = timeAt(e);
    hover.hidden = false;
    hover.textContent = fmt(t);
    hover.style.left = `${(t / length) * 100}%`;
    if (dragging) $('tl-fill').style.width = `${(t / length) * 100}%`;
  });
  bar.addEventListener('pointerleave', () => (hover.hidden = true));
  bar.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    seekTo(timeAt(e));
  });
  $('tl-climax').addEventListener('click', () => jumpToClimax());
}

export function jumpToClimax(): void {
  if (climax >= 0) seekTo(Math.max(0, climax - 2.5));
}

/** New run information (from the Critic's headless run). */
export function setRun(len: number, markers: Marker[], climaxAt: number): void {
  length = Math.max(1, len);
  climax = climaxAt;
  $<HTMLButtonElement>('tl-climax').disabled = climax < 0;
  const box = $('tl-markers');
  box.replaceChildren(
    ...markers.map((m) => {
      const d = document.createElement('i');
      d.className = `m-${m.kind}`;
      d.style.left = `${(m.t / length) * 100}%`;
      d.title = `${m.kind} at ${m.t.toFixed(1)}s`;
      return d;
    }),
  );
}

/** Before the headless run is back: just the length. */
export function setLength(len: number): void {
  length = Math.max(1, len);
  climax = -1;
  $('tl-markers').replaceChildren();
  $<HTMLButtonElement>('tl-climax').disabled = true;
}

export function setTime(t: number): void {
  $('tl-fill').style.width = `${Math.min(100, (t / length) * 100)}%`;
  $('tl-time').textContent = `${fmt(t)} / ${fmt(length)}`;
}
