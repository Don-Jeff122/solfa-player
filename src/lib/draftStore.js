import { VOICE_OCTAVE_MAX, VOICE_OCTAVE_MIN } from './notes.js'

const STORAGE_KEY = 'solfa-piano.draft.v1'
const DRAFT_VERSION = 1
const TEMPO_MIN = 40
const TEMPO_MAX = 200

function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function clampNumber(value, min, max, fallback) {
  const number = finiteNumber(value, fallback)
  return Math.max(min, Math.min(max, number))
}

function normalizeVoiceOctaves(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [name, octave] of Object.entries(value)) {
    if (!name || !Number.isFinite(octave)) continue
    out[name] = Math.max(
      VOICE_OCTAVE_MIN,
      Math.min(VOICE_OCTAVE_MAX, Math.round(octave))
    )
  }
  return out
}

/** The last draft, or null when there is nothing useful to restore. */
export function loadDraft(store = defaultStorage()) {
  if (!store) return null
  let raw
  try {
    raw = store.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const text = typeof parsed.text === 'string' ? parsed.text : ''
  const activeSheetId =
    typeof parsed.activeSheetId === 'string' && parsed.activeSheetId
      ? parsed.activeSheetId
      : null
  if (!text.trim() && !activeSheetId) return null

  return {
    text,
    sheetName: typeof parsed.sheetName === 'string' ? parsed.sheetName : '',
    uiKey: typeof parsed.uiKey === 'string' && parsed.uiKey ? parsed.uiKey : 'C',
    tempo: Math.round(clampNumber(parsed.tempo, TEMPO_MIN, TEMPO_MAX, 90)),
    octave: Math.round(clampNumber(parsed.octave, -1, 1, 0)),
    sound: typeof parsed.sound === 'string' ? parsed.sound : '',
    sustain: typeof parsed.sustain === 'string' ? parsed.sustain : '',
    repeat: parsed.repeat === true,
    metronome: parsed.metronome === true,
    voiceOctaves: normalizeVoiceOctaves(parsed.voiceOctaves),
    partSel: Array.isArray(parsed.partSel)
      ? parsed.partSel.filter((name) => typeof name === 'string' && name)
      : null,
    activeSheetId,
    savedAt: Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0,
  }
}

/** Save the current work space. Returns false when storage is unavailable. */
export function saveDraft(draft, store = defaultStorage()) {
  if (!store || !draft || typeof draft !== 'object') return false
  const payload = {
    version: DRAFT_VERSION,
    text: typeof draft.text === 'string' ? draft.text : '',
    sheetName: typeof draft.sheetName === 'string' ? draft.sheetName : '',
    uiKey: typeof draft.uiKey === 'string' ? draft.uiKey : 'C',
    tempo: Math.round(clampNumber(draft.tempo, TEMPO_MIN, TEMPO_MAX, 90)),
    octave: Math.round(clampNumber(draft.octave, -1, 1, 0)),
    sound: typeof draft.sound === 'string' ? draft.sound : '',
    sustain: typeof draft.sustain === 'string' ? draft.sustain : '',
    repeat: draft.repeat === true,
    metronome: draft.metronome === true,
    voiceOctaves: normalizeVoiceOctaves(draft.voiceOctaves),
    partSel: Array.isArray(draft.partSel)
      ? draft.partSel.filter((name) => typeof name === 'string' && name)
      : null,
    activeSheetId:
      typeof draft.activeSheetId === 'string' && draft.activeSheetId
        ? draft.activeSheetId
        : null,
    savedAt: Date.now(),
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

/** Clear the remembered draft, for example when starting over. */
export function clearDraft(store = defaultStorage()) {
  if (!store) return
  try {
    store.removeItem(STORAGE_KEY)
  } catch {
    /* storage is blocked */
  }
}

export const DRAFT_STORAGE_KEY = STORAGE_KEY
