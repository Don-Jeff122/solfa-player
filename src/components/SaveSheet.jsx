export default function SaveSheet({
  name,
  placeholder,
  status,
  feedback,
  canSave,
  canSaveCopy,
  saveLabel,
  conflict,
  onNameChange,
  onSave,
  onSaveCopy,
  onReplace,
  onCancelReplace,
}) {
  const showCopy = canSaveCopy && saveLabel !== 'Save as copy' && saveLabel !== 'Save copy'

  return (
    <section className="save-panel" aria-labelledby="save-sheet-title">
      <div className="save-panel-head">
        <h3 id="save-sheet-title">Save sheet</h3>
        <span className={`save-status ${status.tone}`}>{status.label}</span>
      </div>

      <label className="save-field" htmlFor="sheet-name">
        <span>Sheet name</span>
        <input
          id="sheet-name"
          className="save-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !conflict) {
              e.preventDefault()
              onSave()
            }
            if (e.key === 'Escape' && conflict) onCancelReplace()
          }}
          placeholder={placeholder}
          aria-describedby="save-sheet-help"
          spellCheck={false}
        />
      </label>
      <p className="save-help" id="save-sheet-help">
        Stored in this browser only.
      </p>

      {conflict ? (
        <div className="save-conflict" role="alert">
          <p>
            A saved sheet named <strong>“{conflict.name}”</strong> already exists.
          </p>
          <div className="save-conflict-actions">
            <button type="button" className="btn btn-small btn-danger" onClick={onReplace}>
              Replace
            </button>
            {canSaveCopy && (
              <button type="button" className="btn btn-small" onClick={onSaveCopy}>
                Save as copy
              </button>
            )}
            <button type="button" className="btn btn-small" onClick={onCancelReplace}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="save-actions">
          <button
            type="button"
            className="btn btn-small btn-primary"
            onClick={onSave}
            disabled={!canSave}
          >
            {saveLabel}
          </button>
          {showCopy && (
            <button
              type="button"
              className="btn btn-small"
              onClick={onSaveCopy}
              disabled={!canSaveCopy}
            >
              Save as copy
            </button>
          )}
        </div>
      )}

      {feedback && (
        <p className="save-feedback" role="status">
          {feedback}
        </p>
      )}
    </section>
  )
}
