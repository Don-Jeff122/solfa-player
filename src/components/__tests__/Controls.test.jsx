import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Controls from '../Controls.jsx'

function renderControls(overrides = {}) {
  return renderToStaticMarkup(
    createElement(Controls, {
      canPlay: true,
      isPlaying: false,
      mediaPlayback: true,
      preparing: false,
      onPlay: () => {},
      onStop: () => {},
      isPaused: false,
      onPause: () => {},
      progress: 0,
      duration: 0,
      onSeek: () => {},
      tempo: 90,
      onTempo: () => {},
      keyFromSheet: false,
      sheetKey: 'C',
      onKey: () => {},
      parts: [],
      activeParts: [],
      onTogglePart: () => {},
      onAllParts: () => {},
      onClearParts: () => {},
      onSoloPart: () => {},
      octave: 0,
      onOctave: () => {},
      voiceOctaveOf: () => 0,
      onVoiceOctave: () => {},
      sound: 'piano',
      onSound: () => {},
      sustain: 'off',
      onSustain: () => {},
      rendering: false,
      repeat: false,
      onRepeat: () => {},
      metronome: false,
      onMetronome: () => {},
      meter: null,
      canRecord: true,
      onRecord: () => {},
      wavUrl: null,
      wavName: 'solfa.wav',
      ...overrides,
    })
  )
}

function playButton(html) {
  return html.match(/<button[^>]*class="btn btn-primary"[^>]*>[\s\S]*?<\/button>/)?.[0] || ''
}

describe('Playback controls', () => {
  it('shows Preparing while background audio is prepared', () => {
    const button = playButton(renderControls({ preparing: true }))

    expect(button).toContain('Preparing…')
    expect(button).toContain('aria-busy="true"')
    expect(button).toContain('Audio is being prepared')
    expect(button).not.toContain('>Play<')
  })

  it('shows Play when audio is ready', () => {
    const button = playButton(renderControls())

    expect(button).toContain('Play')
    expect(button).not.toContain('Preparing…')
    expect(button).not.toContain('aria-busy="true"')
  })

  it('keeps Resume while paused', () => {
    const button = playButton(renderControls({ isPaused: true, preparing: true }))

    expect(button).toContain('Resume')
    expect(button).not.toContain('Preparing…')
  })
})
