import { describe, expect, it } from 'vitest'
import {
  audioChangeKind,
  audioContentKey,
  audioLiveSettingsKey,
  audioLiveWavStartTime,
  audioPlaybackRate,
  audioPlaybackSource,
  audioRenderKey,
  audioStartBeat,
} from '../keys.js'
import { parseSolfa } from '../../lib/parseSolfa.js'
import { RENDER_LEAD_SECONDS } from '../../lib/timeline.js'

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

  it('prefers media playback when prepared audio matches the content key', () => {
    const content = audioContentKey(parseSolfa('Do Re Mi').result, 'C')

    expect(audioPlaybackSource(content, content, false)).toBe('media')
    expect(audioPlaybackSource(null, content, false)).toBe('live')
    expect(audioPlaybackSource('old-content', content, false)).toBe('live')
    expect(audioPlaybackSource(content, content, true)).toBe('live')
  })

  it('converts tempo changes into a media playback rate', () => {
    expect(audioPlaybackRate(90, 90)).toBe(1)
    expect(audioPlaybackRate(90, 120)).toBeCloseTo(4 / 3, 6)
    expect(audioPlaybackRate(120, 60)).toBe(0.5)
  })

  it('converts media time into a live start beat', () => {
    expect(audioStartBeat(RENDER_LEAD_SECONDS, 120)).toBe(0)
    expect(audioStartBeat(RENDER_LEAD_SECONDS + 1, 120)).toBe(2)
    expect(audioStartBeat(0, 120)).toBe(0)
  })

  it('maps live playback position back onto a prepared WAV timeline', () => {
    const playback = { beat: 4, tempo: 120, startedAt: 1000 }

    expect(audioLiveWavStartTime(playback, 120, 1000)).toBe(RENDER_LEAD_SECONDS + 2)
    expect(audioLiveWavStartTime(playback, 120, 2000)).toBe(RENDER_LEAD_SECONDS + 3)
    expect(audioLiveWavStartTime(playback, 60, 2000)).toBe(RENDER_LEAD_SECONDS + 6)
  })

  it('excludes tempo and repeat from the live handoff key', () => {
    const base = audioLiveSettingsKey(settings)

    expect(audioLiveSettingsKey({ ...settings, tempo: 140 })).toBe(base)
    expect(audioLiveSettingsKey({ ...settings, repeat: true })).toBe(base)
    expect(audioLiveSettingsKey({ ...settings, sound: 'organ' })).not.toBe(base)
    expect(audioLiveSettingsKey({ ...settings, activeParts: ['S', 'A'] })).not.toBe(base)
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
