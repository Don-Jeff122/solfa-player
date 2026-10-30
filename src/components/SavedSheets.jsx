import StarterSheet from './StarterSheet.jsx'

function whenSaved(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** The built-in starter sheet plus the library kept in this browser. */
export default function SavedSheets({ sheets, samples = [], onLoad, onDelete }) {
  return (
    <section className="library" aria-labelledby="sheet-library-title">
      <div className="library-head">
        <div>
          <h3 id="sheet-library-title">Sheet library</h3>
          <p className="library-note">Saved in this browser</p>
        </div>
        <span className="library-count">{sheets.length} saved</span>
      </div>

      {samples.length > 0 && (
        <div className="starter-list">
          {samples.map((sample) => (
            <StarterSheet key={sample.id} sheet={sample} onLoad={onLoad} />
          ))}
        </div>
      )}

      {sheets.length === 0 ? (
        <p className="saved-empty">
          No saved sheets yet. Load the starter sheet above, or name your sheet and press <b>Save</b>{' '}
          to keep it here.
        </p>
      ) : (
        <ul className="saved-list" aria-label="Saved sheets">
          {sheets.map((sheet) => {
            const saved = whenSaved(sheet.savedAt)
            return (
              <li className="saved-item" key={sheet.id}>
                <div className="saved-copy">
                  <span className="saved-name" title={sheet.name}>
                    {sheet.name}
                  </span>
                  {saved && <span className="saved-when">{saved}</span>}
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
    </section>
  )
}
