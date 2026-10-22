import { HYMN_ROW_VOICES, scanHymnalLine } from './hymnal.js'
import { inkRows } from './staff/geometry.js'
import { toMask } from './staff/symbols.js'

const SUBSCRIPTS = { 1: '\u2081', 2: '\u2082', 3: '\u2083' }
const WORD_TO_LETTER = {
  sol: 's',
  do: 'd',
  re: 'r',
  mi: 'm',
  fa: 'f',
  so: 's',
  la: 'l',
  ti: 't',
}
const DOH_KEY_RE = /\bdoh\s*[:=]\s*([a-gA-G])([#b\u266d\u266f]?)/i
const KEY_RE = /\b(?:key|tonic)\s*[:=]?\s*([a-gA-G])([#b\u266d\u266f]?)/i

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function clusterValues(values, tolerance = 4) {
  const sorted = [...values].sort((a, b) => a - b)
  const clusters = []
  for (const value of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && Math.abs(value - last.x) <= tolerance) {
      last.x = (last.x * last.count + value) / (last.count + 1)
      last.count++
    } else {
      clusters.push({ x: value, count: 1 })
    }
  }
  return clusters.map((c) => c.x)
}

function bandsFromRows(rows, { minHeight, maxHeight, gap = 3 }) {
  const bands = []
  let start = -1
  let last = -1

  for (let y = 0; y <= rows.length; y++) {
    const ink = y < rows.length && rows[y]
    if (ink) {
      if (start < 0) start = y
      last = y
      continue
    }
    if (start >= 0 && y - last > gap) {
      const height = last - start + 1
      if (height >= minHeight && height <= maxHeight) {
        bands.push({ start, end: last, height })
      }
      start = -1
      last = -1
    }
  }

  return bands
}

export function findInkBands(
  luma,
  width,
  height,
  threshold,
  {
    minRatio = 0.015,
    minHeight = 5,
    maxHeight = 100,
    ignoreVertical = true,
    minStrokeHeight = 10,
    gap = 3,
  } = {}
) {
  if (!ignoreVertical) {
    const rows = inkRows(luma, width, height, threshold, minRatio)
    return bandsFromRows(rows, { minHeight, maxHeight, gap })
  }

  const ignored = new Uint8Array(width * height)
  for (let x = 0; x < width; x++) {
    let y = 0
    while (y < height) {
      if (luma[y * width + x] > threshold) {
        y++
        continue
      }
      const start = y
      while (y < height && luma[y * width + x] <= threshold) y++
      if (y - start < minStrokeHeight) continue
      for (let row = start; row < y; row++) ignored[row * width + x] = 1
    }
  }

  const need = Math.max(2, Math.round(width * minRatio))
  const rows = new Uint8ClampedArray(height)
  for (let y = 0; y < height; y++) {
    let dark = 0
    const base = y * width
    for (let x = 0; x < width; x++) {
      if (luma[base + x] <= threshold && !ignored[base + x]) dark++
    }
    rows[y] = dark >= need ? 1 : 0
  }

  return bandsFromRows(rows, { minHeight, maxHeight, gap })
}

function mergeStrokes(strokes, tolerance = 2.5) {
  const merged = []
  for (const stroke of [...strokes].sort((a, b) => a.x - b.x || a.y0 - b.y0)) {
    const hit = merged.find((other) => {
      if (Math.abs(other.x - stroke.x) > tolerance) return false
      const overlap = Math.min(other.y1, stroke.y1) - Math.max(other.y0, stroke.y0) + 1
      return overlap >= Math.min(other.height, stroke.height) * 0.4
    })
    if (!hit) {
      merged.push({ ...stroke })
      continue
    }
    const total = hit.height + stroke.height
    hit.x = (hit.x * hit.height + stroke.x * stroke.height) / total
    hit.y0 = Math.min(hit.y0, stroke.y0)
    hit.y1 = Math.max(hit.y1, stroke.y1)
    hit.height = hit.y1 - hit.y0 + 1
    hit.width = Math.max(hit.width, stroke.width)
  }
  return merged
}

export function findVerticalStrokes(
  mask,
  width,
  height,
  { y0 = 0, y1 = height - 1, minHeight = 7, maxWidth = 5 } = {}
) {
  const top = Math.max(0, Math.floor(y0))
  const bottom = Math.min(height - 1, Math.ceil(y1))
  const strokes = []

  for (let x = 0; x < width; x++) {
    let y = top
    while (y <= bottom) {
      if (!mask[y * width + x]) {
        y++
        continue
      }
      const start = y
      while (y <= bottom && mask[y * width + x]) y++
      const end = y - 1
      const runHeight = end - start + 1
      if (runHeight < minHeight) continue

      const mid = (start + end) >> 1
      let left = x
      while (left > 0 && mask[mid * width + left - 1]) left--
      let right = x
      while (right < width - 1 && mask[mid * width + right + 1]) right++
      const runWidth = right - left + 1
      if (runWidth > maxWidth) continue

      strokes.push({
        x: (left + right) / 2,
        y0: start,
        y1: end,
        height: runHeight,
        width: runWidth,
      })
    }
  }

  return mergeStrokes(strokes)
}

export function findMusicRows(
  luma,
  width,
  height,
  threshold,
  {
    minRatio = 0.015,
    minRowHeight = 6,
    maxRowHeight = 90,
    minBars = 3,
    maxBarWidth = 5,
    maxBandHeight = 100,
  } = {}
) {
  const mask = toMask(luma, width, height, threshold)
  const bands = findInkBands(luma, width, height, threshold, {
    minRatio,
    minHeight: minRowHeight,
    maxHeight: maxBandHeight,
  })
  const rows = []

  for (const band of bands) {
    if (band.height > maxRowHeight) continue
    const strokes = findVerticalStrokes(mask, width, height, {
      y0: band.start,
      y1: band.end,
      minHeight: Math.max(4, band.height * 0.48),
      maxWidth: maxBarWidth,
    })
    const bars = clusterValues(strokes.map((s) => s.x), 4)
    if (bars.length < minBars) continue
    if (bars[bars.length - 1] - bars[0] < width * 0.2) continue
    rows.push({
      top: band.start,
      bottom: band.end,
      height: band.height,
      bars,
    })
  }

  return { rows, bands, mask }
}

function sharedBarCount(rows, tolerance) {
  if (!rows.length) return 0
  return rows[0].bars.filter((x) => {
    return rows.filter((row) => row.bars.some((other) => Math.abs(other - x) <= tolerance)).length >= 3
  }).length
}

function formsSystem(rows, tolerance, maxGapRatio) {
  if (rows.length !== 4) return false
  const heights = rows.map((row) => row.height)
  if (Math.max(...heights) > Math.min(...heights) * 2) return false
  const counts = rows.map((row) => row.bars.length)
  if (Math.max(...counts) - Math.min(...counts) > 3) return false

  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].top - rows[i - 1].bottom
    const limit = Math.max(rows[i - 1].height, rows[i].height) * maxGapRatio
    if (gap < -2 || gap > limit) return false
  }

  return sharedBarCount(rows, tolerance) >= 3
}

export function findHymnalSystems(rows, { xTolerance = 4, maxGapRatio = 2.5 } = {}) {
  const systems = []
  let index = 0
  while (index <= rows.length - 4) {
    const group = rows.slice(index, index + 4)
    if (!formsSystem(group, xTolerance, maxGapRatio)) {
      index++
      continue
    }
    systems.push({
      rows: group,
      top: group[0].top,
      bottom: group[3].bottom,
    })
    index += 4
  }
  return systems
}

function clusterLongStrokes(strokes) {
  const groups = []

  for (const stroke of [...strokes].sort((a, b) => a.y0 - b.y0)) {
    let group = groups.find((candidate) => {
      const overlap =
        Math.min(candidate.bottom, stroke.y1) - Math.max(candidate.top, stroke.y0) + 1
      const shortest = Math.min(candidate.bottom - candidate.top + 1, stroke.height)
      return overlap >= Math.max(4, shortest * 0.5)
    })
    if (!group) {
      group = { top: stroke.y0, bottom: stroke.y1, strokes: [] }
      groups.push(group)
    }
    group.top = Math.min(group.top, stroke.y0)
    group.bottom = Math.max(group.bottom, stroke.y1)
    group.strokes.push(stroke)
  }

  return groups
}

export function findLongSystems(rows, mask, width, height, { xTolerance = 4 } = {}) {
  const minHeight = Math.max(24, Math.round(height * 0.045))
  const strokes = findVerticalStrokes(mask, width, height, {
    minHeight,
    maxWidth: 5,
  })
  const systems = []

  for (const group of clusterLongStrokes(strokes)) {
    const bars = clusterValues(group.strokes.map((stroke) => stroke.x), xTolerance + 2)
    if (bars.length < 4) continue

    const top = group.top
    const bottom = group.bottom
    const inside = rows.filter((row) => row.top >= top - 8 && row.bottom <= bottom + 8)
    if (inside.length < 4) continue

    const groupRows = inside
    const rowHeight = median(groupRows.map((row) => row.height))
    const barTolerance = Math.max(8, xTolerance * 2, rowHeight)
    const extent = inkExtent(mask, width, height, top, bottom)
    const edgeTolerance = Math.max(16, xTolerance * 4)
    if (extent.left < bars[0] - edgeTolerance) bars.push(extent.left)
    if (extent.right > bars[bars.length - 1] + edgeTolerance) bars.push(extent.right)
    const barLines = clusterValues(bars, barTolerance)
    if (barLines.length < 4) continue

    systems.push({
      rows: groupRows,
      top: groupRows[0].top,
      bottom: groupRows[groupRows.length - 1].bottom,
      barLines,
    })
  }

  return systems
}

function inkExtent(mask, width, height, top, bottom) {
  let left = width
  let right = -1
  const y0 = Math.max(0, top)
  const y1 = Math.min(height - 1, bottom)
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  return right < left ? { left: 0, right: width - 1 } : { left, right }
}

export function systemBarLines(system, mask, width, height, { xTolerance = 4 } = {}) {
  const clusters = []
  for (const row of system.rows) {
    for (const x of row.bars) {
      const hit = clusters.find((c) => Math.abs(c.x - x) <= xTolerance)
      if (hit) {
        hit.rows.add(row)
        hit.x = (hit.x * hit.count + x) / (hit.count + 1)
        hit.count++
      } else {
        clusters.push({ x, count: 1, rows: new Set([row]) })
      }
    }
  }

  const extent = inkExtent(mask, width, height, system.top, system.bottom)
  const values = clusters.filter((c) => c.rows.size >= 3).map((c) => c.x)
  if (!values.some((x) => Math.abs(x - extent.left) <= xTolerance)) values.push(extent.left)
  if (!values.some((x) => Math.abs(x - extent.right) <= xTolerance)) values.push(extent.right)
  return clusterValues(values, xTolerance)
}

const SOLFA_LETTERS_RE = /^[drmfslteoai]+$/

function rowSolfaScore(row, words) {
  let score = 0
  for (const word of words) {
    const centre = (word.bbox.y0 + word.bbox.y1) / 2
    if (centre < row.top || centre > row.bottom) continue
    const letters = String(word.text || '')
      .toLowerCase()
      .replace(/[^a-z]/g, '')
    if (letters && SOLFA_LETTERS_RE.test(letters)) score++
  }
  return score
}

/**
 * Pick the four solfa rows out of a system's candidate bands. Some hymnals
 * print the words between the upper and lower voice pairs, so the first four
 * bands can include a lyric line and miss the tenor or bass.
 */
export function selectVoiceRows(rows, words = []) {
  if (rows.length <= 4 || !words.length) return rows.slice(0, 4)

  const ranked = rows.map((row, index) => ({
    row,
    index,
    score: rowSolfaScore(row, words),
  }))
  ranked.sort((a, b) => b.score - a.score || a.index - b.index)
  return ranked
    .slice(0, 4)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.row)
}

