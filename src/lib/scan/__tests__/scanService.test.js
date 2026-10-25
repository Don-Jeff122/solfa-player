import { describe, expect, it } from 'vitest'
import {
  mergePageResults,
  rebuildPlayable,
  scanDocument,
  scanPage,
} from '../scanService.js'
import { uncertainWords, uncertaintyCount, worstConfidence } from '../uncertainty.js'

function classicPage(pageNumber, text, overrides = {}) {
  return {
    pageNumber,
    index: pageNumber - 1,
    exactText: overrides.exactText ?? text,
    sourceKind: overrides.sourceKind || 'pdf-text-layer',
    uncertainty: overrides.uncertainty || [],
    uncertaintyCount: (overrides.uncertainty || []).length,
    playable: {
      mode: 'classic',
      ok: true,
      text,
      key: overrides.key || null,
      confidence: overrides.confidence ?? 80,
      warnings: overrides.warnings || [],
      unreadable: overrides.unreadable || 0,
      lowResolution: false,
    },
  }
}

function hymnalPage(pageNumber, key, systems, overrides = {}) {
  return {
    pageNumber,
    index: pageNumber - 1,
    exactText: overrides.exactText || `Doh = ${key}`,
    sourceKind: 'raw-ocr',
    uncertainty: overrides.uncertainty || [],
    uncertaintyCount: (overrides.uncertainty || []).length,
    playable: {
      mode: 'hymnal',
      ok: true,
      text: '',
      key,
      confidence: overrides.confidence ?? 80,
      warnings: overrides.warnings || [],
      systemsData: systems,
      systems: systems.length,
      bars: overrides.bars ?? 2,
      rows: overrides.rows ?? 1,
      unreadable: 0,
      emptyCells: 0,
      lowResolution: false,
    },
  }
}

function textLayerDocument(pageTexts) {
  return {
    pageCount: pageTexts.length,
    async getPage(index) {
      return {
        canvas: { width: 8, height: 8 },
        textLayer: pageTexts[index].map((text) => ({ text })),
      }
    },
  }
}

describe('scanPage', () => {
  it('uses a PDF text layer without running OCR or changing the wording', async () => {
    const document = textLayerDocument([
      ['Doh = A', 'S: d :- /m :r', 'A: f :- /s :-'],
    ])
    const page = await scanPage(document, 0, { rotation: 0 })

    expect(page.usedTextLayer).toBe(true)
    expect(page.sourceKind).toBe('pdf-text-layer')
    expect(page.exactText).toBe('Doh = A\nS: d :- /m :r\nA: f :- /s :-')
    expect(page.playable.ok).toBe(true)
    expect(page.playable.key).toBe('A')
    expect(page.mode).toBe('text')
    expect(page.uncertaintyCount).toBe(0)
  })

  it('stops a multi-page scan after the page already in progress', async () => {
    const document = textLayerDocument([
      ['Do Re Mi'],
      ['Fa So La Ti'],
    ])
    let calls = 0
    const { pages } = await scanDocument(document, [0, 1], {
      shouldStop: () => calls > 0,
      onPage: () => {
        calls++
      },
    })

    expect(pages).toHaveLength(1)
    expect(pages[0].exactText).toBe('Do Re Mi')
  })
})

