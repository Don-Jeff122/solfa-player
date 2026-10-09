import { describe, expect, it } from 'vitest'
import { buildSequences, sequenceBeats } from '../notes.js'
import { parseSolfa } from '../parseSolfa.js'
import { HYMN_WORDS, looksHymnal, scanHymnalLine } from '../hymnal.js'

const TWY_SHEET = `Key E Flat                         10.10.10.10.                 W.H. MONK, 1823-1889.


{ m :- /m :r | d :- /s :- | l :s /s :f | m :- /- :- | m :- /f :s |
  d :- /d :t | d :t /d :r | d :- /- :- | d :- /d :d |
  s :- /s :f | m :- /d :- | d :s /s :s | s :- /- :- | s :- /f :m |
  d :- /s :s | l :- /m :- | f₁ :s /l :t | d :- /- :- | d :t /l :s }

O - nyan - ko - pon, dom   yen  be-hyï-ra  yen,      na - tew w'a-


{ l :- /s :- | f :r /m :fe | s :- /- :- | m :- /m :r | d :- /s :- |
  d :- /d :- | d :r /d :d | l :- /- :- | d :- /l :t | d :- /d :- |
  f :- /m :- | l :s /s :d | r :- /- :- | m :f /s :f | m :- /d :t |
  f :- /d :- | r :t /d :l | s :- /- :- | d :- /s :s | l :- /m :- }

nïn  kye - re yen,  kyi - a yen,       na    ma  yēn-hu    wo


{ s :f /f :m | r :- /- :- | r :- /m :f | m :r /d :f | m :- /r :- | d :- /- :- |
  d :d /de :de | r :- /- :- | t :- /d :t₁ | d :t /d :r | d :- /t₁ :- | d :- /- :- |
  l :l /l :s | f :- /- :- | s :- /s :s | s :f /m :l | s :- /- :f | m :- /- :- |
  f :- /s /l :s | r :- /- :- | f :- /m :r | d :s /l :f | s :- /s :- | d :- /- :- }

kyɛn a-sa-se sa        ne wonkwa-gye a-man-a-man  no  mu.`

describe('looksHymnal', () => {
  it('flags real-sheet note lines', () => {
    expect(looksHymnal('{ m :- /m :r | d :- /s :- }')).toBe(true)
    expect(looksHymnal('d :s, .ta/l, :-')).toBe(true)
    expect(looksHymnal('S: d :d | r :r')).toBe(true)
  })

  it('keeps classic sheets classic', () => {
    expect(looksHymnal('Do Re Mi Fa So La Ti')).toBe(false)
    expect(looksHymnal('|: Do Re :|')).toBe(false)
    expect(looksHymnal('Do- Di- Ra- Di Fi(1/2)')).toBe(false)
    expect(looksHymnal('1=F#')).toBe(false)
  })
})

describe('scanHymnalLine', () => {
  it('split `m :- /m :r` into four beats with the hold folded', () => {
    const { ok, events } = scanHymnalLine('m :- /m :r', 1, 'Soprano')
    expect(ok).toBe(true)
    expect(events.map((e) => [e.solfa, e.beats])).toEqual([
      ['mi', 2],
      ['mi', 1],
      ['re', 1],
    ])
  })

  it('reads rests, holds and subscript octaves', () => {
    const { ok, events } = scanHymnalLine('0 :- | f₁ :s /l :t', 1, 'Bass')
    expect(ok).toBe(true)
    expect(events[0]).toMatchObject({ solfa: null, beats: 2 })
    expect(events[2]).toMatchObject({ solfa: 'fa', down: 1 })
    expect(events[3]).toMatchObject({ solfa: 'so', up: 0, down: 0 })
    expect(events[4]).toMatchObject({ solfa: 'la' })
  })

  it('keeps repeat and ending bar tokens in order', () => {
    const { ok, events } = scanHymnalLine('|: m :- :| 1. r', 1, 'Main')
    expect(ok).toBe(true)
    const types = events.map((e) => e.type)
    expect(types).toEqual(['bar', 'note', 'bar', 'ending', 'note'])
    expect(events[0].attrs.open).toBe(true)
    expect(events[2].attrs.close).toBe(true)
    expect(events[3].n).toBe(1)
  })

  it('splits two parts squeezed into one beat equally', () => {
    const { ok, events } = scanHymnalLine('d :s s', 1, 'Soprano')
    expect(ok).toBe(true)
    const beats = events.map((e) => e.beats)
    expect(beats[0]).toBe(1)
    expect(beats[1]).toBeCloseTo(0.5)
    expect(beats[2]).toBeCloseTo(0.5)
  })

  it('reports unknown words with a real-sheet hint', () => {
    const { ok, message } = scanHymnalLine('q :-', 1, 'Alto')
    expect(ok).toBe(false)
    expect(message).toMatch(/Unrecognized note "q"/)
    expect(message).toMatch(/Real sheets use/)
  })
})

