import { useMemo } from 'react'
import { midiName, solfaForMidi } from '../lib/notes.js'
import { fitRange } from '../lib/range.js'

export default function Piano({ activeMidi, tonicMidi = 60, onPlayNote, midiNotes = [] }) {
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

  const active = activeMidi || new Set()
  const whitePct = 100 / whiteKeys.length
  const blackPct = whitePct * 0.62

  const label = (midi) => ({
    solfa: solfaForMidi(midi, tonicMidi),
    name: midiName(midi),
  })

  return (
    <div className="piano-case" aria-label="Piano keyboard">
      <div className="piano-nameplate">
        <span>
          {midiName(start)} – {midiName(end)}
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
              onPointerDown={(e) => {
                e.preventDefault()
                if (onPlayNote) onPlayNote(midi)
              }}
              aria-label={`${name}${solfa ? ` (${solfa})` : ''}`}
            >
              <span className="key-solfa">{solfa}</span>
              <span className="key-pc">{name}</span>
            </button>
          )
        })}
        {blackKeys.map(({ midi, afterWhite }) => {
          const { solfa, name } = label(midi)
          const left = afterWhite * whitePct + whitePct - blackPct / 2
          return (
            <button
              key={midi}
              type="button"
              className={`key black${active.has(midi) ? ' active' : ''}`}
              style={{ left: `${left}%`, width: `${blackPct}%` }}
              onPointerDown={(e) => {
                e.preventDefault()
                if (onPlayNote) onPlayNote(midi)
              }}
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