export function analyzeHymnalPage(luma, width, height, threshold, options = {}) {
  const { rows, bands, mask } = findMusicRows(luma, width, height, threshold, options)
  const longSystems = findLongSystems(rows, mask, width, height, options)
  const rawSystems = longSystems.length
    ? longSystems
    : findHymnalSystems(rows, options).map((system) => ({
        ...system,
        barLines: systemBarLines(system, mask, width, height, options),
      }))
  const systems = rawSystems.map((system) => {
    const selected = selectVoiceRows(system.rows, options.words)
    return {
      ...system,
      rows: selected,
      top: selected.length ? selected[0].top : system.top,
      bottom: selected.length ? selected[selected.length - 1].bottom : system.bottom,
    }
  })
  const rowHeights = systems.flatMap((system) => system.rows.map((row) => row.height))
  const medianRowHeight = median(rowHeights)
  return {
    systems,
    rows,
    bands,
    mask,
    width,
    height,
    medianRowHeight,
    lowResolution: width < 1000 || medianRowHeight < 12,
  }
}

export function countInk(mask, width, height, { x0 = 0, x1 = width - 1, y0 = 0, y1 = height - 1 } = {}) {
  const left = Math.max(0, Math.floor(x0))
  const right = Math.min(width - 1, Math.ceil(x1))
  const top = Math.max(0, Math.floor(y0))
  const bottom = Math.min(height - 1, Math.ceil(y1))
  let ink = 0
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) ink += mask[y * width + x] ? 1 : 0
  }
  return ink
}

