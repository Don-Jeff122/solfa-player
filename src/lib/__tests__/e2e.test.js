import { describe, expect, it } from 'vitest'
import { parseSolfa } from '../parseSolfa.js'
import { ALL_PARTS, buildSequences, midiName, noteToMidi, tonicMidiForKey } from '../notes.js'
import { fitRange } from '../range.js'

function pipeline(text, part = ALL_PARTS, octave = 0) {
  const parsed = parseSolfa(text)
  expect(parsed.ok, parsed.ok ? '' : parsed.error.message).toBe(true)
  const key = parsed.result.key ?? 'C'
  const seqs = buildSequences(parsed.result, key, octave, part)
  return { parsed, key, seqs }
}

describe('end-to-end: sheet -> piano notes', () => {
  it('plays a key specified in the sheet', () => {
    const { key, seqs } = pipeline('Key: G\nDo Re Mi')
    expect(key).toBe('G')
    expect(seqs[0].notes.map((n) => midiName(n.midi))).toEqual(['G4', 'A4', 'B4'])
  })

  it('falls back to the dropdown key when the sheet has none', () => {
    const parsed = parseSolfa('Do Re Mi')
    const seqs = buildSequences(parsed.result, 'D', 0, ALL_PARTS)
    expect(seqs[0].notes.map((n) => midiName(n.midi))).toEqual(['D4', 'E4', 'F#4'])
  })

  it('respects octave marks', () => {
    const { seqs } = pipeline("Do' ,Do Do'' Do',")
    // Do' = C5, ,Do = C3, Do'' = C6, Do', = up one + down one = C4
    expect(seqs[0].notes.map((n) => midiName(n.midi))).toEqual(['C5', 'C3', 'C6', 'C4'])
  })

  it('honours durations as beats', () => {
    const { seqs } = pipeline('Do- Do--- Do(3) 0-')
    expect(seqs[0].notes.map((n) => n.beats)).toEqual([2, 4, 3, 2])
  })

  it('plays a single part on demand (bass only)', () => {
    const sheet = `Key: C

Soprano
Do Re Mi

Bass
,Do ,Re ,Mi`
    const { seqs } = pipeline(sheet, 'Bass')
    expect(seqs).toHaveLength(1)
    expect(seqs[0].name).toBe('Bass')
    // Bass register (-2) plus the printed , on each note.
    expect(seqs[0].notes.map((n) => midiName(n.midi))).toEqual(['C1', 'D1', 'E1'])
  })

  it('plays all parts simultaneously by default', () => {
    const sheet = `Key: C

Soprano
Do

Bass
,Do`
    const { seqs } = pipeline(sheet, ALL_PARTS)
    expect(seqs.map((s) => s.name)).toEqual(['Soprano', 'Bass'])
    expect(seqs[0].notes[0].midi).toBe(60)
    expect(seqs[1].notes[0].midi).toBe(24)
  })

  it('spreads the voices across the keyboard', () => {
    const sheet = `Key: C

Soprano
Do So

Alto
Do So

Tenor
Do So

Bass
Do So`
    const { seqs } = pipeline(sheet, ALL_PARTS)
    const [soprano, alto, tenor, bass] = seqs.map((s) => s.notes[0].midi)
    expect(soprano).toBe(60)
    expect(alto).toBe(soprano)
    expect(tenor).toBe(soprano - 12)
    expect(bass).toBe(soprano - 24)
    expect(bass).toBeLessThan(tenor)
    expect(tenor).toBeLessThan(soprano)
  })

  it('shifts every part with the octave control', () => {
    const sheet = `Bass
,Do ,Re`
    const low = pipeline(sheet, 'Bass', 0).seqs[0].notes.map((n) => n.midi)
    const high = pipeline(sheet, 'Bass', 1).seqs[0].notes.map((n) => n.midi)
    expect(high).toEqual(low.map((m) => m + 12))
  })

  it('plays Twinkle Twinkle correctly in C', () => {
    const { seqs } = pipeline(
      'Key: C\nDo Do So So Re Re Do- Mi Mi Fa Fa So So Mi-\nLa La So So Fa Fa Re- Do Do So So Re Re Do-'
    )
    const played = seqs[0].notes.map((n) => midiName(n.midi))
    expect(played.slice(0, 7)).toEqual([
      'C4', 'C4', 'G4', 'G4', 'D4', 'D4', 'C4',
    ])
    expect(played[12]).toBe('G4')
    expect(played.at(-1)).toBe('C4')
  })

  it('keeps rests as silent beats inside the sequence', () => {
    const { seqs } = pipeline('Do 0 Mi')
    expect(seqs[0].notes[1].midi).toBe(null)
    const [lo, hi] = fitRange(seqs[0].notes.map((n) => n.midi))
    expect(lo).toBeLessThanOrEqual(60)
    expect(hi).toBeGreaterThanOrEqual(64)
  })

  it('reports a helpful error for bad input', () => {
    const parsed = parseSolfa('Key: C\nDo Qe Mi')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toContain('Qe')
    expect(parsed.error.message).toContain('line 2')
  })

  it('keeps every note inside the rendered keyboard range', () => {
    const sheet = `Key: G

Soprano
Do'' Re'

Bass
,,Do ,Do`
    const { seqs } = pipeline(sheet, ALL_PARTS)
    const [lo, hi] = fitRange(seqs.flatMap((s) => s.notes.map((n) => n.midi)))
    for (const seq of seqs) {
      for (const n of seq.notes) {
        expect(n.midi, `${n.token} = ${midiName(n.midi)}`).toBeGreaterThanOrEqual(lo)
        expect(n.midi, `${n.token} = ${midiName(n.midi)}`).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('expands first and second endings so all parts line up', () => {
    const sheet = `Key: C
Meter: 4/4

Soprano
|: Do Do Do Do | 1. Mi Mi Mi Mi :| 2. So So So So |

Alto
|: Do Do Do Do | 1. Mi Mi Mi Mi :| 2. So So So So |`
    const { seqs } = pipeline(sheet, ALL_PARTS)
    const soprano = seqs[0].notes.map((n) => n.token)
    const alto = seqs[1].notes.map((n) => n.token)
    // First trip ends on the 1. chord, second on the 2. chord.
    expect(soprano).toEqual([
      'Do', 'Do', 'Do', 'Do', 'Mi', 'Mi', 'Mi', 'Mi',
      'Do', 'Do', 'Do', 'Do', 'So', 'So', 'So', 'So',
    ])
    expect(alto).toEqual(soprano)
    // The :| makes every voice repeat, so their downbeats tick together.
    expect(seqs[0].barStarts).toEqual([0, 4, 8, 12])
    expect(seqs[1].barStarts).toEqual(seqs[0].barStarts)
  })

  it('gives bar arms to the metronome only when the sheet has a meter', () => {
    const { seqs } = pipeline('Do Re | Mi Fa')
    // No meter on the sheet, so the grid is unknowable.
    expect(seqs[0].barStarts).toBe(null)
  })

  it('flags parts whose repeats are written differently', () => {
    const sheet = `Meter: 4/4

Soprano
|: Do Do Do Do :|

Alto
Do Do Do Do | Do Do Do Do`
    const parsed = parseSolfa(sheet)
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toMatch(/don't line up/)
  })

  it('maps solfa to the right scale degrees for any key', () => {
    for (const key of ['C', 'G', 'F', 'Bb', 'E']) {
      const tonic = tonicMidiForKey(key)
      const degrees = ['do', 're', 'mi', 'fa', 'so', 'la', 'ti']
      degrees.forEach((solfa, i) => {
        expect(noteToMidi({ solfa, up: 0, down: 0 }, tonic)).toBe(tonic + [0, 2, 4, 5, 7, 9, 11][i])
      })
    }
  })
})
