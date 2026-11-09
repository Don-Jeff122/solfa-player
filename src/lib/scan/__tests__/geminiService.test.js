import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  blobToBase64,
  createGeminiGeneralPage,
  createGeminiHymnalPage,
  normalizeGeminiResult,
  requestGeminiScan,
} from '../geminiService.js'
import {
  canMergeSolfaPages,
  mergeGeminiGeneralPages,
  mergeGeminiSolfaPages,
} from '../geminiResults.js'
import { parseSolfa } from '../../parseSolfa.js'

const systems = [
  {
    rows: [
      { voice: 'S', cells: ['s :s | l :l', 's :s | f :f'] },
      { voice: 'A', cells: ['d :d | d :d', 'd :d | l :l'] },
      { voice: 'T', cells: ['m :m | f :f', 'm :m | f :f'] },
      { voice: 'B', cells: ['d :d | d :d', 'd :d | d :d'] },
    ],
    lyrics: ['Mon-kam- fo Nyan-ko-pɔn'],
  },
]

const solfa = {
  mode: 'solfa',
  title: 'Nun Danket',
  key: 'Doh = F',
  metre: '6.7.6.7',
  composer: 'Joh. Crüger',
  headerLines: ['Nun Danket'],
  systems,
  plainText: '',
  warnings: [],
}

describe('Gemini result validation', () => {
  it('normalizes a structured solfa result', () => {
    const checked = normalizeGeminiResult(solfa)

    expect(checked.ok).toBe(true)
    expect(checked.value.key).toBe('F')
    expect(checked.value.systems).toHaveLength(1)
    expect(checked.value.systems[0].rows.map((row) => row.voice)).toEqual([
      'S',
      'A',
      'T',
      'B',
    ])
  })

  it('rejects solfa results without usable rows', () => {
    const checked = normalizeGeminiResult({
      ...solfa,
      systems: [{ rows: [], lyrics: [] }],
    })

    expect(checked.ok).toBe(false)
    expect(checked.error).toMatch(/no playable solfa/i)
  })

  it('rejects an unknown mode', () => {
    const checked = normalizeGeminiResult({ ...solfa, mode: 'unknown' })

    expect(checked.ok).toBe(false)
    expect(checked.error).toMatch(/solfa or text/i)
  })
})

describe('Gemini page conversion', () => {
  it('builds a hymnal page that merges with the sheet pipeline', () => {
    const checked = normalizeGeminiResult(solfa)
    const converted = createGeminiHymnalPage(1, checked.value)

    expect(converted.ok).toBe(true)
    expect(converted.page.sourceKind).toBe('gemini-ai')
    expect(converted.page.sheetText).toContain('Nun Danket')
    expect(converted.page.sheetText).toContain('Doh = F')
    expect(converted.page.playable.systemsData).toHaveLength(1)
    expect(converted.page.playable.warnings.join(' ')).toMatch(/Gemini/i)

    const merged = mergeGeminiSolfaPages([converted.page])
    expect(merged.ok).toBe(true)
    expect(merged.sourceKind).toBe('gemini-ai')
    expect(merged.mode).toBe('hymnal')
    expect(parseSolfa(merged.sheetText).ok).toBe(true)
    expect(merged.sheetText).toContain('Mon-kam- fo Nyan-ko-pɔn')
  })

  it('marks an invalid Gemini note as needing correction', () => {
    const checked = normalizeGeminiResult({
      ...solfa,
      systems: [
        {
          rows: [
            { voice: 'S', cells: ['d :d | r :r'] },
            { voice: 'A', cells: ['s :s | l :l'] },
            { voice: 'T', cells: ['m :m | f :f'] },
            { voice: 'B', cells: ['d :d | n :n'] },
          ],
          lyrics: [],
        },
      ],
    })
    const converted = createGeminiHymnalPage(1, checked.value)

    expect(converted.ok).toBe(true)
    expect(converted.page.playable.parseError).toMatch(/Unrecognized note "n"/)
    expect(converted.page.playable.warnings.join(' ')).toMatch(/Check the notes/)

    const merged = mergeGeminiSolfaPages([converted.page])
    expect(merged.parseError).toMatch(/Unrecognized note "n"/)
    expect(merged.warnings.join(' ')).toMatch(/Check the notes/)
  })

  it('does not turn a text result into a solfa page', () => {
    const converted = createGeminiHymnalPage(1, {
      ...solfa,
      mode: 'text',
      systems: [],
      plainText: 'Praise the Lord',
    })

    expect(converted.ok).toBe(false)
    expect(converted.error).toMatch(/General document mode/i)
  })

  it('builds a general text page that merges with the Gemini pipeline', () => {
    const converted = createGeminiGeneralPage(2, {
      mode: 'text',
      title: '',
      key: null,
      metre: '',
      composer: '',
      headerLines: [],
      systems: [],
      plainText: 'First line\nSecond line',
      warnings: [],
    })

    expect(converted.ok).toBe(true)
    expect(converted.page.sourceKind).toBe('gemini-ai')
    expect(converted.page.exactText).toBe('First line\nSecond line')

    const merged = mergeGeminiGeneralPages([converted.page])
    expect(merged.ok).toBe(true)
    expect(merged.sourceKind).toBe('gemini-ai')
    expect(merged.text).toBe('First line\nSecond line')
  })
})

