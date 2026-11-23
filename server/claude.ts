/**
 * Runs the Claude Code CLI (`claude -p`) in this project on the user's own
 * Claude plan, and turns its stream-json output into simple studio events.
 * No API key is used: ANTHROPIC_API_KEY is removed from the child environment
 * so the CLI always uses its logged-in subscription.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

export type AiEvent =
  | { type: 'start'; session: string; model: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; text: string }
  | { type: 'file'; path: string }
  | { type: 'tool-error'; text: string }
  | { type: 'done'; ok: boolean; text: string; ms: number; session: string }
  | { type: 'error'; message: string };

export interface RunOptions {
  prompt: string;
  /** Project root (cwd for claude). */
  root: string;
  /** Scene the user is looking at, if any. */
  scene?: string;
  model: 'fast' | 'smart';
  /** Claude Code session to continue. */
  resume?: string;
  /** Called for every file claude is about to write (absolute path). */
  onWrite?: (abs: string) => void;
}

const MODELS = { fast: 'haiku', smart: 'sonnet' } as const;

/** Tools the studio's Claude may use. Anything else is denied without asking. */
export const ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Edit(scenes/**)',
  'Write(scenes/**)',
  'Bash(npm run sim:*)',
  'Bash(npm run -s sim:*)',
  'Bash(npm test)',
];

export function studioInstructions(scene?: string): string {
  return [
    'You are running inside Ball Escape Studio\'s prompt box. The user sees a live preview that reloads the moment a scene file changes.',
    scene
      ? `The user is currently looking at the scene "${scene}" (scenes/${scene}.json). Unless they ask for a new video, change that scene.`
      : 'No scene is selected; create a new one.',
    'If they ask for a new video, create scenes/<short-kebab-name>.json (do not overwrite another scene).',
    'Be fast: read only what you need (CLAUDE.md is already loaded; the closest preset and src/engine/modifiers.ts are usually enough).',
    'Write the scene file FIRST so the preview updates, then check it with `npm run -s sim -- <name>` and fix any error.',
    'Only search seeds (`npm run -s sim -- <name> --seeds 1-150 --target <s>`) when the change affects how the run ends or the user asks; keep the search to one call.',
    'If .studio/taste.md exists it holds the user\'s likes and dislikes from earlier videos; follow them.',
    'You can only edit files in scenes/. Never touch engine code from here.',
    'Finish with one or two plain sentences saying what you changed (no headings, no lists).',
  ].join('\n');
}

/** Find the claude binary even when PATH is minimal (e.g. a dev server started by an app). */
export function claudeBin(): string {
  if (process.env.STUDIO_CLAUDE_BIN) return process.env.STUDIO_CLAUDE_BIN;
  const candidates = [join(homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', join(homedir(), '.claude/local/claude')];
  return candidates.find((p) => existsSync(p)) ?? 'claude';
}

/** Start a run. Events arrive through `emit`; the returned child can be killed to cancel. */
export function runClaude(opts: RunOptions, emit: (e: AiEvent) => void): ChildProcess {
  const args = [
    '-p',
    opts.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    MODELS[opts.model],
    '--permission-mode',
    'dontAsk',
    '--max-turns',
    '30',
    '--append-system-prompt',
    studioInstructions(opts.scene),
    '--allowedTools',
    ...ALLOWED_TOOLS,
  ];
  if (opts.resume) args.push('--resume', opts.resume);

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // always the user's plan, never API credits
  delete env.CLAUDECODE; // allow running from inside another Claude Code session
  const child = spawn(claudeBin(), args, { cwd: opts.root, env, stdio: ['ignore', 'pipe', 'pipe'] });

  let buffer = '';
  let stderr = '';
  let finished = false;
  const rel = (p: string) => relative(opts.root, p) || p;

  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === 'system' && msg.subtype === 'init') {
        emit({ type: 'start', session: msg.session_id, model: msg.model ?? MODELS[opts.model] });
      } else if (msg.type === 'assistant') {
        for (const part of msg.message?.content ?? []) {
          if (part.type === 'text' && part.text?.trim()) emit({ type: 'text', text: part.text.trim() });
          if (part.type === 'tool_use') {
            const input = part.input ?? {};
            if ((part.name === 'Write' || part.name === 'Edit') && input.file_path) {
              const abs = String(input.file_path);
              opts.onWrite?.(abs.startsWith('/') ? abs : join(opts.root, abs));
              emit({ type: 'file', path: rel(abs) });
            } else if (part.name === 'Bash') emit({ type: 'tool', text: `$ ${input.command}` });
            else emit({ type: 'tool', text: `${part.name} ${rel(String(input.file_path ?? input.pattern ?? input.path ?? ''))}`.trim() });
          }
        }
      } else if (msg.type === 'user') {
        for (const part of msg.message?.content ?? []) {
          if (part.type === 'tool_result' && part.is_error) {
            const text = typeof part.content === 'string' ? part.content : JSON.stringify(part.content);
            emit({ type: 'tool-error', text: text.slice(0, 400) });
          }
        }
      } else if (msg.type === 'result') {
        finished = true;
        emit({ type: 'done', ok: !msg.is_error, text: String(msg.result ?? ''), ms: msg.duration_ms ?? 0, session: msg.session_id });
      }
    }
  });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (c: string) => (stderr = (stderr + c).slice(-2000)));
  child.on('error', (err) => {
    finished = true;
    emit({ type: 'error', message: `Could not start Claude Code (${claudeBin()}): ${err.message}. Install it and log in with \`claude\`.` });
  });
  child.on('close', (code, signal) => {
    if (finished) return;
    if (signal) emit({ type: 'error', message: 'Stopped.' });
    else emit({ type: 'error', message: stderr.trim() || `claude exited with code ${code}` });
  });
  return child;
}

/** True when a result text means the CLI is not logged in. */
export function isAuthError(text: string): boolean {
  return /authenticat|401|log ?in|OAuth/i.test(text);
}
