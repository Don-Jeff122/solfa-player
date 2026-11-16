import { partOctave, tonicMidiForKey } from '../notes.js'
import {
  dohKeyFor,
  keyNameForFifths,
  keySignatureForKey,
  pitchClass,
} from './keys.js'
import { LOW_CONFIDENCE } from './staffScore.js'

const SOLFA_BY_PITCH_CLASS = [
  'do',
  'di',
  're',
  'ri',
  'mi',
  'fa',
  'fi',
  'so',
  'si',
  'la',
  'li',
  'ti',
]

const STEP_PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const PART_ORDER = { soprano: 0, alto: 1, tenor: 2, bass: 3 }
const SHORT_VOICES = ['S', 'A', 'T', 'B']
const EPSILON = 1e-6

function pitchToMidi(pitch) {
  if (!pitch) return null
  const base = STEP_PITCH_CLASS[pitch.step]
  if (base == null) return null
  return (pitch.octave + 1) * 12 + base + pitch.alter
}

function scoreKey(score, options) {
  if (options?.tonic) {
    const signature = keySignatureForKey(options.tonic, options.mode || 'major')
    return {
      ...signature,
      fifths: signature.fifths,
    }
  }
  const raw = score.key || {}
  const mode = raw.mode === 'minor' ? 'minor' : 'major'
  const fifths = Math.max(-7, Math.min(7, Math.round(Number(raw.fifths) || 0)))
  const tonic = keyNameForFifths(fifths, mode)
  return {
    fifths,
    mode,
    tonic,
    dohKey: dohKeyFor(tonic, mode),
  }
}

function valueText(value, limit = 240) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function rational(value) {
  const beats = Math.max(0.015625, Math.round(value * 64) / 64)
  const whole = Math.round(beats)
  if (Math.abs(beats - whole) < EPSILON) return { num: whole, den: 1 }
  for (let den = 1; den <= 64; den += 1) {
    const num = Math.round(beats * den)
    if (num <= 0) continue
    if (Math.abs(beats - num / den) < EPSILON) return { num, den }
  }
  return { num: Math.round(beats * 64), den: 64 }
}

function durationSuffix(beats) {
  const { num, den } = rational(beats)
  if (den === 1) {
    if (num === 1) return ''
    return '-'.repeat(num - 1)
  }
  return `(${num}/${den})`
}

function restToken(beats) {
  return `0${durationSuffix(beats)}`
}

function measureBeats(measure, fallback) {
  if (!measure) return fallback ?? 0
  const sum = (measure.notes || []).reduce((total, note) => total + note.duration, 0)
  return Number.isFinite(sum) ? sum : fallback ?? 0
}

function orderedParts(parts) {
  const ranked = parts.map((part, index) => {
    const key = String(part.name || '').trim().toLowerCase()
    const rank = Object.prototype.hasOwnProperty.call(PART_ORDER, key) ? PART_ORDER[key] : null
    return { part, index, rank }
  })
  if (ranked.filter((entry) => entry.rank != null).length < 2) return parts
  return ranked
    .sort((a, b) => {
      if (a.rank == null && b.rank == null) return a.index - b.index
      if (a.rank == null) return 1
      if (b.rank == null) return -1
      return a.rank - b.rank
    })
    .map((entry) => entry.part)
}

function partHeader(name) {
  const value = valueText(name, 80)
  if (!value) return null
  if (/^(soprano|alto|tenor|bass)$/i.test(value)) {
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
  }
  return `[${value.replace(/[\\[\]]/g, '')}]`
}

function voiceShort(name, index) {
  const lower = String(name || '').trim().toLowerCase()
  if (lower.startsWith('soprano')) return 'S'
  if (lower.startsWith('alto')) return 'A'
  if (lower.startsWith('tenor')) return 'T'
  if (lower.startsWith('bass')) return 'B'
  return SHORT_VOICES[index] || 'S'
}

