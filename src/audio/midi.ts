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
  name: string;
  instrument: string;
  notes: number;
  avgPitch: number;
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
  /** The part most likely to be the melody (high, and busy). */
  melodyPart: number;
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
        name: trackNames[n.track] || `Track ${n.track + 1}`,
        instrument: program !== undefined ? FAMILIES[program >> 3] : 'Piano',
        notes: 0,
        avgPitch: 0,
      });
    }
    const p = parts[id];
    p.avgPitch = (p.avgPitch * p.notes + n.note) / (p.notes + 1);
    p.notes++;
    notes.push({ time: seconds(n.tick), note: n.note, part: id });
  }

  const busiest = Math.max(...parts.map((p) => p.notes));
  const melodyPart = parts.filter((p) => p.notes >= busiest * 0.3).sort((a, b) => b.avgPitch - a.avgPitch)[0].id;
  return { parts, notes, melodyPart };
}

/** Notes struck together, in order, from the chosen parts (default: all), with each group's time. */
export function songGroups(song: MidiSong, parts?: number[]): { groups: number[][]; times: number[] } {
  const groups: number[][] = [];
  const times: number[] = [];
  let last = -1;
  for (const n of song.notes) {
    if (parts && parts.length && !parts.includes(n.part)) continue;
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

/** Back-compat: note groups from all parts. */
export function parseMidi(buffer: ArrayBuffer): number[][] {
  return songGroups(readMidi(buffer)).groups;
}
