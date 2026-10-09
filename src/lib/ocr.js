import { parseSolfa } from './parseSolfa.js'

/**
 * Solfa syllables are not a standard Tesseract vocabulary, so raw OCR output is
 * noisy. This maps the syllables we care about onto a small, forgiving alphabet
 * and repairs the most common confusions.
 */

const SYLLABLES = [
  'do',
  're',
  'mi',
  'fa',
  'so',
  'la',
  'ti',
  // Chromatic solfa, so a printed sharp or flat is not thrown away as noise.
  'di',
  'ri',
  'fi',
  'si',
  'li',
  'ra',
  'me',
  'se',
  'le',
  'te',
]

const FIRST_LETTER = {
  d: 'do',
  r: 're',
  m: 'mi',
  f: 'fa',
  s: 'so',
  l: 'la',
  t: 'ti',
}

const LOOKUP = new Map()
for (const s of SYLLABLES) LOOKUP.set(s, s)
LOOKUP.set('sol', 'so')

/** Normalise a raw OCR token, or return null if it isn't a solfa syllable. */
export function normalizeSyllable(token) {
  const cleaned = String(token || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  if (!cleaned) return null
  if (LOOKUP.has(cleaned)) return LOOKUP.get(cleaned)

  // A single clipped syllable ("d" for "Do") or a two-character misread
  // ("rc" for "Re") is still identifiable from its first letter.
  if (cleaned.length <= 2 && FIRST_LETTER[cleaned[0]]) {
    return FIRST_LETTER[cleaned[0]]
  }
  return null
}

const PART_WORDS = new Set(['bass', 'tenor', 'alto', 'soprano'])

const KEY_LINE_RE =
  /^\s*(?:key|tonic)\s*[:=]\s*([a-gA-G])\s*([#b]?)\s*$/i
const SOLFA_KEY_RE = /^\s*1\s*=\s*([a-gA-G])\s*([#b]?)\s*$/

/** Read a "Key: G" / "1=F#" declaration, if the line holds one. */
export function detectKeyLine(line) {
  const m = KEY_LINE_RE.exec(line) || SOLFA_KEY_RE.exec(line)
  if (!m) return null
  const letter = m[1].toUpperCase()
  const accidental = m[2] === '#' ? '#' : m[2] === 'b' ? 'b' : ''
  return `${letter}${accidental}`
}

/** A line that is only a part name is a voice label, not notes. */
function detectPartLine(line) {
  const t = line.trim().toLowerCase()
  if (!PART_WORDS.has(t)) return null
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Convert raw OCR text into a solfa sheet.
 *
 * Recognised syllables become notes; octave marks, durations, rests, key
 * declarations and part labels are preserved. Tokens we cannot recognise are
 * dropped rather than poisoning the parser, and `unreadable` counts them so the
 * UI can warn that the result needs checking.
 */
export function textToSolfa(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => convertStructuredLine(line))
    .filter((line) => line.length > 0)

  const unreadable = countUnrecognised(rawText)
  const key = String(rawText || '')
    .split(/\r?\n/)
    .map(detectKeyLine)
    .find(Boolean)

  return { text: lines.join('\n'), lineCount: lines.length, unreadable, key: key || null }
}

function convertStructuredLine(line) {
  const key = detectKeyLine(line)
  if (key) return `Key: ${key}`

  const part = detectPartLine(line)
  if (part) return part

  return convertLine(line)
}

/**
 * Convert a list of whitespace-separated chunks (one OCR line, or a single
 * word) into canonical solfa. Split out so the staff matcher can reuse the same
 * octave-mark and dash handling for individual words.
 */
export function convertChunks(chunks) {
  const tokens = []

  for (const chunk of chunks) {
    // A dash with no note belongs to the note before it: "Do -" -> "do-".
    if (/^-+$/.test(chunk)) {
      const prev = tokens[tokens.length - 1]
      if (prev) prev.dashes += chunk
      continue
    }

    const lead = chunk.match(/^[,']+/)?.[0] ?? ''
    const trail = chunk.match(/[,']+$/)?.[0] ?? ''
    const dashes = (chunk.match(/-+/g) || []).join('')
    const bare = chunk.replace(/[,']|-/g, '')
    const isRest = /^[0oO]+$/.test(bare) && bare.length > 0

    if (isRest) {
      tokens.push({ solfa: '0', down: 0, up: 0, dashes })
      continue
    }

    const solfa = normalizeSyllable(bare)
    if (!solfa) continue

    tokens.push({
      solfa,
      down: lead.split(',').length - 1,
      up: trail.split("'").length - 1,
      dashes,
    })
  }

  return tokens.map(render).join(' ')
}

function convertLine(line) {
  return convertChunks(line.split(/\s+/).filter(Boolean))
}

/** Canonical sheet form: leading commas down, trailing quotes up, then dashes. */
function render(t) {
  if (t.solfa === '0') return `0${t.dashes}`
  return `${','.repeat(t.down)}${t.solfa}${"'".repeat(t.up)}${t.dashes}`
}

function countUnrecognised(rawText) {
  let bad = 0
  for (const line of String(rawText || '').split(/\r?\n/)) {
    // Structural lines are recognised elsewhere, so they aren't noise.
    if (detectKeyLine(line) || detectPartLine(line)) continue

    for (const chunk of line.split(/\s+/).filter(Boolean)) {
      const bare = chunk.replace(/[^a-zA-Z0-9]/g, '')
      if (!bare) continue
      if (/^0+$/.test(bare)) continue
      if (/^-+$/.test(bare)) continue
      if (!normalizeSyllable(bare)) bad++
    }
  }
  return bad
}

/**
 * Flatten Tesseract's block tree into a flat list of positioned words. The staff
 * matcher needs these boxes to line each printed syllable up with its notehead.
 */
export function extractWords(blocks) {
  const words = []
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        for (const word of line.words || []) {
          const text = String(word?.text || '').trim()
          if (!text) continue
          const { x0, y0, x1, y1 } = word.bbox || {}
          if ([x0, y0, x1, y1].some((v) => typeof v !== 'number')) continue
          words.push({ text, confidence: word.confidence ?? 0, bbox: { x0, y0, x1, y1 } })
        }
      }
    }
  }
  return words.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
}

/**
 * Join the OCR result of every page into one sheet, keeping page breaks as
 * newlines so parts don't run together across pages.
 */
export function pagesToSolfa(pages) {
  const raw = (pages || [])
    .map((p) => (typeof p === 'string' ? p : p?.text || ''))
    .join('\n')
  const result = textToSolfa(raw)
  const confidence =
    pages && pages.length
      ? pages.reduce((sum, p) => sum + (p?.confidence ?? 0), 0) / pages.length
      : 0
  return { ...result, confidence, pages: pages?.length || 0 }
}

/** Validate a converted sheet so the UI can warn before playback. */
export function validateConverted(text) {
  return parseSolfa(text)
}