describe('mergePageResults', () => {
  it('reports an empty scan instead of inventing notes', () => {
    const merged = mergePageResults([])
    expect(merged.ok).toBe(false)
    expect(merged.pageResults).toEqual([])
    expect(merged.error).toMatch(/scan a page/i)
  })

  it('sorts pages and keeps the exact text separate', () => {
    const pages = [
      classicPage(2, 'f s l', {
        exactText: 'D: f s l',
        key: 'C',
        confidence: 90,
      }),
      classicPage(1, 'd r m', {
        exactText: 'D: d r m',
        key: 'C',
        confidence: 70,
      }),
    ]
    const merged = mergePageResults(pages)

    expect(merged.ok).toBe(true)
    expect(merged.mode).toBe('text')
    expect(merged.sourceKind).toBe('pdf-text-layer')
    expect(merged.text).toBe('d r m\nf s l')
    expect(merged.sourceText).toBe('D: d r m\n\nD: f s l')
    expect(merged.pages).toBe(2)
    expect(merged.pageResults).toHaveLength(2)
    expect(merged.key).toBe('C')
    expect(merged.confidence).toBe(80)
    expect(merged.lineCount).toBe(2)
  })

  it('marks mixed sources as raw OCR and keeps page-level uncertainty', () => {
    const uncertain = [
      { text: 'rn', confidence: 42, line: 1, bbox: { x0: 10, x1: 20, y0: 0, y1: 10 } },
    ]
    const merged = mergePageResults([
      classicPage(1, 'd r m', {
        sourceKind: 'layout',
        exactText: 'd rn m',
        uncertainty: uncertain,
      }),
    ])

    expect(merged.sourceKind).toBe('layout')
    expect(merged.uncertain).toEqual([{ ...uncertain[0], page: 1 }])
    expect(merged.uncertainCount).toBe(1)
    expect(merged.warnings.join(' ')).toMatch(/low-confidence token/i)
  })

  it('merges four-part systems and preserves their voice order', () => {
    const pages = [
      hymnalPage(1, 'A', [
        { rows: [{ voice: 'S', cells: ['d :- /m :r', 'd :- /s :-'] }] },
      ]),
      hymnalPage(2, 'A', [
        { rows: [{ voice: 'A', cells: ['f :- /s :-', 'l :- /t :-'] }] },
      ]),
    ]
    const merged = mergePageResults(pages)

    expect(merged.ok).toBe(true)
    expect(merged.mode).toBe('hymnal')
    expect(merged.key).toBe('A')
    expect(merged.systems).toBe(2)
    expect(merged.bars).toBe(4)
    expect(merged.text).toMatch(/S: d :- \/m :r \| d :- \/s :-/)
    expect(merged.text).toMatch(/A: f :- \/s :- \| l :- \/t :-/)
    expect(merged.text.indexOf('S:')).toBeLessThan(merged.text.indexOf('A:'))
    expect(merged.pageResults).toHaveLength(2)
  })

  it('keeps an exact-only region page and explains why it cannot play yet', () => {
    const regionPage = {
      pageNumber: 1,
      index: 0,
      exactText: 'S: d :- /m :r',
      sourceKind: 'raw-ocr',
      uncertainty: [],
      uncertaintyCount: 0,
      playable: {
        mode: 'classic',
        ok: false,
        text: '',
        key: null,
        confidence: 0,
        warnings: [],
        unreadable: 0,
        lowResolution: false,
      },
    }
    const merged = mergePageResults([regionPage])

    expect(merged.ok).toBe(false)
    expect(merged.sourceText).toBe('S: d :- /m :r')
    expect(merged.lineCount).toBe(1)
    expect(merged.pageResults).toHaveLength(1)
    expect(merged.warnings.join(' ')).toMatch(/no playable notes/i)
  })
})

describe('rebuildPlayable', () => {
  it('rebuilds classic solfa from corrected exact text', () => {
    const rebuilt = rebuildPlayable('Do Re Mi\nMi Re Do')
    expect(rebuilt.ok).toBe(true)
    expect(rebuilt.mode).toBe('classic')
    expect(rebuilt.text).toBe('do re mi\nmi re do')
  })

  it('keeps a corrected four-part sheet verbatim', () => {
    const exact = 'Doh = A\nS: d :- /m :r | d :- /s :-'
    const rebuilt = rebuildPlayable(exact)
    expect(rebuilt.ok).toBe(true)
    expect(rebuilt.mode).toBe('hymnal')
    expect(rebuilt.text).toBe(exact)
    expect(rebuilt.key).toBe('A')
  })

  it('refuses empty or unreadable corrections instead of guessing', () => {
    expect(rebuildPlayable('   ').ok).toBe(false)
    const unreadable = rebuildPlayable('hello world')
    expect(unreadable.ok).toBe(false)
    expect(unreadable.error).toMatch(/no solfa notes/i)
  })
})

describe('uncertainWords', () => {
  const words = [
    { text: 'd', confidence: 91, bbox: { x0: 0, x1: 8, y0: 0, y1: 10 } },
    { text: 'rn', confidence: 41.6, bbox: { x0: 12, x1: 24, y0: 0, y1: 10 } },
    { text: 's', confidence: 68.4, bbox: { x0: 28, x1: 36, y0: 12, y1: 22 } },
    { text: '', confidence: 10, bbox: { x0: 40, x1: 44, y0: 0, y1: 10 } },
  ]

  it('flags low-confidence words without changing their text', () => {
    expect(uncertainWords(words, { threshold: 70 })).toEqual([
      {
        text: 'rn',
        confidence: 42,
        line: 1,
        bbox: { x0: 12, x1: 24, y0: 0, y1: 10 },
      },
      {
        text: 's',
        confidence: 68,
        line: 2,
        bbox: { x0: 28, x1: 36, y0: 12, y1: 22 },
      },
    ])
  })

  it('reports the worst confidence for quick triage', () => {
    const found = uncertainWords(words, { threshold: 70 })
    expect(uncertaintyCount(found)).toBe(2)
    expect(worstConfidence(found)).toBe(42)
    expect(worstConfidence([])).toBe(null)
  })
})
