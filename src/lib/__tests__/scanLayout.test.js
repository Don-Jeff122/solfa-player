import { describe, expect, it } from 'vitest'
import {
  baseName,
  countUncertain,
  findChar,
  orderedPages,
  pagesToPlayerText,
  pagesToSvg,
  pagesToText,
  patchPageChar,
  rebuildLineText,
  validateScanFile,
} from '../scanLayout.js'

function makeChar(id, text, offset, { uncertain = false, corrected = false } = {}) {
  return {
    id,
    text,
    offset,
    confidence: uncertain ? 0.4 : 0.96,
    uncertain,
    corrected,
    kind: 'solfa',
    bbox: { x0: offset * 10, y0: 0, x1: offset * 10 + 8, y1: 14 },
  }
}

function makePage() {
  return {
    page: 1,
    width: 100,
    height: 50,
    image_url: '/image',
    uncertain_count: 1,
    lines: [
      {
        id: 'p1-l0',
        row: 0,
        raw_text: 'd : d',
        text: 'd : d',
        bbox: { x0: 0, y0: 0, x1: 50, y1: 14 },
        chars: [
          makeChar('a', 'd', 0),
          makeChar('b', ':', 2),
          makeChar('c', 'd', 4, { uncertain: true }),
        ],
      },
    ],
    rules: [],
    text: 'd : d',
  }
}

describe('validateScanFile', () => {
  it('rejects missing, unsupported, empty and oversized files', () => {
    expect(validateScanFile(null)).toMatch(/Choose/)
    expect(validateScanFile({ name: 'sheet.gif', size: 100 })).toMatch(/PNG/)
    expect(validateScanFile({ name: 'sheet.png', size: 0 })).toMatch(/empty/)
    expect(validateScanFile({ name: 'sheet.pdf', size: 3 })).toBeNull()
    expect(validateScanFile({ name: 'sheet.PDF', size: 26 * 1024 * 1024 })).toMatch(/25 MB/)
  })
})

describe('line and page helpers', () => {
  it('rebuilds a line while retaining original gaps', () => {
    const line = makePage().lines[0]
    expect(rebuildLineText(line)).toBe('d : d')
    const changed = {
      ...line,
      chars: line.chars.map((char) => (char.id === 'c' ? { ...char, text: 'r' } : char)),
    }
    expect(rebuildLineText(changed)).toBe('d : r')
  })

  it('patches one character without mutating the input page', () => {
    const page = makePage()
    const patched = patchPageChar(page, 'c', 'r')
    expect(patched).not.toBe(page)
    expect(page.lines[0].chars[2].text).toBe('d')
    expect(patched.lines[0].text).toBe('d : r')
    expect(patched.lines[0].chars[2]).toMatchObject({
      text: 'r',
      corrected: true,
      uncertain: false,
      confidence: 1,
    })
    expect(patched.uncertain_count).toBe(0)
    expect(countUncertain(patched)).toBe(0)
  })

  it('finds characters and ignores unknown ids', () => {
    expect(findChar(makePage(), 'b')?.char.text).toBe(':')
    expect(findChar(makePage(), 'nope')).toBeNull()
    expect(findChar(null, 'b')).toBeNull()
  })
})

describe('export helpers', () => {
  it('orders pages and adds page markers only for multipage exports', () => {
    const first = makePage()
    const second = { ...makePage(), page: 2, text: 'm : m' }
    expect(orderedPages({ 2: second, 1: first }).map((page) => page.page)).toEqual([1, 2])
    expect(pagesToText({ 1: first })).toBe('d : d')
    expect(pagesToText({ 2: second, 1: first })).toContain('--- Page 1 ---')
    expect(pagesToText({ 2: second, 1: first })).toContain('--- Page 2 ---')
    expect(pagesToPlayerText({ 2: second, 1: first })).toBe('d : d\n\nm : m')
  })

  it('builds a safe filename base', () => {
    expect(baseName('My Sheet.PDF')).toBe('My-Sheet')
    expect(baseName('sheet (final).png')).toBe('sheet-final')
    expect(baseName('???')).toBe('solfa-scan')
  })

  it('escapes SVG text and includes rules', () => {
    const page = makePage()
    page.lines[0].text = '<&'
    page.lines[0].chars[0].text = '<&'
    page.rules = [
      {
        id: 'r1',
        orientation: 'horizontal',
        x0: 0,
        y0: 30,
        x1: 90,
        y1: 30,
      },
    ]
    const svg = pagesToSvg({ 1: page })
    expect(svg).toContain('<svg')
    expect(svg).toContain('&lt;&amp;')
    expect(svg).toContain('xml:space="preserve"')
    expect(svg).toContain('<line')
    expect(svg).toContain('width="148"')

    page.lines[0].text = 'a\u0000b'
    expect(pagesToSvg({ 1: page })).toContain('>ab</text>')
  })
})
