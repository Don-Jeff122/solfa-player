import { describe, expect, it } from 'vitest'
import { notesOnly } from '../notesOnly.js'

describe('notesOnly', () => {
  it('keeps note lines and strips headings, lyrics, key lines and part labels', () => {
    const exact = [
      'Doh = A',
      'Ancient Hymn',
      'S: d :- /m :r | d :- /s :-',
      'A: f :- /s :- | l :- /t :-',
      'Praise to the Lord, the Almighty',
      'Verse 2',
      'T: d :- /d :- | d :- /d :-',
      'B: d :- /d :- | d :- /d :-',
    ].join('\n')

    expect(notesOnly(exact)).toBe(
      [
        'd :- /m :r | d :- /s :-',
        'f :- /s :- | l :- /t :-',
        'd :- /d :- | d :- /d :-',
        'd :- /d :- | d :- /d :-',
      ].join('\n')
    )
  })

  it('keeps classic solfa lines and their printed symbols', () => {
    expect(notesOnly('Do Re Mi\n1. d :- /m :r | d :- /s :- :|')).toBe(
      'Do Re Mi\n1. d :- /m :r | d :- /s :- :|'
    )
  })

  it('keeps compact solfa text without spaces between notes', () => {
    expect(notesOnly('drmf|sltd')).toBe('drmf|sltd')
    expect(notesOnly('Simple Song\nPraise the Lord\ndrmf|sltd\nVerse 2')).toBe('drmf|sltd')
  })

  it('removes full part names and section prefixes', () => {
    expect(notesOnly('Soprano: d r m\nVerse 3: f s l')).toBe('d r m\nf s l')
  })

  it('drops meter, key and pure lyric lines', () => {
    expect(notesOnly('Key: D\nMeter: 4/4\nPraise the Lord\nd r m')).toBe('d r m')
  })

  it('returns an empty string when there are no note lines', () => {
    expect(notesOnly('Doh = A\nPraise the Lord\n')).toBe('')
  })
})
