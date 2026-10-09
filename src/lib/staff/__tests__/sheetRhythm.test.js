import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  pagesToRhythmSolfa,
  pairWithNotes,
  readStaffRhythm,
  rhythmToSolfa,
} from '../sheetRhythm.js'
import {
  createCanvas,
  drawBeamBetween,
  drawNote,
  drawStaff,
} from './fixtures.js'

const SPACING = 20

/**
 * Render one staff of notes and return a page image plus the positioned "OCR"
 * words standing in for the printed solfa underneath. Syllables are deliberately
 * placed slightly off their notehead, because real OCR boxes are never exact.
 */
function renderStaff(notes, { top = 60, left = 40, label = null, width = 900, height = 320 } = {}) {
  const canvas = createCanvas(width, height)
  const staff = drawStaff(canvas, { top, left, right: width - 40, spacing: SPACING })

  let x = left + SPACING * 3
  const placed = notes.map((n) => {
    const p = { ...n, x }
    drawNote(canvas, staff, { x, step: n.step ?? 2, beats: n.beats, dotted: !!n.dotted })
    x += SPACING * 3
    return p
  })

  const flagged = placed.filter((p) => p.beats <= 0.5)
  if (flagged.length >= 2) {
    drawBeamBetween(canvas, staff, {
      fromX: flagged[0].x,
      toX: flagged[flagged.length - 1].x,
      step: 2,
      levels: flagged.every((f) => f.beats <= 0.25) ? 2 : 1,
    })
  }

  // Solfa prints under the staff, around three quarters of a space below it.
  const wordY = top + 4 * SPACING + SPACING * 0.6
  const words = placed.map((p, i) => ({
    text: p.syllable || ['do', 're', 'mi', 'fa', 'so', 'la', 'ti'][i % 7],
    confidence: 90,
    bbox: { x0: p.x - 6, x1: p.x + 6, y0: wordY, y1: wordY + 14 },
  }))

  if (label) {
    words.unshift({
      text: label,
      confidence: 95,
      bbox: { x0: left - 30, x1: left - 4, y0: wordY, y1: wordY + 14 },
    })
  }

  return { canvas, staff, placed, words }
}

/** The detector runs on image data, so give the fixture a canvas-like reader. */
function pageOf(canvas) {
  return {
    width: canvas.width,
    height: canvas.height,
    getContext: () => ({
      getImageData: (x, y, w, h) => ({ data: canvas.data, width: w, height: h }),
    }),
  }
}

describe('duration formatting', () => {
  it('leaves a crotchet bare, which is the default length', () => {
    expect(formatDuration(1)).toBe('')
  })

  it('writes whole, half and minim lengths in parentheses', () => {
    expect(formatDuration(2)).toBe('(2)')
    expect(formatDuration(4)).toBe('(4)')
  })

  it('writes flagged notes as fractions so the parser reads them exactly', () => {
    expect(formatDuration(0.5)).toBe('(1/2)')
    expect(formatDuration(0.25)).toBe('(1/4)')
  })

  it('writes a dot after the base length, which is how solfa shows a dot', () => {
    expect(formatDuration(1.5, true)).toBe('.')
    expect(formatDuration(3, true)).toBe('(2).')
  })
})

describe('pairing syllables with noteheads', () => {
  it('uses each notehead once and keeps the left-to-right order', () => {
    const notes = [{ x: 100 }, { x: 200 }, { x: 300 }]
    const words = [
      { bbox: { x0: 194, x1: 206, y0: 0, y1: 10 } },
      { bbox: { x0: 94, x1: 106, y0: 0, y1: 10 } },
      { bbox: { x0: 294, x1: 306, y0: 0, y1: 10 } },
    ]
    const pairs = pairWithNotes(words, notes, 20)
    expect(pairs.map((p) => p.note.x)).toEqual([100, 200, 300])
  })

  it('leaves a syllable alone when no notehead is close enough', () => {
    const notes = [{ x: 100 }]
    const words = [{ bbox: { x0: 500, x1: 520, y0: 0, y1: 10 } }]
    expect(pairWithNotes(words, notes, 20)).toHaveLength(0)
  })
})

