/**
 * The songbook: public-domain melodies in simple arrangements of our own,
 * written in a compact notation and generated as MIDI files into songs/
 * (with songs/songs.json for titles and categories).
 *
 *   npm run songs
 *
 * Notation: space-separated notes "E4/8", "C#5/4.", "Bb3/2", rests "r/8".
 * Duration: 1 whole, 2 half, 4 quarter, 8 eighth, 16 sixteenth; a trailing
 * "." makes it dotted; "/12" is an eighth-note triplet. "|" is ignored (bars).
 * A chord is notes joined with "+": "C4+E4+G4/2".
 */
import { mkdirSync, writeFileSync } from 'node:fs';

interface Song {
  slug: string;
  title: string;
  composer: string;
  category: 'Classical' | 'Folk & traditional' | 'Nursery & kids' | 'Ragtime & marches';
  bpm: number;
  melody: string;
  bass?: string;
}

/** Repeat a phrase. */
const x = (s: string, n: number) => Array.from({ length: n }, () => s).join(' ');

/** Broken-chord pattern helper: each chord's notes as 16ths, Bach-prelude style. */
const prelude = (bars: string[][]) => bars.map(([a, b, c, d, e]) => x(`${a}/16 ${b}/16 ${c}/16 ${d}/16 ${e}/16 ${c}/16 ${d}/16 ${e}/16`, 2)).join(' ');

/** Rising-and-falling 8th-note arpeggio over chords (root, 3rd, 5th, octave). */
const arpeggio = (chords: string[][]) => chords.map(([a, b, c, d]) => `${a}/8 ${b}/8 ${c}/8 ${d}/8 ${c}/8 ${b}/8 ${c}/8 ${b}/8`).join(' ');

