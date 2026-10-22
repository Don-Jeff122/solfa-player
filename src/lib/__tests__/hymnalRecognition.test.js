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
    expect(result.warnings.join(' ')).toContain('D.C.')
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
