/**
 * Standard MIDI File reader.
 *
 * readMidi() returns every note with its time in seconds (tempo changes
 * honored) and the song's "parts": one per (track, channel) pair, with a name,
 * an instrument family and a note count, so a scene can pick which parts feed
 * the melody. Drums (channel 10) are skipped.
 */

export interface MidiPart {
  id: number;
  track: number;
  channel: number;
  /** Track name from the file ('' if none). */
  name: string;
  instrument: string;
  notes: number;
  avgPitch: number;
  /** Lowest and highest MIDI note. */
  low: number;
  high: number;
  /** Share of this part's moments that are chords (0 = a single line). */
  poly: number;
  /** What the part most likely is. */
  role: 'melody' | 'bass' | 'part';
  /** A short human name: the track name if it's distinctive, else Melody / Bass / instrument. */
  label: string;
}

export interface MidiNote {
  /** Seconds from the start of the song. */
  time: number;
  note: number;
  part: number;
}

export interface MidiSong {
  parts: MidiPart[];
  notes: MidiNote[];
  /** The part most likely to be the melody (a busy, high, single line). */
  melodyPart: number;
  /** Drum notes skipped (channel 10): they have no pitch to play on a bounce. */
  drums: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** 60 -> "C4" */
export function noteName(n: number): string {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

const FAMILIES = ['Piano', 'Chromatic perc.', 'Organ', 'Guitar', 'Bass', 'Strings', 'Ensemble', 'Brass', 'Reed', 'Pipe', 'Synth lead', 'Synth pad', 'Synth FX', 'Ethnic', 'Percussive', 'Sound FX'];

export function readMidi(buffer: ArrayBuffer): MidiSong {
  const data = new DataView(buffer);
  let pos = 0;
  const u8 = () => data.getUint8(pos++);
  const u16 = () => ((pos += 2), data.getUint16(pos - 2));
  const u32 = () => ((pos += 4), data.getUint32(pos - 4));
  const text = (at: number, n: number) => String.fromCharCode(...new Uint8Array(buffer, at, n));
  const varint = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  };

  if (buffer.byteLength < 14 || text(0, 4) !== 'MThd') throw new Error('Not a MIDI file (missing MThd header)');
  pos = 4;
  const headerLen = u32();
  u16(); // format
  const trackCount = u16();
  const division = u16();
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
  pos = 8 + headerLen;

  const raw: { tick: number; note: number; track: number; channel: number }[] = [];
  let drums = 0;
  const tempos: { tick: number; usPerQuarter: number }[] = [];
  const trackNames: string[] = [];
  const programs = new Map<string, number>();

  for (let t = 0; t < trackCount && pos + 8 <= buffer.byteLength; t++) {
    const id = text(pos, 4);
    pos += 4;
    const len = u32();
    const end = Math.min(buffer.byteLength, pos + len);
    if (id !== 'MTrk') {
      pos = end;
      continue;
    }
    let tick = 0;
    let status = 0;
    while (pos < end) {
      tick += varint();
      let b = u8();
      if (b === 0xff) {
        const type = u8();
        const n = varint(); // (not `pos += varint()`: that reads pos before varint advances it)
        if (type === 0x51 && n === 3) tempos.push({ tick, usPerQuarter: (data.getUint8(pos) << 16) | (data.getUint8(pos + 1) << 8) | data.getUint8(pos + 2) });
        if (type === 0x03 && !trackNames[t]) trackNames[t] = text(pos, n).replace(/[^\x20-\x7e]/g, '').trim();
        pos += n;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        const n = varint();
        pos += n;
        continue;
      }
      if (b & 0x80) status = b;
      else pos--; // running status: this byte is data
      b = status;
      const type = b & 0xf0;
      const channel = b & 0x0f;
      if (type === 0x90) {
        const note = u8();
        const vel = u8();
        if (vel > 0 && channel !== 9) raw.push({ tick, note, track: t, channel });
        else if (vel > 0) drums++;
      } else if (type === 0xc0) {
        const program = u8();
        if (!programs.has(`${t}:${channel}`)) programs.set(`${t}:${channel}`, program);
      } else if (type === 0x80 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
        pos += 2;
      } else if (type === 0xd0) {
        pos += 1;
      }
    }
    pos = end;
  }
  if (!raw.length) throw new Error('MIDI file has no notes');

  // Ticks → seconds, honoring tempo changes (default 120 bpm).
  tempos.sort((a, b) => a.tick - b.tick);
  const seconds = (tick: number) => {
    let s = 0;
    let lastTick = 0;
    let us = 500000;
    for (const tp of tempos) {
      if (tp.tick >= tick) break;
      s += ((tp.tick - lastTick) * us) / division / 1e6;
      lastTick = tp.tick;
      us = tp.usPerQuarter;
    }
    return s + ((tick - lastTick) * us) / division / 1e6;
  };

  const partIds = new Map<string, number>();
  const parts: MidiPart[] = [];
  const notes: MidiNote[] = [];
  raw.sort((a, b) => a.tick - b.tick || b.note - a.note);
  for (const n of raw) {
    const key = `${n.track}:${n.channel}`;
    let id = partIds.get(key);
    if (id === undefined) {
      id = parts.length;
      partIds.set(key, id);
      const program = programs.get(key);
      parts.push({
        id,
        track: n.track,
        channel: n.channel,
        name: trackNames[n.track] ?? '',
        instrument: program !== undefined ? FAMILIES[program >> 3] : 'Piano',
        notes: 0,
        avgPitch: 0,
        low: 127,
        high: 0,
        poly: 0,
        role: 'part',
        label: '',
      });
    }
    const p = parts[id];
    p.avgPitch = (p.avgPitch * p.notes + n.note) / (p.notes + 1);
    p.notes++;
    p.low = Math.min(p.low, n.note);
    p.high = Math.max(p.high, n.note);
    notes.push({ time: seconds(n.tick), note: n.note, part: id });
  }

  // How chordal each part is: share of its onset moments with more than one note.
  for (const p of parts) {
    const perTick = new Map<number, number>();
    for (const r of raw) if (partIds.get(`${r.track}:${r.channel}`) === p.id) perTick.set(r.tick, (perTick.get(r.tick) ?? 0) + 1);
    const moments = [...perTick.values()];
    p.poly = moments.filter((c) => c > 1).length / Math.max(1, moments.length);
  }

  // Melody: among the busier parts, the highest single line (a chordal piano
  // part can sit high too, so chords count against a part).
  const busiest = Math.max(...parts.map((p) => p.notes));
  const melodyPart = parts.filter((p) => p.notes >= busiest * 0.25).sort((a, b) => b.avgPitch - 14 * b.poly - (a.avgPitch - 14 * a.poly))[0].id;
  const lowest = [...parts].sort((a, b) => a.avgPitch - b.avgPitch)[0];
  for (const p of parts) p.role = p.id === melodyPart ? 'melody' : p.id === lowest.id && p.avgPitch < 57 && parts.length > 1 ? 'bass' : 'part';

  // Names: a track name only helps if it tells parts apart (single-track files
  // give every part the song title).
  const nameCount = new Map<string, number>();
  for (const p of parts) if (p.name) nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1);
  const instCount = new Map<string, number>();
  for (const p of parts) {
    if (p.name && nameCount.get(p.name) === 1 && !/^track ?\d*$/i.test(p.name)) p.label = p.name;
    else if (p.role === 'melody') p.label = 'Melody';
    else if (p.role === 'bass') p.label = 'Bass';
    else {
      const k = (instCount.get(p.instrument) ?? 0) + 1;
      instCount.set(p.instrument, k);
      p.label = `${p.instrument}${k > 1 ? ` ${k}` : ''}`;
    }
  }
  return { parts, notes, melodyPart, drums };
}

