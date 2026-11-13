import { parseSolfa } from './parseSolfa.js'

const STORAGE_KEY = 'solfa-piano.saved-sheets.v1'

/** Enough for a big library without filling the browser's quota. */
export const MAX_SHEETS = 50

/** localStorage, or null where it is unavailable (private mode, tests, SSR). */
function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** A readable default name, so saving never needs a name typed first. */
export function describeSheet(source) {
  const parsed =
    typeof source === 'string' ? parseSolfa(source) : source && source.ok ? source : null
  if (!parsed || !parsed.ok) return 'Untitled sheet'

  const { key, parts } = parsed.result
  const notes = parts.reduce((sum, p) => sum + p.notes.length, 0)
  const bits = []
  if (key) bits.push(`${key} major`)
  bits.push(`${notes} ${notes === 1 ? 'note' : 'notes'}`)
  if (parts.length > 1) bits.push(`${parts.length} parts`)
  return bits.join(' · ')
}

/** Every saved sheet, newest first. A missing or broken store reads as empty. */
export function loadSheets(store = defaultStorage()) {
  if (!store) return []
  let raw
  try {
    raw = store.getItem(STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((s) => s && typeof s.name === 'string' && typeof s.text === 'string')
      .map((s) => ({
        id: typeof s.id === 'string' && s.id ? s.id : newId(),
        name: s.name,
        text: s.text,
        savedAt: typeof s.savedAt === 'number' ? s.savedAt : 0,
      }))
  } catch {
    return []
  }
}

function write(sheets, store) {
  store.setItem(STORAGE_KEY, JSON.stringify(sheets))
}

/** A free name for a copy, matching saved names case-insensitively. */
export function uniqueSheetName(base, sheets) {
  const trimmed = String(base ?? '').trim() || 'Untitled sheet'
  const names = new Set(sheets.map((sheet) => sheet.name.toLowerCase()))
  if (!names.has(trimmed.toLowerCase())) return trimmed
  let copy = 1
  while (true) {
    const candidate = `${trimmed} (copy${copy === 1 ? '' : ` ${copy}`})`
    if (!names.has(candidate.toLowerCase())) return candidate
    copy += 1
  }
}

/** Undo a delete by putting the sheet back where it was. */
export function restoreSheet(sheet, index, store = defaultStorage()) {
  if (!sheet || typeof sheet.name !== 'string' || typeof sheet.text !== 'string') {
    return loadSheets(store)
  }
  const sheets = loadSheets(store)
  if (sheets.some((s) => s.id === sheet.id)) return sheets
  const entry = {
    id: typeof sheet.id === 'string' && sheet.id ? sheet.id : newId(),
    name: sheet.name,
    text: sheet.text,
    savedAt: typeof sheet.savedAt === 'number' ? sheet.savedAt : Date.now(),
  }
  const next = [...sheets]
  const at = Number.isInteger(index)
    ? Math.max(0, Math.min(index, next.length))
    : next.length
  next.splice(at, 0, entry)
  const kept = next.slice(0, MAX_SHEETS)
  try {
    write(kept, store)
    return kept
  } catch {
    return sheets
  }
}

/**
 * Store a sheet, newest first. Saving under a name that is already there
 * replaces it, so pressing Save twice updates one entry instead of piling up
 * copies.
 */
export function saveSheet({ name, text }, store = defaultStorage()) {
  const trimmed = String(name ?? '').trim()
  const body = String(text ?? '')
  if (!trimmed || !body.trim()) return { sheets: loadSheets(store), error: 'empty' }

  const sheets = loadSheets(store)
  const at = sheets.findIndex((s) => s.name.toLowerCase() === trimmed.toLowerCase())
  const entry = {
    id: at >= 0 ? sheets[at].id : newId(),
    name: trimmed,
    text: body,
    savedAt: Date.now(),
  }
  const next = at >= 0 ? [entry, ...sheets.filter((_, i) => i !== at)] : [entry, ...sheets]
  const kept = next.slice(0, MAX_SHEETS)

  try {
    write(kept, store)
    return { sheets: kept, saved: entry }
  } catch {
    return { sheets, error: 'storage' }
  }
}

/** Case-insensitive search across sheet names and notation text. */
export function searchSheets(sheets, query) {
  const term = String(query ?? '').trim().toLowerCase()
  if (!term) return sheets
  return sheets.filter(
    (sheet) =>
      sheet.name.toLowerCase().includes(term) || sheet.text.toLowerCase().includes(term)
  )
}

/** Rename a saved sheet without moving it in the library. */
export function renameSheet(id, name, store = defaultStorage()) {
  const trimmed = String(name ?? '').trim()
  const sheets = loadSheets(store)
  if (!trimmed) return { sheets, error: 'empty' }
  const at = sheets.findIndex((sheet) => sheet.id === id)
  if (at < 0) return { sheets, error: 'missing' }
  if (
    sheets.some(
      (sheet, index) => index !== at && sheet.name.toLowerCase() === trimmed.toLowerCase()
    )
  ) {
    return { sheets, error: 'duplicate' }
  }
  if (sheets[at].name === trimmed) return { sheets, sheet: sheets[at] }
  const entry = { ...sheets[at], name: trimmed }
  const next = sheets.map((sheet, index) => (index === at ? entry : sheet))
  try {
    write(next, store)
    return { sheets: next, sheet: entry }
  } catch {
    return { sheets, error: 'storage' }
  }
}

/** Copy a sheet under a free name and put the copy first. */
export function duplicateSheet(id, store = defaultStorage()) {
  const sheets = loadSheets(store)
  const original = sheets.find((sheet) => sheet.id === id)
  if (!original) return { sheets, error: 'missing' }
  const base =
    original.name.replace(/\s*\(copy(?:\s+\d+)?\)$/i, '').trim() || original.name
  const entry = {
    id: newId(),
    name: uniqueSheetName(base, sheets),
    text: original.text,
    savedAt: Date.now(),
  }
  const next = [entry, ...sheets].slice(0, MAX_SHEETS)
  try {
    write(next, store)
    return { sheets: next, sheet: entry }
  } catch {
    return { sheets, error: 'storage' }
  }
}

/** A portable backup of the whole library. */
export function exportLibrary(sheets) {
  return JSON.stringify(
    {
      app: 'solfa-piano',
      version: 1,
      exportedAt: new Date().toISOString(),
      sheets: sheets.map(({ name, text, savedAt }) => ({
        name,
        text,
        savedAt: Number.isFinite(savedAt) ? savedAt : 0,
      })),
    },
    null,
    2
  )
}

function libraryEntries(raw) {
  let parsed
  try {
    parsed = JSON.parse(String(raw ?? ''))
  } catch {
    return { error: 'invalid' }
  }
  const entries = Array.isArray(parsed) ? parsed : parsed?.sheets
  if (!Array.isArray(entries)) return { error: 'invalid' }
  const valid = entries
    .filter(
      (entry) =>
        entry &&
        typeof entry.name === 'string' &&
        entry.name.trim() &&
        typeof entry.text === 'string' &&
        entry.text.trim()
    )
    .map((entry) => ({
      name: entry.name.trim(),
      text: entry.text,
      savedAt: Number.isFinite(entry.savedAt) ? entry.savedAt : 0,
    }))
  return valid.length ? { entries: valid } : { error: 'empty' }
}

/**
 * Merge a backup into the library. Identical sheets are skipped; a name clash
 * with different notes keeps both by giving the imported one a copy suffix.
 */
export function importLibrary(raw, store = defaultStorage()) {
  const parsed = libraryEntries(raw)
  if (parsed.error) return { sheets: loadSheets(store), error: parsed.error }
  const existing = loadSheets(store)
  const working = [...existing]
  const importedIds = new Set()
  let renamed = 0
  let skipped = 0
  for (const entry of parsed.entries) {
    const clash = working.find(
      (sheet) => sheet.name.toLowerCase() === entry.name.toLowerCase()
    )
    if (clash) {
      if (clash.text === entry.text) {
        skipped += 1
        continue
      }
      const nextName = uniqueSheetName(entry.name, working)
      if (nextName !== entry.name) renamed += 1
      entry.name = nextName
    }
    const next = { id: newId(), name: entry.name, text: entry.text, savedAt: entry.savedAt }
    importedIds.add(next.id)
    working.push(next)
  }
  if (!importedIds.size) {
    return { sheets: existing, imported: 0, renamed, skipped, dropped: 0, max: MAX_SHEETS }
  }
  const sorted = [...working].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
  const kept = sorted.slice(0, MAX_SHEETS)
  const keptImported = kept.filter((sheet) => importedIds.has(sheet.id)).length
  try {
    write(kept, store)
    return {
      sheets: kept,
      imported: keptImported,
      renamed,
      skipped,
      dropped: importedIds.size - keptImported,
      max: MAX_SHEETS,
    }
  } catch {
    return { sheets: existing, error: 'storage' }
  }
}

/** Forget one sheet, leaving the rest alone. */
export function deleteSheet(id, store = defaultStorage()) {
  const sheets = loadSheets(store)
  const next = sheets.filter((s) => s.id !== id)
  if (next.length === sheets.length) return sheets
  try {
    write(next, store)
    return next
  } catch {
    return sheets
  }
}
