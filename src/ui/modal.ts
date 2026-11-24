/** A small in-page dialog: a question, an optional text field, and buttons. */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface Choice {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
}

export function ask(opts: { title: string; body?: string; input?: { value: string; placeholder?: string }; buttons: Choice[] }): Promise<{ value: string; input: string }> {
  return new Promise((resolve) => {
    const modal = $('modal');
    $('m-title').textContent = opts.title;
    $('m-body').textContent = opts.body ?? '';
    $('m-body').hidden = !opts.body;
    const input = $<HTMLInputElement>('m-input');
    input.hidden = !opts.input;
    input.value = opts.input?.value ?? '';
    input.placeholder = opts.input?.placeholder ?? '';
    const box = $('m-buttons');
    const done = (value: string) => {
      modal.hidden = true;
      document.removeEventListener('keydown', onKey, true);
      resolve({ value, input: input.value.trim() });
    };
    box.replaceChildren(
      ...opts.buttons.map((b) => {
        const btn = document.createElement('button');
        btn.textContent = b.label;
        if (b.primary) btn.className = 'primary';
        if (b.danger) btn.className = 'danger';
        btn.onclick = () => done(b.value);
        return btn;
      }),
    );
    const primary = opts.buttons.find((b) => b.primary) ?? opts.buttons[0];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        done('cancel');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        done(primary.value);
      }
    };
    document.addEventListener('keydown', onKey, true);
    modal.hidden = false;
    if (opts.input) {
      input.focus();
      input.select();
    } else (box.querySelector('.primary') as HTMLButtonElement | null)?.focus();
  });
}

/** "My Cool Scene!" -> "my-cool-scene" */
export function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
