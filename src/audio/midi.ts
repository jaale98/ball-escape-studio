/**
 * Minimal Standard MIDI File reader. Returns the notes struck at each moment,
 * in order: [[67], [69], [71, 55], ...]. Drums (channel 10) are skipped.
 * Enough to drive "each bounce plays the next note" — timing is not kept.
 */
export function parseMidi(buffer: ArrayBuffer): number[][] {
  const data = new DataView(buffer);
  let pos = 0;
  const u8 = () => data.getUint8(pos++);
  const u16 = () => ((pos += 2), data.getUint16(pos - 2));
  const u32 = () => ((pos += 4), data.getUint32(pos - 4));
  const str = (n: number) => String.fromCharCode(...new Uint8Array(buffer, (pos += n) - n, n));
  const varint = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  };

  if (str(4) !== 'MThd') throw new Error('Not a MIDI file (missing MThd header)');
  const headerLen = u32();
  u16(); // format
  const tracks = u16();
  u16(); // division
  pos = 8 + headerLen;

  const onsets: { tick: number; note: number }[] = [];
  for (let t = 0; t < tracks && pos < buffer.byteLength; t++) {
    const id = str(4);
    const len = u32();
    const end = pos + len;
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
        u8(); // meta type
        const n = varint(); // (not `pos += varint()`: that reads pos before varint advances it)
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
        if (vel > 0 && channel !== 9) onsets.push({ tick, note });
      } else if (type === 0x80 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
        pos += 2;
      } else if (type === 0xc0 || type === 0xd0) {
        pos += 1;
      }
    }
    pos = end;
  }

  onsets.sort((a, b) => a.tick - b.tick || b.note - a.note);
  const groups: number[][] = [];
  let lastTick = -1;
  for (const o of onsets) {
    if (o.tick !== lastTick) {
      groups.push([]);
      lastTick = o.tick;
    }
    groups[groups.length - 1].push(o.note);
  }
  if (!groups.length) throw new Error('MIDI file has no notes');
  return groups;
}
