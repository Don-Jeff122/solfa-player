import { expandBars } from './repeats.js'

export const SOLFA_OFFSETS = {
  do: 0,
  re: 2,
  mi: 4,
  fa: 5,
  so: 7,
  sol: 7,
  la: 9,
  ti: 11,
  // Chromatic solfa: a raised note sits a semitone above its plain neighbour,
  // a lowered one a semitone below. "Ra" is do-flat, so it lands below do and
  // is written as -1 rather than the 11 that would sound an octave too high.
  di: 1,
  ri: 3,
  fi: 6,
  si: 8,
  li: 10,
  ra: -1,
  me: 1,
  se: 4,
  le: 6,
  te: 8,
}

/** Chromatic syllables, raised first then lowered, for help text and tests. */
export const CHROMATIC_SOLFA = {
  raised: ['Di', 'Ri', 'Fi', 'Si', 'Li'],
  lowered: ['Ra', 'Me', 'Se', 'Le', 'Te'],
}

export const LETTER_TO_SOLFA = {
  d: 'do',
  r: 're',
  m: 'mi',
  f: 'fa',
  s: 'so',
  l: 'la',
  t: 'ti',
}

export const SOLFA_NAMES = ['Do', 'Re', 'Mi', 'Fa', 'So', 'La', 'Ti']

const SEMITONES = {
  c: 0,
  'c#': 1,
  db: 1,
  d: 2,
  'd#': 3,
  eb: 3,
  e: 4,
  f: 5,
  'f#': 6,
  gb: 6,
  g: 7,
  'g#': 8,
  ab: 8,
  a: 9,
  'a#': 10,
  bb: 10,
  b: 11,
}

export const MAJOR_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export const BASE_DO_MIDI = 60

export const ALL_PARTS = '__all__'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function keyToSemitones(key) {
  if (typeof key !== 'string') return null
  const norm = key.toLowerCase().replace(/\s+/g, '')
  return Object.prototype.hasOwnProperty.call(SEMITONES, norm) ? SEMITONES[norm] : null
}

export function normalizeKey(key) {
  if (typeof key !== 'string') return key
  const m = key.match(/^([a-gA-G])([#b])?$/)
  if (!m) return key
  return m[1].toUpperCase() + (m[2] ? (m[2] === 'b' ? 'b' : '#') : '')
}

export function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function midiName(midi) {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[pc]}${octave}`
}

export function tonicMidiForKey(key, octaveShift = 0) {
  const semi = keyToSemitones(key)
  if (semi == null) return BASE_DO_MIDI + 12 * octaveShift
  return BASE_DO_MIDI + semi + 12 * octaveShift
}

export function solfaForMidi(midi, tonicMidi) {
  const pc = ((midi - tonicMidi) % 12 + 12) % 12
  const map = {
    0: 'Do',
    2: 'Re',
    4: 'Mi',
    5: 'Fa',
    7: 'So',
    9: 'La',
    11: 'Ti',
    1: 'Di',
    3: 'Ri',
    6: 'Fi',
    8: 'Si',
    10: 'Li',
  }
  return Object.prototype.hasOwnProperty.call(map, pc) ? map[pc] : null
}

export function noteToMidi(note, tonicMidi = BASE_DO_MIDI) {
  if (!note || note.solfa == null) return null
  const offset = SOLFA_OFFSETS[note.solfa]
  if (offset == null) return null
  return tonicMidi + offset + 12 * (note.up || 0) - 12 * (note.down || 0)
}

/**
 * Lowest note the app will play, C1 at 32.7 Hz.
 *
 * Registers stack with the octave marks printed in the sheet, so a bass part
 * written as `,,Do` sits an octave below an already low `,Do` and lands on
 * C0 at 16 Hz, which no laptop speaker or phone can reproduce. Such a note is
 * silent rather than deep, so it is lifted to the lowest audible C instead.
 */
export const MIDI_FLOOR = 24

/**
 * Where each named voice sits by default. Every voice sings its own solfa
 * line, so this is purely about register: Soprano and Alto read at written
 * pitch while Tenor and Bass read an octave below, as in choral scores. The
 * Bass sits a further octave down to give a choir-sized spread. Unknown and
 * custom part names stay at 0.
 */
export const PART_OCTAVES = { soprano: 0, alto: 0, tenor: -1, bass: -2 }

export const VOICE_OCTAVE_MIN = -3
export const VOICE_OCTAVE_MAX = 3

export function partOctave(name) {
  const found = PART_OCTAVES[String(name == null ? '' : name).trim().toLowerCase()]
  return found == null ? 0 : found
}

export function clampVoiceOctave(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(VOICE_OCTAVE_MIN, Math.min(VOICE_OCTAVE_MAX, Math.round(n)))
}

/**
 * Build playable sequences. `partSelection` is either ALL_PARTS or a list of
 * voice names, so any combination of voices can play together.
 *
 * `voiceOctaves` maps a voice name to its total octave register, overriding
 * PART_OCTAVES. The value is the voice's own register, so what the UI shows is
 * exactly what sounds; the global `octaveShift` still moves every voice.
 */
export function buildSequences(result, key, octaveShift, partSelection, voiceOctaves) {
  const base = tonicMidiForKey(key, 0) + 12 * (octaveShift || 0)
  const wanted =
    partSelection === ALL_PARTS || partSelection == null
      ? null
      : new Set(Array.isArray(partSelection) ? partSelection : [partSelection])
  const parts = wanted ? result.parts.filter((p) => wanted.has(p.name)) : result.parts
  return parts.map((p) => {
    const register = voiceOctaves && voiceOctaves[p.name] != null
      ? clampVoiceOctave(voiceOctaves[p.name])
      : partOctave(p.name)
    const tonic = base + 12 * register
    // Repeats are expanded here, once, so playback, the on-screen keys and the
    // WAV export all follow the written |: ... :| and 1./2. endings.
    const { notes: written, barStarts } = expandBars(p)
    const notes = written.map((n) => {
      const midi = noteToMidi(n, tonic)
      return { ...n, midi: midi == null ? midi : Math.max(MIDI_FLOOR, midi) }
    })
    return {
      name: p.name,
      notes,
      // Beat offsets of every bar's downbeat for the metronome; only usable
      // when the sheet names a meter, otherwise the grid is unknowable.
      barStarts: result && result.meter && p.bars && p.bars.length ? barStarts : null,
    }
  })
}

export function sequenceBeats(seq) {
  return seq.notes.reduce((sum, n) => sum + n.beats, 0)
}
