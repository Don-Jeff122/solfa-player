/**
 * End-to-end check: real Tesseract on a rendered sheet, then the staff detector
 * on the same pixels, joined the way the app joins them.
 */
import { readFileSync } from 'node:fs'
import { createWorker } from 'tesseract.js'
import { parseSolfa } from '../src/lib/parseSolfa.js'
import { extractWords } from '../src/lib/ocr.js'
import { pagesToRhythmSolfa } from '../src/lib/staff/sheetRhythm.js'
import { ALL_PARTS, buildSequences, midiName } from '../src/lib/notes.js'

const PNG = new URL('./rhythm-sample.png', import.meta.url).pathname.replace(/^\//, '')
const RGBA = new URL('./rhythm-sample.rgba', import.meta.url).pathname.replace(/^\//, '')
const WIDTH = 900
const HEIGHT = 340

const worker = await createWorker('eng', 1)
const result = await worker.recognize(PNG, {}, { text: true, blocks: true })
await worker.terminate()

console.log('=== RAW OCR (confidence', Math.round(result.data.confidence), ') ===')
console.log(result.data.text.trim())
console.log()

const words = extractWords(result.data.blocks)
console.log('=== POSITIONED WORDS:', words.length, '===')
for (const w of words) {
  console.log(
    `  ${JSON.stringify(w.text).padEnd(12)} x=${String(w.bbox.x0).padStart(4)}..${String(w.bbox.x1).padStart(4)}` +
      ` y=${String(w.bbox.y0).padStart(4)}..${w.bbox.y1}`
  )
}
console.log()

// Expand the 24bpp BGR dump into the RGBA the detector expects.
const raw = readFileSync(RGBA)
const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
for (let p = 0; p < WIDTH * HEIGHT; p++) {
  const s = p * 3
  data[p * 4] = raw[s + 2]
  data[p * 4 + 1] = raw[s + 1]
  data[p * 4 + 2] = raw[s]
  data[p * 4 + 3] = 255
}
const canvas = {
  width: WIDTH,
  height: HEIGHT,
  getContext: () => ({ getImageData: () => ({ data, width: WIDTH, height: HEIGHT }) }),
}

const out = pagesToRhythmSolfa([
  { canvas, words, confidence: result.data.confidence, text: result.data.text },
])
console.log('=== STAFF DETECTION ===')
{
  const { findStaves, inkRows, otsuThreshold, toLuma } = await import(
    '../src/lib/staff/geometry.js'
  )
  const { detectNotes, findBeams, findDots, findHeads, findStems, removeStaffLines, toMask } =
    await import('../src/lib/staff/symbols.js')

  const luma = toLuma(data, WIDTH, HEIGHT)
  const threshold = otsuThreshold(luma)
  const staves = findStaves(inkRows(luma, WIDTH, HEIGHT, threshold))
  console.log('staves:', staves.length)
  staves.forEach((staff, i) => {
    const mask = toMask(luma, WIDTH, HEIGHT, threshold)
    const clean = removeStaffLines(mask, WIDTH, HEIGHT, staff)
    const notes = detectNotes({ mask, width: WIDTH, height: HEIGHT, staff })
    const heads = findHeads(clean, WIDTH, HEIGHT, staff)
    const stems = findStems(clean, WIDTH, HEIGHT, staff)
    const beams = findBeams(clean, WIDTH, HEIGHT, staff, stems)
    const dots = findDots(clean, WIDTH, HEIGHT, staff, heads)
    console.log(` staff ${i}: top=${staff.top} bottom=${staff.bottom} spacing=${staff.spacing.toFixed(1)}`)
    console.log(
      '   heads:',
      JSON.stringify(
        heads.map((h) => ({
          cx: h.cx,
          cy: h.cy,
          w: h.width,
          h: h.height,
          filled: h.filled,
          density: +h.density.toFixed(2),
          stepOff: +h.stepOffset.toFixed(2),
        }))
      )
    )
    console.log('   stems:', JSON.stringify(stems.map((s) => [s.x, s.y0, s.y1])))
    console.log('   beams:', JSON.stringify(beams))
    console.log('   dots:', JSON.stringify(dots))
    console.log('   notes:', JSON.stringify(notes.map((n) => `${n.x}:${n.beats}${n.dotted ? '?' : ''}`)))
  })
}
console.log()

console.log('=== SOLFA WITH STAFF RHYTHM ===')
console.log(out.text)
console.log(
  'timed:', out.timed,
  '| staves:', out.staves,
  '| matched:', out.matched,
  '| unmatched notes:', out.unmatchedNotes,
  '| unreadable:', out.unreadable
)
console.log()

const parsed = parseSolfa(out.text)
if (!parsed.ok) {
  console.log('PARSE REJECTED:', parsed.error)
  process.exitCode = 1
} else {
  console.log('=== VOICES ===')
  for (const p of parsed.result.parts) {
    console.log(
      ' ',
      p.name.padEnd(8),
      p.notes.map((n) => (n.solfa == null ? `rest(${n.beats})` : `${n.solfa}:${n.beats}`)).join(' ')
    )
  }
  const seqs = buildSequences(parsed.result, parsed.result.key, 0, ALL_PARTS)
  console.log('=== PLAYBACK ===')
  for (const s of seqs) {
    console.log(' ', s.name.padEnd(8), s.notes.map((n) => midiName(n.midi)).join(' '))
  }
}
