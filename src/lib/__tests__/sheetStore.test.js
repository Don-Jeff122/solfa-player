import { describe, expect, it } from 'vitest'
import {
  MAX_SHEETS,
  deleteSheet,
  describeSheet,
  duplicateSheet,
  exportLibrary,
  importLibrary,
  loadSheets,
  renameSheet,
  restoreSheet,
  saveSheet,
  searchSheets,
  uniqueSheetName,
} from '../sheetStore.js'

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

describe('uniqueSheetName', () => {
  it('returns the name when it is free', () => {
    expect(uniqueSheetName('New song', [{ name: 'Other' }])).toBe('New song')
  })

  it('adds a copy suffix case-insensitively', () => {
    expect(uniqueSheetName('New song', [{ name: 'new SONG' }])).toBe('New song (copy)')
  })

  it('increments the copy suffix until it is free', () => {
    const sheets = [{ name: 'Song' }, { name: 'Song (copy)' }, { name: 'Song (copy 2)' }]

    expect(uniqueSheetName('Song', sheets)).toBe('Song (copy 3)')
  })

  it('falls back to a readable name for a blank base', () => {
    expect(uniqueSheetName('  ', [])).toBe('Untitled sheet')
  })
})

describe('restoreSheet', () => {
  it('puts a deleted sheet back at its original position', () => {
    const store = fakeStore()
    const one = saveSheet({ name: 'One', text: 'Do' }, store).saved
    const two = saveSheet({ name: 'Two', text: 'Re' }, store).saved
    saveSheet({ name: 'Three', text: 'Mi' }, store)
    deleteSheet(two.id, store)

    const restored = restoreSheet(two, 1, store)

    expect(restored.map((s) => s.name)).toEqual(['Three', 'Two', 'One'])
    expect(restored[1]).toEqual(two)
    expect(one.id).toBe(restored[2].id)
  })

  it('does not duplicate a sheet that is already back', () => {
    const store = fakeStore()
    const saved = saveSheet({ name: 'Only', text: 'Do' }, store).saved

    expect(restoreSheet(saved, 0, store)).toHaveLength(1)
  })

  it('leaves the library alone when storage cannot be written', () => {
    const store = fakeStore()
    const saved = saveSheet({ name: 'Only', text: 'Do' }, store).saved
    deleteSheet(saved.id, store)
    store.setItem = () => {
      throw new Error('quota exceeded')
    }

    expect(restoreSheet(saved, 0, store)).toHaveLength(0)
    expect(loadSheets(store)).toHaveLength(0)
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

describe('searchSheets', () => {
  const sheets = [
    { id: '1', name: 'Morning hymn', text: 'Do Re Mi', savedAt: 2 },
    { id: '2', name: 'Evening', text: 'So La Ti', savedAt: 1 },
  ]

  it('matches names and notation case-insensitively', () => {
    expect(searchSheets(sheets, 'MORNING').map((s) => s.id)).toEqual(['1'])
    expect(searchSheets(sheets, 'la ti').map((s) => s.id)).toEqual(['2'])
  })

  it('returns every sheet for a blank query', () => {
    expect(searchSheets(sheets, '   ')).toBe(sheets)
  })
})

describe('renameSheet', () => {
  it('renames in place without changing the notes', () => {
    const store = fakeStore()
    const saved = saveSheet({ name: 'Old', text: 'Do Re' }, store).saved
    saveSheet({ name: 'Other', text: 'Mi' }, store)

    const result = renameSheet(saved.id, '  New name  ', store)

    expect(result.error).toBeUndefined()
    expect(result.sheet.name).toBe('New name')
    expect(result.sheets.map((s) => s.name)).toEqual(['Other', 'New name'])
    expect(loadSheets(store).find((s) => s.id === saved.id).text).toBe('Do Re')
  })

  it('rejects blank, missing, duplicate and failed names', () => {
    const store = fakeStore()
    const one = saveSheet({ name: 'One', text: 'Do' }, store).saved
    saveSheet({ name: 'Two', text: 'Re' }, store)

    expect(renameSheet(one.id, ' ', store).error).toBe('empty')
    expect(renameSheet('missing', 'Name', store).error).toBe('missing')
    expect(renameSheet(one.id, 'two', store).error).toBe('duplicate')

    store.setItem = () => {
      throw new Error('quota exceeded')
    }
    expect(renameSheet(one.id, 'Three', store).error).toBe('storage')
  })
})

describe('duplicateSheet', () => {
  it('copies a sheet first under a free name', () => {
    const store = fakeStore()
    const saved = saveSheet({ name: 'Song', text: 'Do Re' }, store).saved

    const result = duplicateSheet(saved.id, store)

    expect(result.error).toBeUndefined()
    expect(result.sheet.name).toBe('Song (copy)')
    expect(result.sheet.id).not.toBe(saved.id)
    expect(result.sheet.text).toBe('Do Re')
    expect(result.sheets.map((s) => s.name)).toEqual(['Song (copy)', 'Song'])
  })

  it('reports a missing sheet', () => {
    expect(duplicateSheet('missing', fakeStore()).error).toBe('missing')
  })
})

describe('library backup', () => {
  it('exports and restores a library', () => {
    const source = fakeStore()
    saveSheet({ name: 'One', text: 'Do' }, source)
    saveSheet({ name: 'Two', text: 'Re Mi' }, source)
    const backup = exportLibrary(loadSheets(source))

    expect(JSON.parse(backup)).toMatchObject({
      app: 'solfa-piano',
      version: 1,
    })

    const target = fakeStore()
    const result = importLibrary(backup, target)

    expect(result).toMatchObject({ imported: 2, renamed: 0, skipped: 0, dropped: 0 })
    expect(loadSheets(target).map((s) => s.name)).toEqual(['Two', 'One'])
  })

  it('skips identical sheets and renames clashing imports', () => {
    const store = fakeStore()
    saveSheet({ name: 'Song', text: 'Do' }, store)
    const backup = JSON.stringify([
      { name: 'Song', text: 'Do', savedAt: 1 },
      { name: 'song', text: 'Re Mi', savedAt: 2 },
    ])

    const result = importLibrary(backup, store)

    expect(result).toMatchObject({ imported: 1, renamed: 1, skipped: 1 })
    expect(loadSheets(store).map((s) => s.name)).toEqual(['Song', 'song (copy)'])
  })

  it('rejects malformed or empty backups', () => {
    expect(importLibrary('not json', fakeStore()).error).toBe('invalid')
    expect(importLibrary('{"sheets": {}}', fakeStore()).error).toBe('invalid')
    expect(importLibrary('[]', fakeStore()).error).toBe('empty')
    expect(importLibrary('{"sheets": [{"name": " "}]}', fakeStore()).error).toBe('empty')
  })

  it('reports a storage failure without changing the library', () => {
    const store = fakeStore()
    saveSheet({ name: 'Keep', text: 'Do' }, store)
    store.setItem = () => {
      throw new Error('quota exceeded')
    }

    const result = importLibrary(JSON.stringify([{ name: 'New', text: 'Re' }]), store)

    expect(result.error).toBe('storage')
    expect(result.sheets.map((s) => s.name)).toEqual(['Keep'])
  })
})
