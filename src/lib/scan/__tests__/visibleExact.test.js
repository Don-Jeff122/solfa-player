import { describe, expect, it } from 'vitest'
import {
  visibleExactPages,
  visibleExactText,
  visibleLineCount,
} from '../visibleExact.js'

const exact = 'Doh = C\nPraise the Lord\nS: d r m f | s l t d'

describe('visibleExactText', () => {
  it('keeps the complete PDF text', () => {
    expect(visibleExactText(exact, true)).toBe(exact)
  })

  it('keeps only notes for image scans', () => {
    expect(visibleExactText(exact, false)).toBe('d r m f | s l t d')
  })

  it('handles empty input', () => {
    expect(visibleExactText(null, true)).toBe('')
    expect(visibleExactText(undefined, false)).toBe('')
  })
})

describe('visibleExactPages', () => {
  it('joins all visible page text in order', () => {
    const pages = [
      { exactText: 'Doh = C\nS: d r m' },
      { exactText: 'Doh = C\nA: f s l' },
    ]

    expect(visibleExactPages(pages, true)).toBe('Doh = C\nS: d r m\n\nDoh = C\nA: f s l')
    expect(visibleExactPages(pages, false)).toBe('d r m\n\nf s l')
  })
})

describe('visibleLineCount', () => {
  it('counts non-blank visible lines', () => {
    expect(visibleLineCount('d r m\n\nf s l\n')).toBe(2)
    expect(visibleLineCount('')).toBe(0)
  })
})
