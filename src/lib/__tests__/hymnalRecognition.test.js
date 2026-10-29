import { describe, expect, it } from 'vitest'
import { pagesToHymnalSolfa, readHymnalPage } from '../hymnalRecognition.js'

const CELLS = [
  ['d r', 'm f', 's l', 't d'],
  ['s', 'l', 't', 'd'],
  ['m', 'f', 's', 'l'],
  ['d', 'r', 'm', 'f'],
]

const ANALYSIS = {
  width: 420,
  height: 200,
  systems: [
    {
      top: 40,
      bottom: 130,
      barLines: [10, 110, 210, 310, 410],
      rows: [
        { top: 50, bottom: 66, height: 17 },
        { top: 70, bottom: 86, height: 17 },
        { top: 90, bottom: 106, height: 17 },
        { top: 110, bottom: 126, height: 17 },
      ],
    },
  ],
  rows: 4,
  mask: null,
  medianRowHeight: 17,
  lowResolution: false,
}

function page(text = 'TAYEYI NE ASEDA\nDoh = A\nD.C.') {
  return { canvas: { width: 420, height: 200 }, text, confidence: 80 }
}

function rowFor(y) {
  if (y < 68) return 0
  if (y < 88) return 1
  if (y < 108) return 2
  return 3
}

function crop(source, rect) {
  if (rect.height > 30) return { header: true }
  const bar = ANALYSIS.systems[0].barLines.findIndex(
    (line, index, lines) => index < lines.length - 1 && rect.x >= line && rect.x < lines[index + 1]
  )
  return { row: rowFor(rect.y + 3), bar: Math.max(0, bar) }
}

function ocrCell(canvas) {
  return { text: CELLS[canvas.row][canvas.bar], confidence: 90 }
}

describe('hymnal page recognition', () => {
  it('reads each bar in each voice and assembles a parsed sheet', async () => {
    const result = await readHymnalPage(page(), {
      analyze: () => ANALYSIS,
      crop,
      ocrCell,
    })

    expect(result.ok).toBe(true)
    expect(result.key).toBe('A')
    expect(result.systems).toBe(1)
    expect(result.rows).toBe(4)
    expect(result.bars).toBe(4)
    expect(result.emptyCells).toBe(0)
    expect(result.text).toContain('Doh = A')
    expect(result.text).toContain('S: d r | m f | s l | t d')
    expect(result.text).toContain('B: d | r | m | f')
    expect(result.sourceText).toContain('Doh = A')
    expect(result.sourceText).toContain('D.C.')
    expect(result.sourceKind).toBe('raw-ocr')
    expect(result.warnings.join(' ')).toContain('D.C.')
  })

  it('keeps exact source symbols and lyrics separate from playable text', async () => {
    const sourcePage = {
      ...page('Dohis E\nD.C.'),
      words: [
        { text: 'Dohis', bbox: { x0: 10, y0: 2, x1: 40, y1: 12 } },
        { text: 'E', bbox: { x0: 45, y0: 2, x1: 53, y1: 12 } },
        { text: 'S:', bbox: { x0: 10, y0: 52, x1: 28, y1: 62 } },
        { text: 'd', bbox: { x0: 40, y0: 52, x1: 48, y1: 62 } },
        { text: '|:', bbox: { x0: 106, y0: 52, x1: 114, y1: 62 } },
        { text: 'f1', bbox: { x0: 140, y0: 52, x1: 150, y1: 62 } },
        { text: ':|', bbox: { x0: 206, y0: 52, x1: 214, y1: 62 } },
        { text: 'O', bbox: { x0: 240, y0: 52, x1: 248, y1: 62 } },
        { text: 'Me', bbox: { x0: 10, y0: 135, x1: 24, y1: 145 } },
        { text: 'hyi', bbox: { x0: 30, y0: 135, x1: 46, y1: 145 } },
        { text: 'ra', bbox: { x0: 52, y0: 135, x1: 62, y1: 145 } },
        { text: 'D.C.', bbox: { x0: 180, y0: 145, x1: 200, y1: 155 } },
        { text: '1', bbox: { x0: 300, y0: 155, x1: 308, y1: 165 } },
      ],
    }
    const analysis = {
      ...ANALYSIS,
      systems: [
        {
          ...ANALYSIS.systems[0],
          sourceRows: ANALYSIS.systems[0].rows,
          barLines: [10, 110, 210, 310],
        },
      ],
    }
    const result = await readHymnalPage(sourcePage, {
      analyze: () => analysis,
      crop: () => ({}),
      ocrCell: () => ({ text: 'd', confidence: 90 }),
      ocrHeader: () => ({ text: '', confidence: 0 }),
    })

    expect(result.sourceText).toBe(
      ['Dohis E', 'S: d |: f1 :| O', 'Me hyi ra', 'D.C.', '1'].join('\n')
    )
    expect(result.sourceKind).toBe('layout')
  })

  it('writes empty cells as rests', async () => {
    const result = await readHymnalPage(page(), {
      analyze: () => ANALYSIS,
      crop,
      ocrCell: (canvas) =>
        canvas.row === 0 && canvas.bar === 1
          ? { text: '', confidence: 40 }
          : ocrCell(canvas),
    })

    expect(result.emptyCells).toBe(1)
    expect(result.text).toContain('S: d r | 0 | s l | t d')
  })

  it('falls back to an OCR header when the page text has no key', async () => {
    const result = await readHymnalPage(page('TAYEYI NE ASEDA'), {
      analyze: () => ANALYSIS,
      crop,
      ocrCell,
      ocrHeader: () => ({ text: 'Doh = G', confidence: 80 }),
    })

    expect(result.key).toBe('G')
    expect(result.text).toContain('Doh = G')
  })

  it('does not turn a narrow double-bar gap into an empty bar', async () => {
    const analysis = {
      ...ANALYSIS,
      systems: [{ ...ANALYSIS.systems[0], barLines: [10, 110, 130, 230, 330] }],
    }
    const doubleBarCrop = (source, rect) => {
      const bar = analysis.systems[0].barLines.findIndex(
        (line, index, lines) => index < lines.length - 1 && rect.x >= line && rect.x < lines[index + 1]
      )
      return { bar }
    }
    const result = await readHymnalPage(page(), {
      analyze: () => analysis,
      crop: doubleBarCrop,
      ocrCell: (canvas) => ({
        text: { 0: 'd', 2: 'r', 3: 'm' }[canvas.bar] ?? 'd',
        confidence: 90,
      }),
    })

    expect(result.bars).toBe(3)
    expect(result.emptyCells).toBe(0)
    expect(result.text).toContain('S: d | r | m')
  })

  it('reports a page with no four-row systems', async () => {
    const result = await readHymnalPage(page(), {
      analyze: () => ({ ...ANALYSIS, systems: [] }),
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-layout')
    expect(result.sourceText).toContain('Doh = A')
    expect(result.sourceKind).toBe('raw-ocr')
    expect(result.warnings.join(' ')).toContain('Could not find four voice rows')
  })

  it('combines pages through the public entry point', async () => {
    const result = await pagesToHymnalSolfa([page()], {
      analyze: () => ANALYSIS,
      crop,
      ocrCell,
    })

    expect(result.ok).toBe(true)
    expect(result.pages).toBe(1)
    expect(result.systems).toBe(1)
    expect(result.bars).toBe(4)
    expect(result.text).toContain('S: d r | m f | s l | t d')
  })
})
