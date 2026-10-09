import { textToSolfa } from '../src/lib/ocr.js'
import { parseSolfa } from '../src/lib/parseSolfa.js'
import { buildSequences, midiName, ALL_PARTS } from '../src/lib/notes.js'

const cases = [
  'Do Re Mi',
  "Do' ,Do Do''",
  'Do - Do ---',
  'Do Re 0 Mi',
  'Key: G\nDo Re Mi',
  'Bass\nDo So\nTenor\nRe Mi',
  '1 = D\nDo Re Mi Fa',
]

let failures = 0
for (const c of cases) {
  const out = textToSolfa(c)
  const parsed = parseSolfa(out.text)
  if (!parsed.ok) {
    failures++
    console.log('REJECT ', JSON.stringify(c), '->', JSON.stringify(out.text), '::', parsed.error)
    continue
  }
  const seqs = buildSequences(parsed.result, out.key || parsed.result.key, 0, ALL_PARTS)
  console.log(
    'OK     ',
    JSON.stringify(c),
    '=> key',
    out.key || '(none)',
    '| parts:',
    parsed.result.parts.map((p) => `${p.name}(${p.notes.length})`).join(' ')
  )
  for (const s of seqs) {
    console.log(
      '         ',
      s.name.padEnd(8),
      s.notes.map((n) => (n.midi == null ? 'rest' : midiName(n.midi))).join(' ')
    )
  }
}
console.log(failures ? `\n${failures} FAILURES` : '\nall converted sheets parsed cleanly')
