import SourcePreview from './SourcePreview.jsx'

export default function CorrectionBar({
  page,
  char,
  line,
  source,
  draft,
  onDraft,
  onApply,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  saving,
}) {
  const changed = char ? draft !== char.text : false
  return (
    <div className={`scan-correction${char ? ' active' : ''}`}>
      {char && (
        <SourcePreview
          src={source}
          page={page}
          selectedChar={char}
          compact
        />
      )}
      <div className="scan-correction-main">
        {char ? (
          <>
            <div className="scan-correction-meta">
              <span className="scan-correction-label">Correct character</span>
              <span className="scan-correction-confidence">
                {Math.round(char.confidence * 100)}% confidence · {char.kind}
                {char.uncertain ? ' · uncertain' : ''}
              </span>
            </div>
            <form
              className="scan-correction-form"
              onSubmit={(event) => {
                event.preventDefault()
                if (changed) onApply(draft)
              }}
            >
              <input
                value={draft}
                onChange={(event) => onDraft(event.target.value)}
                maxLength={12}
                aria-label={`Replace ${char.text}`}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="submit" className="btn btn-small btn-primary" disabled={!changed || saving}>
                Apply
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => onDraft(char.text)}
                disabled={!changed || saving}
              >
                Reset
              </button>
            </form>
            <p className="scan-correction-note">
              Editing {JSON.stringify(char.text)}
              {line ? ` on line ${line.row + 1}` : ''}. Only this character changes.
            </p>
          </>
        ) : (
          <p className="scan-correction-hint">
            Select any character in the layout or editable text to correct it. Uncertain characters
            are marked in amber.
          </p>
        )}
      </div>
      <div className="scan-history-actions">
        <button
          type="button"
          className="btn btn-small"
          onClick={onUndo}
          disabled={!canUndo || saving}
          title="Undo correction"
        >
          Undo
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={onRedo}
          disabled={!canRedo || saving}
          title="Redo correction"
        >
          Redo
        </button>
      </div>
    </div>
  )
}
