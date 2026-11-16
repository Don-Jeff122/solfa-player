import { describe, expect, it } from 'vitest'
import {
  createMusicXmlPage,
  createStaffPage,
  reconvertStaffPage,
  validateStaffScore,
} from '../scan/staffConversion.js'

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

function rawScore({ name = 'Soprano', notes = null, key = { fifths: 0, mode: 'major' } } = {}) {
  return {
    title: 'Test Hymn',
    composer: 'A. Composer',
    key,
    time: { beats: 4, beatType: 4 },
    parts: [
      {
        name,
        clef: 'G2',
        measures: [
          {
            number: '1',
            notes: notes || [
              note('C', 5),
              note('D', 5),
              note('E', 5),
              note('F', 5),
            ],
          },
        ],
      },
    ],
    warnings: [],
  }
}

describe('validated staff conversion', () => {
  it('converts a staff score and produces a playable page', () => {
    const result = createStaffPage(1, rawScore(), { source: 'gemini' })

    expect(result.ok).toBe(true)
    expect(result.page.sourceKind).toBe('gemini-staff')
    expect(result.page.notationType).toBe('staff')
    expect(result.page.key).toBe('C')
    expect(result.page.sheetText).toContain("do' re' mi' fa'")
    expect(result.page.playable.parseError).toBeNull()
    expect(result.page.playable.systemsData).toHaveLength(1)
    expect(result.page.playable.warnings.join(' ')).toMatch(/Read by Gemini/i)
  })

  it('validates and parses the converted text', () => {
    const checked = validateStaffScore(rawScore())

    expect(checked.ok).toBe(true)
    expect(checked.parsed.ok).toBe(true)
    expect(checked.uncertain).toEqual([])
  })

  it('reconverts with a corrected key and mode while keeping the source notes', () => {
    const first = createStaffPage(1, rawScore())
    const changed = reconvertStaffPage(first.page, { tonic: 'G', mode: 'major' })

    expect(changed.ok).toBe(true)
    expect(changed.page.conversion.displayKey).toBe('G major')
    expect(changed.page.sheetText).toContain('Doh = G')
    expect(changed.page.sheetText).toContain('fa so la li')
    expect(changed.page.sourceScore).toEqual(first.page.sourceScore)
  })

  it('keeps MusicXML provenance and low-confidence notes', () => {
    const result = createMusicXmlPage(
      2,
      rawScore({
        notes: [
          note('C', 5, 1, { confidence: 0.2 }),
          note('D', 5, 1),
          note('E', 5, 1),
          note('F', 5, 1),
        ],
      }),
      { name: 'hymn.xml' }
    )

    expect(result.ok).toBe(true)
    expect(result.page.pageNumber).toBe(2)
    expect(result.page.sourceKind).toBe('musicxml')
    expect(result.page.uncertainCount).toBe(1)
    expect(result.page.playable.warnings.join(' ')).toMatch(/MusicXML/i)
  })

  it('rejects malformed staff input without notes', () => {
    const result = createStaffPage(1, { parts: [] })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no readable staff notes/i)
  })

  it('refuses to reconvert a page that did not keep its score', () => {
    const result = reconvertStaffPage({ pageNumber: 1 })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/does not keep/i)
  })
})