describe('reading a page with printed solfa', () => {
  it('gives quarter notes no length marker', () => {
    const { canvas, words } = renderStaff([{ beats: 1 }, { beats: 1 }, { beats: 1 }])
    const result = readStaffRhythm(pageOf(canvas), words)
    expect(result.parts[0].tokens).toEqual(['do', 're', 'mi'])
  })

  it('takes half, whole and dotted lengths from the staff', () => {
    const { canvas, words } = renderStaff([
      { beats: 2 },
      { beats: 4 },
      { beats: 1, dotted: true },
    ])
    const result = readStaffRhythm(pageOf(canvas), words)
    expect(result.parts[0].tokens).toEqual(['do(2)', 're(4)', 'mi.'])
  })

  it('turns beamed eighths into halves', () => {
    const { canvas, words } = renderStaff([
      { beats: 0.5 },
      { beats: 0.5 },
      { beats: 1 },
    ])
    const result = readStaffRhythm(pageOf(canvas), words)
    expect(result.parts[0].tokens).toEqual(['do(1/2)', 're(1/2)', 'mi'])
  })

  it('names the voice from a printed part name', () => {
    const { canvas, words } = renderStaff([{ beats: 1 }, { beats: 1 }], { label: 'Bass' })
    const result = readStaffRhythm(pageOf(canvas), words)
    expect(result.parts[0].name).toBe('Bass')
    expect(rhythmToSolfa(result)).toBe('Bass\ndo re')
  })

  it('keeps two staves apart and keeps the key line', () => {
    const top = renderStaff([{ beats: 1 }, { beats: 2 }], { label: 'Soprano', top: 60 })
    const bottom = renderStaff([{ beats: 2 }, { beats: 4 }], {
      label: 'Bass',
      top: 230,
      height: 400,
    })

    // Both staves are drawn onto one page, as they would be on a real sheet.
    // Each was rendered at its own absolute height, so there is no shift here.
    const page = createCanvas(900, 400)
    page.data.set(top.canvas.data, 0)
    // Copy ink only; all three colour channels matter for greyscale conversion.
    for (let i = 0; i < bottom.canvas.data.length; i += 4) {
      if (bottom.canvas.data[i] === 255) continue
      page.data[i] = 0
      page.data[i + 1] = 0
      page.data[i + 2] = 0
      page.data[i + 3] = 255
    }

    const words = [...top.words, ...bottom.words]

    const result = readStaffRhythm(pageOf(page), words)
    const text = rhythmToSolfa(result, { key: 'G' })
    expect(text).toBe('Key: G\nSoprano\ndo re(2)\nBass\ndo(2) re(4)')
  })

  it('reports notes that had no syllable under them', () => {
    const { canvas, words } = renderStaff([{ beats: 1 }, { beats: 1 }, { beats: 1 }])
    const result = readStaffRhythm(pageOf(canvas), words.slice(0, 2))
    expect(result.notesFound).toBe(3)
    expect(result.matched).toBe(2)
    expect(result.unmatchedNotes).toBe(1)
  })

  it('keeps octave marks that the sheet printed', () => {
    const { canvas, words } = renderStaff([
      { beats: 1, syllable: "Do'" },
      { beats: 1, syllable: ',Mi' },
    ])
    const result = readStaffRhythm(pageOf(canvas), words)
    expect(result.parts[0].tokens).toEqual(["do'", ',mi'])
  })
})

describe('assembling pages', () => {
  it('falls back to plain text when no page carries a staff image', () => {
    const result = pagesToRhythmSolfa([{ text: 'Key: G\nDo Re Mi', confidence: 90 }])
    expect(result.timed).toBe(false)
    expect(result.key).toBe('G')
    expect(result.text).toContain('do re mi')
  })

  it('carries one voice across a page break instead of repeating its name', () => {
    const first = renderStaff([{ beats: 1 }, { beats: 2 }], { label: 'Bass' })
    const second = renderStaff([{ beats: 4 }, { beats: 1 }], { label: 'Bass' })

    const result = pagesToRhythmSolfa([
      { canvas: pageOf(first.canvas), words: first.words, confidence: 90, text: '' },
      { canvas: pageOf(second.canvas), words: second.words, confidence: 90, text: '' },
    ])

    expect(result.timed).toBe(true)
    expect(result.text).toBe('Bass\ndo re(2) do(4) re')
  })
})
