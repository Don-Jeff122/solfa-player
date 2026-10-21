import { describe, expect, it } from 'vitest'
import { buildTimeline, formatClock, RENDER_LEAD_SECONDS, timelineAt } from '../timeline.js'

const lead = RENDER_LEAD_SECONDS
const sequences = [
  {
    name: 'Soprano',
    notes: [
      { midi: 60, beats: 1 },
      { midi: null, beats: 1 },
      { midi: 62, beats: 2 },
    ],
  },
  { name: 'Bass', notes: [{ midi: 48, beats: 2 }] },
]

describe('buildTimeline', () => {
  it('places notes after the render lead, in beats', () => {
    const timeline = buildTimeline(sequences, 60)
    expect(timeline).toHaveLength(2)
    expect(timeline[0].notes.map((n) => n.start)).toEqual([
      lead,
      lead + 1,
      lead + 2,
    ])
    expect(timeline[0].notes[2].end).toBeCloseTo(lead + 4)
    expect(timeline[0].notes.map((n) => n.index)).toEqual([0, 1, 2])
    expect(timeline[1].notes[0].end).toBeCloseTo(lead + 2)
  })

  it('follows the tempo', () => {
    const timeline = buildTimeline(sequences, 120)
    expect(timeline[0].notes[1].start).toBeCloseTo(lead + 0.5)
    expect(timeline[0].notes[2].start).toBeCloseTo(lead + 1)
  })

  it('accepts a custom lead', () => {
    const timeline = buildTimeline(sequences, 60, 0)
    expect(timeline[0].notes[0].start).toBe(0)
  })
})

describe('timelineAt', () => {
  const timeline = buildTimeline(sequences, 60)

  it('has no current note during the lead-in', () => {
    const at = timelineAt(timeline, 0)
    expect(at.indexes).toEqual([-1, -1])
    expect(at.midi.size).toBe(0)
  })

  it('finds the sounding notes in every voice', () => {
    const at = timelineAt(timeline, lead + 0.5)
    expect(at.indexes).toEqual([0, 0])
    expect([...at.midi].sort((a, b) => a - b)).toEqual([48, 60])
  })

  it('keeps a rest as the current index without adding a MIDI note', () => {
    const at = timelineAt(timeline, lead + 1.5)
    expect(at.indexes).toEqual([1, 0])
    expect([...at.midi]).toEqual([48])
  })

  it('switches on the exact boundary', () => {
    expect(timelineAt(timeline, lead + 1).indexes).toEqual([1, 0])
    expect(timelineAt(timeline, lead + 2).indexes).toEqual([2, -1])
  })

  it('ends after the final note', () => {
    expect(timelineAt(timeline, lead + 4 - 0.001).indexes).toEqual([2, -1])
    expect(timelineAt(timeline, lead + 4).indexes).toEqual([-1, -1])
    expect(timelineAt(timeline, 100).indexes).toEqual([-1, -1])
  })

  it('is safe with no timeline or bad times', () => {
    expect(timelineAt([], 1)).toEqual({ indexes: [], midi: new Set() })
    expect(timelineAt(timeline, Number.NaN).indexes).toEqual([-1, -1])
  })
})

describe('formatClock', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(7.9)).toBe('0:07')
    expect(formatClock(95)).toBe('1:35')
  })

  it('uses hours for long tracks', () => {
    expect(formatClock(3723)).toBe('1:02:03')
  })

  it('treats missing or negative times as zero', () => {
    expect(formatClock(Number.NaN)).toBe('0:00')
    expect(formatClock(-4)).toBe('0:00')
    expect(formatClock(undefined)).toBe('0:00')
  })
})
