import {
  fifthsForKey,
  keyNameForFifths,
  modeFromValue,
  normalizeKeyName,
} from './keys.js'

const LOW_CONFIDENCE = 0.7
const STEP_RE = /^[A-G]$/

function finite(value, fallback = null) {
  if (value == null || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function clean(value, limit = 240) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function normalizeMode(value) {
  return modeFromValue(value)
}

function normalizeScoreKey(raw, warnings) {
  const value = raw && typeof raw === 'object' ? raw : {}
  let fifths = finite(value.fifths, null)
  let mode = normalizeMode(value.mode ?? value.tonicMode)
  let tonic = normalizeKeyName(value.tonic ?? value.name)

  if (fifths == null && tonic) fifths = fifthsForKey(tonic, mode)
  if (fifths == null && typeof raw === 'string') {
    tonic = normalizeKeyName(raw)
    if (tonic) fifths = fifthsForKey(tonic, mode)
  }
  if (fifths == null) {
    fifths = 0
    warnings.push('No key signature was found; C major was assumed.')
  }
  fifths = clamp(Math.round(fifths), -7, 7)
  const named = keyNameForFifths(fifths, mode)
  tonic = tonic || named
  if (!tonic) {
    tonic = 'C'
    mode = 'major'
  }
  return {
    fifths,
    mode,
    tonic,
    dohKey: normalizeKeyName(tonic) || 'C',
  }
}

function normalizeTime(raw, warnings) {
  const value = raw && typeof raw === 'object' ? raw : {}
  let beats = finite(value.beats ?? value.num, null)
  let beatType = finite(value.beatType ?? value.den, null)
  if ((beats == null || beatType == null) && typeof raw === 'string') {
    const match = raw.match(/(\d+)\s*\/\s*(\d+)/)
    if (match) {
      beats = Number(match[1])
      beatType = Number(match[2])
    }
  }
  if (
    beats == null ||
    beatType == null ||
    beats <= 0 ||
    beatType <= 0 ||
    beats > 32 ||
    beatType > 32
  ) {
    if (raw != null) warnings.push('The time signature could not be read.')
    return null
  }
  return {
    beats: Math.round(beats),
    beatType: Math.round(beatType),
  }
}

function normalizePitch(raw) {
  if (!raw || typeof raw !== 'object') return null
  const step = clean(raw.step, 1).toUpperCase()
  if (!STEP_RE.test(step)) return null
  const octave = finite(raw.octave, null)
  if (octave == null || octave < 0 || octave > 10) return null
  return {
    step,
    alter: clamp(Math.round(finite(raw.alter, 0)), -2, 2),
    octave: Math.round(octave),
  }
}

function normalizeNote(raw, measureNumber, index, warnings, partName) {
  if (!raw || typeof raw !== 'object') return null
  const pitch = normalizePitch(raw.pitch)
  const rest = Boolean(raw.rest) || !pitch
  let duration = finite(raw.duration ?? raw.beats, null)
  if (duration == null || duration <= 0) {
    duration = 1
    warnings.push(
      `A note in ${partName}, measure ${measureNumber}, has no readable length; one beat was assumed.`
    )
  }
  if (duration > 64) {
    duration = 64
    warnings.push(`A note in ${partName}, measure ${measureNumber}, was too long; 64 beats was used.`)
  }
  const confidence = clamp(finite(raw.confidence, 1), 0, 1)
  const tie = clean(raw.tie, 20).toLowerCase()
  return {
    pitch: rest ? null : pitch,
    rest,
    duration,
    voice: clean(raw.voice, 40) || null,
    tieStart:
      raw.tieStart === true || tie === 'start' || tie === 'continue' || tie === 'both',
    tieStop:
      raw.tieStop === true || tie === 'stop' || tie === 'continue' || tie === 'both',
    confidence,
    index,
    measure: measureNumber,
  }
}

function normalizeMeasure(raw, index, partName, warnings) {
  if (!raw || typeof raw !== 'object') return null
  const number = clean(raw.number ?? raw.index ?? index + 1, 40) || String(index + 1)
  const rawNotes = Array.isArray(raw.notes) ? raw.notes : []
  const notes = rawNotes
    .map((note, noteIndex) =>
      normalizeNote(note, number, noteIndex, warnings, partName)
    )
    .filter(Boolean)
  return {
    number,
    beats: finite(raw.beats, null),
    notes,
  }
}

function notesFromFlat(raw, partName, warnings) {
  const grouped = new Map()
  const rawNotes = Array.isArray(raw.notes) ? raw.notes : []
  rawNotes.forEach((note, index) => {
    if (!note || typeof note !== 'object') return
    const number = clean(note.measure ?? note.measureNumber, 40) || '1'
    if (!grouped.has(number)) grouped.set(number, [])
    const normalized = normalizeNote(note, number, index, warnings, partName)
    if (normalized) grouped.get(number).push(normalized)
  })
  return [...grouped.entries()]
    .sort((a, b) => {
      const na = Number(a[0])
      const nb = Number(b[0])
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
      return a[0].localeCompare(b[0])
    })
    .map(([number, notes]) => ({ number, beats: null, notes }))
}

function normalizePart(raw, index, warnings) {
  if (!raw || typeof raw !== 'object') return null
  const name = clean(raw.name ?? raw.partName ?? raw.voiceName, 80) || `Part ${index + 1}`
  const rawMeasures = Array.isArray(raw.measures) ? raw.measures : []
  const measures = rawMeasures.length
    ? rawMeasures
        .map((measure, measureIndex) =>
          normalizeMeasure(measure, measureIndex, name, warnings)
        )
        .filter(Boolean)
    : notesFromFlat(raw, name, warnings)
  if (!measures.length) return null
  const notes = measures.flatMap((measure) => measure.notes)
  return {
    name,
    clef: clean(raw.clef, 20) || null,
    voice: clean(raw.voice, 40) || null,
    measures,
    notes,
    confidence: notes.length
      ? notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length
      : 0,
  }
}

export function normalizeStaffScore(raw, { source = 'gemini' } = {}) {
  const value = raw && typeof raw === 'object' ? raw : null
  if (!value) return { ok: false, error: 'The staff notation result was empty.' }
  const nested = value.staff && typeof value.staff === 'object' ? value.staff : value
  const warnings = []
  const rawWarnings = Array.isArray(nested.warnings)
    ? nested.warnings
    : Array.isArray(value.warnings)
      ? value.warnings
      : []
  for (const warning of rawWarnings.slice(0, 30)) {
    const line = clean(warning, 500)
    if (line) warnings.push(line)
  }

  const key = normalizeScoreKey(nested.key ?? nested.keySignature, warnings)
  const time = normalizeTime(nested.time ?? nested.meter ?? nested.metre, warnings)
  const rawParts = Array.isArray(nested.parts)
    ? nested.parts
    : Array.isArray(nested.voices)
      ? nested.voices
      : []
  const parts = rawParts
    .map((part, index) => normalizePart(part, index, warnings))
    .filter(Boolean)

  if (!parts.length) {
    return { ok: false, error: 'No readable staff notes were found.' }
  }

  const notes = parts.flatMap((part) => part.notes)
  if (!notes.length) {
    return { ok: false, error: 'No readable staff notes were found.' }
  }

  const uncertain = []
  for (const part of parts) {
    for (const measure of part.measures) {
      for (const note of measure.notes) {
        if (note.confidence >= LOW_CONFIDENCE) continue
        uncertain.push({
          part: part.name,
          measure: measure.number,
          note: note.index + 1,
          confidence: note.confidence,
        })
      }
    }
  }
  if (uncertain.length) {
    warnings.push(
      `${uncertain.length} note${uncertain.length === 1 ? '' : 's'} were read with low confidence. Check the marked places against the original.`
    )
  }

  const confidence = notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length
  return {
    ok: true,
    score: {
      title: clean(nested.title ?? value.title, 240),
      composer: clean(nested.composer ?? value.composer, 240),
      source,
      key,
      time,
      parts,
      warnings: [...new Set(warnings)],
      confidence,
    },
    warnings: [...new Set(warnings)],
    uncertain,
  }
}

export { LOW_CONFIDENCE }
