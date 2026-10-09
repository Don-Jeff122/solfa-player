import { describe, expect, it } from 'vitest'
import {
  detectKeyLine,
  extractWords,
  normalizeSyllable,
  pagesToSolfa,
  textToSolfa,
} from '../ocr.js'

describe('normalizeSyllable', () => {
  it('accepts all seven syllables', () => {
    for (const s of ['do', 're', 'mi', 'fa', 'so', 'la', 'ti']) {
      expect(normalizeSyllable(s)).toBe(s)
    }
  })

  it('is case-insensitive', () => {
    expect(normalizeSyllable('DO')).toBe('do')
    expect(normalizeSyllable('Re')).toBe('re')
    expect(normalizeSyllable('TI')).toBe('ti')
  })

  it('maps sol to so', () => {
    expect(normalizeSyllable('sol')).toBe('so')
  })

  it('recovers clipped syllables from the first letter', () => {
    expect(normalizeSyllable('d')).toBe('do')
    expect(normalizeSyllable('T')).toBe('ti')
    expect(normalizeSyllable('rc')).toBe('re')
    expect(normalizeSyllable('ml')).toBe('mi')
  })

  it('rejects unrelated words', () => {
    expect(normalizeSyllable('hello')).toBe(null)
    expect(normalizeSyllable('xyz')).toBe(null)
    expect(normalizeSyllable('')).toBe(null)
    expect(normalizeSyllable('123')).toBe(null)
  })
})

describe('textToSolfa', () => {
  it('converts a clean solfa line', () => {
    const out = textToSolfa('Do Re Mi Fa So La Ti')
    expect(out.text).toBe('do re mi fa so la ti')
    expect(out.unreadable).toBe(0)
  })

  it('is case-insensitive and handles Sol', () => {
    const out = textToSolfa('DO re MI fa Sol la TI')
    expect(out.text).toBe('do re mi fa so la ti')
  })

  it('preserves octave marks', () => {
    const out = textToSolfa("Do' ,Do Do''")
    expect(out.text).toBe("do' ,do do''")
  })

  it('preserves duration dashes', () => {
    const out = textToSolfa('Do - Do ---')
    expect(out.text).toBe('do- do---')
  })

  it('keeps rests as 0', () => {
    const out = textToSolfa('Do 0 Mi')
    expect(out.text).toBe('do 0 mi')
  })

  it('drops noise instead of emitting invalid tokens', () => {
    const out = textToSolfa('Do hello Mi')
    expect(out.text).toBe('do mi')
    expect(out.unreadable).toBe(1)
  })

  it('handles multiple lines', () => {
    const out = textToSolfa('Do Re Mi\nFa So La Ti')
    expect(out.text).toBe('do re mi\nfa so la ti')
    expect(out.lineCount).toBe(2)
  })

  it('returns empty text for empty input', () => {
    const out = textToSolfa('')
    expect(out.text).toBe('')
    expect(out.lineCount).toBe(0)
  })

  it('ignores blank lines', () => {
    const out = textToSolfa('Do Re\n\n\nMi')
    expect(out.text).toBe('do re\nmi')
  })

  it('produces text the solfa parser accepts', () => {
    const out = textToSolfa("Key: C\nDo Re Mi\nDo' So Mi")
    expect(out.text).toContain('do')
  })
})

describe('detectKeyLine', () => {
  it('reads a "Key:" declaration', () => {
    expect(detectKeyLine('Key: G')).toBe('G')
    expect(detectKeyLine('key: F#')).toBe('F#')
    expect(detectKeyLine('TONIC: Bb')).toBe('Bb')
  })

  it('reads a "1=" solfa key declaration', () => {
    expect(detectKeyLine('1 = D')).toBe('D')
    expect(detectKeyLine('1=C#')).toBe('C#')
  })

  it('ignores ordinary note lines', () => {
    expect(detectKeyLine('Do Re Mi')).toBe(null)
    expect(detectKeyLine('')).toBe(null)
  })
})

describe('structural lines survive conversion', () => {
  it('keeps the key declaration', () => {
    const out = textToSolfa('Key: G\nDo Re Mi')
    expect(out.text).toBe('Key: G\ndo re mi')
    expect(out.key).toBe('G')
    expect(out.unreadable).toBe(0)
  })

  it('keeps part labels', () => {
    const out = textToSolfa('Bass\nDo So\nTenor\nRe Mi')
    expect(out.text).toBe('Bass\ndo so\nTenor\nre mi')
    expect(out.unreadable).toBe(0)
  })

  it('does not mistake a part name for a note', () => {
    expect(normalizeSyllable('Bass')).toBe(null)
    expect(normalizeSyllable('Soprano')).toBe(null)
    expect(normalizeSyllable('Alto')).toBe(null)
  })
})

