import { describe, expect, it } from 'vitest'
import {
  DRAFT_STORAGE_KEY,
  clearDraft,
  loadDraft,
  saveDraft,
} from '../draftStore.js'

function fakeStore(initial) {
  const map = new Map()
  if (initial != null) map.set(DRAFT_STORAGE_KEY, initial)
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

describe('draftStore', () => {
  it('round-trips the current workspace', () => {
    const store = fakeStore()
    const saved = saveDraft(
      {
        text: 'Key: G\nDo Re Mi',
        sheetName: 'Practice',
        uiKey: 'G',
        tempo: 75,
        octave: -1,
        sound: 'organ',
        sustain: 'long',
        repeat: true,
        metronome: false,
        voiceOctaves: { Soprano: 1, Bass: -2 },
        partSel: ['Soprano', 'Bass'],
        activeSheetId: 'sheet-1',
      },
      store
    )

    expect(saved).toBe(true)
    expect(loadDraft(store)).toMatchObject({
      text: 'Key: G\nDo Re Mi',
      sheetName: 'Practice',
      uiKey: 'G',
      tempo: 75,
      octave: -1,
      sound: 'organ',
      sustain: 'long',
      repeat: true,
      metronome: false,
      voiceOctaves: { Soprano: 1, Bass: -2 },
      partSel: ['Soprano', 'Bass'],
      activeSheetId: 'sheet-1',
    })
  })

  it('normalizes out-of-range settings and bad values', () => {
    const draft = loadDraft(
      fakeStore(
        JSON.stringify({
          text: 'Do',
          tempo: 999,
          octave: 4,
          voiceOctaves: { Alto: 99, Tenor: 'x' },
          partSel: ['Alto', 4, ''],
        })
      )
    )

    expect(draft.tempo).toBe(200)
    expect(draft.octave).toBe(1)
    expect(draft.voiceOctaves).toEqual({ Alto: 3 })
    expect(draft.partSel).toEqual(['Alto'])
  })

  it('ignores missing, broken, or empty drafts', () => {
    expect(loadDraft(fakeStore())).toBeNull()
    expect(loadDraft(fakeStore('not json'))).toBeNull()
    expect(loadDraft(fakeStore(JSON.stringify({ text: '   ' })))).toBeNull()
    expect(loadDraft(null)).toBeNull()
  })

  it('survives a blocked store', () => {
    const blocked = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
      removeItem() {
        throw new Error('blocked')
      },
    }

    expect(loadDraft(blocked)).toBeNull()
    expect(saveDraft({ text: 'Do' }, blocked)).toBe(false)
    expect(() => clearDraft(blocked)).not.toThrow()
  })

  it('clears the remembered draft', () => {
    const store = fakeStore()
    saveDraft({ text: 'Do' }, store)
    clearDraft(store)

    expect(loadDraft(store)).toBeNull()
  })
})
