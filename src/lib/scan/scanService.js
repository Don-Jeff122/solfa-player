/**
 * Orchestrates the scanner:
 *
 *   document page -> enhanced OCR copy -> Tesseract words -> exact transcript
 *   -> separate playable interpretation -> per-page result -> merged document.
 *
 * The exact transcript is never normalized. Normalization happens only in the
 * playable copy, which the user explicitly sends to the player.
 */

import { pagesTextLayerToText } from '../pdfText.js'
import { parseSolfa } from '../parseSolfa.js'
import { recognizePages, tryTextLayer } from '../sheetRecognition.js'
import { sourceTranscription } from '../sourceTranscription.js'
import { textToSolfa } from '../ocr.js'
import { looksHymnal } from '../hymnal.js'
import { assembleHymnalSheet } from '../hymnalScan.js'
import { rhythmToSolfa } from '../staff/sheetRhythm.js'
import { prepareCanvas, cropFraction } from './canvasTools.js'
import { recognizeCanvas } from '../ocrService.js'
import { notesOnly } from './notesOnly.js'
import { uncertainWords } from './uncertainty.js'

const HYMN_ROW_RE = /^\s*[SATBL]\d*\s*[:：]/m

function layerTextFor(page) {
  return pagesTextLayerToText([{ textLayer: page.textLayer || [] }]).trim()
}

function exactFromOcr(page, playable) {
  if (playable?.sourceKind === 'layout' && playable.sourceText) {
    return playable.sourceText
  }
  const words = page.words || []
  if (words.length) {
    const transcript = sourceTranscription(words, [])
    if (transcript.trim()) return transcript
  }
  return String(page.text || '').trim()
}

function emptyResult(message) {
  return {
    mode: 'classic',
    ok: false,
    text: '',
    sourceText: '',
    sourceKind: 'raw-ocr',
    key: null,
    confidence: 0,
    pages: 0,
    pageResults: [],
    lineCount: 0,
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
    uncertain: [],
    error: message,
  }
}

/**
 * OCR and interpret a single page. The page canvas is released before this
 * resolves so a multi-page document is never held in memory all at once.
 */
export async function scanPage(document, index, options = {}) {
  const {
    onProgress,
    maxDimension = 2400,
    rotation = 0,
    autoStraighten = true,
    contrast = true,
    denoise = false,
    binarize = false,
    uncertaintyThreshold = 70,
  } = options

  const pageNumber = index + 1
  onProgress?.(`Reading page ${pageNumber}…`)
  const raw = await document.getPage(index, { maxDimension, rotation })
  const layerText = layerTextFor(raw)

  let pageResult = null
  let page = null

  if (layerText) {
    const direct = tryTextLayer(layerText, [raw])
    if (direct?.ok) {
      pageResult = direct
      page = {
        text: layerText,
        words: [],
        textLayer: raw.textLayer,
        confidence: 100,
      }
    }
  }

  if (!pageResult) {
    onProgress?.(`Preparing page ${pageNumber} for recognition…`)
    const prepared = prepareCanvas(raw.canvas, {
      autoStraighten,
      contrast,
      denoise,
      binarize: Boolean(binarize),
    })
    const ocr = await recognizeCanvas(prepared.canvas, {
      onProgress,
      psm: '6',
      preprocess: false,
    })
    page = {
      canvas: prepared.canvas,
      hymnalCanvas: null,
      text: ocr.text,
      words: ocr.words,
      confidence: ocr.confidence,
      textLayer: [],
      skewAngle: prepared.skewAngle,
      binarized: prepared.threshold != null,
    }
    const uncertainty = uncertainWords(ocr.words, { threshold: uncertaintyThreshold })
    pageResult = await recognizePages([page], { onProgress })
    pageResult = {
      ...pageResult,
      skewAngle: prepared.skewAngle,
      binarized: prepared.threshold != null,
      uncertain: uncertainty,
      uncertainCount: uncertainty.length,
    }
    prepared.canvas.width = 1
    prepared.canvas.height = 1
  }

  const exactText = layerText || exactFromOcr(page, pageResult)
  const sourceKind = layerText
    ? 'pdf-text-layer'
    : pageResult.sourceKind === 'layout'
      ? 'layout'
      : 'raw-ocr'

  if (!pageResult.ok && !exactText) {
    pageResult = {
      ...pageResult,
      ok: false,
      error:
        pageResult.error ||
        'No solfa was found on this page. Try a clearer scan, a straighter page, or the original PDF.',
    }
  }

  if (!pageResult.uncertain) {
    pageResult = { ...pageResult, uncertain: [], uncertainCount: 0 }
  }

  raw.canvas.width = 1
  raw.canvas.height = 1

  return {
    pageNumber,
    index,
    exactText,
    sourceKind,
    playable: pageResult,
    uncertainty: pageResult.uncertain || [],
    uncertaintyCount: pageResult.uncertainCount || 0,
    usedTextLayer: Boolean(layerText),
    skewAngle: page.skewAngle || 0,
    binarized: Boolean(page.binarized),
    mode: pageResult.mode,
    key: pageResult.key || null,
  }
}

