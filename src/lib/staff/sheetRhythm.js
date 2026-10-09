/**
 * Read a scanned page into solfa with real durations.
 *
 * Printed syllables carry the pitch and the voice; the staff carries the rhythm.
 * So we detect noteheads on each staff and pair them with the syllables printed
 * underneath, then write each syllable with the duration its notehead implied.
 */

import { convertChunks, pagesToSolfa } from '../ocr.js'
import { findStaves, inkRows, otsuThreshold, toLuma } from './geometry.js'
import { detectNotes, toMask } from './symbols.js'

const PART_LABELS = new Map([
  ['bass', 'Bass'],
  ['tenor', 'Tenor'],
  ['alto', 'Alto'],
  ['soprano', 'Soprano'],
])

// The solfa grammar prints lengths as a whole number or a fraction, so durations
// are rounded to the nearest of these rather than written as decimals.
const DENOMINATORS = [1, 2, 3, 4, 6, 8, 12, 16]

/** A beat count as solfa duration syntax, e.g. 0.5 -> "(1/2)", 3 dotted -> "(2)." */
export function formatDuration(beats, dotted = false) {
  const base = dotted ? beats / 1.5 : beats
  let body = ''
  if (Math.abs(base - 1) > 1e-6) body = `(${toFraction(base)})`
  return body + (dotted ? '.' : '')
}

function toFraction(value) {
  for (const den of DENOMINATORS) {
    const num = value * den
    const rounded = Math.round(num)
    if (rounded >= 1 && Math.abs(num - rounded) < 1e-6) {
      return den === 1 ? `${rounded}` : `${rounded}/${den}`
    }
  }
  return String(Math.round(value * 100) / 100)
}

/** Horizontal extent of a staff, measured along its middle line. */
function staffExtent(mask, width, height, staff) {
  const mid = Math.round(staff.lines[2])
  let left = 0
  let right = width - 1
  while (left < width - 1 && !mask[mid * width + left]) left++
  while (right > 0 && !mask[mid * width + right]) right--
  return { left: Math.max(0, left - 1), right: Math.min(width - 1, right + 1) }
}

const centreX = (w) => (w.bbox.x0 + w.bbox.x1) / 2
const centreY = (w) => (w.bbox.y0 + w.bbox.y1) / 2

/**
 * Read one page image plus its positioned OCR words into voices with durations.
 * Returns `parts` (each a name and a token list) and counts of anything the two
 * halves disagreed about, so the UI can warn before playback.
 */
export function readStaffRhythm(canvas, words = [], options = {}) {
  const { width, height } = canvas
  const image = canvas.getContext('2d').getImageData(0, 0, width, height)
  const luma = toLuma(image.data, width, height)
  const threshold = otsuThreshold(luma)
  const staves = findStaves(inkRows(luma, width, height, threshold), options.staff)
  const mask = toMask(luma, width, height, threshold)

  const byName = new Map()
  const claimed = new Set()
  let notesFound = 0
  let matched = 0

  staves.forEach((staff, index) => {
    const next = staves[index + 1]
    const notes = detectNotes({ mask, width, height, staff })
    if (!notes.length) return

    const extent = staffExtent(mask, width, height, staff)
    // Syllables sit just under the staff, but must not reach the next system.
    const band = {
      top: staff.bottom + staff.spacing * 0.15,
      bottom: Math.min(
        staff.bottom + staff.spacing * 3.5,
        next ? next.top - staff.spacing * 0.2 : Infinity
      ),
    }

    const near = words.filter((w) => {
      if (claimed.has(w)) return false
      const margin = staff.spacing * 1.5
      return (
        centreY(w) >= band.top &&
        centreY(w) <= band.bottom &&
        centreX(w) >= extent.left - margin &&
        centreX(w) <= extent.right + margin
      )
    })

    let label = null
    const syllables = []
    for (const w of near) {
      const bare = w.text.toLowerCase().replace(/[^a-z]/g, '')
      // A voice name is printed beside the staff, before its first note.
      if (!label && PART_LABELS.has(bare) && centreX(w) < notes[0].x) {
        label = PART_LABELS.get(bare)
        claimed.add(w)
        continue
      }
      syllables.push(w)
      claimed.add(w)
    }

    if (!syllables.length) return

    const pairs = pairWithNotes(syllables, notes, staff.spacing * 1.5)
    const tokens = pairs.map(({ word, note }) => buildToken(word, note))
    if (!tokens.length) return

    notesFound += notes.length
    matched += pairs.length

    const name = label || 'Main'
    const key = name.toLowerCase()
    const existing = byName.get(key)
    if (existing) existing.tokens.push(...tokens)
    else byName.set(key, { name, tokens })
  })

  return {
    parts: [...byName.values()],
    staves: staves.length,
    notesFound,
    matched,
    unmatchedNotes: notesFound - matched,
  }
}

