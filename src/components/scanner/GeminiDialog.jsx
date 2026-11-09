import { useEffect } from 'react'

export default function GeminiDialog({ open, ...props }) {
  if (!open) return null
  return <GeminiDialogContent {...props} />
}

function GeminiDialogContent({
  mode,
  busy,
  error,
  scope = 'page',
  count = 1,
  onCancel,
  onConfirm,
}) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !busy) onCancel?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  const solfa = mode !== 'general'
  const allPages = scope === 'all'
  const noun = count === 1 ? 'page' : 'pages'
  const title = allPages ? 'Read pages with Gemini' : 'Read with Gemini'

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
        aria-label={title}
      >
        <div className="scanner-dialog-head">
          <div>
            <h3>{title}</h3>
            <p>
              Gemini will read {allPages ? `${count} ${noun}, one at a time,` : 'this page'}{' '}
              and return{' '}
              {solfa ? 'an editable four-part solfa sheet' : 'editable document text'}.
              {allPages
                ? ' Each page image is sent separately.'
                : ' Only the current page image is sent.'}
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
          <li>
            {allPages
              ? 'Each page image is processed by Google Gemini, not on this device.'
              : 'The page image is processed by Google Gemini, not on this device.'}
          </li>
          <li>Recognition can be wrong. Check every row, key, lyric and word.</li>
          <li>Your Gemini API key stays on the app&apos;s proxy, never in this browser.</li>
          {allPages && (
            <li>
              This uses at least {count} Gemini request{count === 1 ? '' : 's'} and may
              take several minutes. Free limits can stop the batch; completed pages are kept.
            </li>
          )}
        </ul>

        {error && (
          <p className="scanner-error" role="alert">
            {error}
          </p>
        )}

        <p className="scanner-dialog-note">
          {allPages
            ? 'Pages are read in order and skipped if they already have a result. The app does not save images on the proxy.'
            : 'The app sends only the page you are viewing. It does not save the image on the proxy or send your other pages.'}
        </p>

        <div className="scanner-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy
              ? 'Reading with Gemini…'
              : allPages
                ? `Read ${count} ${noun} with Gemini`
                : 'Send this page to Gemini'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  )
}
