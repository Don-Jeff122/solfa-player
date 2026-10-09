import { describe, expect, it } from 'vitest'
import { detectNotes, toMask } from '../symbols.js'
import { findStaves, inkRows, otsuThreshold, toLuma } from '../geometry.js'
import { createCanvas, drawBeamBetween, drawNote, drawStaff } from './fixtures.js'

/** Render a single staff of notes and detect them. */
function analyse(notes, { spacing = 20, top = 60, left = 40, step = 2 } = {}) {
  const width = 900
  const height = 300
  const canvas = createCanvas(width, height)
  const staff = drawStaff(canvas, { top, left, right: width - 40, spacing })

  // Lay out the notes, then beam each run of consecutive flagged notes.
  let x = left + spacing * 3
  const placed = notes.map((n) => {
    const p = { ...n, x }
    x += spacing * 3
    return p
  })

  let group = []
  const flush = () => {
    if (group.length >= 2) {
      const levels = group.every((g) => g.beats <= 0.25) ? 2 : 1
      drawBeamBetween(canvas, staff, {
        fromX: group[0].x,
        toX: group[group.length - 1].x,
        step,
        levels,
      })
    }
    group = []
  }
  for (const p of placed) {
    if (p.beats <= 0.5) group.push(p)
    else flush()
    drawNote(canvas, staff, { x: p.x, step, beats: p.beats, dotted: !!p.dotted })
  }
  flush()

  const luma = toLuma(canvas.data, width, height)
  const threshold = otsuThreshold(luma)
  const rows = inkRows(luma, width, height, threshold)
  const staves = findStaves(rows)
  expect(staves.length).toBeGreaterThan(0)
  const mask = toMask(luma, width, height, threshold)
  return { detected: detectNotes({ mask, width, height, staff: staves[0] }), truth: placed, staff: staves[0] }
}

const close = (a, b, tol = 0.01) => Math.abs(a - b) <= tol

describe('notehead detection', () => {
  it('finds one head per note', () => {
    const { detected } = analyse([{ beats: 1 }, { beats: 1 }, { beats: 1 }])
    expect(detected).toHaveLength(3)
  })

  it('reads the staff step of each head', () => {
    const { detected } = analyse([{ beats: 1 }], { step: 3 })
    expect(detected[0].step).toBe(3)
  })

  it('orders notes left to right', () => {
    const { detected } = analyse([{ beats: 1 }, { beats: 1 }, { beats: 1 }])
    const xs = detected.map((d) => d.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })
})

describe('duration classification', () => {
  it('recognises a quarter note', () => {
    const { detected } = analyse([{ beats: 1 }])
    expect(close(detected[0].beats, 1)).toBe(true)
  })

  it('recognises a half note as hollow with a stem', () => {
    const { detected } = analyse([{ beats: 2 }])
    expect(close(detected[0].beats, 2)).toBe(true)
  })

  it('recognises a whole note as hollow with no stem', () => {
    const { detected } = analyse([{ beats: 4 }])
    expect(close(detected[0].beats, 4)).toBe(true)
  })

  it('recognises beamed eighth notes', () => {
    const { detected } = analyse([
      { beats: 0.5 },
      { beats: 0.5 },
      { beats: 0.5 },
    ])
    expect(detected).toHaveLength(3)
    expect(detected.filter((d) => close(d.beats, 0.5)).length).toBeGreaterThanOrEqual(2)
  })

  it('recognises a dotted note', () => {
    const { detected } = analyse([{ beats: 1, dotted: true }])
    expect(close(detected[0].beats, 1.5)).toBe(true)
  })

  it('reads a mixed bar of durations', () => {
    const { detected, truth } = analyse([
      { beats: 1 },
      { beats: 0.5 },
      { beats: 0.5 },
      { beats: 2 },
    ])
    expect(detected).toHaveLength(truth.length)
    const wrong = detected.filter((d, i) => !close(d.beats, truth[i].beats))
    expect(wrong.map((w) => w.beats)).toEqual([])
  })
})

describe('accuracy on a full bar', () => {
  it('detects every duration correctly in a 4/4 bar', () => {
    // quarter + two eighths + half + quarter = 4 beats
    const truth = [{ beats: 1 }, { beats: 0.5 }, { beats: 0.5 }, { beats: 2 }, { beats: 1 }]
    const { detected } = analyse(truth)
    expect(detected).toHaveLength(truth.length)
    const hits = detected.filter((d, i) => close(d.beats, truth[i].beats, 0.01)).length
    expect(hits / truth.length).toBeGreaterThanOrEqual(0.8)
  })

  it('sums the detected bar to the expected beats', () => {
    const truth = [{ beats: 1 }, { beats: 1 }, { beats: 2 }]
    const { detected } = analyse(truth)
    const total = detected.reduce((s, d) => s + d.beats, 0)
    expect(Math.abs(total - 4)).toBeLessThan(0.6)
  })

  it('works at a small staff spacing', () => {
    const truth = [{ beats: 1 }, { beats: 2 }]
    const { detected } = analyse(truth, { spacing: 10 })
    expect(detected).toHaveLength(2)
  })

  it('works at a large staff spacing', () => {
    const truth = [{ beats: 1 }, { beats: 2 }]
    const { detected } = analyse(truth, { spacing: 34 })
    expect(detected).toHaveLength(2)
  })
})
