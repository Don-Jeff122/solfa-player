function whenSaved(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** The library of sheets kept in this browser, with load and delete. */
export default function SavedSheets({ sheets, onLoad, onDelete }) {
  return (
    <details className="saved">
      <summary>Saved sheets{sheets.length ? ` (${sheets.length})` : ''}</summary>
      {sheets.length === 0 ? (
        <p className="saved-empty">
          Nothing saved yet. Name a sheet and press <b>Save</b> to keep it here — it stays in this
          browser, so you can load it again next time.
        </p>
      ) : (
        <ul className="saved-list">
          {sheets.map((sheet) => (
            <li className="saved-item" key={sheet.id}>
              <span className="saved-name" title={sheet.name}>
                {sheet.name}
              </span>
              <span className="saved-when">{whenSaved(sheet.savedAt)}</span>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => onLoad(sheet)}
                aria-label={`Load ${sheet.name}`}
              >
                Load
              </button>
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => onDelete(sheet.id)}
                aria-label={`Delete ${sheet.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
