import { describe, expect, it } from 'vitest'
import { parseSolfa } from '../parseSolfa.js'
import { convertScoreToSolfa } from '../music/tonicSolfa.js'

function note(step, octave, duration = 1, extra = {}) {
  return {
    pitch: { step, alter: 0, octave },
    rest: false,
    duration,
    confidence: 1,
    tieStart: false,
    tieStop: false,
    ...extra,
  }
}

function score(parts, { fifths = 0, mode = 'major', beats = 4, beatType = 4 } = {}) {
  return {
    key: { fifths, mode },
    time: { beats, beatType },
    parts,
  }
}

describe('staff to tonic solfa conversion', () => {
  it('converts a C major scale with octave marks', () => {
    const converted = convertScoreToSolfa(
      score([
        {
          name: 'Soprano',
          measures: [
            {
              number: '1',
              notes: [
                note('C', 5),
                note('D', 5),
                note('E', 5),
                note('F', 5),
              ],
            },
          ],
        },
      ])
    )

    expect(converted.ok).toBe(true)
    expect(converted.text).toBe("Doh = C\nMeter: 4/4\nSoprano\ndo' re' mi' fa'")
    expect(parseSolfa(converted.text).ok).toBe(true)
    expect(converted.systems[0].rows).toEqual([
      { voice: 'S', cells: ["do' re' mi' fa'"] },
    ])
  })

  it('uses the key signature for accidentals and relative minor Doh', () => {
    const major = convertScoreToSolfa(
      score(
        [
          {
            name: 'Soprano',
            measures: [
              {
                number: '1',
                notes: [note('G', 4), note('A', 4), note('B', 4), note('F', 5, 1, { pitch: { step: 'F', alter: 1, octave: 5 } })],
              },
            ],
          },
        ],
        { fifths: 1 }
      )
    )
    expect(major.text).toContain('do re mi ti')
    expect(major.displayKey).toBe('G major')

    const minor = convertScoreToSolfa(
      score(
        [
          {
            name: 'Soprano',
            measures: [
              {
                number: '1',
                notes: [note('A', 4), note('B', 4), note('C', 5), note('G', 4, 1, { pitch: { step: 'G', alter: 1, octave: 4 } })],
              },
            ],
          },
        ],
        { mode: 'minor' }
      )
    )
    expect(minor.text).toContain('Doh = C')
    expect(minor.text).toContain("la ti do' si")
    expect(minor.displayKey).toBe('A minor')
  })

  it('keeps bass sounding pitch by combining part and note octaves', () => {
    const converted = convertScoreToSolfa(
      score([
        {
          name: 'Bass',
          measures: [
            {
              number: '1',
              notes: [note('C', 3), note('D', 3), note('E', 3), note('F', 3)],
            },
          ],
        },
      ])
    )

    expect(converted.text).toContain("Bass\ndo' re' mi' fa'")
    expect(parseSolfa(converted.text).ok).toBe(true)
  })

  it('writes exact fractional durations and rests', () => {
    const converted = convertScoreToSolfa(
      score([
        {
          name: 'Soprano',
          measures: [
            {
              number: '1',
              notes: [
                note('C', 4, 1),
                note('D', 4, 1),
                note('E', 4, 0.5),
                note('F', 4, 0.5),
                {
                  pitch: null,
                  rest: true,
                  duration: 1,
                  confidence: 1,
                  tieStart: false,
                  tieStop: false,
                },
              ],
            },
          ],
        },
      ])
    )

    expect(converted.text).toContain('do re mi(1/2) fa(1/2) 0')
    expect(parseSolfa(converted.text).ok).toBe(true)
  })

  it('keeps a tie across a barline', () => {
    const converted = convertScoreToSolfa(
      score([
        {
          name: 'Soprano',
          measures: [
            {
              number: '1',
              notes: [note('C', 4, 4, { tieStart: true })],
            },
            {
              number: '2',
              notes: [note('C', 4, 4, { tieStop: true })],
            },
          ],
        },
      ])
    )

    expect(converted.text).toContain('do--- | _ do---')
    expect(parseSolfa(converted.text).ok).toBe(true)
  })

  it('orders SATB parts and supports printed custom part names', () => {
    const converted = convertScoreToSolfa(
      score([
        {
          name: 'Bass',
          measures: [{ number: '1', notes: [note('C', 3, 4)] }],
        },
        {
          name: 'Soprano',
          measures: [{ number: '1', notes: [note('C', 5, 4)] }],
        },
        {
          name: 'Descant',
          measures: [{ number: '1', notes: [note('E', 5, 4)] }],
        },
      ])
    )

    expect(converted.text).toContain('[Descant]')
    expect(converted.text.indexOf('Soprano')).toBeLessThan(
      converted.text.indexOf('Bass')
    )
    expect(parseSolfa(converted.text).ok).toBe(true)
  })

  it('reports low-confidence notes for correction', () => {
    const converted = convertScoreToSolfa(
      score([
        {
          name: 'Soprano',
          measures: [
            {
              number: '1',
              notes: [
                note('C', 4, 4, { confidence: 0.2 }),
              ],
            },
          ],
        },
      ])
    )

    expect(converted.uncertain).toHaveLength(1)
    expect(converted.warnings.join(' ')).toMatch(/low-confidence/i)
  })

  it('rejects a score without readable measures', () => {
    expect(convertScoreToSolfa({ parts: [] })).toMatchObject({
      ok: false,
    })
  })
})