describe('pagesToSolfa', () => {
  it('joins pages and averages confidence', () => {
    const out = pagesToSolfa([
      { text: 'Do Re', confidence: 80 },
      { text: 'Mi Fa', confidence: 90 },
    ])
    expect(out.text).toBe('do re\nmi fa')
    expect(out.confidence).toBe(85)
    expect(out.pages).toBe(2)
  })

  it('accepts plain strings', () => {
    expect(pagesToSolfa(['Do']).text).toBe('do')
  })

  it('handles no pages', () => {
    expect(pagesToSolfa([]).text).toBe('')
    expect(pagesToSolfa([]).confidence).toBe(0)
  })
})

describe('extractWords', () => {
  const word = (text, bbox, confidence = 90) => ({ text, bbox, confidence })
  const blockOf = (words) => [{ paragraphs: [{ lines: [{ words }] }] }]

  it('flattens blocks into words with their boxes', () => {
    const words = extractWords(blockOf([word('Do', { x0: 10, y0: 20, x1: 40, y1: 36 })]))

    expect(words).toEqual([
      { text: 'Do', confidence: 90, bbox: { x0: 10, y0: 20, x1: 40, y1: 36 } },
    ])
  })

  it('keeps every block and line in one list', () => {
    const words = extractWords([
      ...blockOf([word('Bass', { x0: 0, y0: 0, x1: 20, y1: 14 })]),
      { paragraphs: [{ lines: [{ words: [word('Do', { x0: 40, y0: 0, x1: 60, y1: 14 })] }] }] },
    ])

    expect(words.map((w) => w.text)).toEqual(['Bass', 'Do'])
  })

  it('reads words top to bottom and left to right', () => {
    const words = extractWords(
      blockOf([
        word('Mi', { x0: 200, y0: 100, x1: 220, y1: 114 }),
        word('Re', { x0: 100, y0: 100, x1: 120, y1: 114 }),
        word('So', { x0: 100, y0: 40, x1: 120, y1: 54 }),
      ])
    )

    expect(words.map((w) => w.text)).toEqual(['So', 'Re', 'Mi'])
  })

  it('drops blank words and words with an unusable box', () => {
    const words = extractWords(
      blockOf([
        word('   ', { x0: 0, y0: 0, x1: 10, y1: 10 }),
        word('Do', { x0: 0, y0: 0, x1: 10 }),
        word('Re', { x0: 'a', y0: 0, x1: 10, y1: 10 }),
        word('Mi', { x0: 0, y0: 0, x1: 10, y1: 10 }),
      ])
    )

    expect(words.map((w) => w.text)).toEqual(['Mi'])
  })

  it('defaults a missing confidence to zero', () => {
    const words = extractWords(blockOf([{ text: 'Do', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }]))

    expect(words[0].confidence).toBe(0)
  })

  it('handles a result with no blocks', () => {
    expect(extractWords(undefined)).toEqual([])
    expect(extractWords([])).toEqual([])
    expect(extractWords([{}])).toEqual([])
  })
})

  describe('chromatic solfa', () => {
    it('normalises the sharp and flat syllables', () => {
      for (const s of ['di', 'ri', 'fi', 'si', 'li', 'ra', 'me', 'se', 'le', 'te']) {
        expect(normalizeSyllable(s)).toBe(s)
        expect(normalizeSyllable(s.toUpperCase())).toBe(s)
      }
    })

    it('still reads a clipped syllable as the plain note', () => {
      expect(normalizeSyllable('d')).toBe('do')
      expect(normalizeSyllable('r')).toBe('re')
    })

    it('keeps accidentals through OCR conversion', () => {
      expect(textToSolfa('Do Re\nDi Ra Fi Se').text).toBe('do re\ndi ra fi se')
    })

    it('counts a chromatic syllable as read, not as noise', () => {
      expect(textToSolfa('Do Di Ra').unreadable).toBe(0)
    })

    it('keeps octave marks and dashes on accidentals', () => {
      expect(textToSolfa("Di' Ra-").text).toBe("di' ra-")
    })
  })
