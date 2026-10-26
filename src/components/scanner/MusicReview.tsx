import {
  partLabel,
  SCANNED_VOICES,
  type ScannedPartName,
  type ScannedScore,
  type ScoreEvent,
  type ScoreSystemRow,
  type ScoreWarning,
} from '../../lib/scanScore'

const PART_OPTIONS = [
  ...SCANNED_VOICES,
  'Main',
] as const

type AssignmentValue = ScannedPartName | null | undefined

interface MusicReviewProps {
  score: ScannedScore
  overrides: Record<string, AssignmentValue>
  onAssign: (lineId: string, value: AssignmentValue) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onSelectEvent: (event: ScoreEvent) => void
  selectedEventId: string | null
}

function assignmentSource(row: ScoreSystemRow): string {
  if (row.assignment.source === 'user') return 'Set by you'
  if (row.assignment.source === 'label') return 'Read from part label'
  if (row.assignment.source === 'position') return 'Inferred from row position'
  if (row.assignment.source === 'fallback') return 'Single-line melody'
  return 'Needs assignment'
}

function overrideValue(
  lineId: string,
  overrides: Record<string, AssignmentValue>
): string {
  if (!Object.prototype.hasOwnProperty.call(overrides, lineId)) return '__auto__'
  return overrides[lineId] ?? '__unassigned__'
}

function selectionValue(value: string): AssignmentValue {
  if (value === '__auto__') return undefined
  if (value === '__unassigned__') return null
  return value
}

function flagLabel(flags: ScannedScore['measures'][number]['flags']): string {
  const parts: string[] = []
  for (const ending of flags.endings) parts.push(`${ending}.`)
  if (flags.openRepeat) parts.push('|:')
  if (flags.closeRepeat) parts.push(':|')
  if (flags.double) parts.push('||')
  return parts.join(' ')
}

function eventTitle(event: ScoreEvent): string {
  const details = [
    `${event.token} · ${event.beats} beat${event.beats === 1 ? '' : 's'}`,
    `${Math.round(event.confidence * 100)}% confidence`,
  ]
  if (event.uncertain) details.push('uncertain')
  if (event.corrected) details.push('corrected')
  if (event.slur) details.push('underlined run')
  if (!event.source) details.push('no source character')
  return details.join(' · ')
}

function warningWhere(warning: ScoreWarning): string {
  const parts: string[] = []
  if (warning.page) parts.push(`Page ${warning.page}`)
  if (warning.system != null) parts.push(`System ${warning.system + 1}`)
  if (warning.measure != null) parts.push(`Measure ${warning.measure}`)
  if (warning.part) parts.push(warning.part)
  return parts.join(' · ')
}

