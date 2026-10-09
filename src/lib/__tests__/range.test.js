import { describe, expect, it } from 'vitest'
import { DEFAULT_RANGE, isWhiteKey, fitRange, RANGE_MIN } from '../range.js'
import { MIDI_FLOOR } from '../notes.js'

const countWhite = (lo, hi) => {
  let n = 0
  for (let m = lo; m <= hi; m++) if (isWhiteKey(m)) n++
  return n
}

describe('piano range fitting', () => {
  it('classifies white and black keys', () => {
    expect(isWhiteKey(60)).toBe(true)
    expect(isWhiteKey(61)).toBe(false)
    expect(isWhiteKey(59)).toBe(true)
    expect(isWhiteKey(48)).toBe(true)
    expect(isWhiteKey(69)).toBe(true)
    expect(isWhiteKey(70)).toBe(false)
    expect(isWhiteKey(66)).toBe(false)
  })

  it('defaults to a three-octave range for empty input', () => {
    expect(fitRange([])).toEqual(DEFAULT_RANGE)
  })

  it('always starts and ends on white keys', () => {
    const cases = [[60], [61], [61, 70], [48, 83], [40, 90], [66, 67]]
    for (const notes of cases) {
      const [lo, hi] = fitRange(notes)
      expect(isWhiteKey(lo)).toBe(true)
      expect(isWhiteKey(hi)).toBe(true)
      expect(hi).toBeGreaterThanOrEqual(lo)
    }
  })

  it('keeps whole octaves so the span reads like a real piano', () => {
    for (const notes of [[60], [61, 70], [48, 83], [40, 90], [66, 67]]) {
      const [lo, hi] = fitRange(notes)
      expect(lo % 12).toBe(0)
      expect(((hi % 12) + 12) % 12).toBe(11)
    }
  })

  it('covers every sounding note with padding', () => {
    for (const notes of [[60], [58, 66], [64, 67, 69], [50, 72]]) {
      const [lo, hi] = fitRange(notes)
      for (const n of notes) {
        expect(lo).toBeLessThanOrEqual(n)
        expect(hi).toBeGreaterThanOrEqual(n)
      }
    }
  })

  it('never hides notes, even for very wide ranges', () => {
    const notes = [24, 108]
    const [lo, hi] = fitRange(notes)
    for (const n of notes) {
      expect(n).toBeGreaterThanOrEqual(lo)
      expect(n).toBeLessThanOrEqual(hi)
    }
  })

  it('trims octave padding when the music sits in one region', () => {
    const [lo, hi] = fitRange([60, 64, 67])
    expect(countWhite(lo, hi)).toBeLessThanOrEqual(26)
    expect(hi - lo).toBeLessThanOrEqual(24)
  })

  it('handles a split range without dropping either side', () => {
    const [lo, hi] = fitRange([24, 108])
    expect(lo).toBeLessThanOrEqual(24)
    expect(hi).toBeGreaterThanOrEqual(108)
  })

  it('keeps a normal melody within a compact span', () => {
    const [lo, hi] = fitRange([60, 62, 64, 65, 67])
    expect(hi - lo).toBeLessThanOrEqual(24)
  })

  it('clamps to sane midi bounds', () => {
    const [lo] = fitRange([0])
    expect(lo).toBeGreaterThanOrEqual(RANGE_MIN)
    expect(lo).toBe(RANGE_MIN)
    const [, hi] = fitRange([127])
    expect(hi).toBeLessThanOrEqual(108)
  })

  it('still shows the lowest note a deep Bass voice can reach', () => {
    // A Bass at its -2 register with a printed ,Do bottoms out on C1.
    const notes = [MIDI_FLOOR, 24, 60]
    const [lo, hi] = fitRange(notes)
    for (const n of notes) {
      expect(lo).toBeLessThanOrEqual(n)
      expect(hi).toBeGreaterThanOrEqual(n)
    }
  })

  it('ignores rests (null midi)', () => {
    expect(fitRange([null, null])).toEqual(DEFAULT_RANGE)
    expect(fitRange([null, 60, null])).toEqual(fitRange([60]))
  })
})
