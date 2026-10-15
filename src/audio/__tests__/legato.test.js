import { describe, expect, it } from 'vitest'
import { Synth, legatoAttack, slurFlags } from '../Synth.js'
import { installFakeAudio } from './fakeAudio.js'

describe('slurFlags', () => {
  it('marks both ends of a slurred pair', () => {
    const notes = [{ slur: 1 }, { slur: 1 }, {}]
    expect(slurFlags(notes)).toEqual([
      { legatoIn: false, legatoOut: true },
      { legatoIn: true, legatoOut: false },
      { legatoIn: false, legatoOut: false },
    ])
  })

  it('marks both sides of the middle of a three-note slur', () => {
    const notes = [{ slur: 2 }, { slur: 2 }, { slur: 2 }]
    expect(slurFlags(notes).map((f) => [f.legatoIn, f.legatoOut])).toEqual([
      [false, true],
      [true, true],
      [true, false],
    ])
  })

  it('leaves un-slurred notes alone', () => {
    expect(slurFlags([{}, { slur: null }, {}])).toEqual([
      { legatoIn: false, legatoOut: false },
      { legatoIn: false, legatoOut: false },
      { legatoIn: false, legatoOut: false },
    ])
  })

  it('does not join two notes that happen to share a missing id', () => {
    expect(slurFlags([{}, {}]).every((f) => !f.legatoIn && !f.legatoOut)).toBe(true)
  })
})

describe('legatoAttack', () => {
  it('softens the attack of a slurred continuation', () => {
    const voice = { attack: 0.2 }
    expect(legatoAttack(voice, false)).toBe(0.2)
    expect(legatoAttack(voice, true)).toBeCloseTo(0.08)
  })

  it('never bottoms out below the minimum attack', () => {
    expect(legatoAttack({ attack: 0 }, true)).toBe(0.001)
  })
})

describe('slurred playback', () => {
  it('renders a slurred line without throwing', async () => {
    const audio = installFakeAudio()
    try {
      const synth = new Synth()
      const seqs = [
        {
          name: 'Soprano',
          notes: [
            { midi: 60, beats: 1, slur: 1 },
            { midi: 62, beats: 1, slur: 1 },
            { midi: 64, beats: 1 },
          ],
        },
      ]
      await synth.render(seqs, { voice: 'piano' })
      expect(synth.lastError).toBe(null)
    } finally {
      audio.restore()
    }
  })
})
