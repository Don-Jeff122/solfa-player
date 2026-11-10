import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ScanResults from '../ScanResults.jsx'

const sheet = [
  'Nun Danket',
  'Doh = F     6.7.6.7.6.6.6.6.     Joh. Cruger, 1645',
  '{ | s | s :s / l :l |',
  '  | d | d :d / d :d |',
  '  | m | m :m / f :f |',
  '  | d | d :d / d :d |',
  '  Mon-kam- fo Nyan-ko-pon',
  '}',
].join('\n')

function geminiPage(overrides = {}) {
  return {
    pageNumber: 1,
    index: 0,
    exactText: sheet,
    sheetText: sheet,
    sourceKind: 'gemini-ai',
    mode: 'hymnal',
    key: 'F',
    warnings: [],
    playable: {
      mode: 'hymnal',
      ok: true,
      text: '',
      key: 'F',
      sheetHeaderLines: ['Nun Danket', 'Doh = F'],
      systemsData: [],
      warnings: [],
      bars: 4,
      rows: 4,
    },
    ...overrides,
  }
}

function renderResult(overrides = {}, propOverrides = {}) {
  const result = {
    mode: 'hymnal',
    ok: true,
    text: sheet,
    sheetText: sheet,
    sheetHeaderLines: ['Nun Danket', 'Doh = F'],
    sourceText: sheet,
    sourceKind: 'gemini-ai',
    key: 'F',
    pages: 1,
    bars: 4,
    warnings: [],
    pageResults: [geminiPage()],
    ...overrides,
  }

  return renderToStaticMarkup(
    createElement(ScanResults, {
      result,
      activePage: 1,
      pageCount: 1,
      scanMode: 'solfa',
      error: null,
      geminiBusy: false,
      onTextChange: () => {},
      onUse: () => {},
      onPageChange: () => {},
      onReadGemini: () => {},
      ...propOverrides,
    })
  )
}

describe('Gemini ScanResults', () => {
  it('shows the Gemini sheet as the primary editable result', () => {
    const html = renderResult()

    expect(html).toContain('Gemini solfa sheet')
    expect(html).toContain('Nun Danket')
    expect(html).toContain('Read by Gemini')
    expect(html).toContain('Copy sheet')
    expect(html).toContain('Use sheet in player')
    expect(html).not.toContain('Playable interpretation')
  })

  it('disables the player action while a sheet needs correction', () => {
    const html = renderResult({
      parseError: 'Unrecognized note "n" on line 14 (part "Bass").',
    })

    expect(html).toContain('needs correction')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Use sheet in player<\/button>/)
  })

  it('shows general document text without player actions', () => {
    const textPage = geminiPage({
      exactText: 'First line\nSecond line',
      sheetText: '',
      mode: 'general',
    })
    const html = renderResult(
      {
        mode: 'general',
        text: 'First line\nSecond line',
        sheetText: '',
        pageResults: [textPage],
      },
      { scanMode: 'general' }
    )

    expect(html).toContain('Document transcription')
    expect(html).toContain('First line')
    expect(html).toContain('Copy page text')
    expect(html).not.toContain('Use sheet in player')
  })

  it('offers one combined copy for multiple general pages', () => {
    const first = geminiPage({
      exactText: 'First page',
      sheetText: '',
      mode: 'general',
      playable: undefined,
    })
    const second = geminiPage({
      pageNumber: 2,
      index: 1,
      exactText: 'Second page',
      sheetText: '',
      mode: 'general',
      playable: undefined,
    })
    const html = renderResult(
      {
        mode: 'general',
        text: 'First page\n\nSecond page',
        sheetText: '',
        key: null,
        pages: 2,
        pageResults: [first, second],
      },
      { activePage: 2, pageCount: 2, scanMode: 'general' }
    )

    expect(html).toContain('Copy all 2 pages')
    expect(html).toContain('Copy page 2')
    expect(html).toContain('Download all .txt')
    expect(html).not.toContain('Use page 2 in player')
  })

  it('asks for the current page when it has not been read', () => {
    const html = renderResult({ pageResults: [] }, { activePage: 2 })

    expect(html).toContain('Page 2 has not been read by Gemini yet')
    expect(html).toContain('Read page 2 with Gemini')
  })

  it('offers per-page and safe all-page player actions', () => {
    const html = renderResult(
      {
        pages: 2,
        pageResults: [
          geminiPage(),
          geminiPage({ pageNumber: 2, index: 1 }),
        ],
      },
      {
        activePage: 2,
        pageCount: 3,
        onUseAll: () => {},
        canMergeAll: true,
        onReadAll: () => {},
        remainingCount: 2,
        readAllLabel: 'Read remaining 2 pages',
      }
    )

    expect(html).toContain('Use page 2 in player')
    expect(html).toContain('Use all pages in player')
    expect(html).toContain('Read remaining 2 pages')
    expect(html).toContain('Copy all 2 pages')
    expect(html).toContain('Download all .txt')
    expect(html).toContain('Copy page 2')
  })

  it('offers a combined copy when pages name different keys', () => {
    const html = renderResult(
      {
        pages: 2,
        pageResults: [
          geminiPage(),
          geminiPage({
            pageNumber: 2,
            index: 1,
            key: 'G',
            sheetText: sheet.replace('Doh = F', 'Doh = G'),
            playable: { ...geminiPage().playable, key: 'G' },
          }),
        ],
      },
      { activePage: 2, pageCount: 2 }
    )

    expect(html).toContain('Copy all 2 pages')
    expect(html).toContain('Pages name different keys (F, G)')
    expect(html).toContain('first key, F')
  })

  it('offers a combined copy while the active page is unread', () => {
    const html = renderResult(
      {
        pages: 2,
        pageResults: [
          geminiPage(),
          geminiPage({ pageNumber: 2, index: 1 }),
        ],
      },
      { activePage: 3, pageCount: 3 }
    )

    expect(html).toContain('Page 3 has not been read by Gemini yet')
    expect(html).toContain('Copy all 2 pages')
    expect(html).toContain('Page 3 was not read')
  })

  it('lists failed pages and offers a retry', () => {
    const html = renderResult(
      {},
      {
        onRetryFailed: () => {},
        failedPages: [{ pageNumber: 2, message: 'Gemini is busy.' }],
        remainingCount: 2,
        readAllLabel: 'Read remaining 2 pages',
      }
    )

    expect(html).toContain('1 page could not be read')
    expect(html).toContain('Page 2: Gemini is busy.')
    expect(html).toContain('Retry failed (1)')
  })

  it('lists failed pages even when no page was read', () => {
    const html = renderToStaticMarkup(
      createElement(ScanResults, {
        result: null,
        activePage: 1,
        pageCount: 3,
        scanMode: 'solfa',
        error: null,
        geminiBusy: false,
        onTextChange: () => {},
        onUse: () => {},
        onPageChange: () => {},
        onReadGemini: () => {},
        onReadAll: () => {},
        remainingCount: 3,
        readAllLabel: 'Retry 1 failed page',
        failedPages: [{ pageNumber: 1, message: 'Gemini is busy.' }],
      })
    )

    expect(html).toContain('1 page could not be read')
    expect(html).toContain('Page 1: Gemini is busy.')
    expect(html).toContain('Retry 1 failed page')
  })
})
