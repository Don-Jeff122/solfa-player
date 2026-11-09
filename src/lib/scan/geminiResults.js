import { parseSolfa } from '../parseSolfa.js'
import { assembleHymnalSheet, assembleHymnalSheetLayout } from './geminiSheet.js'

function orderedPages(pages) {
  return [...pages].sort(
    (a, b) => (a.index ?? a.pageNumber - 1) - (b.index ?? b.pageNumber - 1)
  )
}

function firstKey(pages) {
  for (const page of pages) {
    if (page.key) return page.key
  }
  return null
}

export function canMergeSolfaPages(pages = []) {
  if (!pages.length) return false
  const ordered = orderedPages(pages)
  let key = null

  for (let index = 0; index < ordered.length; index += 1) {
    const result = ordered[index].playable || ordered[index]
    if (!result?.ok) return false
    if (index > 0) {
      const previous = ordered[index - 1]
      const currentIndex = ordered[index].index ?? ordered[index].pageNumber - 1
      const previousIndex = previous.index ?? previous.pageNumber - 1
      if (currentIndex !== previousIndex + 1) return false
    }
    if (result.key) {
      if (key && result.key !== key) return false
      key = result.key
    }
  }

  return true
}

function emptyResult(mode, message) {
  return {
    mode,
    ok: false,
    text: '',
    sourceText: '',
    sheetText: '',
    sheetHeaderLines: [],
    sourceKind: 'gemini-ai',
    key: null,
    confidence: null,
    pages: 0,
    pageResults: [],
    lineCount: 0,
    warnings: [],
    uncertain: [],
    uncertainCount: 0,
    systems: 0,
    rows: 0,
    bars: 0,
    unreadable: 0,
    emptyCells: 0,
    parseError: null,
    error: message,
  }
}

export function mergeGeminiSolfaPages(pages = []) {
  if (!pages.length) return emptyResult('hymnal', 'Read a page with Gemini first.')

  const ordered = orderedPages(pages)
  const systems = []
  const warnings = []
  let sheetHeaderLines = []
  let bars = 0
  let rows = 0

  for (const page of ordered) {
    const result = page.playable || page
    if (!result?.ok || !result.systemsData?.length) continue
    if (!sheetHeaderLines.length && result.sheetHeaderLines?.length) {
      sheetHeaderLines = result.sheetHeaderLines
    }
    systems.push(...result.systemsData)
    warnings.push(...(result.warnings || []))
    bars += result.bars || 0
    rows += result.rows || 0
  }

  const key = firstKey(ordered.map((page) => page.playable || page))
  const pageSheets = ordered.map((page) => page.sheetText).filter(Boolean)
  const sheetText =
    pageSheets.length === ordered.length
      ? pageSheets.join('\n\n')
      : assembleHymnalSheetLayout({ key, headerLines: sheetHeaderLines, systems })
  const text = sheetText || assembleHymnalSheet({ key, systems })
  const parsed = parseSolfa(sheetText)
  const parseError = parsed.ok ? null : parsed.error?.message || 'The notes could not be read.'
  if (parseError) warnings.push(`Check the notes: ${parseError}`)
  for (const page of ordered) {
    const pageKey = (page.playable || page).key
    if (pageKey && key && pageKey !== key) {
      warnings.push(`A page names a different key (${pageKey}).`)
    }
  }

  const sourceText = ordered
    .map((page) => page.exactText)
    .filter(Boolean)
    .join('\n\n')
  const ok = systems.length > 0 && Boolean(sheetText.trim())

  return {
    ...emptyResult('hymnal', ok ? null : 'No playable Gemini solfa was found.'),
    ok,
    text,
    sourceText,
    sheetText,
    sheetHeaderLines,
    key,
    pages: ordered.length,
    pageResults: ordered,
    lineCount: sheetText.split('\n').filter(Boolean).length,
    warnings: [...new Set(warnings)],
    systems: systems.length,
    rows,
    bars,
    parseError,
    error: ok ? null : 'No playable Gemini solfa was found.',
  }
}

export function mergeGeminiGeneralPages(pages = []) {
  if (!pages.length) return emptyResult('general', 'Read a page with Gemini first.')

  const ordered = orderedPages(pages)
  const text = ordered
    .map((page) => page.exactText)
    .filter(Boolean)
    .join('\n\n')
  const warnings = [...new Set(ordered.flatMap((page) => page.warnings || []))]
  const ok = Boolean(text)

  return {
    ...emptyResult('general', ok ? null : 'Gemini returned no page text.'),
    ok,
    text,
    sourceText: text,
    pages: ordered.length,
    pageResults: ordered,
    lineCount: text.split('\n').filter(Boolean).length,
    warnings,
    error: ok ? null : 'Gemini returned no page text.',
  }
}
