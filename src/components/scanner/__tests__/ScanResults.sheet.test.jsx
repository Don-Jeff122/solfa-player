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
    expect(html).toContain('Copy all sheets')
    expect(html).toContain('Use sheet in player')
    expect(html).not.toContain('Playable interpretation')
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
    expect(html).toContain('Copy all text')
    expect(html).not.toContain('Use sheet in player')
  })

  it('asks for the current page when it has not been read', () => {
    const html = renderResult({ pageResults: [] }, { activePage: 2 })

    expect(html).toContain('Page 2 has not been read by Gemini yet')
    expect(html).toContain('Read page 2 with Gemini')
  })
})
