import { describe, expect, it } from 'vitest'
import { MAX_SHEETS, deleteSheet, describeSheet, loadSheets, saveSheet } from '../sheetStore.js'

/** Minimal stand-in for localStorage. */
function fakeStore(initial) {
  const map = new Map()
  if (initial != null) map.set('solfa-piano.saved-sheets.v1', initial)
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    size: () => map.size,
  }
}

const SHEET = 'Key: G\nDo Re Mi So'

describe('describeSheet', () => {
  it('names a sheet after its key and note count', () => {
    expect(describeSheet(SHEET)).toBe('G major · 4 notes')
  })

  it('counts one note in the singular', () => {
    expect(describeSheet('Do')).toBe('1 note')
  })

  it('mentions the key only when the sheet declares one', () => {
    expect(describeSheet('Do Re')).toBe('2 notes')
  })

  it('mentions multiple parts', () => {
    expect(describeSheet('Bass\nDo\nSoprano\nRe Mi')).toBe('3 notes · 2 parts')
  })

  it('falls back for a sheet that does not parse', () => {
    expect(describeSheet('Bam')).toBe('Untitled sheet')
    expect(describeSheet('')).toBe('Untitled sheet')
  })

  it('accepts an already parsed sheet', () => {
    expect(describeSheet({ ok: true, result: { key: 'C', parts: [] } })).toBe('C major · 0 notes')
  })
})

describe('saveSheet', () => {
  it('saves a sheet and reads it back', () => {
    const store = fakeStore()
    const { sheets, saved, error } = saveSheet({ name: 'Twinkle', text: SHEET }, store)

    expect(error).toBeUndefined()
    expect(saved.name).toBe('Twinkle')
    expect(sheets).toHaveLength(1)
    expect(loadSheets(store)).toEqual([
      { id: saved.id, name: 'Twinkle', text: SHEET, savedAt: saved.savedAt },
    ])
  })

  it('keeps the newest first', () => {
    const store = fakeStore()
    saveSheet({ name: 'One', text: 'Do' }, store)
    saveSheet({ name: 'Two', text: 'Re' }, store)

    expect(loadSheets(store).map((s) => s.name)).toEqual(['Two', 'One'])
  })

  it('replaces a sheet saved under the same name', () => {
    const store = fakeStore()
    const first = saveSheet({ name: 'Song', text: 'Do' }, store).saved
    const second = saveSheet({ name: 'song', text: 'Re Mi' }, store)

    expect(second.sheets).toHaveLength(1)
    expect(second.sheets[0].id).toBe(first.id)
    expect(second.sheets[0].text).toBe('Re Mi')
  })

  it('trims the name and keeps the text as typed', () => {
    const store = fakeStore()
    const { saved } = saveSheet({ name: '  Padded  ', text: 'Do  Re\n' }, store)

    expect(saved.name).toBe('Padded')
    expect(saved.text).toBe('Do  Re\n')
  })

  it('caps the library and drops the oldest', () => {
    const store = fakeStore()
    for (let i = 0; i < MAX_SHEETS + 5; i++) saveSheet({ name: `Sheet ${i}`, text: 'Do' }, store)

    const sheets = loadSheets(store)
    expect(sheets).toHaveLength(MAX_SHEETS)
    expect(sheets[0].name).toBe(`Sheet ${MAX_SHEETS + 4}`)
    expect(sheets.some((s) => s.name === 'Sheet 0')).toBe(false)
  })

  it('refuses an empty name or an empty sheet', () => {
    const store = fakeStore()

    expect(saveSheet({ name: '  ', text: SHEET }, store).error).toBe('empty')
    expect(saveSheet({ name: 'Blank', text: '   ' }, store).error).toBe('empty')
    expect(store.size()).toBe(0)
  })

  it('reports a storage failure instead of losing the sheet silently', () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }

    const { error } = saveSheet({ name: 'Big', text: SHEET }, full)
    expect(error).toBe('storage')
  })

  it('reports a storage failure when there is no storage at all', () => {
    expect(saveSheet({ name: 'Any', text: SHEET }, null).error).toBe('storage')
    expect(loadSheets(null)).toEqual([])
  })
})

describe('loadSheets', () => {
  it('reads nothing as an empty library', () => {
    expect(loadSheets(fakeStore())).toEqual([])
    expect(loadSheets(fakeStore('[]'))).toEqual([])
  })

  it('survives corrupted data', () => {
    expect(loadSheets(fakeStore('not json'))).toEqual([])
    expect(loadSheets(fakeStore('{"sheets": []}'))).toEqual([])
    expect(loadSheets(fakeStore('[1, 2, 3]'))).toEqual([])
    expect(loadSheets(fakeStore('[{"name": "No text"}]'))).toEqual([])
  })

  it('fills in a missing id and timestamp', () => {
    const sheets = loadSheets(fakeStore('[{"name": "Old", "text": "Do"}]'))

    expect(sheets[0].id).toBeTruthy()
    expect(sheets[0].savedAt).toBe(0)
  })

  it('survives a store that throws on read', () => {
    const broken = {
      getItem() {
        throw new Error('blocked')
      },
    }

    expect(loadSheets(broken)).toEqual([])
  })
})

describe('deleteSheet', () => {
  it('removes one sheet and keeps the rest', () => {
    const store = fakeStore()
    saveSheet({ name: 'Keep', text: 'Do' }, store)
    const drop = saveSheet({ name: 'Drop', text: 'Re' }, store).saved

    const sheets = deleteSheet(drop.id, store)
    expect(sheets.map((s) => s.name)).toEqual(['Keep'])
    expect(loadSheets(store)).toHaveLength(1)
  })

  it('does nothing for an unknown id', () => {
    const store = fakeStore()
    saveSheet({ name: 'Only', text: 'Do' }, store)

    expect(deleteSheet('nope', store)).toHaveLength(1)
  })
})
