import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Controls from './components/Controls.jsx'
import Piano from './components/Piano.jsx'
import SavedSheets from './components/SavedSheets.jsx'
import SheetScanner from './components/SheetScanner.jsx'
import { Synth } from './audio/Synth.js'
import {
  DEFAULT_SUSTAIN_ID,
  DEFAULT_VOICE_ID,
  getVoice,
  sustainSeconds,
} from './audio/voices.js'
import { audioBufferToWavBlob } from './audio/wav.js'
import { parseSolfa } from './lib/parseSolfa.js'
import { SAMPLE_SHEETS } from './lib/sampleSheets.js'
import {
  buildSequences,
  clampVoiceOctave,
  partOctave,
  sequenceBeats,
  tonicMidiForKey,
} from './lib/notes.js'
import { deleteSheet, describeSheet, loadSheets, saveSheet } from './lib/sheetStore.js'

const DEFAULT_TEXT = `Key: C
Do Do So So Re Re Do- Mi Mi Fa Fa So So Mi-
La La So So Fa Fa Re- Do Do So So Re Re Do-`

function SolfaChip({ note, current }) {
  const cls = `chip${current ? ' current' : ''}`
  if (note.solfa == null) {
    return (
      <span className={`${cls} rest`}>
        {note.token === '0' ? '0' : 'rest'}
        {note.beats > 1 && <span className="beats">{'-'.repeat(note.beats - 1)}</span>}
      </span>
    )
  }
  let name = note.solfa.charAt(0).toUpperCase() + note.solfa.slice(1)
  if (name === 'Sol') name = 'So'
  const marks = "'".repeat(note.up) + ','.repeat(note.down)
  return (
    <span className={cls}>
      {name}
      {marks}
      {note.beats > 1 && <span className="beats">{'-'.repeat(note.beats - 1)}</span>}
    </span>
  )
}

