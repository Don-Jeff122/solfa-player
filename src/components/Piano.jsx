import { useMemo, useRef, useState } from 'react'
import { midiName, solfaForMidi } from '../lib/notes.js'
import { BLACK_KEY_WIDTH_RATIO, blackKeyLeft, fitRange } from '../lib/range.js'

export default function Piano({ activeMidi, tonicMidi = 60, onPlayNote, midiNotes = [] }) {
  const pressedRef = useRef(new Map())
  const [pressed, setPressed] = useState(() => new Set())

  const { whiteKeys, blackKeys, start, end } = useMemo(() => {
    const [startMidi, endMidi] = fitRange(midiNotes)
    const white = []
    const black = []
    for (let m = startMidi; m <= endMidi; m++) {
      const pc = ((m % 12) + 12) % 12
      if (pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10) {
        black.push({ midi: m, afterWhite: white.length })
      } else {
        white.push(m)
      }
    }
    return { whiteKeys: white, blackKeys: black, start: startMidi, end: endMidi }
  }, [midiNotes])

  const active = useMemo(() => {
    const notes = new Set(activeMidi || [])
    for (const midi of pressed) notes.add(midi)
    return notes
  }, [activeMidi, pressed])
  const whitePct = 100 / whiteKeys.length
  const blackPct = whitePct * BLACK_KEY_WIDTH_RATIO

  const label = (midi) => ({
    solfa: solfaForMidi(midi, tonicMidi),
    name: midiName(midi),
  })

  const pressKey = (event, midi) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pressedRef.current.set(event.pointerId, midi)
    setPressed(new Set(pressedRef.current.values()))
    if (onPlayNote) onPlayNote(midi)
  }

  const releaseKey = (event) => {
    if (!pressedRef.current.has(event.pointerId)) return
    pressedRef.current.delete(event.pointerId)
    setPressed(new Set(pressedRef.current.values()))
  }

  return (
    <div className="piano-case" aria-label="Piano keyboard">
      <div className="piano-nameplate">
        <span>
          {midiName(start)}-{midiName(end)}
        </span>
      </div>
      <div className="piano-scroll">
        <div
          className="piano"
          style={{
            height: 'var(--piano-height, 190px)',
            minWidth: whiteKeys.length * 26,
          }}
        >
        {whiteKeys.map((midi) => {
          const { solfa, name } = label(midi)
          return (
            <button
              key={midi}
              type="button"
              className={`key white${active.has(midi) ? ' active' : ''}`}
              style={{ width: `${whitePct}%` }}
              onPointerDown={(e) => pressKey(e, midi)}
              onPointerUp={releaseKey}
              onPointerCancel={releaseKey}
              onLostPointerCapture={releaseKey}
              onPointerLeave={releaseKey}
              aria-label={`${name}${solfa ? ` (${solfa})` : ''}`}
            >
              <span className="key-solfa">{solfa}</span>
              <span className="key-pc">{name}</span>
            </button>
          )
        })}
        {blackKeys.map(({ midi, afterWhite }) => {
          const { solfa, name } = label(midi)
          const left = blackKeyLeft(afterWhite, whiteKeys.length)
          return (
            <button
              key={midi}
              type="button"
              className={`key black${active.has(midi) ? ' active' : ''}`}
              style={{ left: `${left}%`, width: `${blackPct}%` }}
              onPointerDown={(e) => pressKey(e, midi)}
              onPointerUp={releaseKey}
              onPointerCancel={releaseKey}
              onLostPointerCapture={releaseKey}
              onPointerLeave={releaseKey}
              aria-label={`${name}${solfa ? ` (${solfa})` : ''}`}
            >
              <span className="key-pc">{name}</span>
            </button>
          )
        })}
        </div>
      </div>
    </div>
  )
}
