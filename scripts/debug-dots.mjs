import { removeStaffLines, toMask } from '../src/lib/staff/symbols.js'
import { findStaves, inkRows, otsuThreshold, toLuma } from '../src/lib/staff/geometry.js'
import { createCanvas, drawNote, drawStaff } from '../src/lib/staff/__tests__/fixtures.js'

const width = 900
const height = 300
const spacing = 20
const c = createCanvas(width, height)
const staff = drawStaff(c, { top: 60, left: 40, right: width - 40, spacing })
drawNote(c, staff, { x: 100, step: 2, beats: 1, dotted: true })

const luma = toLuma(c.data, width, height)
const t = otsuThreshold(luma)
const rows = inkRows(luma, width, height, t)
const s0 = findStaves(rows)[0]
const mask = toMask(luma, width, height, t)
const clean = removeStaffLines(mask, width, height, s0)

console.log('threshold', t, 'staff lines', JSON.stringify(s0.lines))
const X0 = 104
const X1 = 134
for (const y of range(72, 90)) {
  let line = String(y).padStart(3) + ' raw  '
  for (let x = X0; x <= X1; x++) line += mask[y * width + x] ? '#' : '.'
  line += '   clean '
  for (let x = X0; x <= X1; x++) line += clean[y * width + x] ? '#' : '.'
  console.log(line)
}
console.log('    ' + range(X0, X1).map((x) => String(x % 10)).join(''))

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i)
}
