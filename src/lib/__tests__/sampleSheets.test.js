import { describe, expect, it } from 'vitest'
import { buildSequences, sequenceBeats } from '../notes.js'
import { parseSolfa } from '../parseSolfa.js'
import { ABIDE_WITH_ME } from '../sampleSheets.js'

describe('Abide with Me sample sheet', () => {
  it('reads every note and sign: key, S: rows, holds, chromatics', () => {
    const parsed = parseSolfa(ABIDE_WITH_ME)
    expect(parsed.ok).toBe(true, parsed.error && parsed.error.message)
    expect(parsed.result.key).toBe('Eb')
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Soprano'])

    const notes = parsed.result.parts[0].notes
    expect(notes.length).toBe(40)
    expect(notes.map((n) => n.solfa)).toEqual([
      'mi', 'mi', 're', 'do', 'so', 'la', 'so', 'so', 'fa', 'mi',
      'mi', 'mi', 'so', 'la', 'so', 'fa', 're', 'mi', 'fi', 'so',
      'mi', 'mi', 're', 'do', 'so', 'so', 'fa', 'fa', 'mi', 're',
      're', 'mi', 'fa', 'mi', 're', 'do', 'fa', 'mi', 're', 'do',
    ])
    // The fe chromatic (raised fa leading into so) is read as fi.
    expect(notes[18].solfa).toBe('fi')
  })

  it('lays the whole tune out as one playable sequence', () => {
    const parsed = parseSolfa(ABIDE_WITH_ME)
    const seqs = buildSequences(parsed.result, 'Eb', 0, ['Soprano'], {})
    expect(seqs).toHaveLength(1)
    // 4 phrases x 11 beats (last note of each phrase holds two beats).
    expect(sequenceBeats(seqs[0])).toBe(44)
    expect(seqs[0].notes[0].midi).toBe(67) // mi above do (Eb4 -> G4, the Soprano range).
  })
})