/** OCR only a dragged region, without touching the page transcription. */
export async function scanRegion(document, index, selection, options = {}) {
  const {
    onProgress,
    rotation = 0,
    maxDimension = 2800,
    denoise = false,
    uncertaintyThreshold = 70,
  } = options
  onProgress?.(`Reading the selected region on page ${index + 1}…`)
  const raw = await document.getPage(index, { maxDimension, rotation })
  const crop = cropFraction(raw.canvas, selection)
  const prepared = prepareCanvas(crop, {
    autoStraighten: true,
    contrast: true,
    denoise,
    maxDimension: 2200,
    minLongSide: 900,
  })
  const ocr = await recognizeCanvas(prepared.canvas, {
    onProgress,
    psm: '6',
    preprocess: false,
  })
  const transcript = sourceTranscription(ocr.words, [])
  const text = transcript.trim() || String(ocr.text || '').trim()
  const uncertainty = uncertainWords(ocr.words, { threshold: uncertaintyThreshold })

  raw.canvas.width = 1
  raw.canvas.height = 1
  crop.width = 1
  crop.height = 1
  prepared.canvas.width = 1
  prepared.canvas.height = 1

  return {
    kind: 'region',
    pageNumber: index + 1,
    selection,
    text,
    confidence: ocr.confidence,
    uncertainty,
    uncertaintyCount: uncertainty.length,
    ok: Boolean(text),
    error: text ? null : 'No readable notation was found in that region.',
  }
}

function firstKey(results) {
  for (const result of results) {
    if (result.key) return result.key
  }
  return null
}

function mergeHymnal(pages) {
  const systems = []
  const warnings = []
  let bars = 0
  let rows = 0
  let confidenceSum = 0
  let confidenceBars = 0
  let lowResolution = false
  let unreadable = 0
  let emptyCells = 0
  const key = firstKey(pages.map((page) => page.playable))

  for (const page of pages) {
    const result = page.playable
    if (!result?.ok || !result.systemsData?.length) continue
    systems.push(...result.systemsData)
    warnings.push(...(result.warnings || []))
    bars += result.bars || 0
    rows += result.rows || 0
    lowResolution = lowResolution || Boolean(result.lowResolution)
    unreadable += result.unreadable || 0
    emptyCells += result.emptyCells || 0
    confidenceSum += (result.confidence || 0) * Math.max(1, result.bars || 1)
    confidenceBars += Math.max(1, result.bars || 1)
  }

  const text = assembleHymnalSheet({ key, systems })
  const parsed = parseSolfa(text)
  const parseError = parsed.ok ? null : parsed.error?.message || 'The notes could not be read.'
  if (parseError) warnings.push(`Check the notes: ${parseError}`)
  for (const result of pages.map((page) => page.playable)) {
    if (result?.key && key && result.key !== key) {
      warnings.push(`A page names a different key (${result.key}).`)
    }
  }

  return {
    mode: 'hymnal',
    ok: systems.length > 0 && Boolean(text.trim()),
    text,
    key,
    confidence: confidenceBars ? confidenceSum / confidenceBars : 0,
    timed: false,
    staves: 0,
    matched: 0,
    unmatchedNotes: 0,
    systems: systems.length,
    rows,
    bars,
    lowResolution,
    warnings: [...new Set(warnings)],
    unreadable,
    emptyCells,
    parseError,
  }
}