export default function MusicReview({
  score,
  overrides,
  onAssign,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSelectEvent,
  selectedEventId,
}: MusicReviewProps) {
  const unassigned = score.stats.unassignedLines
  const uncertain = score.stats.uncertainEvents
  const errors = score.warnings.filter((warning) => warning.severity === 'error').length
  const blockingWarnings = score.warnings.filter(
    (warning) => warning.severity === 'error' && warning.code !== 'unassigned-lines'
  )
  const systemRows = score.systems.map((system) => {
    const measures = system.measureIndexes
      .map((index) => score.measures[index])
      .filter((measure): measure is ScannedScore['measures'][number] => Boolean(measure))
    return { system, measures }
  })

  return (
    <div className="scan-score">
      <div className="scan-score-summary">
        <div>
          <span>Systems</span>
          <strong>{score.stats.systems}</strong>
        </div>
        <div>
          <span>Measures</span>
          <strong>{score.stats.measures}</strong>
        </div>
        <div>
          <span>Events</span>
          <strong>{score.stats.events}</strong>
        </div>
        <div>
          <span>Parts</span>
          <strong>{score.parts.length}</strong>
        </div>
      </div>

      <div className="scan-score-toolbar">
        <div className="scan-score-key">
          <span>{score.key ? `Key ${score.key}` : 'No key read'}</span>
          <span>{score.meter ? `Metre ${score.meter.num}/${score.meter.den}` : 'No metre read'}</span>
          <span>
            {score.meterInPlayerText
              ? 'Metre included in playback'
              : 'Metre omitted from playback'}
          </span>
        </div>
        <div className="scan-score-history">
          <button
            type="button"
            className="btn btn-small"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo part assignment"
          >
            Undo part
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo part assignment"
          >
            Redo part
          </button>
        </div>
      </div>

      {unassigned > 0 && (
        <div className="scan-score-blocked" role="alert">
          <strong>
            {unassigned} line{unassigned === 1 ? '' : 's'} still need a part.
          </strong>
          <span>
            Choose an explicit voice below. Playback stays blocked until every recognized line
            belongs to a part.
          </span>
        </div>
      )}

      {blockingWarnings.length > 0 && (
        <div className="scan-score-blocked" role="alert">
          <strong>
            {blockingWarnings.length} score error{blockingWarnings.length === 1 ? '' : 's'} must
            be corrected before playback.
          </strong>
          <span>{blockingWarnings[0].message}</span>
        </div>
      )}

      {score.warnings.length > 0 && (
        <div className="scan-score-warnings" aria-label="Score warnings">
          <div className="scan-score-warnings-head">
            <strong>{score.warnings.length} notation warning{score.warnings.length === 1 ? '' : 's'}</strong>
            <span>
              {errors} error{errors === 1 ? '' : 's'} · {uncertain} uncertain event
              {uncertain === 1 ? '' : 's'}
            </span>
          </div>
          <ul>
            {score.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className={warning.severity}>
                <span>{warningWhere(warning)}</span>
                <p>{warning.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {systemRows.length === 0 && (
        <div className="scan-score-empty-state">
          No playable systems were found. Correct the recognized characters, then return here.
        </div>
      )}

      {systemRows.map(({ system, measures }) => (
        <section className="scan-score-system" key={system.index}>
          <header className="scan-score-system-head">
            <div>
              <strong>System {system.index + 1}</strong>
              <span>
                Page {system.page} · column {system.column + 1} · {measures.length} measure
                {measures.length === 1 ? '' : 's'}
              </span>
            </div>
            <span>{Math.round(system.confidence * 100)}% row confidence</span>
          </header>

          <div className="scan-score-row scan-score-measure-head" aria-hidden="true">
            <span>Part and source</span>
            <div className="scan-score-track">
              {measures.map((measure) => (
                <span
                  key={measure.index}
                  className="scan-score-measure-label"
                  style={{ flexGrow: Math.max(1, measure.x1 - measure.x0) }}
                >
                  <b>{measure.number}</b>
                  <em>{flagLabel(measure.flags)}</em>
                </span>
              ))}
            </div>
          </div>

          {system.rows.map((row) => {
            const usedByOthers = new Set(
              system.rows
                .filter((other) => other.lineId !== row.lineId && other.part)
                .map((other) => other.part)
            )
            const rowValue = overrideValue(row.lineId, overrides)
            return (
              <div className="scan-score-row" key={row.lineId}>
                <div className="scan-score-part">
                  <div className="scan-score-part-title">
                    <span
                      className={`scan-score-part-dot${row.part ? '' : ' empty'}`}
                      aria-hidden="true"
                    />
                    <strong>{partLabel(row.part)}</strong>
                    {row.uncertain && <span className="scan-score-uncertain">uncertain</span>}
                  </div>
                  <select
                    value={rowValue}
                    aria-label={`Part for ${row.lineId}`}
                    onChange={(event) => onAssign(row.lineId, selectionValue(event.target.value))}
                  >
                    <option value="__auto__">Auto (label / position)</option>
                    {PART_OPTIONS.map((part) => (
                      <option
                        key={part}
                        value={part}
                        disabled={part !== row.part && usedByOthers.has(part)}
                      >
                        {part}
                      </option>
                    ))}
                    <option value="__unassigned__">Unassigned</option>
                  </select>
                  <span className="scan-score-part-meta">
                    {assignmentSource(row)} · {Math.round(row.confidence * 100)}% OCR
                  </span>
                  {row.error && <span className="scan-score-row-error">{row.error}</span>}
                  <span className="scan-score-source-text" title={row.line.text || row.line.raw_text}>
                    {row.line.text || row.line.raw_text}
                  </span>
                </div>

                <div className="scan-score-track">
                  {measures.map((measure) => {
                    const events = score.events.filter(
                      (event) =>
                        event.system === system.index &&
                        event.measure === measure.index &&
                        event.sourceLineId === row.lineId
                    )
                    return (
                      <div
                        key={measure.index}
                        className={`scan-score-measure${measure.warning ? ' warned' : ''}`}
                        style={{ flexGrow: Math.max(1, measure.x1 - measure.x0) }}
                        title={measure.warning || undefined}
                      >
                        {events.length === 0 && <span className="scan-score-rest">·</span>}
                        {events.map((event) => {
                          const classes = ['scan-score-event']
                          if (event.uncertain) classes.push('uncertain')
                          if (event.corrected) classes.push('corrected')
                          if (event.slur) classes.push('slurred')
                          if (event.id === selectedEventId) classes.push('selected')
                          return (
                            <button
                              type="button"
                              key={event.id}
                              className={classes.join(' ')}
                              title={eventTitle(event)}
                              aria-pressed={event.id === selectedEventId}
                              disabled={!event.source}
                              onClick={() => onSelectEvent(event)}
                            >
                              {event.token}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </section>
      ))}

      <details className="scan-score-text">
        <summary>Aligned player text</summary>
        <p>
          Each voice uses the same detected measure skeleton. Missing beats become rests; notes are
          never repeated or moved into another measure.
        </p>
        <pre>{score.playerText || 'Playback is blocked until every part is assigned.'}</pre>
      </details>

      <p className="scan-mode-note">
        Select a note to highlight its source character. Change a part assignment to correct a
        missing or misread label; the measure alignment stays intact.
      </p>
    </div>
  )
}