export function convertScoreToSolfa(score, options = {}) {
  if (!score || !Array.isArray(score.parts) || !score.parts.length) {
    return { ok: false, error: 'No staff parts were found.' }
  }
  const key = scoreKey(score, options)
  const dohPc = pitchClass(key.dohKey)
  const dohBase = tonicMidiForKey(key.dohKey, 0)
  if (dohPc == null) return { ok: false, error: 'The key signature could not be read.' }

  const parts = orderedParts(score.parts)
  const maxMeasures = Math.max(...parts.map((part) => part.measures.length), 0)
  if (!maxMeasures) return { ok: false, error: 'No measures were found.' }

  const warnings = [...(score.warnings || [])]
  const uncertain = []
  const meter = score.time
    ? { num: score.time.beats, den: score.time.beatType }
    : null
  const targetBeats = meter ? (meter.num * 4) / meter.den : null
  let meterValid = Boolean(meter)

  const fallbackByMeasure = []
  for (let measureIndex = 0; measureIndex < maxMeasures; measureIndex += 1) {
    let max = 0
    for (const part of parts) {
      const measure = part.measures[measureIndex]
      const sum = measureBeats(measure, 0)
      if (sum > max) max = sum
    }
    fallbackByMeasure.push(max || targetBeats || 4)
  }

  const renderedParts = []

  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex]
    const name = valueText(part.name || `Part ${partIndex + 1}`, 80)
    const header = partHeader(name)
    const base = dohBase + 12 * partOctave(name)
    const cells = []
    let pendingTie = false
    let pendingTieMidi = null

    for (let measureIndex = 0; measureIndex < maxMeasures; measureIndex += 1) {
      const measure = part.measures[measureIndex] || { notes: [] }
      const tokens = []
      let used = 0
      let tieIntoMeasure = false
      const target = targetBeats ?? fallbackByMeasure[measureIndex]
      const isEdge = measureIndex === 0 || measureIndex === maxMeasures - 1

      for (const note of measure.notes || []) {
        if (note.rest || !note.pitch) {
          if (pendingTie) {
            warnings.push(
              `${name}, measure ${measure.number}: a tie was broken by a rest or unreadable note.`
            )
            pendingTie = false
            pendingTieMidi = null
          }
          tokens.push(restToken(note.duration))
          used += note.duration
          continue
        }

        const midi = pitchToMidi(note.pitch)
        if (midi == null) {
          tokens.push(restToken(note.duration))
          used += note.duration
          warnings.push(
            `${name}, measure ${measure.number}: an unreadable note was replaced with a rest.`
          )
          continue
        }

        if (pendingTie && !note.tieStop) {
          warnings.push(
            `${name}, measure ${measure.number}: a tie was not continued by the next note.`
          )
          pendingTie = false
          pendingTieMidi = null
        }

        const tieIn = pendingTie && note.tieStop && pendingTieMidi === midi
        if (tieIn) {
          tieIntoMeasure = true
        } else if (note.tieStop && !pendingTie) {
          warnings.push(
            `${name}, measure ${measure.number}: a tie stop had no matching start.`
          )
        } else if (pendingTie && note.tieStop && pendingTieMidi !== midi) {
          warnings.push(
            `${name}, measure ${measure.number}: a tied note changed pitch, so the tie was not kept.`
          )
        }

        const pc = ((midi - dohPc) % 12 + 12) % 12
        const offset = pc
        const shift = Math.round((midi - base - offset) / 12)
        const marks = shift > 0 ? "'".repeat(shift) : shift < 0 ? ','.repeat(-shift) : ''
        tokens.push(`${SOLFA_BY_PITCH_CLASS[pc]}${marks}${durationSuffix(note.duration)}`)
        used += note.duration
        if (note.confidence < LOW_CONFIDENCE) {
          uncertain.push({
            part: name,
            measure: measure.number,
            note: note.index + 1,
            confidence: note.confidence,
          })
        }
        pendingTie = Boolean(note.tieStart)
        pendingTieMidi = pendingTie ? midi : null
      }

      if (pendingTie && measureIndex === maxMeasures - 1) {
        warnings.push(`${name}, measure ${measure.number}: a tie was left open.`)
      }

      if (tieIntoMeasure) tokens.unshift('_')

      if (used > target + EPSILON) {
        meterValid = false
        warnings.push(
          `${name}, measure ${measure.number} has ${used} beats but the time signature expects ${target}.`
        )
      } else if (used < target - EPSILON) {
        if (!isEdge || !tokens.length) {
          tokens.push(restToken(target - used))
          used = target
        }
      }

      cells.push(tokens.length ? tokens.join(' ') : restToken(target || 4))
    }

    if (header) renderedParts.push({ name, header, cells, voice: voiceShort(name, partIndex) })
  }

  const headerLines = []
  const title = valueText(score.title)
  const composer = valueText(score.composer)
  if (title) headerLines.push(title)
  if (composer) headerLines.push(composer)
  headerLines.push(`Doh = ${key.dohKey}`)
  if (meterValid && meter) headerLines.push(`Meter: ${meter.num}/${meter.den}`)

  const lines = [`Doh = ${key.dohKey}`]
  if (meterValid && meter) lines.push(`Meter: ${meter.num}/${meter.den}`)
  for (const part of renderedParts) {
    lines.push(part.header)
    lines.push(part.cells.join(' | '))
  }
  const text = lines.join('\n')
  const systems = [
    {
      rows: renderedParts.map((part) => ({
        voice: part.voice,
        cells: part.cells,
      })),
      lyrics: [],
    },
  ]

  if (uncertain.length) {
    warnings.push(
      `${uncertain.length} converted note${uncertain.length === 1 ? '' : 's'} came from low-confidence recognition. Check them before playing.`
    )
  }

  return {
    ok: true,
    text,
    systems,
    headerLines,
    key: key.dohKey,
    displayKey: `${key.tonic} ${key.mode}`,
    tonic: key.tonic,
    mode: key.mode,
    fifths: key.fifths,
    meter,
    meterValid,
    parts: renderedParts.map((part) => part.name),
    rows: renderedParts.length,
    bars: maxMeasures,
    warnings: [...new Set(warnings)],
    uncertain,  }
}