describe('Gemini multi-page grouping', () => {
  function page(pageNumber, key = 'F', ok = true) {
    return {
      pageNumber,
      index: pageNumber - 1,
      playable: { ok, key, parseError: null },
    }
  }

  it('allows consecutive pages that share a key', () => {
    expect(canMergeSolfaPages([page(1), page(2), page(3)])).toBe(true)
  })

  it('rejects different keys, gaps and invalid pages', () => {
    expect(canMergeSolfaPages([page(1, 'F'), page(2, 'G')])).toBe(false)
    expect(canMergeSolfaPages([page(1), page(3)])).toBe(false)
    expect(canMergeSolfaPages([page(1), page(2, 'F', false)])).toBe(false)
  })
})

describe('Gemini image encoding', () => {
  it('encodes a page blob as base64', async () => {
    const blob = new Blob(['page'], { type: 'image/jpeg' })
    expect(await blobToBase64(blob)).toBe('cGFnZQ==')
  })
})

describe('Gemini proxy request', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const textResult = {
    mode: 'text',
    title: '',
    key: '',
    metre: '',
    composer: '',
    headerLines: [],
    systems: [],
    plainText: 'Praise the Lord',
    warnings: [],
  }

  it('posts the current page to the configured proxy', async () => {
    vi.stubEnv('VITE_GEMINI_PROXY_URL', 'https://proxy.test/')
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: textResult }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestGeminiScan({
      blob: new Blob(['page'], { type: 'image/jpeg' }),
      mode: 'general',
    })

    expect(result.plainText).toBe('Praise the Lord')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://proxy.test')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      mode: 'general',
      image: { data: 'cGFnZQ==', mimeType: 'image/jpeg' },
    })
  })

  it('reports an unreachable proxy without leaking the raw fetch error', async () => {
    vi.stubEnv('VITE_GEMINI_PROXY_URL', 'https://proxy.test')
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    await expect(
      requestGeminiScan({
        blob: new Blob(['page'], { type: 'image/jpeg' }),
        mode: 'general',
      })
    ).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('keeps the proxy status and retry hint on HTTP errors', async () => {
    vi.stubEnv('VITE_GEMINI_PROXY_URL', 'https://proxy.test')
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Gemini request limit reached.' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '10',
        },
      })
    ))

    await expect(
      requestGeminiScan({
        blob: new Blob(['page'], { type: 'image/jpeg' }),
        mode: 'general',
      })
    ).rejects.toMatchObject({
      message: 'Gemini request limit reached.',
      status: 429,
      retryAfter: '10',
    })
  })

  it('reports a caller cancellation separately from a timeout', async () => {
    vi.stubEnv('VITE_GEMINI_PROXY_URL', 'https://proxy.test')
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      if (options.signal.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }
      return new Response(JSON.stringify({ data: textResult }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))
    const controller = new AbortController()
    controller.abort()

    await expect(
      requestGeminiScan({
        blob: new Blob(['page'], { type: 'image/jpeg' }),
        mode: 'general',
        signal: controller.signal,
      })
    ).rejects.toMatchObject({
      name: 'AbortError',
      code: 'CANCELED',
    })
  })

  it('rejects unsupported images and unconfigured builds', async () => {
    vi.stubEnv('VITE_GEMINI_PROXY_URL', 'https://proxy.test')

    await expect(
      requestGeminiScan({
        blob: new Blob(['page'], { type: 'image/gif' }),
        mode: 'general',
      })
    ).rejects.toThrow(/PNG, JPEG or WebP/i)

    vi.stubEnv('VITE_GEMINI_PROXY_URL', '')
    await expect(
      requestGeminiScan({
        blob: new Blob(['page'], { type: 'image/jpeg' }),
        mode: 'general',
      })
    ).rejects.toThrow(/not configured/i)
  })
})