function mergeStaff(pages) {
  const byName = new Map()
  const warnings = []
  let staves = 0
  let matched = 0
  let unmatched = 0
  const key = firstKey(pages.map((page) => page.playable))

  for (const page of pages) {
    const result = page.playable
    warnings.push(...(result?.warnings || []))
    staves += result?.staves || 0
    matched += result?.matched || 0
    unmatched += result?.unmatchedNotes || 0
    for (const part of result?.parts || []) {
      const tokens = (part.tokens || []).filter(Boolean)
      if (!tokens.length) continue
      const name = part.name.toLowerCase()
      const existing = byName.get(name)
      if (existing) existing.tokens.push(...tokens)
      else byName.set(name, { name: part.name, tokens: [...tokens] })
    }
  }

  const parts = [...byName.values()]
  const text = parts.length
    ? rhythmToSolfa({ parts }, { key })
    : pages.map((page) => page.playable?.text || '').filter(Boolean).join('\n')
  const parsed = parseSolfa(text)
  const parseError = parsed.ok ? null : parsed.error?.message || 'The notes could not be read.'
  if (parseError) warnings.push(`Check the notes: ${parseError}`)

  return {
    mode: 'staff',
    ok: Boolean(text.trim()),
    text,
    key: key || (parsed.ok ? parsed.result.key : null),
    confidence:
      pages.reduce((sum, page) => sum + (page.playable?.confidence || 0), 0) /
      Math.max(1, pages.length),
    timed: true,
    staves,
    matched,
    unmatchedNotes: unmatched,
    systems: 0,
    rows: 0,
    bars: 0,
    lowResolution: pages.some((page) => page.playable?.lowResolution),
    warnings: [...new Set(warnings)],
    unreadable: pages.reduce((sum, page) => sum + (page.playable?.unreadable || 0), 0),
    emptyCells: 0,
    parseError,
  }
}

/**
 * Combine per-page results into one document result while keeping each page's
 * exact transcription separate for review.
 */
