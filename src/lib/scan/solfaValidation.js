import { parseSolfa } from '../parseSolfa.js'
import { assembleHymnalSheet } from './geminiSheet.js'

/**
 * Build the sheet text the player will parse and return any notation error.
 * Shared by the browser and the Worker so a model response is accepted by the
 * same rules that the player uses.
 */
export function validateSolfaSystems(systems) {
  if (!Array.isArray(systems) || !systems.length) {
    return { ok: false, text: '', error: 'Gemini found no playable solfa rows on this page.' }
  }

  const usable = []
  for (const system of systems) {
    if (!system || typeof system !== 'object' || !Array.isArray(system.rows)) continue
    const rows = []
    for (const row of system.rows) {
      if (!row || typeof row !== 'object' || !Array.isArray(row.cells)) continue
      if (!row.cells.length) continue
      rows.push({
        voice: String(row.voice ?? '').trim() || 'S',
        cells: row.cells,
      })
    }
    if (rows.length) usable.push({ rows })
  }

  if (!usable.length) {
    return { ok: false, text: '', error: 'Gemini found no playable solfa rows on this page.' }
  }

  const text = assembleHymnalSheet({ systems: usable })
  const parsed = parseSolfa(text)
  if (!parsed.ok) {
    return {
      ok: false,
      text,
      error: parsed.error?.message || 'The Gemini note rows could not be read.',
    }
  }
  if (!parsed.result?.parts?.length) {
    return { ok: false, text, error: 'Gemini found no playable solfa notes on this page.' }
  }

  return { ok: true, text, result: parsed.result }
}
