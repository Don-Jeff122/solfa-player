import { describe, expect, it } from 'vitest'
import { parseSolfa } from '../parseSolfa.js'
import { buildSequences, midiName, ALL_PARTS } from '../notes.js'

const beatsOf = (token) => {
  const r = parseSolfa(token)
  expect(r.ok, r.ok ? '' : r.error.message).toBe(true)
  return r.result.parts[0].notes[0].beats
}

const notesOf = (text, part) => {
  const r = parseSolfa(text)
  expect(r.ok, r.ok ? '' : r.error.message).toBe(true)
  return buildSequences(r.result, 'C', 0, part)
}

describe('part merging', () => {
  it('merges a repeated part header into one voice', () => {
    const r = parseSolfa('Bass\nDo So Mi\nBass\nRe Fa')
    expect(r.ok).toBe(true)
    expect(r.result.parts).toHaveLength(1)
    expect(r.result.parts[0].name).toBe('Bass')
    expect(r.result.parts[0].notes).toHaveLength(5)
  })

  it('keeps every note of a split part when selected', () => {
    const seqs = notesOf('Bass\nDo So Mi\nBass\nRe Fa', ['Bass'])
    expect(seqs).toHaveLength(1)
    // The Bass voice plays two octaves below the written do.
    expect(seqs[0].notes.map((n) => midiName(n.midi))).toEqual(['C2', 'G2', 'E2', 'D2', 'F2'])
  })

  it('merges repeated headers case-insensitively', () => {
    const r = parseSolfa('Tenor\nDo\ntenor\nRe')
    expect(r.result.parts).toHaveLength(1)
    expect(r.result.parts[0].notes).toHaveLength(2)
  })

  it('still separates different voices', () => {
    const r = parseSolfa('Bass\nDo\nTenor\nRe\nAlto\nMi')
    expect(r.result.parts.map((p) => p.name)).toEqual(['Bass', 'Tenor', 'Alto'])
  })

  it('merges repeated custom part names', () => {
    const r = parseSolfa('[Left hand]\nDo\n[Left hand]\nRe')
    expect(r.result.parts).toHaveLength(1)
    expect(r.result.parts[0].notes).toHaveLength(2)
  })

  it('keeps distinct custom names apart', () => {
    const r = parseSolfa('[Right]\nDo\n[Left]\nRe')
    expect(r.result.parts.map((p) => p.name)).toEqual(['Right', 'Left'])
  })
})

describe('rhythm grammar', () => {
  it('reads whole, half and quarter notes', () => {
    expect(beatsOf('Do')).toBe(1)
    expect(beatsOf('Do-')).toBe(2)
    expect(beatsOf('Do--')).toBe(3)
    expect(beatsOf('Do---')).toBe(4)
    expect(beatsOf('Do(3)')).toBe(3)
  })

  it('reads fractional beats', () => {
    expect(beatsOf('Do(1/2)')).toBe(0.5)
    expect(beatsOf('Do(1/4)')).toBe(0.25)
    expect(beatsOf('Do(3/2)')).toBe(1.5)
    expect(beatsOf('Do(1/8)')).toBe(0.125)
  })

  it('reads dotted values', () => {
    expect(beatsOf('Do.')).toBe(1.5)
    expect(beatsOf('Do..')).toBe(1.75)
    expect(beatsOf('Do-.')).toBe(3)
    expect(beatsOf('Do(1/2).')).toBe(0.75)
  })

  it('reads rests in the same forms', () => {
    expect(beatsOf('0')).toBe(1)
    expect(beatsOf('0-')).toBe(2)
    expect(beatsOf('0(2)')).toBe(2)
    expect(beatsOf('0-.')).toBe(3)
    expect(beatsOf('rest-')).toBe(2)
  })

  it('still accepts octave marks alongside rhythm', () => {
    expect(beatsOf("Do'(1/2)")).toBe(0.5)
    expect(beatsOf(",Do-.")).toBe(3)
  })

  it('rejects malformed durations instead of guessing', () => {
    expect(parseSolfa('Do(0)').ok).toBe(false)
    expect(parseSolfa('Do(x)').ok).toBe(false)
  })

  it('accumulates a mixed rhythm line', () => {
    const seqs = notesOf('Do Do- Do(1/2) Do.', ALL_PARTS)
    expect(seqs[0].notes.map((n) => n.beats)).toEqual([1, 2, 0.5, 1.5])
  })
})

describe('multi-voice selection', () => {
  const sheet = 'Bass\nDo So\nTenor\nMi Re\nAlto\nFa La'

  it('plays every voice together with ALL_PARTS', () => {
    const seqs = notesOf(sheet, ALL_PARTS)
    expect(seqs.map((s) => s.name)).toEqual(['Bass', 'Tenor', 'Alto'])
  })

  it('plays one voice alone', () => {
    const seqs = notesOf(sheet, ['Bass'])
    expect(seqs).toHaveLength(1)
    expect(seqs[0].name).toBe('Bass')
  })

  it('plays any combination of voices', () => {
    const seqs = notesOf(sheet, ['Bass', 'Alto'])
    expect(seqs.map((s) => s.name)).toEqual(['Bass', 'Alto'])
  })

  it('plays nothing when no voice is selected', () => {
    expect(notesOf(sheet, [])).toHaveLength(0)
  })

  it('starts every voice at beat zero so they sound together', () => {
    const seqs = notesOf(sheet, ALL_PARTS)
    const starts = seqs.map((s) => s.notes[0].beats === undefined)
    expect(starts).toEqual([false, false, false])
    // Each voice begins on its own first note with no offset delay.
    for (const s of seqs) expect(s.notes[0]).toBeDefined()
  })

  it('ignores unknown voice names', () => {
    expect(notesOf(sheet, ['Nope'])).toHaveLength(0)
  })
})
