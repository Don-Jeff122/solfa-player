import { useEffect } from 'react'

export default function GeminiDialog({ open, ...props }) {
  if (!open) return null
  return <GeminiDialogContent {...props} />
}

function GeminiDialogContent({ mode, busy, error, onCancel, onConfirm }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !busy) onCancel?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  const solfa = mode !== 'general'

  return (
    <div
      className="scanner-dialog-backdrop"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel?.()
      }}
    >
      <section
        className="scanner-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Read with Gemini"
      >
        <div className="scanner-dialog-head">
          <div>
            <h3>Read with Gemini</h3>
            <p>
              Gemini will read this page and return{' '}
              {solfa ? 'an editable four-part solfa sheet' : 'editable document text'}.
              Only the current page image is sent.
            </p>
          </div>
          <button
            type="button"
            className="scanner-close"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close Gemini dialog"
          >
            ×
          </button>
        </div>

        <ul className="scanner-dialog-list">
          <li>The page image is processed by Google Gemini, not on this device.</li>
          <li>Recognition can be wrong. Check every row, key, lyric and word.</li>
          <li>Your Gemini API key stays on the app’s proxy, never in this browser.</li>
        </ul>

        {error && (
          <p className="scanner-error" role="alert">
            {error}
          </p>
        )}

        <p className="scanner-dialog-note">
          The app sends only the page you are viewing. It does not save the image
          on the proxy or send your other pages.
        </p>

        <div className="scanner-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Reading with Gemini…' : 'Send this page to Gemini'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  )
}
