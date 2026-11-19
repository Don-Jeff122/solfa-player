import { describe, expect, it } from 'vitest'
import { audioChangeKind, audioContentKey, audioRenderKey } from '../keys.js'
import { parseSolfa } from '../../lib/parseSolfa.js'

const settings = {
  octave: 0,
  activeParts: ['S'],
  voiceOctaves: {},
  tempo: 90,
  sound: 'piano',
  sustain: 'medium',
  metronome: false,
}

describe('audio keys', () => {
  it('ignores formatting that does not change the parsed notes', () => {
    const compact = parseSolfa('Do Re Mi').result
    const spaced = parseSolfa('Do  Re   Mi').result

    expect(audioContentKey(spaced, 'C')).toBe(audioContentKey(compact, 'C'))
  })

  it('changes the content key when notes or key change', () => {
    const notes = parseSolfa('Do Re Mi').result
    const changedNotes = parseSolfa('Do Re Fa').result

    expect(audioContentKey(changedNotes, 'C')).not.toBe(audioContentKey(notes, 'C'))
    expect(audioContentKey(notes, 'G')).not.toBe(audioContentKey(notes, 'C'))
  })

  it('changes the render key when playback sound settings change', () => {
    const content = audioContentKey(parseSolfa('Do Re Mi').result, 'C')
    const base = audioRenderKey(content, settings)

    expect(audioRenderKey(content, { ...settings, octave: 1 })).not.toBe(base)
    expect(audioRenderKey(content, { ...settings, activeParts: ['S', 'A'] })).not.toBe(base)
    expect(audioRenderKey(content, { ...settings, voiceOctaves: { S: 1 } })).not.toBe(base)
    expect(audioRenderKey(content, { ...settings, tempo: 120 })).not.toBe(base)
    expect(audioRenderKey(content, { ...settings, sound: 'organ' })).not.toBe(base)
    expect(audioRenderKey(content, { ...settings, sustain: 'long' })).not.toBe(base)
    expect(audioRenderKey(content, { ...settings, metronome: true })).not.toBe(base)
  })

  it('does not treat repeat as a render setting', () => {
    const content = audioContentKey(parseSolfa('Do Re Mi').result, 'C')
    const base = audioRenderKey(content, settings)

    expect(audioRenderKey(content, { ...settings, repeat: true })).toBe(base)
  })

  it('classifies only note and key changes as content changes', () => {
    const content = audioContentKey(parseSolfa('Do Re Mi').result, 'C')
    const render = audioRenderKey(content, settings)
    const current = { contentKey: content, renderKey: render }

    expect(audioChangeKind(current, current)).toBe('none')
    expect(
      audioChangeKind(current, { ...current, renderKey: audioRenderKey(content, { ...settings, tempo: 120 }) })
    ).toBe('settings')
    expect(audioChangeKind(current, { ...current, contentKey: audioContentKey(parseSolfa('Do Re Fa').result, 'C') })).toBe(
      'content'
    )
    expect(audioChangeKind(current, { ...current, contentKey: audioContentKey(parseSolfa('Do Re Mi').result, 'G') })).toBe(
      'content'
    )
  })
})
