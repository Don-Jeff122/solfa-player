import { describe, expect, it } from 'vitest'
import { groupWordsIntoLines, sourceTranscription } from '../sourceTranscription.js'

function word(text, x, y, width = 8, height = 10) {
  return { text, bbox: { x0: x, y0: y, x1: x + width, y1: y + height } }
}

const NOTE_SYSTEM = {
  rows: [{ top: 20, bottom: 34 }],
  barLines: [10, 110, 210, 310],
}

describe('source transcription', () => {
  it('keeps raw symbols, headers, lyrics and page text', () => {
    const words = [
      word('Dohis', 10, 2, 30),
      word('E', 45, 2),
      word('S:', 10, 22, 18),
      word('d', 40, 22),
      word('|:', 106, 22, 8),
      word('f1', 140, 22, 10),
      word(':|', 206, 22, 8),
      word('O', 240, 22),
      word('Me', 10, 52, 14),
      word('hyi', 30, 52, 16),
      word('ra', 52, 52, 10),
      word('D.C.', 180, 72, 20),
      word('1', 300, 82),
    ]

    expect(sourceTranscription(words, [NOTE_SYSTEM])).toBe(
      ['Dohis E', 'S: d |: f1 :| O', 'Me hyi ra', 'D.C.', '1'].join('\n')
    )
  })

  it('adds only a structural bar separator when OCR missed the bar token', () => {
    const words = [
      word('d', 40, 22),
      word('m', 140, 22),
    ]

    expect(sourceTranscription(words, [NOTE_SYSTEM])).toBe('d | m')
  })

  it('leaves a lyric line unmodified instead of splitting it into bars', () => {
    const words = [word('Me', 10, 52, 14), word('hyi', 30, 52, 16), word('ra', 52, 52, 10)]

    expect(sourceTranscription(words, [NOTE_SYSTEM])).toBe('Me hyi ra')
  })

  it('falls back to raw lines when layout is unavailable', () => {
    const words = [word('Dohis', 10, 2, 30), word('E', 45, 2), word('S:', 10, 22, 18), word('f1', 40, 22)]

    expect(sourceTranscription(words, [])).toBe('Dohis E\nS: f1')
  })

  it('groups words by their vertical position', () => {
    const lines = groupWordsIntoLines([
      word('one', 10, 10),
      word('two', 40, 10),
      word('three', 10, 40),
    ])

    expect(lines.map((line) => line.words.map((entry) => entry.text).join(' '))).toEqual([
      'one two',
      'three',
    ])
  })
})
