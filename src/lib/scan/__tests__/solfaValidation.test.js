import { describe, expect, it } from 'vitest'
import { validateSolfaSystems } from '../solfaValidation.js'

const validSystems = [
  {
    rows: [
      { voice: 'S', cells: ['d :d | r :r', 'm :m | f :f'] },
      { voice: 'A', cells: ['s :s | l :l', 's :s | f :f'] },
      { voice: 'T', cells: ['m :m | f :f', 'm :m | f :f'] },
      { voice: 'B', cells: ['d :d | d :d', 'd :d | d :d'] },
    ],
  },
]

describe('Solfa output validation', () => {
  it('accepts playable solfa rows and returns the assembled sheet', () => {
    const checked = validateSolfaSystems(validSystems)

    expect(checked.ok).toBe(true)
    expect(checked.text).toContain('S: d :d | r :r')
    expect(checked.result.parts).toHaveLength(4)
  })

  it('rejects an invalid note so the Worker can try another model', () => {
    const checked = validateSolfaSystems([
      {
        rows: [{ voice: 'B', cells: ['d :d | n :n', 'd :d | d :d'] }],
      },
    ])

    expect(checked.ok).toBe(false)
    expect(checked.error).toMatch(/Unrecognized note "n"/)
  })

  it('rejects empty or unreadable rows', () => {
    expect(validateSolfaSystems([]).ok).toBe(false)
    expect(validateSolfaSystems([{ rows: [] }]).ok).toBe(false)
    expect(validateSolfaSystems([{ rows: [{ voice: 'S', cells: [] }] }]).ok).toBe(false)
  })
})