export const SONGS: Song[] = [
  // ---- Classical ------------------------------------------------------------
  {
    slug: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'Beethoven',
    category: 'Classical',
    bpm: 112,
    melody:
      'E4/4 E4/4 F4/4 G4/4 | G4/4 F4/4 E4/4 D4/4 | C4/4 C4/4 D4/4 E4/4 | E4/4. D4/8 D4/2 | E4/4 E4/4 F4/4 G4/4 | G4/4 F4/4 E4/4 D4/4 | C4/4 C4/4 D4/4 E4/4 | D4/4. C4/8 C4/2 | D4/4 D4/4 E4/4 C4/4 | D4/4 E4/8 F4/8 E4/4 C4/4 | D4/4 E4/8 F4/8 E4/4 D4/4 | C4/4 D4/4 G3/2 | E4/4 E4/4 F4/4 G4/4 | G4/4 F4/4 E4/4 D4/4 | C4/4 C4/4 D4/4 E4/4 | D4/4. C4/8 C4/2',
    bass: 'C3/2 G2/2 C3/2 G2/2 C3/2 G2/2 G2/2 C3/2 C3/2 G2/2 C3/2 G2/2 C3/2 G2/2 G2/2 C3/2 G2/2 C3/2 G2/2 C3/2 G2/2 C3/2 G2/2 G2/2 C3/2 G2/2 C3/2 G2/2 C3/2 G2/2 G2/2 C3/2',
  },
  {
    slug: 'fur-elise',
    title: 'Für Elise',
    composer: 'Beethoven',
    category: 'Classical',
    bpm: 66,
    melody:
      'E5/16 D#5/16 | E5/16 D#5/16 E5/16 B4/16 D5/16 C5/16 | A4/8 r/16 C4/16 E4/16 A4/16 | B4/8 r/16 E4/16 G#4/16 B4/16 | C5/8 r/16 E4/16 E5/16 D#5/16 | E5/16 D#5/16 E5/16 B4/16 D5/16 C5/16 | A4/8 r/16 C4/16 E4/16 A4/16 | B4/8 r/16 E4/16 C5/16 B4/16 | A4/4',
    bass: 'r/8 r/4. A2/16 E3/16 A3/16 r/16 r/8 E2/16 E3/16 G#3/16 r/16 r/8 A2/16 E3/16 A3/16 r/16 r/4. r/8 A2/16 E3/16 A3/16 r/16 r/8 E2/16 E3/16 G#3/16 r/16 r/8 A2/4',
  },
  {
    slug: 'minuet-in-g',
    title: 'Minuet in G',
    composer: 'Petzold',
    category: 'Classical',
    bpm: 120,
    melody:
      'D5/4 G4/8 A4/8 B4/8 C5/8 | D5/4 G4/4 G4/4 | E5/4 C5/8 D5/8 E5/8 F#5/8 | G5/4 G4/4 G4/4 | C5/4 D5/8 C5/8 B4/8 A4/8 | B4/4 C5/8 B4/8 A4/8 G4/8 | F#4/4 G4/8 A4/8 B4/8 G4/8 | B4/4 A4/2 | D5/4 G4/8 A4/8 B4/8 C5/8 | D5/4 G4/4 G4/4 | E5/4 C5/8 D5/8 E5/8 F#5/8 | G5/4 G4/4 G4/4 | C5/4 D5/8 C5/8 B4/8 A4/8 | B4/4 C5/8 B4/8 A4/8 G4/8 | A4/4 B4/8 A4/8 G4/8 F#4/8 | G4/2.',
    bass: 'G3/2. B3/2. C4/2. B3/2. A3/2. G3/2. D4/2. D3/2. G3/2. B3/2. C4/2. B3/2. A3/2. G3/2. D3/2. G2/2.',
  },
  {
    slug: 'prelude-in-c',
    title: 'Prelude in C',
    composer: 'J. S. Bach',
    category: 'Classical',
    bpm: 66,
    melody: prelude([
      ['C4', 'E4', 'G4', 'C5', 'E5'],
      ['C4', 'D4', 'A4', 'D5', 'F5'],
      ['B3', 'D4', 'G4', 'D5', 'F5'],
      ['C4', 'E4', 'G4', 'C5', 'E5'],
      ['C4', 'E4', 'A4', 'E5', 'A5'],
      ['C4', 'D4', 'F#4', 'A4', 'D5'],
      ['B3', 'D4', 'G4', 'D5', 'G5'],
      ['B3', 'C4', 'E4', 'G4', 'C5'],
      ['A3', 'C4', 'E4', 'G4', 'C5'],
      ['D3', 'A3', 'D4', 'F#4', 'C5'],
      ['G3', 'B3', 'D4', 'G4', 'B4'],
    ]),
  },
  {
    slug: 'canon-in-d',
    title: 'Canon in D',
    composer: 'Pachelbel',
    category: 'Classical',
    bpm: 72,
    melody: x(
      arpeggio([
        ['D4', 'F#4', 'A4', 'D5'],
        ['A3', 'C#4', 'E4', 'A4'],
        ['B3', 'D4', 'F#4', 'B4'],
        ['F#3', 'A3', 'C#4', 'F#4'],
        ['G3', 'B3', 'D4', 'G4'],
        ['D4', 'F#4', 'A4', 'D5'],
        ['G3', 'B3', 'D4', 'G4'],
        ['A3', 'C#4', 'E4', 'A4'],
      ]),
      2,
    ),
    bass: x('D3/1 A2/1 B2/1 F#2/1 G2/1 D2/1 G2/1 A2/1', 2),
  },
  {
    slug: 'moonlight-sonata',
    title: 'Moonlight Sonata',
    composer: 'Beethoven',
    category: 'Classical',
    bpm: 54,
    melody: `${x('G#3/12 C#4/12 E4/12', 8)} ${x('A3/12 C#4/12 E4/12', 2)} ${x('A3/12 D4/12 F#4/12', 2)} ${x('G#3/12 C4/12 F#4/12', 1)} ${x('G#3/12 C#4/12 E4/12', 1)} ${x('G#3/12 C#4/12 D#4/12', 1)} ${x('F#3/12 C4/12 D#4/12', 1)} ${x('E3/12 G#3/12 C#4/12', 4)}`,
    bass: 'C#3/1 B2/1 A2/2 F#2/2 G#2/2 G#2/2 C#2/1',
  },
  {
    slug: 'hall-of-the-mountain-king',
    title: 'In the Hall of the Mountain King',
    composer: 'Grieg',
    category: 'Classical',
    bpm: 132,
    melody: x(
      'B3/8 C#4/8 D4/8 E4/8 F#4/8 D4/8 F#4/4 | F4/8 C#4/8 F4/4 E4/8 C4/8 E4/4 | B3/8 C#4/8 D4/8 E4/8 F#4/8 D4/8 F#4/8 B4/8 | A4/8 F#4/8 D4/8 F#4/8 A4/2',
      2,
    ),
    bass: x('B2/2 B2/2 C#3/2 C3/2 B2/2 B2/2 D3/2 D3/2', 2),
  },
  {
    slug: 'eine-kleine-nachtmusik',
    title: 'Eine kleine Nachtmusik',
    composer: 'Mozart',
    category: 'Classical',
    bpm: 132,
    melody:
      'G4/4 r/8 D4/8 G4/4 r/8 D4/8 | G4/8 D4/8 G4/8 B4/8 D5/2 | C5/4 r/8 A4/8 C5/4 r/8 A4/8 | C5/8 A4/8 F#4/8 A4/8 D4/2 | G4/4 G4/4 B4/8. A4/16 G4/8 G4/8 | G4/8 F#4/8 F#4/4 A4/8. C5/16 F#4/8 A4/8 | G4/4 G4/4 B4/8. A4/16 G4/8 G4/8 | G4/8 F#4/8 F#4/4 A4/8. C5/16 F#4/8 A4/8 | G4/2',
    bass: 'G2/2 G2/2 G2/2 G2/2 D3/2 D3/2 D3/2 D3/2 G2/2 G2/2 D3/2 D3/2 G2/2 G2/2 D3/2 D3/2 G2/2',
  },
  {
    slug: 'turkish-march',
    title: 'Turkish March',
    composer: 'Mozart',
    category: 'Classical',
    bpm: 120,
    melody:
      'B4/16 A4/16 G#4/16 A4/16 C5/4 | D5/16 C5/16 B4/16 C5/16 E5/4 | F5/16 E5/16 D#5/16 E5/16 B5/16 A5/16 G#5/16 A5/16 | B5/16 A5/16 G#5/16 A5/16 C6/4 | A5/8 C6/8 | B5/8 A5/8 G5/8 A5/8 | B5/8 A5/8 G5/8 A5/8 | B5/8 A5/8 G5/8 F#5/8 | E5/4',
    bass: 'r/4 A2/8 C3+E3/8 C3+E3/8 C3+E3/8 A2/8 C3+E3/8 C3+E3/8 C3+E3/8 A2/8 C3+E3/8 A2/8 C3+E3/8 A2/8 C3+E3/8 E2/8 B2+E3/8 E2/8 B2+E3/8 E2/8 B2+E3/8 E2/8 B2+E3/8 E2/4',
  },
  {
    slug: 'can-can',
    title: 'Can-Can (Infernal Galop)',
    composer: 'Offenbach',
    category: 'Classical',
    bpm: 150,
    melody:
      'C4/4 D4/8 F4/8 E4/8 D4/8 G4/4 G4/4 G4/8 A4/8 E4/8 F4/8 D4/4 D4/4 D4/8 F4/8 E4/8 D4/8 C4/8 C5/8 B4/8 A4/8 G4/8 F4/8 E4/8 D4/8 | C4/4 D4/8 F4/8 E4/8 D4/8 G4/4 G4/4 G4/8 A4/8 E4/8 F4/8 D4/4 D4/4 D4/8 F4/8 E4/8 D4/8 C4/8 G4/8 D4/8 E4/8 C4/4',
    bass: 'C3/4 G2/4 C3/4 G2/4 G2/4 D3/4 G2/4 D3/4 G2/4 D3/4 G2/4 D3/4 C3/4 G2/4 C3/4 G2/4 C3/4 G2/4 C3/4 G2/4 G2/4 D3/4 G2/4 D3/4 G2/4 D3/4 G2/4 G2/4 C3/4',
  },
  {
    slug: 'william-tell',
    title: 'William Tell Overture (Finale)',
    composer: 'Rossini',
    category: 'Classical',
    bpm: 150,
    melody:
      'E4/16 E4/16 E4/8 E4/16 E4/16 E4/8 E4/16 E4/16 A4/8 B4/8 C#5/8 | E4/16 E4/16 E4/8 E4/16 E4/16 A4/8 C#5/16 C#5/16 B4/8 G#4/8 E4/8 | E4/16 E4/16 E4/8 E4/16 E4/16 E4/8 E4/16 E4/16 A4/8 B4/8 C#5/8 | A4/16 C#5/16 E5/8 D5/8 C#5/8 B4/8 A4/4',
    bass: x('A2/8 E3/8', 6) + ' ' + x('E2/8 E3/8', 6) + ' ' + x('A2/8 E3/8', 6) + ' E2/8 E3/8 A2/4',
  },
  {
    slug: 'habanera',
    title: 'Habanera',
    composer: 'Bizet',
    category: 'Classical',
    bpm: 72,
    melody: 'D5/4. C#5/8 C5/4 C5/8 B4/8 | Bb4/4. A4/8 Ab4/4 G4/4 | F4/8 G4/8 A4/8 F4/8 E4/4 r/4 | D5/4. C#5/8 C5/4 C5/8 B4/8 | Bb4/4. A4/8 Ab4/4 G4/4 | F4/8 G4/8 A4/8 F4/8 D4/2',
    bass: x('D3/8. A3/16 F3/8 A3/8', 12),
  },
  {
    slug: 'morning-mood',
    title: 'Morning Mood',
    composer: 'Grieg',
    category: 'Classical',
    bpm: 66,
    melody: 'G5/8 E5/8 D5/8 C5/8 D5/8 E5/8 | G5/8 E5/8 D5/8 C5/8 D5/16 E5/16 D5/16 E5/16 | G5/8 E5/8 G5/8 A5/8 E5/8 A5/8 | G5/8 E5/8 D5/8 C5/4.',
    bass: 'C4+G4/4. C4+G4/4. C4+G4/4. C4+G4/4. C4+A4/4. C4+A4/4. C4+G4/4. C4+E4/4.',
  },
  // ---- Ragtime & marches ----------------------------------------------------
  {
    slug: 'the-entertainer',
    title: 'The Entertainer',
    composer: 'Scott Joplin',
    category: 'Ragtime & marches',
    bpm: 80,
    melody:
      'D4/16 D#4/16 | E4/16 C5/8 E4/16 C5/8 E4/16 C5/4. | C5/16 D5/16 D#5/16 E5/16 C5/16 D5/16 E5/8 B4/16 D5/8 C5/4. | D4/16 D#4/16 | E4/16 C5/8 E4/16 C5/8 E4/16 C5/4. | A4/16 G4/16 F#4/16 A4/16 C5/16 E5/8 D5/16 C5/16 A4/16 D5/4.',
    bass: 'r/8 C3/8 C4+E4/8 G2/8 C4+E4/8 C3/8 C4+E4/8 G2/8 C4+E4/8 F2/8 C4+F4/8 G2/8 B3+F4/8 C3/8 C4+E4/8 G2/8 C4+E4/8 C3/8 C4+E4/8 G2/8 C4+E4/8 C3/8 C4+E4/8 D3/8 C4+F#4/8 D3/8 C4+F#4/8 G2/4',
  },
  {
    slug: 'when-the-saints',
    title: 'When the Saints Go Marching In',
    composer: 'Traditional',
    category: 'Ragtime & marches',
    bpm: 132,
    melody: 'C4/4 E4/4 F4/4 | G4/1 | r/4 C4/4 E4/4 F4/4 | G4/1 | r/4 C4/4 E4/4 F4/4 | G4/2 E4/2 | C4/2 E4/2 | D4/1 | r/4 E4/4 E4/4 D4/4 | C4/2. C4/4 | E4/2 G4/2 | G4/4 F4/2. | r/4 E4/4 F4/4 G4/4 | E4/2 C4/2 | D4/2 C4/2 | C4/1',
    bass: 'r/2. C3/1 C3/1 C3/1 C3/1 C3/1 G2/1 G2/1 C3/1 C3/1 F2/1 F2/1 C3/1 G2/1 C3/1',
  },
  {
    slug: 'yankee-doodle',
    title: 'Yankee Doodle',
    composer: 'Traditional',
    category: 'Ragtime & marches',
    bpm: 132,
    melody: 'C4/8 C4/8 D4/8 E4/8 C4/8 E4/8 D4/4 | C4/8 C4/8 D4/8 E4/8 C4/4 B3/4 | C4/8 C4/8 D4/8 E4/8 F4/8 E4/8 D4/8 C4/8 | B3/8 G3/8 A3/8 B3/8 C4/4 C4/4',
    bass: 'C3/4 G2/4 C3/4 G2/4 C3/4 G2/4 C3/4 G2/4 C3/4 G2/4 F2/4 F2/4 G2/4 G2/4 C3/4 C3/4',
  },
  // ---- Folk & traditional -----------------------------------------------------
  {
    slug: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional',
    category: 'Folk & traditional',
    bpm: 96,
    melody:
      'A4/4 | C5/2 D5/4 | E5/4. F5/8 E5/4 | D5/2 B4/4 | G4/4. A4/8 B4/4 | C5/2 A4/4 | A4/4. G#4/8 A4/4 | B4/2 G#4/4 | E4/2 A4/4 | C5/2 D5/4 | E5/4. F5/8 E5/4 | D5/2 B4/4 | G4/4. A4/8 B4/4 | C5/4. B4/8 A4/4 | G#4/4. F#4/8 G#4/4 | A4/2. | A4/2.',
    bass: 'r/4 A2/2. C3/2. G2/2. E2/2. A2/2. F2/2. E2/2. E2/2. A2/2. C3/2. G2/2. E2/2. A2/2. E2/2. A2/2. A2/2.',
  },
  {
    slug: 'amazing-grace',
    title: 'Amazing Grace',
    composer: 'Traditional',
    category: 'Folk & traditional',
    bpm: 84,
    melody: 'D4/4 | G4/2 B4/8 G4/8 | B4/2 A4/4 | G4/2 E4/4 | D4/2 D4/4 | G4/2 B4/8 G4/8 | B4/2 A4/8 B4/8 | D5/2. | D5/2 B4/4 | D5/4. B4/8 D5/8 B4/8 | G4/2 D4/4 | E4/4. G4/8 G4/8 E4/8 | D4/2 D4/4 | G4/2 B4/8 G4/8 | B4/2 A4/4 | G4/2.',
    bass: 'r/4 G2/2. G2/2. C3/2. G2/2. G2/2. D3/2. D3/2. G2/2. G2/2. G2/2. C3/2. G2/2. G2/2. D3/2. G2/2.',
  },
  {
    slug: 'auld-lang-syne',
    title: 'Auld Lang Syne',
    composer: 'Traditional',
    category: 'Folk & traditional',
    bpm: 84,
    melody: 'C4/4 | F4/4. F4/8 F4/4 A4/4 | G4/4. F4/8 G4/4 A4/8 G4/8 | F4/4. F4/8 A4/4 C5/4 | D5/2. D5/4 | C5/4. A4/8 A4/4 F4/4 | G4/4. F4/8 G4/4 A4/8 G4/8 | F4/4. D4/8 D4/4 C4/4 | F4/2.',
    bass: 'r/4 F2/1 C3/1 F2/1 Bb2/1 F2/1 C3/1 Bb2/2 C3/2 F2/2.',
  },
  {
    slug: 'oh-susanna',
    title: 'Oh! Susanna',
    composer: 'Stephen Foster',
    category: 'Folk & traditional',
    bpm: 120,
    melody: 'C4/8 D4/8 | E4/4 G4/4 G4/4. A4/8 | G4/4 E4/4 C4/4. D4/8 | E4/4 E4/4 D4/4 C4/4 | D4/2. C4/8 D4/8 | E4/4 G4/4 G4/4. A4/8 | G4/4 E4/4 C4/4. D4/8 | E4/4 E4/4 D4/4 D4/4 | C4/2.',
    bass: 'r/4 C3/1 C3/1 C3/1 G2/1 C3/1 C3/1 G2/1 C3/2.',
  },
  // ---- Nursery & kids -----------------------------------------------------------
  {
    slug: 'twinkle-twinkle',
    title: 'Twinkle Twinkle Little Star',
    composer: 'Traditional',
    category: 'Nursery & kids',
    bpm: 100,
    melody:
      'C4/4 C4/4 G4/4 G4/4 | A4/4 A4/4 G4/2 | F4/4 F4/4 E4/4 E4/4 | D4/4 D4/4 C4/2 | G4/4 G4/4 F4/4 F4/4 | E4/4 E4/4 D4/2 | G4/4 G4/4 F4/4 F4/4 | E4/4 E4/4 D4/2 | C4/4 C4/4 G4/4 G4/4 | A4/4 A4/4 G4/2 | F4/4 F4/4 E4/4 E4/4 | D4/4 D4/4 C4/2',
    bass: 'C3/1 F2/2 C3/2 F2/2 C3/2 G2/2 C3/2 C3/2 F2/2 C3/2 G2/2 C3/2 F2/2 C3/2 G2/2 C3/1 F2/2 C3/2 F2/2 C3/2 G2/2 C3/2',
  },
  {
    slug: 'mary-had-a-little-lamb',
    title: 'Mary Had a Little Lamb',
    composer: 'Traditional',
    category: 'Nursery & kids',
    bpm: 112,
    melody: 'E4/4 D4/4 C4/4 D4/4 | E4/4 E4/4 E4/2 | D4/4 D4/4 D4/2 | E4/4 G4/4 G4/2 | E4/4 D4/4 C4/4 D4/4 | E4/4 E4/4 E4/4 E4/4 | D4/4 D4/4 E4/4 D4/4 | C4/1',
    bass: 'C3/1 C3/1 G2/1 C3/1 C3/1 C3/1 G2/1 C3/1',
  },
  {
    slug: 'frere-jacques',
    title: 'Frère Jacques',
    composer: 'Traditional',
    category: 'Nursery & kids',
    bpm: 108,
    melody: 'C4/4 D4/4 E4/4 C4/4 | C4/4 D4/4 E4/4 C4/4 | E4/4 F4/4 G4/2 | E4/4 F4/4 G4/2 | G4/8 A4/8 G4/8 F4/8 E4/4 C4/4 | G4/8 A4/8 G4/8 F4/8 E4/4 C4/4 | C4/4 G3/4 C4/2 | C4/4 G3/4 C4/2',
    bass: x('C3/2 G2/2', 8),
  },
  {
    slug: 'row-your-boat',
    title: 'Row, Row, Row Your Boat',
    composer: 'Traditional',
    category: 'Nursery & kids',
    bpm: 72,
    melody: 'C4/4. C4/4. | C4/4 D4/8 E4/4. | E4/4 D4/8 E4/4 F4/8 | G4/2. | C5/8 C5/8 C5/8 G4/8 G4/8 G4/8 | E4/8 E4/8 E4/8 C4/8 C4/8 C4/8 | G4/4 F4/8 E4/4 D4/8 | C4/2.',
    bass: 'C3/2. C3/2. C3/2. C3/2. C3/2. C3/2. G2/2. C3/2.',
  },
  {
    slug: 'london-bridge',
    title: 'London Bridge',
    composer: 'Traditional',
    category: 'Nursery & kids',
    bpm: 112,
    melody: 'G4/4. A4/8 G4/4 F4/4 | E4/4 F4/4 G4/2 | D4/4 E4/4 F4/2 | E4/4 F4/4 G4/2 | G4/4. A4/8 G4/4 F4/4 | E4/4 F4/4 G4/2 | D4/2 G4/2 | E4/4 C4/2.',
    bass: 'C3/1 C3/1 G2/1 C3/1 C3/1 C3/1 G2/1 C3/1',
  },
  {
    slug: 'happy-birthday',
    title: 'Happy Birthday',
    composer: 'Traditional',
    category: 'Nursery & kids',
    bpm: 100,
    melody: 'G4/8. G4/16 | A4/4 G4/4 C5/4 | B4/2 G4/8. G4/16 | A4/4 G4/4 D5/4 | C5/2 G4/8. G4/16 | G5/4 E5/4 C5/4 | B4/4 A4/4 F5/8. F5/16 | E5/4 C5/4 D5/4 | C5/2.',
    bass: 'r/4 C3/2. G2/2. G2/2. C3/2. C3/2. F2/2. C3/4 G2/4 G2/4 C3/2.',
  },
  {
    slug: 'old-macdonald',
    title: 'Old MacDonald Had a Farm',
    composer: 'Traditional',
    category: 'Nursery & kids',
    bpm: 120,
    melody: 'G4/4 G4/4 G4/4 D4/4 | E4/4 E4/4 D4/2 | B4/4 B4/4 A4/4 A4/4 | G4/2. D4/4 | G4/4 G4/4 G4/4 D4/4 | E4/4 E4/4 D4/2 | B4/4 B4/4 A4/4 A4/4 | G4/1',
    bass: 'G2/1 C3/2 G2/2 D3/1 G2/1 G2/1 C3/2 G2/2 D3/1 G2/1',
  },
];