describe('hymnal word sheet', () => {
  it('carties the real-sheet chromatic spellings', () => {
    expect(HYMN_WORDS.de).toBe('di')
    expect(HYMN_WORDS.fe).toBe('fi')
    expect(HYMN_WORDS.se).toBe('si')
    expect(HYMN_WORDS.le).toBe('li')
    expect(HYMN_WORDS.lo).toBe('le')
    expect(HYMN_WORDS.ta).toBe('te')
  })

  it('parses the pasted Twi hymn verbatim', () => {
    const parsed = parseSolfa(TWY_SHEET)
    expect(parsed.ok).toBe(true, parsed.error && parsed.error.message)
    const { key, parts } = parsed.result
    expect(key).toBe('Eb')
    expect(parts.map((p) => p.name)).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass'])
    for (const p of parts) expect(p.notes.length).toBeGreaterThan(0)
  })

  it('names the four voices from the braced rows', () => {
    const parsed = parseSolfa(
      '{ m :- /m :r | d :- /s :- }\n' +
        'd :- /d :t | d :t /d :r\n' +
        's :- /s :f | m :- /d :- \n' +
        'd :- /s :s | l :- /m :- }'
    )
    expect(parsed.ok).toBe(true)
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass'])
    expect(parsed.result.parts.map((p) => p.bars.length)).toEqual([2, 2, 2, 2])
    expect(parsed.result.parts.map((p) => p.notes.reduce((a, n) => a + n.beats, 0))).toEqual([8, 8, 8, 8])
  })

  it('skips lyric, title and composer lines', () => {
    const parsed = parseSolfa(
      'Key E Flat\nO - nyan - ko - pon, dom yen be-hyï-ra yen,\n{ m :- /m :r }'
    )
    expect(parsed.ok).toBe(true)
    expect(parsed.result.key).toBe('Eb')
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Soprano'])
  })

  it('applies real-sheet chromatics to the pitched notes', () => {
    const parsed = parseSolfa(TWY_SHEET)
    expect(parsed.ok).toBe(true)
    const sopranoSolfa = parsed.result.parts[0].notes.map((n) => n.solfa)
    const altoSolfa = parsed.result.parts[1].notes.map((n) => n.solfa)
    expect(sopranoSolfa).toContain('fi')
    expect(altoSolfa).toContain('di')
    expect(parsed.result.parts.some((p) => p.notes.some((n) => n.solfa === 'si'))).toBe(false)
  })

  it('keeps the registers: Tenor an octave down, Bass two down', () => {
    const parsed = parseSolfa(TWY_SHEET)
    expect(parsed.ok).toBe(true)
    const seq = buildSequences(parsed.result, 'Eb', 0, ['Soprano', 'Tenor', 'Bass'], {})
    expect(sequenceBeats(seq[0])).toBe(64)
    expect(sequenceBeats(seq[1])).toBe(64)
    expect(sequenceBeats(seq[2])).toBe(65)
    expect(seq[0].notes[0].midi).toBe(67) // mi above do = Eb4 -> G4
    expect(seq[2].notes[0].midi).toBe(39) // bass do at Eb2
  })

  it('flags the 5-beat bass bar when a meter is forced', () => {
    const parsed = parseSolfa('Meter: 4/4\n' + TWY_SHEET)
    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toMatch(/of Bass has 5 beats/)
  })
})

