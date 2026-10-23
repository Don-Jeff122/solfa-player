import { describe, expect, it } from 'vitest'
import {
  analyzeHymnalPage,
  assembleHymnalSheet,
  countInk,
  findHymnalSystems,
  findInkBands,
  findMusicRows,
  keyFromHymnalText,
  normalizeHymnalOcr,
  selectVoiceRows,
} from '../hymnalScan.js'
import { parseSolfa } from '../parseSolfa.js'
import { otsuThreshold, toLuma } from '../staff/geometry.js'
import { createCanvas } from '../staff/__tests__/fixtures.js'

const BAR_LINES = [40, 140, 240, 340, 440]

function drawHymnalPage() {
  const width = 520
  const height = 260
  const canvas = createCanvas(width, height)
  const systems = [
    [30, 54, 78, 102],
    [160, 184, 208, 232],
  ]

  for (const tops of systems) {
    for (const top of tops) {
      const bottom = top + 17
      for (const x of BAR_LINES) canvas.vLine(x, top, bottom, 2)
      for (let cell = 0; cell < BAR_LINES.length - 1; cell++) {
        const left = BAR_LINES[cell] + 8
        canvas.hLine(left, left + 14, top + 8, 2)
        canvas.set(left + 28, top + 5)
        canvas.set(left + 28, top + 2)
        canvas.set(left + 37, top + 5)
        canvas.set(left + 37, top + 2)
      }
    }
  }

  canvas.hLine(40, 64, 134, 5)
  canvas.hLine(78, 102, 134, 5)
  canvas.hLine(116, 140, 134, 5)
  canvas.hLine(154, 178, 134, 5)

  return { canvas, width, height }
}

function analyse(canvas) {
  const luma = toLuma(canvas.data, canvas.width, canvas.height)
  const threshold = otsuThreshold(luma)
  return {
    luma,
    threshold,
    result: analyzeHymnalPage(luma, canvas.width, canvas.height, threshold),
  }
}

describe('hymnal layout', () => {
  it('finds the four-row systems around the lyric line', () => {
    const { result } = analyse(drawHymnalPage().canvas)
    expect(result.systems).toHaveLength(2)
    expect(result.systems[0].rows).toHaveLength(4)
    expect(result.systems[0].sourceRows).toHaveLength(4)
    expect(result.systems[1].rows).toHaveLength(4)
    expect(result.systems[1].sourceRows).toHaveLength(4)
    expect(result.lowResolution).toBe(true)
  })

  it('skips a lyric band when selecting the four solfa rows', () => {
    const rows = [30, 54, 78, 102, 126, 150].map((top) => ({
      top,
      bottom: top + 17,
      height: 17,
    }))
    const word = (text, top) => ({
      text,
      bbox: { x0: 0, x1: 20, y0: top + 2, y1: top + 16 },
    })
    const words = [
      ...[rows[0], rows[1], rows[3], rows[4]].flatMap((row) => [
        word('d', row.top),
        word('s : f', row.top),
        word('m : r', row.top),
      ]),
      word('Me', rows[2].top),
      word('hyi', rows[2].top),
      word('ra', rows[2].top),
    ]

    expect(selectVoiceRows(rows, words)).toEqual([
      rows[0],
      rows[1],
      rows[3],
      rows[4],
    ])
  })

  it('uses the shared barlines and page edges as bar boundaries', () => {
    const { result } = analyse(drawHymnalPage().canvas)
    expect(result.systems[0].barLines).toEqual([40.5, 140.5, 240.5, 340.5, 440.5])
    expect(result.systems[0].barLines).toHaveLength(5)
  })

  it('finds systems from barlines that run through all four voices', () => {
    const { canvas } = drawHymnalPage()
    for (const x of BAR_LINES) {
      canvas.vLine(x, 27, 123, 2)
      canvas.vLine(x, 157, 253, 2)
    }
    const { result } = analyse(canvas)
    expect(result.systems).toHaveLength(2)
    expect(result.systems[0].rows).toHaveLength(4)
    expect(result.systems[1].rows).toHaveLength(4)
  })

  it('rejects a four-row group whose rows have unrelated barlines', () => {
    const rows = [
      { top: 10, bottom: 26, height: 17, bars: [10, 50, 90, 130] },
      { top: 30, bottom: 46, height: 17, bars: [10, 55, 95, 135] },
      { top: 50, bottom: 66, height: 17, bars: [10, 60, 100, 140] },
      { top: 70, bottom: 86, height: 17, bars: [10, 65, 105, 145] },
    ]
    expect(findHymnalSystems(rows)).toHaveLength(0)
  })

  it('finds ink bands and counts ink in a cell', () => {
    const { canvas } = drawHymnalPage()
    const luma = toLuma(canvas.data, canvas.width, canvas.height)
    const threshold = otsuThreshold(luma)
    const bands = findInkBands(luma, canvas.width, canvas.height, threshold)
    expect(bands.length).toBeGreaterThanOrEqual(9)

    const { result } = analyse(canvas)
    expect(countInk(result.mask, canvas.width, canvas.height, { x0: 40, x1: 140, y0: 30, y1: 47 })).toBeGreaterThan(0)
  })

  it('finds music rows but not the lyric line', () => {
    const { canvas } = drawHymnalPage()
    const luma = toLuma(canvas.data, canvas.width, canvas.height)
    const { rows } = findMusicRows(luma, canvas.width, canvas.height, otsuThreshold(luma))
    expect(rows).toHaveLength(8)
  })
})

