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
