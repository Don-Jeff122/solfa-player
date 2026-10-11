

  import { describe, expect, it } from 'vitest'
import { parseSolfa } from '../parseSolfa.js'

  it('parses chromatic solfa', () => {
    expect(firstNotes('Di Ri Fi Si Li Ra Me Se Le Te').map((n) => n.solfa)).toEqual([
      'di',
      'ri',
      'fi',
      'si',
      'li',
      'ra',
      'me',
      'se',
      'le',
      'te',
    ])
  })

  it('gives chromatic notes their semitone, and keeps lengths', () => {
    const notes = firstNotes('Do- Di- Ra- Di Fi(1/2)')
    expect(notes.map((n) => [n.solfa, n.beats])).toEqual([
      ['do', 2],
      ['di', 2],
      ['ra', 2],
      ['di', 1],
      ['fi', 0.5],
    ])
  })

  it('takes octave marks on chromatic notes', () => {
    expect(firstNotes("Di' ,ra").map((n) => [n.solfa, n.up, n.down])).toEqual([
      ['di', 1, 0],
      ['ra', 0, 1],
    ])
  })

  it('names the sharps and flats in the error message', () => {
    const parsed = parseSolfa('Bam')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toMatch(/Di, Ri, Fi, Si, Li/)
    expect(parsed.error.message).toMatch(/Ra, Me, Se, Le, Te/)
  })

function firstNotes(text) {
  const parsed = parseSolfa(text)
  expect(parsed.ok).toBe(true, parsed.error && parsed.error.message)
  return parsed.result.parts[0].notes
}

describe('parseSolfa', () => {
  it('parses full solfa names', () => {
    const notes = firstNotes('Do Re Mi Fa So La Ti')
    expect(notes.map((n) => n.solfa)).toEqual(['do', 're', 'mi', 'fa', 'so', 'la', 'ti'])
    expect(notes.every((n) => n.beats === 1)).toBe(true)
  })

  it('parses single letters (d r m f s l t)', () => {
    const notes = firstNotes('D R M F S L T')
    expect(notes.map((n) => n.solfa)).toEqual(['do', 're', 'mi', 'fa', 'so', 'la', 'ti'])
  })

  it('is case-insensitive and accepts mixed styles', () => {
    const notes = firstNotes('dO rE mI fa sOl lA tI')
    expect(notes.map((n) => n.solfa)).toEqual(['do', 're', 'mi', 'fa', 'so', 'la', 'ti'])
  })

  it('treats R as Re, not a rest', () => {
    const notes = firstNotes('R')
    expect(notes[0].solfa).toBe('re')
  })

  it('parses the sol alias', () => {
    const notes = firstNotes('sol')
    expect(notes[0].solfa).toBe('so')
  })

  it('parses octave marks', () => {
    const [up, down, up2, mixed] = firstNotes("Do' Do',, Do'' Do',")
    expect(up.up).toBe(1)
    expect(up.down).toBe(0)
    expect(down.up).toBe(1)
    expect(down.down).toBe(2)
    expect(up2.up).toBe(2)
    expect(mixed.up).toBe(1)
    expect(mixed.down).toBe(1)
  })

  it('stacks multiple octave marks on one note', () => {
    const [n] = firstNotes("Do',,, So")
    expect(n.up).toBe(1)
    expect(n.down).toBe(3)
  })

  it('accepts a leading comma for a lower octave (,Do)', () => {
    const [one, two] = firstNotes(',Do ,,Do')
    expect(one.down).toBe(1)
    expect(two.down).toBe(2)
  })

  it('mixes leading commas with trailing marks', () => {
    const [n] = firstNotes(",Do'")
    expect(n.up).toBe(1)
    expect(n.down).toBe(1)
  })

  it('accepts smart apostrophes for octave up', () => {
    const notes = firstNotes('Do\u2019')
    expect(notes[0].up).toBe(1)
  })

  it('parses rests', () => {
    const notes = firstNotes('Do 0 rest 0-')
    expect(notes.map((n) => n.solfa)).toEqual(['do', null, null, null])
    expect(notes.map((n) => n.beats)).toEqual([1, 1, 1, 2])
  })

  it('parses durations with dashes and parentheses', () => {
    const notes = firstNotes('Do- Do--- Do(3) Mi(12)')
    expect(notes.map((n) => n.beats)).toEqual([2, 4, 3, 12])
  })

  it('parses a key declaration with colon', () => {
    const parsed = parseSolfa('Key: G\nDo Re')
    expect(parsed.ok).toBe(true)
    expect(parsed.result.key).toBe('G')
  })

  it('parses key variants (tonic:, 1=, flat, case)', () => {
    expect(parseSolfa('tonic: D#\nDo').result.key).toBe('D#')
    expect(parseSolfa('1=F#\nDo').result.key).toBe('F#')
    expect(parseSolfa('Key: bb\nDo').result.key).toBe('Bb')
    expect(parseSolfa('KEY: g\nDo').result.key).toBe('G')
  })

  it('rejects an unknown key', () => {
    const parsed = parseSolfa('Key: H\nDo')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toContain('H')
  })
  it('detects named parts', () => {
    const parsed = parseSolfa('Soprano\nDo Mi\n\nBass\nSo La\nT\n')
    const result = parsed.result
    expect(result.parts.map((p) => p.name)).toEqual(['Soprano', 'Bass'])
    expect(result.parts[0].notes.map((n) => n.solfa)).toEqual(['do', 'mi'])
    expect(result.parts[1].notes.map((n) => n.solfa)).toEqual(['so', 'la', 'ti'])
  })

  it('detects parts with colon suffix and any case', () => {
    const parsed = parseSolfa('ALTO:\nDo\nTENOR\nRe')
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Alto', 'Tenor'])
  })

  it('detects custom bracketed parts', () => {
    const parsed = parseSolfa('[Flute]\nDo\n[Bass]\nSo')
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Flute', 'Bass'])
  })

  it('collects notes before any header into Main', () => {
    const parsed = parseSolfa('Do Re\nBass\nSo')
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Main', 'Bass'])
  })

  it('merges repeated custom part names into one voice', () => {
    const parsed = parseSolfa('[Bass]\nDo\n[Bass]\nSo')
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Bass'])
    expect(parsed.result.parts[0].notes).toHaveLength(2)
  })

  it('a bare keyword line is a part header, not a note', () => {
    const parsed = parseSolfa('Bass')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toContain('No notes found')
  })

  it('rejects unknown tokens with a helpful message', () => {
    const parsed = parseSolfa('Do Xy Re')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toContain('Xy')
    expect(parsed.error.message).toContain('line 1')
  })

  it('rejects trailing garbage on a note', () => {
    expect(parseSolfa('Do2').ok).toBe(false)
    expect(parseSolfa('Do zzz').ok).toBe(false)
  })

  it('rejects empty input', () => {
    expect(parseSolfa('').ok).toBe(false)
    expect(parseSolfa('Key: C\n\n').ok).toBe(false)
  })

  it('keeps line numbers across the document', () => {
    const parsed = parseSolfa('Key: C\nDo\n\nbad')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toContain('line 4')
  })
})