export function mergePageResults(pages = []) {
  if (!pages.length) return emptyResult('Scan a page first.')

  const ordered = [...pages].sort(
    (a, b) => (a.index ?? a.pageNumber - 1) - (b.index ?? b.pageNumber - 1)
  )
  const playablePages = ordered.map((page) => page.playable).filter(Boolean)
  const hymnalPages = ordered.filter(
    (page) => page.playable?.mode === 'hymnal' && page.playable?.systemsData?.length
  )
  const staffPages = ordered.filter((page) => page.playable?.timed)
  const textLayerPages = ordered.filter((page) => page.sourceKind === 'pdf-text-layer')

  let merged
  if (hymnalPages.length) {
    merged = mergeHymnal(hymnalPages)
  } else if (staffPages.length) {
    merged = mergeStaff(staffPages)
  } else {
    const text = playablePages.map((result) => result.text || '').filter(Boolean).join('\n')
    const parsed = parseSolfa(text)
    merged = {
      mode: textLayerPages.length === ordered.length ? 'text' : 'classic',
      ok: Boolean(text.trim()),
      text,
      key: firstKey(playablePages) || (parsed.ok ? parsed.result.key : null),
      confidence:
        playablePages.length > 0
          ? playablePages.reduce((sum, result) => sum + (result.confidence || 0), 0) /
            playablePages.length
          : 0,
      timed: false,
      staves: 0,
      matched: 0,
      unmatchedNotes: 0,
      systems: 0,
      rows: 0,
      bars: 0,
      lowResolution: ordered.some((page) => page.playable?.lowResolution),
      warnings: [...new Set(playablePages.flatMap((result) => result.warnings || []))],
      unreadable: playablePages.reduce((sum, result) => sum + (result.unreadable || 0), 0),
      emptyCells: 0,
      parseError: parsed.ok ? null : parsed.error?.message || 'The notes could not be read.',
    }
  }

  const exactText = ordered
    .map((page) => page.exactText)
    .filter(Boolean)
    .join('\n\n')
  const uncertain = ordered.flatMap((page) =>
    (page.uncertainty || []).map((entry) => ({ ...entry, page: page.pageNumber }))
  )
  const sourceKind = ordered.some((page) => page.sourceKind === 'layout')
    ? 'layout'
    : textLayerPages.length === ordered.length
      ? 'pdf-text-layer'
      : 'raw-ocr'

  const warnings = [...(merged.warnings || [])]
  if (!merged.ok && !merged.error) {
    warnings.push(
      'No playable notes were found. Check the transcription against the page, correct it, then rebuild the playable copy.'
    )
  }
  if (uncertain.length) {
    warnings.push(
      `${uncertain.length} low-confidence token${uncertain.length === 1 ? '' : 's'} need checking against the page.`
    )
  }

  return {
    ...merged,
    ok: Boolean(merged.text?.trim()),
    sourceText: exactText,
    sourceKind,
    pages: ordered.length,
    pageResults: ordered,
    lineCount: (merged.text?.trim() ? merged.text : notesOnly(exactText))
      .split('\n')
      .filter(Boolean).length,
    warnings: [...new Set(warnings)],
    uncertain,
    uncertainCount: uncertain.length,
    error: merged.ok
      ? null
      : ordered.find((page) => page.playable?.error)?.playable.error ||
        'No playable notes were found.',
  }
}

/**
 * Rebuild the playable copy after the user corrects the exact transcription.
 * No conversion happens during transfer; this only runs when the user asks for
 * it, and the corrected text remains the source of truth.
 */
export function rebuildPlayable(exactText) {
  const value = String(exactText || '').trim()
  if (!value) return { ok: false, text: '', key: null, error: 'The transcription is empty.' }
  if (looksHymnal(value) || HYMN_ROW_RE.test(value)) {
    const parsed = parseSolfa(value)
    return {
      ok: parsed.ok,
      text: value,
      key: parsed.ok ? parsed.result.key : null,
      error: parsed.ok ? null : parsed.error?.message || 'The corrected notes could not be read.',
      mode: 'hymnal',
    }
  }
  const converted = textToSolfa(value)
  if (!converted.text.trim()) {
    return {
      ok: false,
      text: '',
      key: converted.key,
      error: 'No solfa notes were found in the corrected transcription.',
      mode: 'classic',
    }
  }
  const parsed = parseSolfa(converted.text)
  return {
    ok: parsed.ok,
    text: converted.text,
    key: parsed.ok ? parsed.result.key : converted.key,
    error: parsed.ok ? null : parsed.error?.message || 'The corrected notes could not be read.',
    mode: 'classic',
  }
}

/**
 * Scan one or more pages sequentially. The caller can update the UI as each
 * page finishes; canvases are released before the next page starts.
 */
export async function scanDocument(document, indexes, options = {}) {
  const pages = []
  const total = indexes.length

  for (let i = 0; i < indexes.length; i++) {
    if (options.shouldStop?.()) break
    const index = indexes[i]
    const result = await scanPage(document, index, {
      ...options,
      onProgress: (message) => options.onProgress?.(message, { page: i + 1, total }),
    })
    pages.push(result)
    options.onPage?.(result, { page: i + 1, total })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return { pages, merged: mergePageResults(pages) }
}
