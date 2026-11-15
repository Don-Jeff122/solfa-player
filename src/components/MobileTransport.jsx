import { formatClock } from '../lib/timeline.js'

const TEMPO_MIN = 40
const TEMPO_MAX = 200
const TEMPO_STEP = 5

export default function MobileTransport({
  visible = true,
  title,
  subtitle,
  canPlay,
  isPlaying,
  isPaused,
  mediaPlayback,
  preparing,
  progress,
  duration,
  tempo,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onTempo,
}) {
  const total = duration > 0 ? duration : 0
  const shown = Math.min(Math.max(progress, 0), total)
  const tempoFill = ((tempo - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN)) * 100
  const playLabel = preparing && !isPaused ? 'Preparing audio' : isPaused ? 'Resume' : 'Play'
  return (
    <div
      className={`mobile-transport${visible ? ' is-visible' : ''}`}
      role="region"
      aria-label="Practice player"
      aria-hidden={visible ? undefined : true}
      inert={visible ? undefined : true}
    >
      {title && (
        <div className="mobile-transport-track">
          <span className="mobile-transport-title" title={title}>
            {title}
          </span>
          {subtitle && <span className="mobile-transport-subtitle">{subtitle}</span>}
        </div>
      )}
      {total > 0 && (
        <div className="mobile-transport-progress-row">
          <span className="mobile-transport-clock">{formatClock(shown)}</span>
          <input
            className="mobile-transport-progress"
            type="range"
            min="0"
            max={total}
            step="0.1"
            value={shown}
            onChange={(event) => onSeek(Number(event.target.value))}
            aria-label="Playback position"
            style={{ '--fill': `${(shown / total) * 100}%` }}
          />
          <span className="mobile-transport-clock">{formatClock(total)}</span>
        </div>
      )}
      <div className="mobile-transport-main">
        <div className="mobile-transport-actions">
          {isPlaying ? (
            mediaPlayback ? (
              <button
                type="button"
                className="mobile-transport-control mobile-transport-control-primary"
                onClick={onPause}
                aria-label="Pause"
                title="Pause without losing your place"
              >
                <span className="btn-icon pause" />
              </button>
            ) : (
              <span className="mobile-transport-live" role="status" aria-label="Live playback">
                <span className="mobile-transport-live-dot" aria-hidden="true" />
                Live
              </span>
            )
          ) : (
            <button
              type="button"
              className="mobile-transport-control mobile-transport-control-primary"
              onClick={onPlay}
              disabled={!canPlay}
              aria-busy={preparing && !isPaused ? true : undefined}
              aria-label={playLabel}
              title={
                preparing && !isPaused
                  ? 'Audio is being prepared; playback will start when ready'
                  : undefined
              }
            >
              {preparing && !isPaused ? (
                <span className="mobile-transport-spinner" aria-hidden="true" />
              ) : (
                <span className="btn-icon play" />
              )}
            </button>
          )}
          {(isPlaying || isPaused) && (
            <button
              type="button"
              className="mobile-transport-control mobile-transport-control-secondary"
              onClick={onStop}
              aria-label="Stop"
              title="Stop playback"
            >
              <span className="btn-icon stop" />
            </button>
          )}
        </div>
        <label className="mobile-transport-tempo">
          <span className="mobile-transport-tempo-label">Tempo</span>
          <input
            className="mobile-transport-tempo-input"
            type="range"
            min={TEMPO_MIN}
            max={TEMPO_MAX}
            step={TEMPO_STEP}
            value={tempo}
            onChange={(event) => onTempo(Number(event.target.value))}
            aria-label="Tempo"
            style={{ '--fill': `${tempoFill}%` }}
          />
          <span className="mobile-transport-tempo-value" aria-label={`${tempo} BPM`}>
            {tempo}
            <span className="mobile-transport-tempo-unit"> BPM</span>
          </span>
        </label>
      </div>
    </div>
  )
}
