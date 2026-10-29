import { describe, expect, it } from 'vitest'
import { pagesTextLayerToText, textItemsToLines } from '../pdfText.js'

function item(str, x, y, width = str.length * 8, height = 10) {
  return { str, width, height, transform: [height, 0, 0, height, x, y] }
}

describe('PDF text layers', () => {
  it('groups items into lines and keeps word gaps', () => {
    const lines = textItemsToLines([
      item('S:', 10, 200, 12),
      item('d r', 30, 201, 20),
      item('|', 60, 200, 4),
      item('m', 70, 200, 8),
      item('Doh = A', 100, 180, 60),
    ])

    expect(lines.map((line) => line.text)).toEqual(['S: d r | m', 'Doh = A'])
  })

  it('sorts pages and accepts raw strings', () => {
    expect(
      pagesTextLayerToText([
        { textLayer: [{ text: 'Doh = A' }, { text: 'S: d | r' }] },
        { textLayer: ['A: f | s'] },
        { textLayer: [] },
      ])
    ).toBe('Doh = A\nS: d | r\nA: f | s')
  })

  it('ignores blank items', () => {
    expect(textItemsToLines([item(' ', 10, 10), item('d', 20, 10)])).toHaveLength(1)
    expect(pagesTextLayerToText([])).toBe('')
  })
})
