import { RENDER_LEAD_SECONDS } from '../lib/timeline.js'

export function audioChangeKind(previous, current) {
  if (previous.contentKey !== current.contentKey) return 'content'
  if (previous.renderKey !== current.renderKey) return 'settings'
  return 'none'
}

export function audioContentKey(result, key) {
  return JSON.stringify({
    key,
    meter: result?.meter ?? null,
    parts: result?.parts ?? [],
  })
}

export function audioPlaybackRate(renderTempo, tempo) {
  const base = Number(renderTempo) > 0 ? Number(renderTempo) : 90
  const target = Number(tempo) > 0 ? Number(tempo) : base
  return target / base
}

export function audioStartBeat(currentTime, renderTempo) {
  const tempo = Number(renderTempo) > 0 ? Number(renderTempo) : 90
  return Math.max(0, ((Number(currentTime) || 0) - RENDER_LEAD_SECONDS) / (60 / tempo))
}

export function audioLiveWavStartTime(playback, renderTempo, now) {
  const beat = Math.max(0, Number(playback?.beat) || 0)
  const tempo = Number(playback?.tempo) > 0 ? Number(playback.tempo) : 90
  const startedAt = Number(playback?.startedAt) || 0
  const elapsedBeats = Math.max(0, (Number(now) || 0) - startedAt) / 1000 / (60 / tempo)
  const base = Number(renderTempo) > 0 ? Number(renderTempo) : tempo
  return RENDER_LEAD_SECONDS + (beat + elapsedBeats) * (60 / base)
}

export function audioLiveSettingsKey(settings) {
  const { octave, activeParts, voiceOctaves, sound, sustain, metronome } = settings
  return JSON.stringify({ octave, activeParts, voiceOctaves, sound, sustain, metronome })
}

export function audioPlaybackSource(cacheKey, contentKey, liveFallback = false) {
  return !liveFallback && cacheKey === contentKey ? 'media' : 'live'
}

export function audioRenderKey(contentKey, settings) {
  const { octave, activeParts, voiceOctaves, tempo, sound, sustain, metronome } = settings
  return JSON.stringify({
    contentKey,
    octave,
    activeParts,
    voiceOctaves,
    tempo,
    sound,
    sustain,
    metronome,
  })
}
