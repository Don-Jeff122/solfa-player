function whenSaved(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round((startOfToday - startOfDate) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days > 1 && days < 7) return `${days} days ago`
  const options = { day: 'numeric', month: 'short' }
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric'
  return date.toLocaleDateString(undefined, options)
}

/** The library of sheets kept in this browser. */
export default function SavedSheets({
  sheets,
  activeId,
  undo,
  onLoad,
  onDelete,
  onUndoDelete,
}) {
  return (
    <section className="library" aria-labelledby="sheet-library-title">
      <div className="library-head">
        <div>
          <h3 id="sheet-library-title">Sheet library</h3>
          <p className="library-note">Saved in this browser</p>
        </div>
        <span className="library-count">{sheets.length} saved</span>
      </div>

      {sheets.length === 0 ? (
        <p className="saved-empty">
          No saved sheets yet. Save a sheet to keep it in this browser.
        </p>
      ) : (
        <ul className="saved-list" aria-label="Saved sheets">
          {sheets.map((sheet) => {
            const isActive = sheet.id === activeId
            const saved = whenSaved(sheet.savedAt)
            const meta = isActive ? `${saved ? `${saved} · ` : ''}Loaded` : saved
            return (
              <li
                className={`saved-item${isActive ? ' active' : ''}`}
                key={sheet.id}
                aria-current={isActive ? 'true' : undefined}
              >
                <div className="saved-copy">
                  <span className="saved-name" title={sheet.name}>
                    {sheet.name}
                  </span>
                  {meta && <span className="saved-when">{meta}</span>}
                </div>
                <div className="saved-actions">
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
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {undo && (
        <div className="library-undo" role="status">
          <span>Deleted “{undo.sheet.name}”.</span>
          <button type="button" className="library-undo-btn" onClick={onUndoDelete}>
            Undo
          </button>
        </div>
      )}
    </section>
  )
}
