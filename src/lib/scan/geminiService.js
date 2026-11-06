import {
  assembleHymnalSheet,
  assembleHymnalSheetLayout,
  keyFromHymnalText,
} from './geminiSheet.js'
import { validateSolfaSystems } from './solfaValidation.js'

export const GEMINI_CONSENT_KEY = 'solfa-gemini-consent-v1'

const VOICE_ORDER = ['S', 'A', 'T', 'B']
const VOICE_SET = new Set(VOICE_ORDER)
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 90000

export function geminiProxyUrl() {
  const value = import.meta.env?.VITE_GEMINI_PROXY_URL
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
}

export function isGeminiConfigured() {
  return Boolean(geminiProxyUrl())
}

export function hasGeminiConsent() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(GEMINI_CONSENT_KEY) === '1'
  } catch {
    return false
  }
}

export function rememberGeminiConsent() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(GEMINI_CONSENT_KEY, '1')
  } catch {
    /* storage may be unavailable */
  }
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function cleanLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stringList(value, limit) {
  if (!Array.isArray(value)) return []
  return value.map(cleanLine).filter(Boolean).slice(0, limit)
}

function normalizeKey(value) {
  const text = cleanLine(value)
  if (!text) return null
  const direct = keyFromHymnalText(text)
  if (direct) return direct
  const wrapped = keyFromHymnalText(`Doh = ${text}`)
  if (wrapped) return wrapped
  const match = text.match(/\b([A-G])([#b\u266d\u266f]?)\b/i)
  return match ? keyFromHymnalText(`Doh = ${match[1]}${match[2]}`) : null
}

function normalizeSystems(value) {
  if (!Array.isArray(value)) return []
  const systems = []

  for (const entry of value.slice(0, 40)) {
    if (!entry || typeof entry !== 'object') continue
    const rows = []
    const rawRows = Array.isArray(entry.rows) ? entry.rows.slice(0, 4) : []

    rawRows.forEach((row, index) => {
      if (!row || typeof row !== 'object') return
      const voice = cleanLine(row.voice).toUpperCase()
      const cells = Array.isArray(row.cells)
        ? row.cells.map(cleanLine).filter(Boolean).slice(0, 80)
        : []
      if (!cells.length) return
      rows.push({
        voice: VOICE_SET.has(voice) ? voice : VOICE_ORDER[index] || 'S',
        cells,
      })
    })

    if (!rows.length) continue
    systems.push({
      rows,
      lyrics: stringList(entry.lyrics, 8),
    })
  }

  return systems
}

export function normalizeGeminiResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Gemini returned an unreadable result.' }
  }

  const mode = raw.mode === 'solfa' || raw.mode === 'text' ? raw.mode : null
  if (!mode) {
    return { ok: false, error: 'Gemini did not say whether the page was solfa or text.' }
  }

  const systems = mode === 'solfa' ? normalizeSystems(raw.systems) : []
  const plainText = cleanText(raw.plainText)

  if (mode === 'solfa' && !systems.length) {
    return { ok: false, error: 'Gemini found no playable solfa rows on this page.' }
  }
  if (mode === 'text' && !plainText) {
    return { ok: false, error: 'Gemini returned no page text.' }
  }

  return {
    ok: true,
    value: {
      mode,
      title: cleanLine(raw.title),
      key: normalizeKey(raw.key),
      metre: cleanLine(raw.metre),
      composer: cleanLine(raw.composer),
      headerLines: stringList(raw.headerLines, 30),
      systems,
      plainText,
      warnings: stringList(raw.warnings, 20),
    },
  }
}

function headerLinesFor(value) {
  const headers = [...value.headerLines]
  const title = value.title.toLowerCase()
  if (value.title && !headers.some((line) => line.toLowerCase().includes(title))) {
    headers.unshift(value.title)
  }
  const hasKey = value.key && headers.some((line) => keyFromHymnalText(line) === value.key)
  if (value.key && !hasKey) headers.push(`Doh = ${value.key}`)
  return headers
}

export function createGeminiHymnalPage(pageNumber, value) {
  if (value?.mode !== 'solfa' || !value.systems?.length) {
    return {
      ok: false,
      error:
        'Gemini read this page as text, not playable solfa. Switch to General document mode and try again.',
    }
  }

  const key = value.key || 'C'
  const warnings = [...value.warnings]
  if (!value.key) warnings.push('No key was found; C was assumed.')
  const headerLines = headerLinesFor({ ...value, key })
  const systemsData = value.systems
  const sheetText = assembleHymnalSheetLayout({ key, headerLines, systems: systemsData })
  const validation = validateSolfaSystems(systemsData)
  const text = assembleHymnalSheet({ key, systems: systemsData })
  const parseError = validation.ok
    ? null
    : validation.error || 'The Gemini note rows could not be read.'
  if (parseError) warnings.push(`Check the notes: ${parseError}`)
  warnings.push(
    'Read by Gemini from the page image. Verify every row, key and lyric against the original.'
  )
  const bars =
    validation.ok && validation.result.parts.length
      ? Math.max(...validation.result.parts.map((part) => part.bars.length))
      : 0
  const rows = systemsData.reduce((sum, system) => sum + system.rows.length, 0)
  const page = {
    pageNumber,
    index: pageNumber - 1,
    exactText: value.plainText || sheetText,
    sheetText,
    sheetHeaderLines: headerLines,
    sourceKind: 'gemini-ai',
    mode: 'hymnal',
    key,
    playable: {
      mode: 'hymnal',
      ok: Boolean(text.trim()) && systemsData.length > 0,
      text,
      sheetText,
      sheetHeaderLines: headerLines,
      key,
      warnings: [...new Set(warnings)],
      systemsData,
      rows,
      bars,
      parseError,
      error: parseError,
    },
  }

  return { ok: true, page }
}

export function createGeminiGeneralPage(pageNumber, value) {
  const text = cleanText(value?.plainText)
  if (!text) {
    return { ok: false, error: 'Gemini returned no page text.' }
  }
  const warnings = [
    ...(value.warnings || []),
    'Read by Gemini from the page image. Verify every line against the original.',
  ]
  return {
    ok: true,
    page: {
      pageNumber,
      index: pageNumber - 1,
      exactText: text,
      sourceKind: 'gemini-ai',
      mode: 'general',
      warnings: [...new Set(warnings)],
      ok: true,
      error: null,
    },
  }
}

export async function requestGeminiScan({ blob, mode, signal } = {}) {
  const url = geminiProxyUrl()
  if (!url) throw new Error('Gemini AI is not configured for this build.')
  if (mode !== 'solfa' && mode !== 'general') {
    throw new Error('Choose Solfa sheet or General document mode first.')
  }
  if (!blob || typeof blob.arrayBuffer !== 'function') {
    throw new Error('The page image could not be prepared for Gemini.')
  }
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error('This page image is too large for Gemini. Try a lower-resolution scan.')
  }

  const mimeType = String(blob.type || 'image/jpeg').toLowerCase()
  if (!MIME_TYPES.has(mimeType)) {
    throw new Error('Gemini accepts PNG, JPEG or WebP page images.')
  }

  const data = await blobToBase64(blob)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener?.('abort', abort)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, image: { data, mimeType } }),
      signal: controller.signal,
    })
    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok) {
      throw new Error(payload?.error || 'Gemini could not read this page. Try again.')
    }
    const checked = normalizeGeminiResult(payload?.data ?? payload)
    if (!checked.ok) throw new Error(checked.error)
    return checked.value
  } catch (reason) {
    if (reason?.name === 'AbortError') {
      throw new Error('Gemini took too long to respond. Try again.')
    }
    if (reason?.name === 'TypeError') {
      throw new Error('Gemini could not be reached. Check your connection and try again.')
    }
    throw reason instanceof Error ? reason : new Error('Gemini could not read this page.')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', abort)
  }
}
