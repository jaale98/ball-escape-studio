/**
 * The prompt box: sends a prompt to the dev server, which runs Claude Code
 * (on the user's Claude plan) in this project and streams back what it does.
 * Claude edits scene files; the studio picks the edits up as hot updates.
 */

type AiEvent =
  | { type: 'start'; session: string; model: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; text: string }
  | { type: 'file'; path: string }
  | { type: 'tool-error'; text: string }
  | { type: 'done'; ok: boolean; text: string; ms: number; session: string }
  | { type: 'error'; message: string };

export interface AssistantHooks {
  /** Scene the user is looking at. */
  currentScene(): string | undefined;
  /** Claude wrote a file (path relative to the project). */
  onFile(path: string): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function initAssistant(hooks: AssistantHooks): void {
  const input = $<HTMLTextAreaElement>('ai-prompt');
  const send = $<HTMLButtonElement>('ai-send');
  const stop = $<HTMLButtonElement>('ai-stop');
  const model = $<HTMLSelectElement>('ai-model');
  const status = $('ai-status');
  const log = $<HTMLOListElement>('ai-log');
  let fresh = false;
  let controller: AbortController | null = null;
  let timer = 0;

  const add = (cls: string, text: string) => {
    const li = document.createElement('li');
    li.className = cls;
    li.textContent = text;
    log.append(li);
    log.hidden = false;
    log.scrollTop = log.scrollHeight;
  };
  const setBusy = (busy: boolean) => {
    send.hidden = busy;
    stop.hidden = !busy;
    input.disabled = busy;
  };

  $('ai-new').addEventListener('click', () => {
    fresh = true;
    log.replaceChildren();
    log.hidden = true;
    status.textContent = 'Next prompt starts a new conversation.';
  });

  stop.addEventListener('click', () => {
    void fetch('/__studio/ai', { method: 'DELETE' }).catch(() => {});
    controller?.abort();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send.click();
    }
  });

  send.addEventListener('click', async () => {
    const prompt = input.value.trim();
    if (!prompt) return;
    const started = performance.now();
    let firstFileAt = 0;
    const secs = () => ((performance.now() - started) / 1000).toFixed(1);
    add('you', prompt);
    setBusy(true);
    status.textContent = 'Starting Claude Code…';
    clearInterval(timer);
    timer = window.setInterval(() => {
      if (!status.dataset.final) status.textContent = `${status.dataset.phase ?? 'Working'}… ${secs()}s`;
    }, 200);
    delete status.dataset.final;
    status.dataset.phase = 'Starting';
    controller = new AbortController();

    const finish = (text: string, cls = '') => {
      clearInterval(timer);
      status.dataset.final = '1';
      status.textContent = text;
      status.className = `muted ${cls}`;
      setBusy(false);
      controller = null;
    };

    try {
      const res = await fetch('/__studio/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, scene: hooks.currentScene(), model: model.value, fresh }),
        signal: controller.signal,
      });
      fresh = false;
      if (!res.ok || !res.body) {
        const msg = res.status === 404 ? 'The prompt box needs the dev server (npm run dev).' : ((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
        finish(msg, 'bad');
        return;
      }
      input.value = '';
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      let ended = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AiEvent;
          switch (e.type) {
            case 'start':
              status.dataset.phase = `Claude (${e.model}) is working`;
              break;
            case 'text':
              add('claude', e.text);
              break;
            case 'tool':
              add('tool', e.text);
              break;
            case 'file':
              if (!firstFileAt) firstFileAt = performance.now();
              add('file', `Edited ${e.path}`);
              hooks.onFile(e.path);
              break;
            case 'tool-error':
              add('tool bad', e.text);
              break;
            case 'done': {
              ended = true;
              const preview = firstFileAt ? ` · preview updated at ${((firstFileAt - started) / 1000).toFixed(1)}s` : '';
              finish(e.ok ? `Done in ${secs()}s${preview}` : `Claude stopped: ${e.text.slice(0, 200)}`, e.ok ? 'good' : 'bad');
              break;
            }
            case 'error':
              ended = true;
              finish(e.message, 'bad');
              break;
          }
        }
      }
      if (!ended) finish('Connection closed.', 'bad');
    } catch (err) {
      finish((err as Error).name === 'AbortError' ? 'Stopped.' : `Failed: ${(err as Error).message}`, 'bad');
    }
  });
}
