const MAJOR_BY_FIFTHS = [
  'Cb',
  'Gb',
  'Db',
  'Ab',
  'Eb',
  'Bb',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
]

const MINOR_BY_FIFTHS = [
  'Ab',
  'Eb',
  'Bb',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
  'G#',
  'D#',
  'A#',
]

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

const PITCH_CLASS = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  'E#': 5,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
  Cb: 11,
}

export function pitchClass(name) {
  if (typeof name !== 'string') return null
  const key = name.trim()
  const match = key.match(/^([a-gA-G])([#b]?)$/)
  if (!match) return null
  const normalized = match[1].toUpperCase() + (match[2] || '')
  return Object.prototype.hasOwnProperty.call(PITCH_CLASS, normalized)
    ? PITCH_CLASS[normalized]
    : null
}

export function normalizeKeyName(name) {
  const pc = pitchClass(name)
  if (pc == null) return null
  return keyNameForPitchClass(pc)
}

export function keyNameForPitchClass(pc, { preferFlats = false } = {}) {
  const value = ((Math.round(pc) % 12) + 12) % 12
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[value]
}

export function modeFromValue(value) {
  return String(value ?? '').toLowerCase() === 'minor' ? 'minor' : 'major'
}

export function keyNameForFifths(fifths, mode = 'major') {
  const value = Math.max(-7, Math.min(7, Math.round(Number(fifths) || 0)))
  const table = modeFromValue(mode) === 'minor' ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS
  return normalizeKeyName(table[value + 7])
}

export function fifthsForKey(name, mode = 'major') {
  const pc = pitchClass(name)
  if (pc == null) return null
  const table = modeFromValue(mode) === 'minor' ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS
  for (let index = 0; index < table.length; index += 1) {
    if (pitchClass(table[index]) === pc) return index - 7
  }
  return 0
}

export function relativeMajor(name) {
  const pc = pitchClass(name)
  if (pc == null) return 'C'
  return keyNameForPitchClass((pc + 3) % 12, { preferFlats: true })
}

export function dohKeyFor(tonic, mode = 'major') {
  if (modeFromValue(mode) === 'minor') return relativeMajor(tonic)
  return normalizeKeyName(tonic) || 'C'
}

export function keySignatureForKey(name, mode = 'major') {
  const normalized = normalizeKeyName(name) || 'C'
  const normalizedMode = modeFromValue(mode)
  return {
    fifths: fifthsForKey(normalized, normalizedMode) ?? 0,
    mode: normalizedMode,
    tonic: normalized,
    dohKey: dohKeyFor(normalized, normalizedMode),
  }
}
