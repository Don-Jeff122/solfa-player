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
