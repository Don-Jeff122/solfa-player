import {
  analyzeHymnalPage,
  assembleHymnalSheet,
  countInk,
  defaultVoice,
  isHymnalCell,
  keyFromHymnalText,
  normalizeHymnalOcr,
} from './hymnalScan.js'
import { recognizeCanvas } from './ocrService.js'
import { parseSolfa } from './parseSolfa.js'
import { sourceTranscription } from './sourceTranscription.js'
import { otsuThreshold, toLuma } from './staff/geometry.js'

const CELL_WHITELIST = "drmfslteoai0123:.-_,' "
const DC_RE = /\bD\.?\s*C\.?/i

function wordsForCanvas(page, canvas) {
  const words = page.words || []
  const source = page.canvas
  if (!words.length || !source || !source.width || source.width === canvas.width) return words
  const scale = canvas.width / source.width
  return words.map((word) => ({
    ...word,
    bbox: {
      x0: word.bbox.x0 * scale,
      x1: word.bbox.x1 * scale,
      y0: word.bbox.y0 * scale,
      y1: word.bbox.y1 * scale,
    },
  }))
}

function analyzeCanvas(page) {
  const canvas = page.hymnalCanvas || page.canvas
  const { width, height } = canvas
  const image = canvas.getContext('2d').getImageData(0, 0, width, height)
  const luma = toLuma(image.data, width, height)
  const threshold = otsuThreshold(luma)
  if (threshold == null) {
    return { systems: [], rows: [], mask: null, width, height, medianRowHeight: 0, lowResolution: true }
  }
  return analyzeHymnalPage(luma, width, height, threshold, {
    words: wordsForCanvas(page, canvas),
  })
}

function cropCanvas(source, rect, scale) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.width * scale))
  canvas.height = Math.max(1, Math.round(rect.height * scale))
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    canvas.width,
    canvas.height
  )
  return canvas
}

