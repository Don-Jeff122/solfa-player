import { useEffect, useRef, useState } from 'react'

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* Fall through to the textarea copy path. */
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

function downloadText(text, name) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function pageText(page, generalMode) {
  if (!page) return ''
  return generalMode ? page.exactText || '' : page.sheetText || ''
}

export default function ScanResults({
  result,
  activePage,
  onPageChange,
  onTextChange,
  onUse,
  onReadGemini,
  geminiBusy,
  scanMode,
  error,
}) {
  const [copied, setCopied] = useState('')
  const copyTimer = useRef(0)
  const textRef = useRef(null)
  const generalMode = scanMode === 'general'
  const busy = geminiBusy

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const pages = result?.pageResults || []
  const page = pages.find((entry) => entry.pageNumber === activePage) || null
  const allText = pages
    .map((entry) => pageText(entry, generalMode))
    .filter(Boolean)
    .join('\n\n')
  const exact = pageText(page, generalMode)
  const lineCount = allText.split('\n').filter(Boolean).length
  const key = result?.key
  const needsCorrection = !generalMode && Boolean(result?.parseError)

  async function copy(label, text) {
    if (!text) return
    const ok = await copyToClipboard(text)
    setCopied(ok ? label : '')
    clearTimeout(copyTimer.current)
    if (ok) copyTimer.current = setTimeout(() => setCopied(''), 1600)
  }

  function selectAll() {
    const area = textRef.current
    if (!area) return
    area.focus()
    area.select()
  }

  return (
    <div className="scanner-results">
      {error && (
        <p className="scanner-error" role="alert">
          {error}
        </p>
      )}

      {!result ? (
        <div className="scanner-empty">
          <h3>Gemini results will appear here</h3>
          <p>
            Choose a page, then press <b>Read with Gemini</b>. Only the current page
            is sent.
          </p>
          <ul>
            <li>Solfa mode returns editable four-part sheet rows.</li>
            <li>General document mode returns editable page text.</li>
            <li>Check the result against the original before using it.</li>
          </ul>
          {onReadGemini && (
            <div className="scanner-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={onReadGemini}
                disabled={busy}
              >
                {busy ? 'Reading with Gemini...' : 'Read with Gemini'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="scanner-meta">
            <span className="tag">Gemini AI</span>
            <span className="tag">
              {result.pages} page{result.pages === 1 ? '' : 's'}
            </span>
            <span className="tag">
              {lineCount} line{lineCount === 1 ? '' : 's'}
            </span>
            {key && <span className="tag">key {key}</span>}
            <span
              className={
                generalMode ? 'tag' : needsCorrection ? 'tag warn' : 'tag good'
              }
            >
              {generalMode
                ? 'document text'
                : needsCorrection
                  ? 'needs correction'
                  : 'solfa sheet'}
            </span>
          </div>

          {pages.length > 1 && (
            <div className="scanner-page-tabs" role="tablist" aria-label="Read pages">
              {pages.map((entry) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={entry.pageNumber === activePage}
                  className={`scanner-page-tab${
                    entry.pageNumber === activePage ? ' active' : ''
                  }`}
                  key={entry.pageNumber}
                  onClick={() => onPageChange(entry.pageNumber - 1)}
                  disabled={busy}
                >
                  Page {entry.pageNumber}
                </button>
              ))}
            </div>
          )}

          {result.warnings?.map((warning) => (
            <p className="scanner-warn" key={warning}>
              {warning}
            </p>
          ))}

          {!page ? (
            <div className="scanner-empty compact">
              <p>Page {activePage} has not been read by Gemini yet.</p>
              {onReadGemini && (
                <div className="scanner-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={onReadGemini}
                    disabled={busy}
                  >
                    {busy ? 'Reading with Gemini...' : `Read page ${activePage} with Gemini`}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="scanner-pane-head">
                <label className="scanner-preview-label" htmlFor="scanner-source-text">
                  {generalMode ? 'Document transcription' : 'Gemini solfa sheet'} - page{' '}
                  {activePage}
                </label>
                <span className="tag">Gemini AI</span>
              </div>
              <p className="scanner-pane-note">
                {generalMode
                  ? 'Read by Gemini from the page image. Check every line against the original; AI recognition can be wrong.'
                  : 'Read by Gemini from the page image. Check every row, key and lyric against the original before playing it.'}
              </p>
              <textarea
                id="scanner-source-text"
                ref={textRef}
                className="scanner-text exact"
                value={exact}
                onChange={(event) => onTextChange(page.pageNumber, event.target.value)}
                rows={Math.min(20, Math.max(8, exact.split('\n').length + 2))}
                spellCheck={false}
                disabled={busy}
                aria-label={`Gemini ${generalMode ? 'text' : 'solfa sheet'} for page ${activePage}`}
              />
              <div className="scanner-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => copy('all', allText)}
                  disabled={!allText}
                >
                  {copied === 'all'
                    ? generalMode
                      ? 'Copied all text'
                      : 'Copied all sheets'
                    : generalMode
                      ? 'Copy all text'
                      : 'Copy all sheets'}
                </button>
                <button type="button" className="btn" onClick={selectAll}>
                  Select all
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    downloadText(
                      allText,
                      generalMode ? 'document-transcription.txt' : 'solfa-sheet.txt'
                    )
                  }
                  disabled={!allText}
                >
                  Download .txt
                </button>
                {!generalMode && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={onUse}
                    disabled={busy || !allText.trim() || needsCorrection}
                  >
                    Use sheet in player
                  </button>
                )}
              </div>
            </>
          )}

          <div className="scanner-result-actions">
            {onReadGemini && (
              <button type="button" className="btn" onClick={onReadGemini} disabled={busy}>
                {busy ? 'Reading with Gemini...' : `Read page ${activePage} again`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
