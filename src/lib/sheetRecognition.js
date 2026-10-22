import { pagesToSolfa, textToSolfa } from './ocr.js'
import { pagesTextLayerToText } from './pdfText.js'
import { parseSolfa } from './parseSolfa.js'
import { pagesToRhythmSolfa } from './staff/sheetRhythm.js'
import { pagesToHymnalSolfa } from './hymnalRecognition.js'
import { keyFromHymnalText } from './hymnalScan.js'

const HYMN_CANDIDATE_RE = /\bdoh\s*[:=]|^\s*[SATB]\s*[:：]/im

function pageConfidence(pages) {
  return pages && pages.length
    ? pages.reduce((sum, page) => sum + (page?.confidence ?? 0), 0) / pages.length
    : 0
}

function resultFromText(text, pages, mode) {
  const parsed = parseSolfa(text)
  if (!parsed.ok) return null
  return {
    mode,
    ok: true,
    text,
    key: parsed.result.key || keyFromHymnalText(text),
    confidence: 100,
    pages: pages?.length || 0,
    lineCount: text.split('\n').filter(Boolean).length,
    timed: false,
    staves: 0,
    matched: 0,
    unmatchedNotes: 0,
    systems: 0,
    rows: 0,
    bars: 0,
    lowResolution: false,
    warnings: [],
    unreadable: 0,
    emptyCells: 0,
    parseError: null,
  }
}

export function tryTextLayer(textLayer, pages = []) {
  const raw = String(textLayer || '').trim()
  if (!raw) return null

  const direct = resultFromText(raw, pages, 'text')
  if (direct) return direct

  const converted = textToSolfa(raw)
  if (!converted.text.trim()) return null
  return resultFromText(converted.text, pages, 'text')
}

export async function recognizePages(pages, options = {}) {
  const { onProgress, hymnal = pagesToHymnalSolfa } = options
  const textLayer = pagesTextLayerToText(pages)
  const fromText = tryTextLayer(textLayer, pages)
  if (fromText) return fromText

  const staff = pagesToRhythmSolfa(pages)
  if (staff.timed) {
    return {
      ...staff,
      mode: 'staff',
      ok: true,
      warnings: [],
      systems: 0,
      rows: 0,
      bars: 0,
      lowResolution: false,
      emptyCells: 0,
      parseError: null,
    }
  }

  const hymnalResult = await hymnal(pages, { onProgress })
  const candidate =
    HYMN_CANDIDATE_RE.test(textLayer) ||
    pages.some((page) => HYMN_CANDIDATE_RE.test(page?.text || ''))

  if (hymnalResult.ok) {
    return { ...hymnalResult, mode: 'hymnal', warnings: hymnalResult.warnings || [] }
  }

  if (candidate) {
    return {
      ...hymnalResult,
      mode: 'hymnal',
      ok: false,
      text: '',
      confidence: pageConfidence(pages),
      error:
        'This looks like a four-part tonic solfa sheet, but I could not find its voice rows and barlines. Try a higher-resolution scan or the original PDF.',
      warnings: hymnalResult.warnings || [],
    }
  }

  const classic = pagesToSolfa(pages)
  return {
    ...classic,
    mode: 'classic',
    ok: Boolean(classic.text.trim()),
    timed: false,
    staves: 0,
    matched: 0,
    unmatchedNotes: 0,
    systems: 0,
    rows: 0,
    bars: 0,
    lowResolution: false,
    warnings: [],
    emptyCells: 0,
    parseError: null,
  }
}

export async function recognizeSheet(file, onProgress) {
  const { recognizeFile } = await import('./ocrService.js')
  const pages = await recognizeFile(file, onProgress)
  return recognizePages(pages, { onProgress })
}
