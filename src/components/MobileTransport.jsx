import { formatClock } from '../lib/timeline.js'

const TEMPO_MIN = 40
const TEMPO_MAX = 200
const TEMPO_STEP = 5

export default function MobileTransport({
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
  const shown = Math.min(progress, total)
  const tempoFill = ((tempo - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN)) * 100
  return (
    <div className="mobile-transport" role="region" aria-label="Practice player">
      <div className="mobile-transport-row">
        {isPlaying ? (
          <>
            {mediaPlayback && (
              <button
                type="button"
                className="btn btn-pause mobile-transport-btn"
                onClick={onPause}
                aria-label="Pause"
              >
                <span className="btn-icon pause" />
                Pause
              </button>
            )}
            <button
              type="button"
              className="btn btn-stop mobile-transport-btn"
              onClick={onStop}
              aria-label="Stop"
            >
              <span className="btn-icon stop" />
              Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary mobile-transport-btn"
            onClick={onPlay}
            disabled={!canPlay}
            aria-busy={preparing && !isPaused ? true : undefined}
            title={
              preparing && !isPaused
                ? 'Audio is being prepared; playback will start when ready'
                : undefined
            }
          >
            <span className="btn-icon play" />
            {preparing && !isPaused ? 'Preparing…' : isPaused ? 'Resume' : 'Play'}
          </button>
        )}
        {isPaused && (
          <button
            type="button"
            className="btn btn-stop mobile-transport-btn"
            onClick={onStop}
            aria-label="Stop"
          >
            <span className="btn-icon stop" />
            Stop
          </button>
        )}
        <span className="mobile-transport-time" aria-label="Playback time">
          {formatClock(shown)} / {formatClock(total)}
        </span>
        <label className="mobile-transport-tempo">
          <span>Tempo</span>
          <input
            type="range"
            min={TEMPO_MIN}
            max={TEMPO_MAX}
            step={TEMPO_STEP}
            value={tempo}
            onChange={(event) => onTempo(Number(event.target.value))}
            aria-label="Tempo"
            style={{ '--fill': `${tempoFill}%` }}
          />
          <span className="mobile-transport-tempo-value">{tempo}</span>
        </label>
      </div>
      <input
        className="mobile-transport-progress"
        type="range"
        min="0"
        max={total || 1}
        step="0.1"
        value={shown}
        disabled={!total}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label="Playback position"
        style={{ '--fill': total ? `${(shown / total) * 100}%` : '0%' }}
      />
    </div>
  )
}