// ---- Notation → MIDI ----------------------------------------------------------

const PPQ = 480;
const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function pitch(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function ticks(dur: string): number {
  const dotted = dur.endsWith('.');
  const d = Number(dotted ? dur.slice(0, -1) : dur);
  const base = d === 12 ? PPQ / 3 : (PPQ * 4) / d;
  if (!Number.isFinite(base)) throw new Error(`bad duration ${dur}`);
  return Math.round(dotted ? base * 1.5 : base);
}

type Ev = { tick: number; bytes: number[] };

function track(text: string, channel: number, velocity: number): { events: Ev[]; length: number } {
  const events: Ev[] = [];
  let t = 0;
  for (const tok of text.split(/\s+/).filter((s) => s && s !== '|')) {
    const [notes, dur] = tok.split('/');
    const len = ticks(dur);
    if (notes !== 'r') {
      for (const n of notes.split('+')) {
        const p = pitch(n);
        events.push({ tick: t, bytes: [0x90 | channel, p, velocity] }, { tick: t + Math.max(1, len - 12), bytes: [0x80 | channel, p, 0] });
      }
    }
    t += len;
  }
  return { events, length: t };
}

const varint = (v: number) => {
  const out = [v & 0x7f];
  while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80);
  return out;
};
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function midiFile(song: Song): Uint8Array {
  const mel = track(song.melody, 0, 96);
  const bass = song.bass ? track(song.bass, 1, 64) : { events: [], length: 0 };
  const events = [...mel.events, ...bass.events].sort((a, b) => a.tick - b.tick || (a.bytes[0] & 0xf0) - (b.bytes[0] & 0xf0));
  const us = Math.round(60_000_000 / song.bpm);
  const data: number[] = [0x00, 0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255];
  const name = Array.from(song.title.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), (c) => c.charCodeAt(0) & 0x7f);
  data.push(0x00, 0xff, 0x03, ...varint(name.length), ...name);
  data.push(0x00, 0xc0, 0, 0x00, 0xc1, 32); // melody: piano, bass: acoustic bass
  let last = 0;
  for (const e of events) {
    data.push(...varint(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(0x00, 0xff, 0x2f, 0x00);
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255, 0x4d, 0x54, 0x72, 0x6b, ...u32(data.length), ...data]);
}

// ---- Write ----------------------------------------------------------------------

if (process.argv[1]?.endsWith('songbook.ts')) {
  mkdirSync('songs', { recursive: true });
  const index: Record<string, { title: string; composer: string; category: string; bpm: number }> = {};
  for (const s of SONGS) {
    writeFileSync(`songs/${s.slug}.mid`, midiFile(s));
    index[s.slug] = { title: s.title, composer: s.composer, category: s.category, bpm: s.bpm };
  }
  writeFileSync('songs/songs.json', `${JSON.stringify(index, null, 2)}\n`);
  console.log(`wrote ${SONGS.length} songs to songs/ (+ songs.json)`);
}