export default function App() {
  const [text, setText] = useState(DEFAULT_TEXT)
  const [uiKey, setUiKey] = useState('C')
  const [partSel, setPartSel] = useState(null)
  const [tempo, setTempo] = useState(90)
  const [octave, setOctave] = useState(0)
  const [showScanner, setShowScanner] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [activeMidi, setActiveMidi] = useState(() => new Set())
  const [noteIndexes, setNoteIndexes] = useState([])
  const [rendering, setRendering] = useState(false)
  const [wavUrl, setWavUrl] = useState(null)
  const [wavName, setWavName] = useState('solfa.wav')
  const [error, setError] = useState(null)
  const [audioError, setAudioError] = useState(null)
  const [sheets, setSheets] = useState(() => {
    const existing = loadSheets()
    if (existing.length) return existing
    let seeded = existing
    for (const sample of SAMPLE_SHEETS) {
      seeded = saveSheet({ name: sample.name, text: sample.text }).sheets
    }
    return seeded
  })
  const [sheetName, setSheetName] = useState('')
  const [savedMsg, setSavedMsg] = useState(null)
  const [voiceOctaves, setVoiceOctaves] = useState({})
  const [sound, setSound] = useState(DEFAULT_VOICE_ID)
  const [sustain, setSustain] = useState(DEFAULT_SUSTAIN_ID)
  const [repeat, setRepeat] = useState(false)
  const [metronome, setMetronome] = useState(false)
  const ring = sustainSeconds(sustain)

  const [synth] = useState(() => new Synth())
  const handleRef = useRef(null)
  const tapTimerRef = useRef(null)
  const wavUrlRef = useRef(null)
  // Read from the synth's done callback, which is set up once per pass.
  const repeatRef = useRef(false)
  const startRef = useRef(null)
  useEffect(() => {
    repeatRef.current = repeat
  }, [repeat])

  const parsed = useMemo(() => parseSolfa(text), [text])
  const result = parsed.ok ? parsed.result : null
  const sheetKey = result ? result.key : null
  const meterLabel = result && result.meter ? `${result.meter.num}/${result.meter.den}` : null

  // Bar structure per voice, for the repeat/bar glyphs drawn in the preview.
  const partBars = useMemo(() => {
    const map = new Map()
    if (result) for (const p of result.parts) map.set(p.name, p.bars)
    return map
  }, [result])

  // The glyph shown where one bar hands over to the next.
  const barGlyph = (prev, next) => {
    if (prev?.closeRepeat && next?.openRepeat) return '\u2016:'
    let g = prev?.closeRepeat ? ':\u2016' : ''
    g += next?.openRepeat ? '\u2016:' : ''
    if (!g) g = prev?.double || next?.double ? '\u2016' : '|'
    return g
  }

  // Shown as the placeholder so a sheet can be saved without typing a name.
  const sheetHint = useMemo(() => describeSheet(parsed), [parsed])

  const partNames = useMemo(() => (result ? result.parts.map((p) => p.name) : []), [result])

  // Effective key: a key declared in the sheet always wins over the dropdown.
  const key = sheetKey ?? uiKey

  // Any combination of voices may play. `null` means "all of them".
  const activeParts = useMemo(() => {
    if (!partSel) return partNames
    return partSel.filter((n) => partNames.includes(n))
  }, [partSel, partNames])
  const allSelected = partNames.length > 0 && activeParts.length === partNames.length

  const togglePart = useCallback(
    (name) => {
      setPartSel((prev) => {
        const current = prev ?? partNames
        const next = current.includes(name)
          ? current.filter((n) => n !== name)
          : [...current, name]
        return next.length === partNames.length ? null : next
      })
    },
    [partNames]
  )

  const setAllParts = useCallback(() => setPartSel(null), [])
  const clearParts = useCallback(() => setPartSel([]), [])
  const soloPart = useCallback((name) => setPartSel([name]), [])

  // Each voice carries its own octave register, defaulting to the usual
  // choral placement. An entry here is the voice's total register, not a
  // delta, so the stepper always shows what actually sounds.
  const voiceOctaveOf = useCallback(
    (name) => (voiceOctaves[name] == null ? partOctave(name) : voiceOctaves[name]),
    [voiceOctaves]
  )
  const stepVoiceOctave = useCallback((name, delta) => {
    setVoiceOctaves((prev) => ({
      ...prev,
      [name]: clampVoiceOctave((prev[name] == null ? partOctave(name) : prev[name]) + delta),
    }))
  }, [])

  const sequences = useMemo(() => {
    if (!result) return null
    return buildSequences(result, key, octave, activeParts, voiceOctaves)
  }, [result, key, octave, activeParts, voiceOctaves])

  const pianoMidiNotes = useMemo(() => {
    if (!sequences) return []
    return sequences.flatMap((seq) => seq.notes.map((n) => n.midi))
  }, [sequences])

  const totalBeats = useMemo(
    () => (sequences ? Math.max(...sequences.map(sequenceBeats)) : 0),
    [sequences]
  )
  const totalNotes = useMemo(
    () => (sequences ? sequences.reduce((s, q) => s + q.notes.length, 0) : 0),
    [sequences]
  )

  const stopPlayback = useCallback(() => {
    if (handleRef.current) handleRef.current.stop()
    handleRef.current = null
    setIsPlaying(false)
    setActiveMidi(new Set())
    setNoteIndexes([])
  }, [])

  // Keep the dropdowns in sync with the sheet (so the UI reflects parsed data)
  // and stop playback when the underlying sequence changes.
  useEffect(() => {
    if (sheetKey) setUiKey(sheetKey)
  }, [sheetKey])

  useEffect(() => {
    if (isPlaying) stopPlayback()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequences])

  useEffect(() => {
    return () => {
      if (handleRef.current) handleRef.current.stop()
      clearTimeout(tapTimerRef.current)
      if (wavUrlRef.current) URL.revokeObjectURL(wavUrlRef.current)
    }
  }, [synth])

  const startPlayback = useCallback(() => {
    if (!sequences || !sequences.length || !totalBeats) return
    if (handleRef.current) handleRef.current.stop()
    handleRef.current = null
    setNoteIndexes([])
    setAudioError(null)
    try {
      const ctx = synth._ensureCtx?.() || synth.ctx
      if (ctx?.state === 'suspended' && ctx.resume) ctx.resume()
    } catch {}
    handleRef.current = synth.play(sequences, {
      tempo,
      voice: sound,
      sustain: ring,
      metronome,
      // A note the browser refuses is otherwise swallowed silently, and the
      // notes go on highlighting over a speaker that never makes a sound.
      onError: (err) => setAudioError(err && err.message ? err.message : String(err)),
      onNoteStart: (n) => {
        setNoteIndexes((prev) => {
          const next = prev.slice()
          next[n.seqIndex] = n.index
          return next
        })
        if (n.midi == null) return
        setActiveMidi((prev) => {
          const next = new Set(prev)
          next.add(n.midi)
          return next
        })
      },
      onNoteEnd: (n) => {
        if (n.midi == null) return
        setActiveMidi((prev) => {
          const next = new Set(prev)
          next.delete(n.midi)
          return next
        })
      },
      onDone: () => {
        handleRef.current = null
        setActiveMidi(new Set())
        setNoteIndexes([])
        // Repeat restarts from here; stopping clears the synth's own done timer,
        // so this cannot fire once the player has been stopped or changed.
        if (repeatRef.current) {
          startRef.current?.()
        } else {
          setIsPlaying(false)
        }
      },
    })
    setIsPlaying(true)
  }, [sequences, totalBeats, tempo, sound, ring, synth, metronome])

  // The restart is triggered from the synth's done callback, which is created
  // once per pass, so it reads these refs to see the current settings.
  startRef.current = startPlayback

  const handlePlay = () => {
    stopPlayback()
    startPlayback()
  }

  const handleRecord = async () => {
    if (!sequences || !sequences.length || rendering) return
    setRendering(true)
    setError(null)
    const saveBuffer = (buffer, recordedVoice) => {
      const blob = audioBufferToWavBlob(buffer)
      const url = URL.createObjectURL(blob)
      if (wavUrlRef.current) URL.revokeObjectURL(wavUrlRef.current)
      wavUrlRef.current = url
      setWavUrl(url)
      const slug = allSelected
        ? 'all'
        : activeParts.length
          ? activeParts.map((n) => n.toLowerCase().replace(/\s+/g, '-')).join('-')
          : 'none'
      setWavName(`solfa-${key}-major-${slug}-${recordedVoice}.wav`)
    }
    try {
      // Instruments that ring on (bell, music box, hymn organ) plus the chosen
      // ring-out need a long tail or the export is clipped mid-decay.
      const tail = Math.max(1.4, getVoice(sound).release + ring + 0.3)
      try {
        const ctx = synth._ensureCtx?.() || synth.ctx
        if (ctx?.state === 'suspended' && ctx.resume) ctx.resume()
      } catch {}
      const buffer = await synth.render(sequences, {
        tempo,
        tail,
        voice: sound,
        sustain: ring,
        metronome,
      })
      saveBuffer(buffer, sound)
    } catch (err) {
      console.error('Record failed:', err)
      setError('Could not render audio. Please try again.')
    } finally {
      setRendering(false)
    }
  }

  const handleTap = (midi) => {
    try {
      const ctx = synth._ensureCtx?.() || synth.ctx
      if (ctx?.state === 'suspended' && ctx.resume) ctx.resume()
      synth.playTap(midi, { tempo, voice: sound, sustain: ring })
    } catch (err) {
      setAudioError(err && err.message ? err.message : String(err))
    }
    setActiveMidi(new Set([midi]))
    clearTimeout(tapTimerRef.current)
    tapTimerRef.current = setTimeout(() => setActiveMidi(new Set()), 280)
  }

  // Saving without a name falls back to a description of the sheet, so the
  // button always does something useful.
  const handleSaveSheet = () => {
    const name = sheetName.trim() || sheetHint
    const { sheets: next, error: saveError } = saveSheet({ name, text })
    setSheets(next)
    setSheetName('')
    setSavedMsg(
      saveError === 'storage'
        ? 'Could not save — this browser is blocking storage.'
        : `Saved “${name}”.`
    )
  }

  const handleLoadSheet = (sheet) => {
    setText(sheet.text)
    setError(null)
    setVoiceOctaves({})
    setSavedMsg(`Loaded “${sheet.name}”.`)
  }

  const handleDeleteSheet = (id) => {
    setSheets(deleteSheet(id))
    setSavedMsg('Sheet deleted.')
  }

  const partLabel = allSelected
      ? 'All parts'
      : activeParts.length === 1
        ? activeParts[0]
        : `${activeParts.length} parts`

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo" aria-hidden="true">
          <span />
          <span />
          <span />
          <span className="on" />
        </div>
        <div>
          <h1>Solfa Piano</h1>
          <p className="tagline">
            Type tonic solfa — or a full sheet with parts — and hear it on the piano.
          </p>
        </div>
      </header>

      <div className="layout">
        <section className="card input-card">
          <div className="card-head">
            <h2>Music sheet</h2>
            <div className="head-actions">
              <button
                type="button"
                className={`btn btn-small${showScanner ? ' active' : ''}`}
                onClick={() => setShowScanner((v) => !v)}
              >
                Scan image / PDF
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setText(DEFAULT_TEXT)
                  setError(null)
                  setSavedMsg(null)
                }}
              >
                Reset example
              </button>
            </div>
          </div>
          {showScanner && (
            <SheetScanner
              onApply={(scanned, scannedKey) => {
                setText(scanned)
                if (scannedKey) setUiKey(scannedKey)
                setError(null)
                setSavedMsg(null)
                setShowScanner(false)
              }}
            />
          )}
          <textarea
            className="solfa-input"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
              setSavedMsg(null)
            }}
            spellCheck={false}
            aria-label="Tonic solfa input"
          />
          {parsed.ok ? (
            <p className="meta-line">
              {totalNotes} notes · {totalBeats} beats · key {key} major · playing{' '}
              {partLabel}
            </p>
          ) : (
            <div className="error-box" role="alert">
              {parsed.error.message}
            </div>
          )}

          <div className="save-row">
            <input
              className="save-name"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSaveSheet()
                }
              }}
              placeholder={sheetHint}
              aria-label="Name for saving this sheet"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={handleSaveSheet}
              disabled={!text.trim()}
            >
              Save
            </button>
          </div>
          {savedMsg && <p className="meta-line">{savedMsg}</p>}
          <SavedSheets sheets={sheets} onLoad={handleLoadSheet} onDelete={handleDeleteSheet} />

          {result && (
            <div className="preview">
              {sequences.map((seq, seqIndex) => {
                const bars = partBars.get(seq.name) || []
                return (
                  <div className="chip-group" key={seq.name}>
                    {activeParts.length > 1 && <span className="chip-label">{seq.name}</span>}
                    <div className="chips">
                      {seq.notes.map((n, i) => {
                        const prev = i > 0 ? bars[seq.notes[i - 1].bar] : null
                        const next = bars[n.bar]
                        const boundary = i > 0 && n.bar !== seq.notes[i - 1].bar
                          ? barGlyph(prev, next)
                          : null
                        return (
                          <span key={i} className="chip-node">
                            {boundary && <span className="chip bar">{boundary}</span>}
                            <SolfaChip
                              note={n}
                              current={isPlaying && i === noteIndexes[seqIndex]}
                            />
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <details className="help">
            <summary>Solfa syntax</summary>
            <ul>
              <li>
                <b>Notes</b> — <code>Do Re Mi Fa So La Ti</code> or letters{' '}
                <code>D R M F S L T</code>
              </li>
              <li>
                <b>Sharps</b> — <code>Di Ri Fi Si Li</code> raise do, re, fa, so, la by a
                semitone
              </li>
              <li>
                <b>Flats</b> — <code>Ra Me Se Le Te</code> lower them by a semitone, so{' '}
                <code>Do Ra</code> is a falling semitone. They follow the key rather than
                naming it: in <code>Key: G</code> the key&apos;s F# is <code>Ti</code>, while{' '}
                <code>Fi</code> raises fa (C) to C#.
              </li>
              <li>
                <b>Octave</b> — <code>Do'</code> up one octave, <code>,Do</code> down one
                (repeatable, and they can be combined)
              </li>
              <li>
                <b>Rest</b> — <code>0</code> or <code>rest</code>
</li>
              <li>
                <b>Longer note</b> - add dashes: <code>Do-</code> = 2 beats, <code>Do---</code>{' '}
                = 4 beats, or <code>Do(3)</code>
              </li>
              <li>
                <b>Eighths &amp; triplets</b> — fractions: <code>Do(1/2)</code> = half a
                beat, <code>Do(1/3)</code> = triplet
              </li>
              <li>
                <b>Dotted note</b> — a trailing dot adds half again: <code>Do.</code> = 1.5,{' '}
                <code>Do-.</code> = 3
              </li>
              <li>
                <b>Key</b> — first line <code>Key: G</code> (or <code>tonic: D</code>,{' '}
                <code>1=F#</code>)
              </li>
              <li>
                <b>Meter &amp; bars</b> — a line like <code>Meter: 4/4</code> (or{' '}
                <code>Time: 6/8</code>, a bare <code>4/4</code>, or <code>C</code>) sets the bar
                length. Split the music into bars with <code>|</code>:{' '}
                <code>Do Re | Mi Fa | So Do</code>. Bars must add up to the meter — the first
                bar may be a short pickup and the last may finish the phrase. A wrong bar is an
                error that names the part and counts the beats, so slips in a hymn are caught
                before you hear them.
              </li>
              <li>
                <b>Real choir sheet</b> — paste a hymnal line straight in:{' '}
                <code>{'{ m :- /m :r | d :- /s :- }'}</code>. Beat marks{' '}
                <code>:</code> and <code>/</code> split each bar into beats, <code>-</code>{' '}
                holds a beat, <code>0</code> rests, and <code>de fe se le lo ta</code> are the
                real-sheet chromatics. A subscript like <code>f₁</code> or <code>t₁</code> is an
                octave down. Title, lyric and composer lines are ignored; the rows of a{' '}
                <code>{'{ }'}</code> block become Soprano, Alto, Tenor and Bass
                automatically.
              </li>
              <li>
                <b>Repeats</b> — <code>|: Do Re :|</code> plays the section twice. A{' '}
                <code>:|</code> with no <code>|:</code> repeats from the song start.
              </li>
              <li>
                <b>First &amp; second endings</b> —{' '}
                <code>|: Do Re | 1. Mi Fa :| 2. So Do |</code> plays Do Re Mi Fa, then Do Re So
                Do. All parts must share the same bars and repeats, or the song is flagged as
                misaligned.
              </li>
              <li>
                <b>Metronome</b> — with a meter in the sheet, the <code>Metronome</code> button
                ticks each bar&apos;s downbeat while playing and while recording.
              </li>
              <li>
                <b>Parts</b> — put <code>Bass</code>, <code>Tenor</code>, <code>Alto</code>,{' '}
                <code>Soprano</code> (or <code>[Any Name]</code>) on its own line, then its
                notes. Repeat a name to continue that voice on a new line.
              </li>
              <li>
                <b>Voice octaves</b> — Soprano and Alto play at written pitch, Tenor an
                octave below and Bass two octaves below. Use <code>−</code>/<code>+</code> next
                to a voice to move just that one; the global <code>Octave</code> dropdown moves
                them all. Marks like <code>Do'</code> still apply on top of a voice&apos;s own
                octave.
              </li>
              <li>
                <b>Sound</b> — the <code>Sound</code> dropdown changes the instrument, and it
                applies to playback, the keys you tap and the recorded WAV alike. Try{' '}
                <code>Piano</code> for the default, <code>Church Organ</code> for hymns,{' '}
                <code>Hymn Organ</code> for a warm sustained pedal-and-mixture tone, and{' '}
                <code>Voice (ah)</code> to sing the solfa back at you.
              </li>
              <li>
                <b>Repeat</b> — with <code>Repeat</code> switched on the song keeps playing
                over and over, handy for practising a hymn, until you press <code>Stop</code>.
                Switching it off mid-song lets the current pass finish.
              </li>
              <li>
                <b>Sustain</b> — the <code>Sustain</code> dropdown adds extra ring-out after each
                note so chords keep sounding. <code>Off</code> leaves the instrument&apos;s own
                release alone; <code>Long</code> suits slow hymn singing.
              </li>
            </ul>
          </details>
        </section>

        <section className="card player-card">
          <Controls
            canPlay={!!sequences && totalBeats > 0}
            isPlaying={isPlaying}
            onPlay={handlePlay}
            onStop={stopPlayback}
            tempo={tempo}
            onTempo={setTempo}
            sheetKey={key}
            onKey={setUiKey}
            keyFromSheet={!!sheetKey}
            parts={partNames}
            activeParts={activeParts}
            onTogglePart={togglePart}
            onAllParts={setAllParts}
            onClearParts={clearParts}
            onSoloPart={soloPart}
            octave={octave}
            onOctave={setOctave}
            voiceOctaveOf={voiceOctaveOf}
            onVoiceOctave={stepVoiceOctave}
            sound={sound}
            onSound={setSound}
            sustain={sustain}
            onSustain={setSustain}
            rendering={rendering}
            repeat={repeat}
            onRepeat={setRepeat}
            metronome={metronome}
            onMetronome={setMetronome}
            meter={meterLabel}
            canRecord={!!sequences && totalBeats > 0}
            onRecord={handleRecord}
            wavUrl={wavUrl}
            wavName={wavName}
          />
          <div className="piano-holder">
            <Piano
              activeMidi={activeMidi}
              tonicMidi={tonicMidiForKey(key, octave)}
              onPlayNote={handleTap}
              midiNotes={pianoMidiNotes}
            />
          </div>

          <div className="player-status" aria-live="polite">
            {audioError && (
              <span className="status-error">
                Nothing can play right now: {audioError}
              </span>
            )}
            {!audioError && activeParts.length === 0 && sequences && !isPlaying && (
              <span className="status-error">
                No voices selected — click a part, or All, to hear anything.
              </span>
            )}
            {!audioError && error && <span className="status-error">{error}</span>}
            {!error && rendering && <span className="status-busy">Rendering audio…</span>}
            {!error && !rendering && wavUrl && (
              <span className="status-ok">
                Recording ready — use “Download” to save the WAV.
              </span>
            )}
          </div>

          <p className="tip">
            Tip: click any key to play it. Use the Part selector to hear one part alone — e.g. the
            Bass — or all parts together.
          </p>
        </section>
      </div>
    </div>
  )
}
