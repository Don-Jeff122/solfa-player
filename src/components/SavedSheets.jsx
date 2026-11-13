import { useRef, useState } from 'react'
import { searchSheets } from '../lib/sheetStore.js'

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

function importMessage(result) {
  if (!result.imported && result.skipped) {
    return `No new sheets. ${result.skipped} already in the library.`
  }
  const bits = [`Imported ${result.imported} ${result.imported === 1 ? 'sheet' : 'sheets'}`]
  if (result.renamed) bits.push(`${result.renamed} renamed to avoid a clash`)
  if (result.skipped) bits.push(`${result.skipped} already saved`)
  if (result.dropped) bits.push(`${result.dropped} dropped at the ${result.max} sheet limit`)
  return `${bits.join(' · ')}.`
}

/** The library of sheets kept in this browser. */
export default function SavedSheets({
  sheets,
  activeId,
  undo,
  onLoad,
  onDelete,
  onUndoDelete,
  onRename,
  onDuplicate,
  onExport,
  onImport,
}) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editError, setEditError] = useState('')
  const [feedback, setFeedback] = useState(null)
  const importRef = useRef(null)
  const filtered = searchSheets(sheets, query)

  function startRename(sheet) {
    setEditingId(sheet.id)
    setEditName(sheet.name)
    setEditError('')
    setFeedback(null)
  }

  function cancelRename() {
    setEditingId(null)
    setEditName('')
    setEditError('')
  }

  function commitRename() {
    if (!editingId) return
    const name = editName.trim()
    if (!name) {
      setEditError('Enter a name.')
      return
    }
    const result = onRename?.(editingId, name)
    if (!result?.ok) {
      setEditError(result?.error || 'Could not rename that sheet.')
      return
    }
    setFeedback({ tone: 'ok', text: `Renamed to “${result.name}”.` })
    cancelRename()
  }

  function duplicate(sheet) {
    const result = onDuplicate?.(sheet.id)
    if (!result?.ok) {
      setFeedback({ tone: 'error', text: result?.error || 'Could not copy that sheet.' })
      return
    }
    setFeedback({ tone: 'ok', text: `Copied as “${result.name}”.` })
  }

  function exportSheets() {
    const result = onExport?.()
    if (!result?.ok) {
      setFeedback({ tone: 'error', text: result?.error || 'Could not export the library.' })
      return
    }
    setFeedback({
      tone: 'ok',
      text: `Exported ${result.count} ${result.count === 1 ? 'sheet' : 'sheets'}.`,
    })
  }

  async function importSheets(file) {
    if (!file) return
    const result = await onImport?.(file)
    if (!result?.ok) {
      setFeedback({ tone: 'error', text: result?.error || 'Could not import that file.' })
      return
    }
    setFeedback({ tone: 'ok', text: importMessage(result) })
  }

  return (
    <section className="library" aria-labelledby="sheet-library-title">
      <div className="library-head">
        <div>
          <h3 id="sheet-library-title">Sheet library</h3>
          <p className="library-note">Saved in this browser</p>
        </div>
        <span className="library-count">
          {query ? `${filtered.length} of ${sheets.length}` : `${sheets.length} saved`}
        </span>
      </div>

      <div className="library-tools">
        <label className="library-search">
          <span className="sr-only">Search saved sheets</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search names or notes"
            disabled={!sheets.length}
          />
        </label>
        <button
          type="button"
          className="btn btn-small"
          onClick={exportSheets}
          disabled={!sheets.length}
          title="Download a JSON backup of the library"
        >
          Export
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => importRef.current?.click()}
          title="Merge a Solfa Piano JSON backup into this library"
        >
          Import
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void importSheets(file)
          }}
        />
      </div>

      {feedback && (
        <p
          className={`library-feedback ${feedback.tone}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </p>
      )}

      {sheets.length === 0 ? (
        <p className="saved-empty">
          No saved sheets yet. Save a sheet to keep it in this browser, or import a
          backup.
        </p>
      ) : filtered.length === 0 ? (
        <p className="saved-empty">No sheets match “{query.trim()}”.</p>
      ) : (
        <ul className="saved-list" aria-label="Saved sheets">
          {filtered.map((sheet) => {
            const isActive = sheet.id === activeId
            const saved = whenSaved(sheet.savedAt)
            const meta = isActive ? `${saved ? `${saved} · ` : ''}Loaded` : saved
            if (editingId === sheet.id) {
              return (
                <li className={`saved-item editing${isActive ? ' active' : ''}`} key={sheet.id}>
                  <div className="saved-edit">
                    <input
                      className="saved-rename"
                      value={editName}
                      onChange={(event) => {
                        setEditName(event.target.value)
                        setEditError('')
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitRename()
                        }
                        if (event.key === 'Escape') cancelRename()
                      }}
                      aria-label={`Rename ${sheet.name}`}
                      autoFocus
                    />
                    <div className="saved-edit-actions">
                      <button
                        type="button"
                        className="btn btn-small btn-primary"
                        onClick={commitRename}
                        disabled={!editName.trim()}
                      >
                        Save name
                      </button>
                      <button type="button" className="btn btn-small" onClick={cancelRename}>
                        Cancel
                      </button>
                    </div>
                    {editError && (
                      <p className="saved-edit-error" role="alert">
                        {editError}
                      </p>
                    )}
                  </div>
                </li>
              )
            }
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
                    className="btn btn-small"
                    onClick={() => startRename(sheet)}
                    aria-label={`Rename ${sheet.name}`}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => duplicate(sheet)}
                    aria-label={`Duplicate ${sheet.name}`}
                    title="Duplicate this sheet"
                  >
                    Copy
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
