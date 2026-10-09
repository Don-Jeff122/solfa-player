import {
  detectNotes,
  findBeams,
  findDots,
  findHeads,
  findStems,
  removeStaffLines,
  toMask,
} from '../src/lib/staff/symbols.js'
import { findStaves, inkRows, otsuThreshold, toLuma } from '../src/lib/staff/geometry.js'
import {
  createCanvas,
  drawBeamBetween,
  drawNote,
  drawStaff,
} from '../src/lib/staff/__tests__/fixtures.js'

const width = 900
const height = 300
const spacing = Number(process.argv[3] || 20)
const step = 2
const plan = (process.argv[2] || '1,1,1').split(',').map((t) => ({
  beats: Number(t.replace(/[dD]$/, '')),
  dotted: /[dD]$/.test(t),
}))

const c = createCanvas(width, height)
const staff = drawStaff(c, { top: 60, left: 40, right: width - 40, spacing })

let x = 40 + spacing * 3
const placed = []
for (const n of plan) {
  drawNote(c, staff, { x, step, beats: n.beats, dotted: n.dotted })
  placed.push({ x, beats: n.beats })
  x += spacing * 3
}
if (plan.filter((b) => b <= 0.5).length >= 2) {
  const flagged = placed.filter((p) => p.beats <= 0.5)
  drawBeamBetween(c, staff, {
    fromX: flagged[0].x,
    toX: flagged[flagged.length - 1].x,
    step,
    levels: flagged.every((f) => f.beats <= 0.25) ? 2 : 1,
  })
}

const luma = toLuma(c.data, width, height)
const t = otsuThreshold(luma)
const rows = inkRows(luma, width, height, t)
const s0 = findStaves(rows)[0]
const mask = toMask(luma, width, height, t)
const clean = removeStaffLines(mask, width, height, s0)

console.log('plan:', JSON.stringify(plan), '| spacing', spacing)
console.log('staff lines', JSON.stringify(s0.lines), 'thickness', JSON.stringify(s0.lineThickness))
const heads = findHeads(clean, width, height, s0)
console.log('heads:', heads.length)
for (const h of heads) {
  console.log(
    `  cx=${h.cx} cy=${h.cy} top=${h.top} bot=${h.bottom} w=${h.width} h=${h.height} filled=${h.filled}`
  )
}
const stems = findStems(clean, width, height, s0)
console.log('stems:', JSON.stringify(stems))
console.log('beams:', JSON.stringify(findBeams(clean, width, height, s0, stems)))
console.log('dots:', JSON.stringify(findDots(clean, width, height, s0, heads)))
console.log(
  'notes:',
  JSON.stringify(
    detectNotes({ mask, width, height, staff: s0 }).map((n) => `${n.beats}${n.dotted ? '?' : ''}`)
  )
)