describe('parseSolfa: meter and bars', () => {
  it('reads the meter from named, bare and common-time headers', () => {
    expect(parseSolfa('Meter: 4/4\nDo').result.meter).toEqual({ num: 4, den: 4 })
    expect(parseSolfa('Time 6/8\nDo').result.meter).toEqual({ num: 6, den: 8 })
    expect(parseSolfa('Time=3/4\nDo').result.meter).toEqual({ num: 3, den: 4 })
    expect(parseSolfa('3/4\nDo').result.meter).toEqual({ num: 3, den: 4 })
    expect(parseSolfa('C\nDo').result.meter).toEqual({ num: 4, den: 4 })
    expect(parseSolfa('C|\nDo').result.meter).toEqual({ num: 4, den: 4 })
  })

  it('has no meter when the sheet does not name one', () => {
    expect(parseSolfa('Do | Re').result.meter).toBe(null)
  })

  it('splits notes into bars and tags every note with its bar', () => {
    const parsed = parseSolfa('Do Re | Mi Fa || So')
    expect(parsed.ok).toBe(true)
    const part = parsed.result.parts[0]
    expect(part.bars).toHaveLength(3)
    expect(part.notes.map((n) => n.bar)).toEqual([0, 0, 1, 1, 2])
  })

  it('accepts the ||: and :|| double repeat tokens', () => {
    const parsed = parseSolfa('|: Do :| ||: Re :||')
    expect(parsed.ok).toBe(true, parsed.error && parsed.error.message)
    const part = parsed.result.parts[0]
    expect(part.notes.map((n) => n.solfa)).toEqual(['do', 're'])
    expect(part.bars.map((b) => [b.openRepeat, b.closeRepeat])).toEqual([
      [true, true],
      [true, true],
    ])
  })

  it('accepts a short pickup as the first bar and a short last bar', () => {
    const parsed = parseSolfa('Meter: 4/4\nDo | Do Do Do Do | Re')
    expect(parsed.ok).toBe(true, parsed.error && parsed.error.message)
    const part = parsed.result.parts[0]
    expect(part.bars.map((b) => b.notes.length)).toEqual([1, 4, 1])
  })

  it('rejects an interior bar that is not full length', () => {
    const parsed = parseSolfa('Meter: 4/4\nDo Do Do Do | Do Re | Do Do Do Do')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toMatch(/Bar 2 of Main has 2 beats, but 4\/4 time expects 4/)
  })

  it('counts dotted metric lengths like 3/4 and 6/8', () => {
    expect(parseSolfa('Meter: 3/4\nDo- Re | Do- Re').ok).toBe(true)
    expect(parseSolfa('Meter: 6/8\nDo. Re. | Mi Fa So').ok).toBe(true)
  })

  it('flags a bar that is too long too', () => {
    const parsed = parseSolfa('Meter: 4/4\nDo Do Do Do Do | Do Do Do Do')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toMatch(/bar 1/i)
  })
})