describe('key word forms', () => {
  it.each([
    ['Key E Flat', 'Eb'],
    ['key e♭', 'Eb'],
    ['Key F#', 'F#'],
    ['tonic Bb', 'Bb'],
    ['Key Eb', 'Eb'],
    ['Key C', 'C'],
    ['Doh = A', 'A'],
    ['Doh=A', 'A'],
    ['Doh = Ab', 'Ab'],
  ])('parses %s', (header, expected) => {
    const parsed = parseSolfa(`${header}\nDo Re Mi`)
    expect(parsed.ok).toBe(true)
    expect(parsed.result.key).toBe(expected)
  })
})

describe('domisol-style parts', () => {
  it('reads S:/A:/T:/B: rows as the four voices', () => {
    const parsed = parseSolfa('S: d :d | r :r\nA: m :- | f :-')
    expect(parsed.ok).toBe(true)
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Soprano', 'Alto'])
  })

  it('ignores L: lyric rows', () => {
    const parsed = parseSolfa('L: O nyan ko pon\nS: d :d')
    expect(parsed.ok).toBe(true)
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Soprano'])
  })

  it('still plays a classic repeat sheet', () => {
    const parsed = parseSolfa('Meter: 4/4\n|: Do Re :| Mi Fa')
    expect(parsed.ok).toBe(true)
  })
})

describe('part headers in hymnal mode', () => {
  it('routes notes after a "Bass:" header to Bass', () => {
    const parsed = parseSolfa('Bass:\nd :d | d :r | m :-')
    expect(parsed.ok).toBe(true)
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Bass'])
    const bass = parsed.result.parts[0]
    expect(bass.bars.map((b) => b.notes.reduce((a, n) => a + n.beats, 0))).toEqual([2, 2, 2])
  })

  it('routes each header to its own voice', () => {
    const parsed = parseSolfa('Soprano:\ns :s | s :f\nBass:\nd :d | m :m')
    expect(parsed.ok).toBe(true)
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Soprano', 'Bass'])
  })

  it('accepts a bracketed voice header and still skips other labels', () => {
    const parsed = parseSolfa('[Bass]\nd :d\n[Verse 1]\nO - nyan\nSoprano:\ns :s')
    expect(parsed.ok).toBe(true)
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Bass', 'Soprano'])
  })

  it('lets a braced block override a forced header', () => {
    const parsed = parseSolfa('Bass:\n{ m :- /m :r }\nd :- /d :t\ns :- /s :f\nd :- /d :s }')
    expect(parsed.ok).toBe(true)
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Bass', 'Soprano', 'Alto', 'Tenor'])
  })

  it('continues the same four voices across unbraced systems', () => {
    // Two 4-line systems with no braces, a lyric line between them, and a
    // key header — the "D.C" line skips like any other marking.
    const parsed = parseSolfa(
      'Doh = A\n' +
        'd :- |\n' +
        'm :- |\n' +
        's :- |\n' +
        'l :- |\n' +
        'Me kra hyi-ra A-wura-de no.\n' +
        's :- |\n' +
        'd :- |\n' +
        'm :- |\n' +
        'l :- |\n' +
        'D.C'
    )
    expect(parsed.ok).toBe(true, parsed.error && parsed.error.message)
    expect(parsed.result.key).toBe('A')
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass'])
    for (const p of parsed.result.parts) {
      expect(p.bars.length, p.name).toBe(2)
      expect(p.notes.length, p.name).toBe(2)
      expect(p.notes.some((n) => n.line > 4)).toBe(true)
    }
  })
})