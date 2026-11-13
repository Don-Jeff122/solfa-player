import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MobileTransport from '../MobileTransport.jsx'

function renderTransport(overrides = {}) {
  return renderToStaticMarkup(
    createElement(MobileTransport, {
      canPlay: true,
      isPlaying: false,
      isPaused: false,
      mediaPlayback: true,
      preparing: false,
      progress: 0,
      duration: 60,
      tempo: 90,
      onPlay: () => {},
      onPause: () => {},
      onStop: () => {},
      onSeek: () => {},
      onTempo: () => {},
      ...overrides,
    })
  )
}

describe('MobileTransport', () => {
  it('shows Play, time and tempo when idle', () => {
    const html = renderTransport()

    expect(html).toContain('Practice player')
    expect(html).toContain('>Play<')
    expect(html).toContain('0:00')
    expect(html).toContain('1:00')
    expect(html).toContain('Tempo')
  })

  it('shows the preparing state', () => {
    const html = renderTransport({ preparing: true })

    expect(html).toContain('Preparing…')
    expect(html).toContain('aria-busy="true"')
  })

  it('shows Pause and Stop during media playback', () => {
    const html = renderTransport({ isPlaying: true })

    expect(html).toContain('Pause')
    expect(html).toContain('Stop')
    expect(html).not.toContain('>Play<')
  })

  it('shows only Stop when live fallback cannot pause', () => {
    const html = renderTransport({ isPlaying: true, mediaPlayback: false })

    expect(html).not.toContain('Pause')
    expect(html).toContain('Stop')
  })

  it('shows Resume and Stop while paused', () => {
    const html = renderTransport({ isPaused: true })

    expect(html).toContain('Resume')
    expect(html).toContain('Stop')
  })
})