/** Notes struck together, in order, from the chosen parts (default: the melody part), with each group's time. */
export function songGroups(song: MidiSong, parts?: number[]): { groups: number[][]; times: number[] } {
  const use = parts?.length ? parts : [song.melodyPart];
  const groups: number[][] = [];
  const times: number[] = [];
  let last = -1;
  for (const n of song.notes) {
    if (!use.includes(n.part)) continue;
    if (Math.abs(n.time - last) > 1e-6) {
      groups.push([]);
      times.push(n.time);
      last = n.time;
    }
    groups[groups.length - 1].push(n.note);
  }
  if (!groups.length) throw new Error('The chosen MIDI parts have no notes');
  return { groups, times };
}

/** Back-compat: note groups from the melody part. */
export function parseMidi(buffer: ArrayBuffer): number[][] {
  return songGroups(readMidi(buffer)).groups;
}

/** The parts playing on bounces, and the parts playing as backing (when backing is on). */
export function partRoles(song: MidiSong, audio: { parts?: number[]; backing?: boolean; backingParts?: number[] }): { bounce: number[]; backing: number[] } {
  const bounce = audio.parts?.length ? audio.parts : [song.melodyPart];
  const backing = audio.backing ? (audio.backingParts ?? song.parts.map((p) => p.id)).filter((id) => !bounce.includes(id)) : [];
  return { bounce, backing };
}

/**
 * Fill a scene's audio with what the engine and the sound mapper need from the
 * song: the bounce notes and their times, and the backing notes ([time, note]).
 */
export function applySong<A extends { parts?: number[]; backing?: boolean; backingParts?: number[]; notes?: unknown; noteTimes?: number[]; backingNotes?: [number, number][] }>(audio: A, song: MidiSong): void {
  const { bounce, backing } = partRoles(song, audio);
  const { groups, times } = songGroups(song, bounce);
  audio.notes = groups;
  audio.noteTimes = times;
  audio.backingNotes = backing.length ? song.notes.filter((n) => backing.includes(n.part)).map((n) => [n.time, n.note] as [number, number]) : undefined;
}
