import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MobileTransport from '../MobileTransport.jsx'

function renderTransport(overrides = {}) {
  return renderToStaticMarkup(
    createElement(MobileTransport, {
      title: 'Morning Hymn',
      subtitle: 'Solfa Piano · C major',
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
    expect(html).toContain('aria-label="Play"')
    expect(html).toContain('0:00')
    expect(html).toContain('1:00')
    expect(html).toContain('aria-label="Tempo"')
  })

  it('shows the song title and track metadata', () => {
    const html = renderTransport()

    expect(html).toContain('Morning Hymn')
    expect(html).toContain('Solfa Piano · C major')
    expect(html).toContain('class="mobile-transport-title" title="Morning Hymn"')
  })

  it('shows the preparing state', () => {
    const html = renderTransport({ preparing: true })

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('aria-label="Preparing audio"')
    expect(html).toContain('mobile-transport-spinner')
  })

  it('shows Pause and Stop during media playback', () => {
    const html = renderTransport({ isPlaying: true })

    expect(html).toContain('aria-label="Pause"')
    expect(html).toContain('aria-label="Stop"')
    expect(html).not.toContain('aria-label="Play"')
  })

  it('shows only Stop when live fallback cannot pause', () => {
    const html = renderTransport({ isPlaying: true, mediaPlayback: false })

    expect(html).not.toContain('aria-label="Pause"')
    expect(html).toContain('aria-label="Stop"')
    expect(html).toContain('Live playback')
  })

  it('shows Resume and Stop while paused', () => {
    const html = renderTransport({ isPaused: true })

    expect(html).toContain('aria-label="Resume"')
    expect(html).toContain('aria-label="Stop"')
  })

  it('starts hidden until the main player scrolls away', () => {
    const html = renderTransport({ visible: false })

    expect(html).not.toContain('mobile-transport is-visible')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('inert=""')
  })

  it('omits the seek rail when there is no duration yet', () => {
    const html = renderTransport({ duration: 0 })

    expect(html).not.toContain('Playback position')
  })
})
