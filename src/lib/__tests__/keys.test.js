import { describe, expect, it } from 'vitest'
import {
  dohKeyFor,
  fifthsForKey,
  keyNameForFifths,
  keySignatureForKey,
  normalizeKeyName,
  pitchClass,
  relativeMajor,
} from '../music/keys.js'

describe('music key helpers', () => {
  it('reads pitch classes and common enharmonics', () => {
    expect(pitchClass('C')).toBe(0)
    expect(pitchClass('f#')).toBe(6)
    expect(pitchClass('Bb')).toBe(10)
    expect(pitchClass('Cb')).toBe(11)
    expect(pitchClass('H')).toBeNull()
  })

  it('maps key signatures by fifths', () => {
    expect(keyNameForFifths(0, 'major')).toBe('C')
    expect(keyNameForFifths(1, 'major')).toBe('G')
    expect(keyNameForFifths(-1, 'major')).toBe('F')
    expect(keyNameForFifths(0, 'minor')).toBe('A')
    expect(keyNameForFifths(-3, 'minor')).toBe('C')
    expect(keyNameForFifths(3, 'minor')).toBe('F#')
  })

  it('normalizes supported key names', () => {
    expect(normalizeKeyName('Cb')).toBe('B')
    expect(normalizeKeyName('Ab')).toBe('G#')
    expect(normalizeKeyName('H')).toBeNull()
  })

  it('uses the relative major as Doh for minor keys', () => {
    expect(relativeMajor('A')).toBe('C')
    expect(relativeMajor('F#')).toBe('A')
    expect(dohKeyFor('A', 'minor')).toBe('C')
    expect(dohKeyFor('G', 'major')).toBe('G')
  })

  it('returns a complete key signature for major and minor keys', () => {
    expect(keySignatureForKey('G', 'major')).toMatchObject({
      fifths: 1,
      mode: 'major',
      tonic: 'G',
      dohKey: 'G',
    })
    expect(keySignatureForKey('A', 'minor')).toMatchObject({
      fifths: 0,
      mode: 'minor',
      tonic: 'A',
      dohKey: 'C',
    })
    expect(fifthsForKey('F', 'major')).toBe(-1)
    expect(fifthsForKey('A', 'minor')).toBe(0)
  })
})