function isPunctuationToken(token) {
  return /^[:\-._]+$/.test(token)
}

function isReadableToken(token) {
  if (isPunctuationToken(token)) return true
  const result = scanHymnalLine(token, 1, 'OCR')
  return result.ok
}

export function normalizeHymnalOcr(raw, { cell = false } = {}) {
  let value = String(raw ?? '')
    .toLowerCase()
    .replace(/\u0131/g, '1')
    .replace(/\u2081/g, '1')
    .replace(/\u2082/g, '2')
    .replace(/\u2083/g, '3')
    .replace(/[;；]/g, ':')
    .replace(/[：]/g, ':')
    .replace(/\//g, ':')
    .replace(/[|‖]/g, ' ')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[’‘`]/g, "'")
    .replace(/[·•]/g, '.')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  value = value
    .replace(/([a-z0-9\u2081-\u2083])\s+([,'])/g, '$1$2')
    .replace(/([,'])\s+([a-z])/g, '$1$2')
  value = value.replace(/([a-z])\s*([123])(?![0-9])/g, (_, note, digit) => note + digit)
  value = value.replace(/(^|[\s])o(?=[:.\-_,']|$|\s)/g, '$10')

  if (cell) {
    value = value
      .replace(/([a-z])\s*\.\s*-\s*/g, '$1 - ')
      .replace(/\s*-\s*\.\s*/g, ' - ')
      .replace(/([a-z])\s*\.\s*:\s*/g, '$1 : ')
      .replace(/\s*\.\s*:\s*/g, ' : ')
      .replace(/:\s*\.\s*/g, ' : ')
      .replace(/:\s*i\s*-\s*:/g, ' : - : ')
      .replace(/:\s*-\s*([a-z])/g, ' : - : $1')
      .replace(/([a-z])\s*-\s*:\s*([a-z])/g, '$1 : - : $2')
      .replace(/([a-z])\s*:\s*-\s*([a-z])/g, '$1 : - : $2')
      .replace(/([a-z])([123])?\s*-\s*([a-z])/g, '$1$2 : - : $3')
      .replace(/:\s*:/g, ' : ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const kept = []
  let unreadable = 0
  for (const token of value.split(/\s+/).filter(Boolean)) {
    const cleaned = token.replace(/[^a-z0-9:._,'-]/g, '')
    if (!cleaned) continue
    if (/^\d+$/.test(cleaned)) {
      if (/^0+$/.test(cleaned)) kept.push(cleaned)
      else unreadable++
      continue
    }
    let normalized = cleaned.replace(
      /(^|[^a-z])(sol|do|re|mi|fa|so|la|ti)(?=[^a-z]|$)/g,
      (_, before, word) => before + WORD_TO_LETTER[word]
    )
    normalized = normalized.replace(/^(,{1,3})([a-z])/, (_, commas, note) => {
      return note + (SUBSCRIPTS[Math.min(3, commas.length)] || '')
    })
    const letters = normalized.replace(/[^a-z]/g, '')
    if (letters && !/^[drmfslteoai]+$/.test(letters)) {
      unreadable++
      continue
    }
    normalized = normalized.replace(
      /([a-z])([123])/g,
      (_, note, digit) => note + (SUBSCRIPTS[digit] || digit)
    )
    if (!isReadableToken(normalized)) {
      unreadable++
      continue
    }
    kept.push(normalized)
  }

  const text = kept
    .join(' ')
    .replace(/\s*:\s*/g, ' : ')
    .replace(/\s+/g, ' ')
    .trim()

  return { text, unreadable }
}

export function assembleHymnalSheet({ key, systems = [] } = {}) {
  const lines = []
  if (key) lines.push(`Doh = ${key}`)
  for (const system of systems) {
    for (const row of system.rows || []) {
      const cells = (row.cells || []).map((cell) => String(cell ?? '').trim() || '0')
      if (!cells.length) continue
      lines.push(`${row.voice}: ${cells.join(' | ')}`)
    }
  }
  return lines.join('\n')
}

export function keyFromHymnalText(text) {
  const value = String(text ?? '')
  const doh = value.match(DOH_KEY_RE)
  if (doh) return normalizeAccidental(doh[1], doh[2])
  const key = value.match(KEY_RE)
  if (key) return normalizeAccidental(key[1], key[2])
  return null
}

function normalizeAccidental(letter, accidental) {
  const mark = accidental === '\u266d' ? 'b' : accidental === '\u266f' ? '#' : accidental || ''
  return `${letter.toUpperCase()}${mark}`
}

export function defaultVoice(index) {
  return HYMN_ROW_VOICES[index % HYMN_ROW_VOICES.length].charAt(0)
}

export function isHymnalCell(text) {
  return scanHymnalLine(text, 1, 'OCR').ok
}
