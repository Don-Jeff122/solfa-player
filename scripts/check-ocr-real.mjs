import { createWorker } from 'tesseract.js'
import { pagesToSolfa } from '../src/lib/ocr.js'
import { parseSolfa } from '../src/lib/parseSolfa.js'
import { buildSequences, midiName, ALL_PARTS } from '../src/lib/notes.js'

const worker = await createWorker('eng', 1)
const result = await worker.recognize('scripts/sample-solfa.png')
await worker.terminate()

console.log('=== RAW OCR (confidence', result.data.confidence, ') ===')
console.log(result.data.text.trim())
console.log()

const out = pagesToSolfa([{ text: result.data.text, confidence: result.data.confidence }])
console.log('=== CONVERTED SOLFA ===')
console.log(out.text)
console.log('key:', out.key, '| unreadable:', out.unreadable, '| confidence:', Math.round(out.confidence))
console.log()

const parsed = parseSolfa(out.text)
if (!parsed.ok) {
  console.log('PARSE REJECTED:', parsed.error)
  process.exitCode = 1
} else {
  const key = out.key || parsed.result.key
  const seqs = buildSequences(parsed.result, key, 0, ALL_PARTS)
  console.log('=== PLAYBACK NOTES (key', key, ') ===')
  for (const s of seqs) {
    console.log(
      ' ',
      s.name.padEnd(9),
      s.notes.map((n) => (n.midi == null ? 'rest' : midiName(n.midi))).join(' ')
    )
  }
}
