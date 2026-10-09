import { MAJOR_KEYS, VOICE_OCTAVE_MAX, VOICE_OCTAVE_MIN } from '../lib/notes.js'
import { VOICE_LIST, SUSTAIN_OPTIONS } from '../audio/voices.js'

const TEMPO_MIN = 40
const TEMPO_MAX = 200
const TEMPO_STEP = 5

const octaveLabel = (n) => (n > 0 ? `+${n}` : String(n))

export default function Controls({
  canPlay,
  isPlaying,
  onPlay,
  onStop,
  tempo,
  onTempo,
  key,
  onKey,
  keyFromSheet,
  parts,
  activeParts,
  onTogglePart,
  onAllParts,
  onClearParts,
  onSoloPart,
  octave,
  onOctave,
  voiceOctaveOf,
  onVoiceOctave,
  sound,
  onSound,
  sustain,
  onSustain,
  rendering,
  repeat,
  onRepeat,
  metronome,
  onMetronome,
  meter,
  canRecord,
  onRecord,
  wavUrl,
  wavName,
}) {
  return (
    <div className="controls">
      <div className="controls-row">
        <div className="transport">
          {isPlaying ? (
            <button type="button" className="btn btn-stop" onClick={onStop}>
              <span className="btn-icon stop" />
              Stop
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onPlay} disabled={!canPlay}>
              <span className="btn-icon play" />
              Play
            </button>
          )}
          <button
            type="button"
            className={`btn btn-repeat${repeat ? ' active' : ''}`}
            onClick={() => onRepeat(!repeat)}
            aria-pressed={repeat}
            title={
              repeat
                ? 'On: plays over and over until you press Stop'
                : 'Off: plays once'
            }
          >
            <span className="btn-icon repeat" />
            Repeat
          </button>
          <button
            type="button"
            className={`btn btn-repeat${metronome && meter ? ' active' : ''}`}
            onClick={() => onMetronome(!metronome)}
            aria-pressed={metronome && !!meter}
            disabled={!meter}
            title={
              meter
                ? metronome
                  ? 'On: ticks the downbeat of each bar'
                  : 'Off: no clicks'
                : 'Needs a meter (e.g. Meter: 4/4) in the sheet'
            }
          >
            <span className="btn-icon repeat" />
            Metronome
          </button>
          <button
            type="button"
            className="btn btn-record"
            onClick={onRecord}
            disabled={!canRecord || rendering || isPlaying}
            title={
              isPlaying
                ? 'Stop playback to record'
                : 'Render the current part to a WAV file you can download'
            }
          >
            <span className="btn-icon record" />
            {rendering ? 'Rendering…' : 'Record WAV'}
          </button>
          {wavUrl && (
            <a className="btn btn-download" href={wavUrl} download={wavName}>
              <span className="btn-icon download" />
              Download
            </a>
          )}
        </div>
        <div className="slider-group">
          <label className="slider-label" htmlFor="tempo">
            Tempo
            <span className="slider-value">{tempo} BPM</span>
          </label>
          <input
            id="tempo"
            type="range"
            min={TEMPO_MIN}
            max={TEMPO_MAX}
            step={TEMPO_STEP}
            style={{ '--fill': `${((tempo - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN)) * 100}%` }}
            value={tempo}
            onChange={(e) => onTempo(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="controls-row selects">
        <label className="select-field">
          <span>Key</span>
          <select value={key} onChange={(e) => onKey(e.target.value)} disabled={keyFromSheet}>
            {MAJOR_KEYS.map((k) => (
              <option key={k} value={k}>
                {k} major
              </option>
            ))}
          </select>
        </label>
        {keyFromSheet && <span className="hint">key set in sheet</span>}
        {parts.length > 0 && (
          <div className="voice-picker">
            <div className="voice-head">
              <span>Voices</span>
              <div className="voice-links">
                <button type="button" className="link" onClick={onAllParts}>
                  All
                </button>
                <button type="button" className="link" onClick={onClearParts}>
                  None
                </button>
              </div>
            </div>
            <div className="voice-chips">
              {parts.map((p) => {
                const on = activeParts.includes(p)
                const voiceOct = voiceOctaveOf ? voiceOctaveOf(p) : 0
                return (
                  <div className={`voice${on ? '' : ' muted'}`} key={p}>
                    <button
                      type="button"
                      className={`voice-chip${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() => onTogglePart(p)}
                      onDoubleClick={() => onSoloPart(p)}
                      title={`${on ? 'Mute' : 'Play'} ${p} — double-click to solo`}
                    >
                      {p}
                    </button>
                    <div className="voice-oct" role="group" aria-label={`${p} octave`}>
                      <button
                        type="button"
                        onClick={() => onVoiceOctave(p, -1)}
                        disabled={voiceOct <= VOICE_OCTAVE_MIN}
                        aria-label={`${p} octave down`}
                      >
                        &minus;
                      </button>
                      <span className="voice-oct-value" aria-live="off">
                        {octaveLabel(voiceOct)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onVoiceOctave(p, 1)}
                        disabled={voiceOct >= VOICE_OCTAVE_MAX}
                        aria-label={`${p} octave up`}
                      >
                        +
                      </button>
                    </div>
                    <span className="sr-only">{`${p} plays ${octaveLabel(voiceOct)} octaves`}</span>
                  </div>
                )
              })}
            </div>
            {activeParts.length === 0 && (
              <p className="hint">No voices selected — nothing will play.</p>
            )}
          </div>
        )}
        <label className="select-field">
          <span>Octave (all voices)</span>
          <select value={String(octave)} onChange={(e) => onOctave(Number(e.target.value))}>
            <option value="-1">-1 (lower)</option>
            <option value="0">Normal</option>
            <option value="1">+1 (higher)</option>
          </select>
        </label>
        <label className="select-field">
          <span>Sustain</span>
          <select value={sustain} onChange={(e) => onSustain(e.target.value)}>
            {SUSTAIN_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="select-field">
          <span>Sound</span>
          <select value={sound} onChange={(e) => onSound(e.target.value)}>
            {VOICE_LIST.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