describe('hymnal OCR normalisation', () => {
  it('repairs ASCII subscripts and beat separators', () => {
    expect(normalizeHymnalOcr('d : - : t1 | l1 : - : s1')).toEqual({
      text: 'd : - : t₁ l₁ : - : s₁',
      unreadable: 0,
    })
  })

  it('repairs dotless i and semicolons', () => {
    expect(normalizeHymnalOcr('fı ; - ; sı').text).toBe('f₁ : - : s₁')
    expect(normalizeHymnalOcr('m ; s').text).toBe('m : s')
  })

  it('turns a lone O into a rest and keeps holds', () => {
    expect(normalizeHymnalOcr('O :-').text).toBe('0 : -')
  })

  it('drops lyric-like words and counts them', () => {
    expect(normalizeHymnalOcr('hello d re')).toEqual({ text: 'd r', unreadable: 1 })
  })

  it('keeps dots, holds, slurs and octave marks', () => {
    expect(normalizeHymnalOcr("d.r _ ,m- t'").text).toBe("d.r _ m₁- t'")
  })

  it('repairs common cell punctuation confusions', () => {
    expect(normalizeHymnalOcr('m. -.r', { cell: true }).text).toBe('m : - : r')
    expect(normalizeHymnalOcr('m:i-:m', { cell: true }).text).toBe('m : - : m')
    expect(normalizeHymnalOcr('m -:r', { cell: true }).text).toBe('m : - : r')
    expect(normalizeHymnalOcr('m.: -r', { cell: true }).text).toBe('m : - : r')
    expect(normalizeHymnalOcr('m₁-r', { cell: true }).text).toBe('m₁ : - : r')
  })

  it('keeps chromatic syllables and words', () => {
    expect(normalizeHymnalOcr('di ra ta me se le te do re mi fa so la ti')).toEqual({
      text: 'di ra ta me se le te d r m f s l t',
      unreadable: 0,
    })
  })
})

describe('hymnal sheet assembly', () => {
  it('writes four voices and parses as a real sheet', () => {
    const text = assembleHymnalSheet({
      key: 'A',
      systems: [
        {
          rows: [
            { voice: 'S', cells: ['d : - : t₁', 'l₁ : - : s₁'] },
            { voice: 'A', cells: ['s₁ : - : s₁', 'f₁ : - : m₁'] },
            { voice: 'T', cells: ['m : - : m', 'd : - : d'] },
            { voice: 'B', cells: ['d₁ : - : m₁', 'd₁ : - : d₁'] },
          ],
        },
      ],
    })

    expect(text).toContain('Doh = A')
    expect(text).toContain('S: d : - : t₁ | l₁ : - : s₁')
    const parsed = parseSolfa(text)
    expect(parsed.ok).toBe(true, parsed.ok ? '' : parsed.error.message)
    expect(parsed.result.key).toBe('A')
    expect(parsed.result.parts.map((p) => p.name)).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass'])
    expect(parsed.result.parts.map((p) => p.bars.length)).toEqual([2, 2, 2, 2])
  })

  it('uses rests for empty cells', () => {
    const text = assembleHymnalSheet({
      key: 'G',
      systems: [{ rows: [{ voice: 'S', cells: ['d', ''] }] }],
    })
    expect(text).toBe('Doh = G\nS: d | 0')
  })
})

describe('hymnal key detection', () => {
  it.each([
    ['Doh = A', 'A'],
    ['Doh=A', 'A'],
    ['Doh = Ab', 'Ab'],
    ['Key: F#', 'F#'],
    ['Tonic Bb', 'Bb'],
  ])('reads %s', (text, key) => {
    expect(keyFromHymnalText(text)).toBe(key)
  })

  it('returns null when there is no key', () => {
    expect(keyFromHymnalText('S: d :-')).toBe(null)
  })
})