function rowScale(row) {
  return Math.max(6, Math.min(8, Math.ceil(96 / Math.max(1, row.height))))
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function cellRanges(barLines) {
  const widths = barLines.slice(1).map((x, index) => x - barLines[index])
  const minWidth = Math.max(8, median(widths) * 0.4)
  const ranges = []
  for (let i = 0; i < widths.length; i++) {
    if (widths[i] < minWidth) continue
    ranges.push({ left: barLines[i], right: barLines[i + 1] })
  }
  return ranges
}

function inkColumnCount(mask, width, height, rect) {
  const left = Math.max(0, Math.floor(rect.x))
  const right = Math.min(width - 1, Math.ceil(rect.x + rect.width))
  const top = Math.max(0, Math.floor(rect.y))
  const bottom = Math.min(height - 1, Math.ceil(rect.y + rect.height))
  let columns = 0
  for (let x = left; x <= right; x++) {
    for (let y = top; y <= bottom; y++) {
      if (mask[y * width + x]) {
        columns++
        break
      }
    }
  }
  return columns
}

function binarizeCanvas(source, threshold = 190) {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const dark = (data[i] + data[i + 1] + data[i + 2]) / 3 < threshold
    data[i] = data[i + 1] = data[i + 2] = dark ? 0 : 255
    data[i + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

function assessCell(result) {
  const normalized = normalizeHymnalOcr(result.text, { cell: true })
  const notes = (normalized.text.match(/[a-z\u2081-\u2083]/g) || []).length
  return {
    result,
    normalized,
    notes,
    valid: isHymnalCell(normalized.text),
    score:
      notes * 30 +
      normalized.text.length -
      normalized.unreadable * 20 +
      (result.confidence ?? 0) / 10,
  }
}

function betterCellResult(first, second) {
  const a = assessCell(first)
  const b = assessCell(second)
  if (a.valid !== b.valid) return a.valid ? first : second
  if (a.valid) {
    if (b.notes > a.notes) return second
    if (a.notes > b.notes) return first
    return first
  }
  return b.score > a.score ? second : first
}

async function defaultOcrCell(canvas, onProgress) {
  const options = {
    onProgress,
    psm: '7',
    whitelist: CELL_WHITELIST,
    preprocess: false,
  }
  const plain = await recognizeCanvas(canvas, options)
  const sharp = await recognizeCanvas(binarizeCanvas(canvas), options)
  return betterCellResult(plain, sharp)
}

async function defaultOcrHeader(canvas, onProgress) {
  return recognizeCanvas(canvas, {
    onProgress,
    psm: '6',
    preprocess: false,
  })
}

async function readHeaderKey(page, analysis, options, warnings) {
  const fromText = keyFromHymnalText(page.text)
  if (fromText) return fromText
  if (!analysis.systems.length) return null

  const top = Math.max(0, Math.floor(analysis.systems[0].top - 2))
  if (top < 8) return null
  const headerCanvas = page.hymnalCanvas || page.canvas
  const rect = { x: 0, y: 0, width: headerCanvas.width, height: top }
  const crop = options.crop
    ? options.crop(headerCanvas, rect)
    : cropCanvas(headerCanvas, rect, 2)
  const result = await (options.ocrHeader || defaultOcrHeader)(crop, options.onProgress)
  const key = keyFromHymnalText(result.text)
  if (!key) warnings.push('No key was found. Choose the key before playing.')
  return key
}

function qualityWarnings(analysis, page, emptyCells, unreadable) {
  const warnings = []
  if (analysis.lowResolution) {
    warnings.push(
      'This scan is small. Use the original PDF or a 300 DPI image for reliable reading.'
    )
  }
  if (emptyCells > 0) {
    warnings.push(`${emptyCells} empty bar${emptyCells === 1 ? '' : 's'} were written as rests.`)
  }
  if (unreadable > 0) {
    warnings.push(`${unreadable} unreadable token${unreadable === 1 ? '' : 's'} were dropped.`)
  }
  if (DC_RE.test(page.text || '')) {
    warnings.push('D.C. is printed but is not applied yet.')
  }
  return warnings
}

export async function readHymnalPage(page, options = {}) {
  const analysis = options.analyze ? options.analyze(page) : analyzeCanvas(page)
  const sourceCanvas = page.hymnalCanvas || page.canvas
  const sourceWords = wordsForCanvas(page, sourceCanvas)
  const transcript = sourceTranscription(sourceWords, analysis.systems)
  const sourceText = transcript || String(page.text ?? '')
  const sourceKind = transcript && sourceWords.length ? 'layout' : 'raw-ocr'
  const warnings = []
  const partial = {
    mode: 'hymnal',
    ok: false,
    text: '',
    sourceText,
    sourceKind,
    key: keyFromHymnalText(page.text),
    confidence: page.confidence ?? 0,
    pages: 1,
    lineCount: 0,
    timed: false,
    staves: 0,
    matched: 0,
    unmatchedNotes: 0,
    systems: 0,
    rows: 0,
    bars: 0,
    lowResolution: analysis.lowResolution,
    warnings,
    unreadable: 0,
    emptyCells: 0,
    parseError: null,
  }

  if (!analysis.systems.length) {
    warnings.push(
      'Could not find four voice rows with barlines. Upload a clearer scan or the original PDF.'
    )
    return { ...partial, reason: 'no-layout' }
  }

  const key = await readHeaderKey(page, analysis, options, warnings)
  const systems = []
  let emptyCells = 0
  let unreadable = 0
  let confidenceSum = 0
  let confidenceCount = 0
  let barCount = 0
  let rowCount = 0

  const ocrCell = options.ocrCell || defaultOcrCell
  const crop = options.crop || cropCanvas

  for (const system of analysis.systems) {
    const ranges = cellRanges(system.barLines)
    const width = ranges.length
    if (width < 1) continue
    const rows = []

    for (let rowIndex = 0; rowIndex < system.rows.length; rowIndex++) {
      const row = system.rows[rowIndex]
      const cells = []

      for (let bar = 0; bar < width; bar++) {
        const { left, right } = ranges[bar]
        if (right - left < 2) {
          cells.push('')
          emptyCells++
          continue
        }

        const leftInset = Math.max(4, Math.round(row.height * 0.25))
        const rightInset = 1
        const rect = {
          x: Math.max(0, Math.floor(left + leftInset)),
          y: Math.max(0, Math.floor(row.top - 3)),
          width: Math.max(1, Math.ceil(right - left - leftInset - rightInset)),
          height: Math.max(1, Math.ceil(row.height + 6)),
        }

        if (rect.width < 6 || rect.height < 6) {
          cells.push('')
          emptyCells++
          continue
        }

        if (analysis.mask) {
          const ink = countInk(analysis.mask, analysis.width, analysis.height, {
            x0: rect.x,
            x1: rect.x + rect.width,
            y0: rect.y,
            y1: rect.y + rect.height,
          })
          if (ink === 0 || inkColumnCount(analysis.mask, analysis.width, analysis.height, rect) < 3) {
            cells.push('')
            emptyCells++
            continue
          }
        }

        const cropScale = rowScale(row)
        const cellCanvas = crop(sourceCanvas, rect, cropScale)
        const result = await ocrCell(cellCanvas, options.onProgress)
        const normalized = normalizeHymnalOcr(result.text, { cell: true })
        unreadable += normalized.unreadable
        confidenceSum += result.confidence ?? 0
        confidenceCount++
        if (!normalized.text) {
          cells.push('')
          emptyCells++
        } else {
          cells.push(normalized.text)
        }
      }

      rows.push({ voice: defaultVoice(rowIndex), cells })
      rowCount++
    }

    systems.push({ rows })
    barCount += width
  }

  const text = assembleHymnalSheet({ key, systems })
  const parsed = parseSolfa(text)
  const parseError = parsed.ok ? null : parsed.error?.message || 'The notes could not be read.'
  warnings.push(...qualityWarnings(analysis, page, emptyCells, unreadable))
  if (parseError) warnings.push(`Check the notes: ${parseError}`)

  return {
    ...partial,
    ok: systems.length > 0 && systems.some((system) => system.rows.some((row) => row.cells.some(Boolean))),
    text,
    sourceText,
    sourceKind,
    key,
    confidence: confidenceCount ? confidenceSum / confidenceCount : page.confidence ?? 0,
    lineCount: text.split('\n').filter(Boolean).length,
    systems: systems.length,
    systemsData: systems,
    rows: rowCount,
    bars: barCount,
    warnings,
    unreadable,
    emptyCells,
    parseError,
  }
}

export async function pagesToHymnalSolfa(pages = [], options = {}) {
  const systems = []
  const warnings = []
  let key = null
  let confidenceSum = 0
  let confidenceCount = 0
  let lowResolution = false
  let emptyCells = 0
  let unreadable = 0
  let rows = 0
  let bars = 0
  let pagesWithLayout = 0
  const sourcePages = []
  const sourceKinds = []

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    if (!page?.canvas) continue
    options.onProgress?.(`Reading the four voice rows on page ${i + 1} of ${pages.length}…`)
    const result = await readHymnalPage(page, options)
    lowResolution = lowResolution || result.lowResolution
    warnings.push(...(result.warnings || []))
    sourcePages.push(result.sourceText ?? page.text ?? '')
    sourceKinds.push(result.sourceKind || 'raw-ocr')
    if (!result.ok) continue
    pagesWithLayout++
    systems.push(...(result.systemsData || []))
    if (result.key) {
      if (key && result.key !== key) {
        warnings.push(`Page ${i + 1} names a different key (${result.key}).`)
      } else if (!key) {
        key = result.key
      }
    }
    confidenceSum += result.confidence * (result.bars || 1)
    confidenceCount += result.bars || 1
    emptyCells += result.emptyCells
    unreadable += result.unreadable
    rows += result.rows
    bars += result.bars
  }

  const sourceText = sourcePages.filter(Boolean).join('\n\n')
  const sourceKind = sourceKinds.includes('layout') ? 'layout' : 'raw-ocr'

  if (!pagesWithLayout || !systems.length) {
    return {
      mode: 'hymnal',
      ok: false,
      reason: 'no-layout',
      key,
      text: '',
      sourceText,
      sourceKind,
      lowResolution,
      warnings: [...new Set(warnings)],
      unreadable,
      emptyCells,
      systems: 0,
      rows: 0,
      bars: 0,
      parseError: null,
    }
  }

  const text = assembleHymnalSheet({ key, systems })
  const parsed = parseSolfa(text)
  const parseError = parsed.ok ? null : parsed.error?.message || 'The notes could not be read.'
  if (parseError) warnings.push(`Check the notes: ${parseError}`)

  return {
    mode: 'hymnal',
    ok: true,
    text,
    sourceText,
    sourceKind,
    key,
    confidence: confidenceCount ? confidenceSum / confidenceCount : 0,
    pages: pages.length,
    lineCount: text.split('\n').filter(Boolean).length,
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