describe('parseSolfa: repeats and endings', () => {
  const barsOf = (text) => {
    const parsed = parseSolfa(text)
    expect(parsed.ok, parsed.ok ? '' : parsed.error.message).toBe(true)
    return parsed.result.parts[0].bars
  }

  it('marks the open and close repeat bars', () => {
    const bars = barsOf('|: Do Re | Mi Fa :|')
    expect(bars.map((b) => [b.openRepeat, b.closeRepeat])).toEqual([
      [true, false],
      [false, true],
    ])
  })

  it('handles :|: glyphs as a close that is also an open', () => {
    const bars = barsOf('|: Do :|: Re :|')
    expect(bars.map((b) => [b.openRepeat, b.closeRepeat])).toEqual([
      [true, true],
      [true, true],
    ])
  })

  it('a :| with no |: repeats from the start', () => {
    const bars = barsOf('Do Re :| Mi')
    expect(bars.map((b) => [b.openRepeat, b.closeRepeat])).toEqual([
      [false, true],
      [false, false],
    ])
  })

  it('tags first and second endings on their start bar', () => {
    const bars = barsOf('|: Do Re | 1. Mi Fa :| 2. So Do |')
    expect(bars.map((b) => b.endings)).toEqual([[], [1], [2]])
  })

  it('accepts parenthesized endings', () => {
    const bars = barsOf('|: Do | (1) Mi :| (2) So |')
    expect(bars.map((b) => b.endings)).toEqual([[], [1], [2]])
  })

  it('rejects an ending that tags notes already in a bar', () => {
    const parsed = parseSolfa('|: Do 1. | Mi :|')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toMatch(/must start a bar/)
  })

  it('rejects a third ending', () => {
    const parsed = parseSolfa('|: Do | 3. Mi :|')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toContain('only first/second endings')
  })

  it('rejects an unmatched opening repeat', () => {
    const parsed = parseSolfa('|: Do Re')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toMatch(/Unterminated repeat/)
  })

  it('rejects nested repeats', () => {
    const parsed = parseSolfa('|: Do |: Re :| Mi :|')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toMatch(/Nested repeats/)
  })

  it('rejects endings with no repeat at all', () => {
    const parsed = parseSolfa('Do | 1. Mi')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toMatch(/need a repeat/)
  })

  it('rejects a second ending without a first', () => {
    const parsed = parseSolfa('|: Do | 2. Mi :|')
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toMatch(/without a "1."/)
  })

  it('rejects D.S., D.C., Fine and Coda for now', () => {
    for (const marking of ['D.S.', 'D.C.', 'Fine', 'Coda', 'Segno']) {
      const parsed = parseSolfa(`Do Re ${marking}`)
      expect(parsed.ok).toBe(false)
      expect(parsed.error.message).toContain("aren't supported yet")
    }
  })

  it('still parses Do anywhere, even next to markings', () => {
    const notes = firstNotes('Do La | Do- Re | So Do')
    expect(notes.map((n) => n.solfa)).toEqual(['do', 'la', 'do', 're', 'so', 'do'])
  })

  it('compares every part\'s bar skeleton when a meter exists', () => {
    const sheet = `Key: C
Meter: 4/4

Soprano
Do Do Do Do | Mi Mi Mi Mi

Alto
Do Do Do Do | Mi Mi Mi Mi`
    const ok = parseSolfa(sheet)
    expect(ok.ok, ok.error && ok.error.message).toBe(true)
    const bad = parseSolfa(`Meter: 4/4

Soprano
Do Do Do Do | Mi Mi Mi Mi

Alto
Mi Mi Mi Mi`)
    expect(bad.ok).toBe(false)
    expect(bad.error.message).toMatch(/don't line up/)
  })
})