/**
 * Pair syllables with noteheads by horizontal position: a printed syllable sits
 * under its note, and musical spacing keeps them in step. Each note is used once.
 */
export function pairWithNotes(words, notes, tolerance) {
  const used = new Set()
  const pairs = []

  for (const word of [...words].sort((a, b) => centreX(a) - centreX(b))) {
    const cx = centreX(word)
    let best = -1
    let bestDist = Infinity
    notes.forEach((note, i) => {
      if (used.has(i)) return
      const dist = Math.abs(note.x - cx)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    if (best < 0 || bestDist > tolerance) continue
    used.add(best)
    pairs.push({ word, note: notes[best] })
  }

  return pairs.sort((a, b) => a.note.x - b.note.x)
}

/** A syllable from the OCR text carrying the duration read off the staff. */
function buildToken(word, note) {
  const base = convertChunks([word.text]).replace(/-+$/, '')
  if (!base) return ''
  return base + formatDuration(note.beats, note.dotted)
}

// Only the four SATB names are bare keywords in the grammar; anything else has
// to use the bracketed custom-name form or the player will read it as a note.
const BARE_PARTS = new Set(['bass', 'tenor', 'alto', 'soprano'])

/** Render voices as a solfa sheet the player can already parse. */
export function rhythmToSolfa(result, { key } = {}) {
  const lines = []
  if (key) lines.push(`Key: ${key}`)
  for (const part of result.parts) {
    const tokens = part.tokens.filter(Boolean)
    if (!tokens.length) continue
    lines.push(BARE_PARTS.has(part.name.toLowerCase()) ? part.name : `[${part.name}]`)
    lines.push(tokens.join(' '))
  }
  return lines.join('\n')
}

/**
 * Build one solfa sheet from every recognised page.
 *
 * Durations come from the staff where it could be read; the plain OCR reading is
 * kept as a fallback for sheets whose staff is too faint to measure, because
 * pitches alone are still better than nothing.
 */
export function pagesToRhythmSolfa(pages = []) {
  const fallback = pagesToSolfa(pages)
  const byName = new Map()
  let staves = 0
  let unmatched = 0
  let matched = 0

  for (const page of pages) {
    if (!page?.canvas) continue
    const result = readStaffRhythm(page.canvas, page.words || [])
    staves += result.staves
    unmatched += result.unmatchedNotes
    matched += result.matched

    for (const part of result.parts) {
      const tokens = part.tokens.filter(Boolean)
      if (!tokens.length) continue
      const key = part.name.toLowerCase()
      const existing = byName.get(key)
      if (existing) existing.tokens.push(...tokens)
      else byName.set(key, { name: part.name, tokens: [...tokens] })
    }
  }

  const parts = [...byName.values()]
  if (!parts.length) {
    return { ...fallback, staves, matched, unmatchedNotes: unmatched, timed: false }
  }

  const text = rhythmToSolfa({ parts }, { key: fallback.key })
  return {
    ...fallback,
    text,
    lineCount: text.split('\n').filter(Boolean).length,
    staves,
    matched,
    unmatchedNotes: unmatched,
    timed: true,
  }
}
