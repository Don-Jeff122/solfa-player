import { describe, expect, it } from 'vitest'
import { validateMusicXml } from '../musicXml.js'

function note(step = 'C', octave = 4) {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type></note>`
}

function part(id, name, notes = note()) {
  return `<part id="${id}"><measure number="1"><attributes><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${notes}</measure></part>`
}

function score(parts, { title = 'Test Hymn' } = {}) {
  return `<?xml version="1.0"?><score-partwise><work><work-title>${title}</work-title></work><part-list>${parts
    .map(([id, name]) => `<score-part id="${id}"><part-name>${name}</part-name></score-part>`)
    .join('')}</part-list>${parts
    .map(([id, name, notes]) => part(id, name, notes))
    .join('')}</score-partwise>`
}

describe('validateMusicXml', () => {
  it('accepts a partwise SATB score and reports its structure', () => {
    const result = validateMusicXml(
      score([
        ['P1', 'Soprano'],
        ['P2', 'Alto'],
        ['P3', 'Tenor'],
        ['P4', 'Bass'],
      ]),
      { fileName: 'hymn.musicxml' }
    )

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.title).toBe('Test Hymn')
    expect(result.summary.parts).toBe(4)
    expect(result.summary.notes).toBe(4)
    expect(result.summary.satbConfirmed).toBe(true)
    expect(result.summary.key).toEqual({ fifths: 0, mode: 'major' })
    expect(result.summary.time).toEqual({ beats: 4, beatType: 4 })
  })

  it('warns without inventing voice names when four generic parts are found', () => {
    const result = validateMusicXml(
      score([
        ['P1', 'Part 1'],
        ['P2', 'Part 2'],
        ['P3', 'Part 3'],
        ['P4', 'Part 4'],
      ])
    )

    expect(result.ok).toBe(true)
    expect(result.summary.satbConfirmed).toBe(false)
    expect(result.warnings.some((entry) => entry.includes('generic'))).toBe(true)
    expect(result.warnings.some((entry) => entry.includes('do not clearly identify'))).toBe(true)
  })

  it('rejects empty and timewise MusicXML', () => {
    expect(validateMusicXml('').ok).toBe(false)
    const timewise = validateMusicXml('<score-timewise><part-list/></score-timewise>')
    expect(timewise.ok).toBe(false)
    expect(timewise.errors.join(' ')).toContain('timewise')
  })

  it('rejects notes with neither a valid pitch nor a rest', () => {
    const result = validateMusicXml(
      score([['P1', 'Soprano', '<note><duration>1</duration></note>']])
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('no valid pitch or rest')
  })

  it('rejects a pitch with no octave instead of treating it as octave zero', () => {
    const result = validateMusicXml(
      score([['P1', 'Soprano', '<note><pitch><step>C</step></pitch></note>']])
    )
    expect(result.ok).toBe(false)
    expect(result.summary.notes).toBe(0)
    expect(result.errors.join(' ')).toContain('no valid pitch or rest')
  })

  it('does not report a missing fifths value as C major', () => {
    const xml =
      '<score-partwise><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><key><mode>major</mode></key></attributes><note><pitch><step>C</step><octave>4</octave></pitch></note></measure></part></score-partwise>'
    const result = validateMusicXml(xml)
    expect(result.summary.key).toBeNull()
    expect(result.warnings.join(' ')).toContain('No key signature')
  })

  it('reports missing key, time, and title as warnings', () => {
    const xml =
      '<score-partwise><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch></note></measure></part></score-partwise>'
    const result = validateMusicXml(xml)
    expect(result.ok).toBe(true)
    expect(result.warnings.join(' ')).toContain('No key signature')
    expect(result.warnings.join(' ')).toContain('No time signature')
    expect(result.warnings.join(' ')).toContain('No score title')
  })
})
