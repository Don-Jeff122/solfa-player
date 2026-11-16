import { useEffect, useRef, useState } from 'react'
import { combineGeminiPagesForCopy } from '../../lib/scan/geminiResults.js'

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

function pageText(page) {
  if (!page) return ''
  return page.mode === 'general' ? page.exactText || '' : page.sheetText || ''
}

const KEY_OPTIONS = [
  'C',
  'C#',
  'Db',
  'D',
  'D#',
  'Eb',
  'E',
  'F',
  'F#',
  'Gb',
  'G',
  'G#',
  'Ab',
  'A',
  'A#',
  'Bb',
  'B',
]

export default function ScanResults({
  result,
  activePage,
  pageCount = 1,
  onPageChange,
  onTextChange,
  onReconvert,
  onUse,
  onUseAll,
  onReadGemini,
  onReadAll,
  readAllLabel,
  remainingCount = 0,
  onRetryFailed,
  failedPages = [],
  canMergeAll = false,
  geminiBusy,
  scanMode,
  error,
}) {
  const [copied, setCopied] = useState('')
  const copyTimer = useRef(0)
  const textRef = useRef(null)
  const generalMode = result?.mode === 'general' || (!result && scanMode === 'general')
  const busy = geminiBusy

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const pages = result?.pageResults || []
  const page = pages.find((entry) => entry.pageNumber === activePage) || null
  const pageGeneral = page?.mode === 'general'
  const combined = combineGeminiPagesForCopy(pages, {
    mode: generalMode ? 'general' : 'solfa',
    pageCount,
    fallbackKey: result?.key,
  })
  const allText = combined.text
  const exact = pageText(page)
  const lineCount = allText.split('\n').filter(Boolean).length
  const key = result?.key
  const needsCorrection = !generalMode && Boolean(result?.parseError)
  const pageParseError = page?.playable?.parseError
  const pageNeedsCorrection =
    !pageGeneral &&
    Boolean(
      pageParseError !== undefined ? pageParseError : result?.parseError
    )
  const keyOptions =
    page?.conversion?.tonic && !KEY_OPTIONS.includes(page.conversion.tonic)
      ? [...KEY_OPTIONS, page.conversion.tonic]
      : KEY_OPTIONS

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

      {failedPages.length > 0 && (
        <div className="scanner-failures">
          <p className="scanner-warn">
            {failedPages.length} page{failedPages.length === 1 ? '' : 's'} could
            not be read. Completed pages are kept.
          </p>
          <ul>
            {failedPages.slice(0, 3).map((failure) => (
              <li key={failure.pageNumber}>
                Page {failure.pageNumber}: {failure.message}
              </li>
            ))}
          </ul>
          {failedPages.length > 3 && (
            <p className="scanner-note">
              {failedPages.length - 3} more page
              {failedPages.length - 3 === 1 ? '' : 's'} failed.
            </p>
          )}
        </div>
      )}

      {!result ? (
        <div className="scanner-empty">
          <h3>Gemini results will appear here</h3>
          <p>
            Choose a page, then press <b>Read with Gemini</b>. Only the current page
            is sent. You can also read every page one at a time.
          </p>
          <ul>
            <li>Automatic mode detects solfa, staff notation or page text.</li>
            <li>Staff notation is converted to editable four-part tonic solfa.</li>
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
              {onReadAll && pageCount > 1 && remainingCount > 0 && (
                <button type="button" className="btn" onClick={onReadAll} disabled={busy}>
                  {readAllLabel || `Read all ${pageCount} pages`}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="scanner-meta">
            <span className="tag">
              {page?.sourceKind === 'musicxml' ? 'MusicXML' : 'Gemini AI'}
            </span>
            <span className="tag">
              {result.pages} page{result.pages === 1 ? '' : 's'}
            </span>
            <span className="tag">
              {lineCount} line{lineCount === 1 ? '' : 's'}
            </span>
            {key && <span className="tag">key {key}</span>}
            {page?.uncertainCount > 0 && (
              <span className="tag warn">{page.uncertainCount} low-confidence</span>
            )}
            <span
              className={
                generalMode ? 'tag' : needsCorrection ? 'tag warn' : 'tag good'
              }
            >
              {generalMode
                ? 'document text'
                : page?.notationType === 'staff'
                  ? 'staff to solfa'
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

          {combined.pages > 1 && (
            <div className="scanner-all-pages">
              <div className="scanner-all-pages-head">
                <span className="tag">combined copy</span>
                <span className="scanner-note">
                  {combined.pages === pageCount
                    ? `All ${pageCount} pages read`
                    : `${combined.pages} of ${pageCount} pages read`}
                </span>
              </div>
              <div className="scanner-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => copy('all-pages', allText)}
                  disabled={!allText.trim()}
                >
                  {copied === 'all-pages'
                    ? `Copied all ${combined.pages} pages`
                    : `Copy all ${combined.pages} pages`}
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
                  disabled={!allText.trim()}
                >
                  Download all .txt
                </button>
              </div>
              {combined.warnings.map((warning) => (
                <p className="scanner-warn" key={warning}>
                  {warning}
                </p>
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
                  {onReadAll && remainingCount > 0 && (
                    <button type="button" className="btn" onClick={onReadAll} disabled={busy}>
                      {readAllLabel}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="scanner-pane-head">
                <label className="scanner-preview-label" htmlFor="scanner-source-text">
                  {pageGeneral
                    ? 'Document transcription'
                    : page.sourceKind === 'musicxml'
                      ? 'MusicXML solfa sheet'
                      : page.notationType === 'staff'
                        ? 'Staff notes converted to solfa'
                        : 'Gemini solfa sheet'}{' '}
                  - page {activePage}
                </label>
                <span className="tag">
                  {page.sourceKind === 'musicxml' ? 'local conversion' : 'Gemini AI'}
                </span>
              </div>
              <p className="scanner-pane-note">
                {pageGeneral
                  ? 'Read by Gemini from the page image. Check every line against the original; AI recognition can be wrong.'
                  : page.sourceKind === 'musicxml'
                    ? 'Converted from the MusicXML score on this device. Check the key, rhythm, notes and voices against the original.'
                    : page.notationType === 'staff'
                      ? 'Read as staff notation and converted to tonic solfa. Check every note, key, rhythm and voice against the original.'
                      : 'Read by Gemini from the page image. Check every row, key and lyric against the original before playing it.'}
              </p>
              {page.sourceScore && (
                <div className="scanner-actions">
                  <label>
                    Key{' '}
                    <select
                      value={page.conversion?.tonic || key || 'C'}
                      onChange={(event) =>
                        onReconvert?.(page.pageNumber, {
                          tonic: event.target.value,
                          mode: page.conversion?.mode || 'major',
                        })
                      }
                      disabled={busy}
                    >
                      {keyOptions.map((option) => (
                        <option value={option} key={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Mode{' '}
                    <select
                      value={page.conversion?.mode || 'major'}
                      onChange={(event) =>
                        onReconvert?.(page.pageNumber, {
                          tonic: page.conversion?.tonic || key || 'C',
                          mode: event.target.value,
                        })
                      }
                      disabled={busy}
                    >
                      <option value="major">major</option>
                      <option value="minor">minor</option>
                    </select>
                  </label>
                  {page.conversion?.displayKey && (
                    <span className="tag">{page.conversion.displayKey}</span>
                  )}
                  {page.uncertainCount > 0 && (
                    <span className="tag warn">
                      {page.uncertainCount} note
                      {page.uncertainCount === 1 ? '' : 's'} need checking
                    </span>
                  )}
                </div>
              )}
              <textarea
                id="scanner-source-text"
                ref={textRef}
                className="scanner-text exact"
                value={exact}
                onChange={(event) => onTextChange(page.pageNumber, event.target.value)}
                rows={Math.min(20, Math.max(8, exact.split('\n').length + 2))}
                spellCheck={false}
                disabled={busy}
                aria-label={`${pageGeneral ? 'Text' : 'Solfa sheet'} for page ${activePage}`}
              />
              <div className="scanner-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => copy('page', exact)}
                  disabled={!exact.trim()}
                >
                  {copied === 'page'
                    ? pages.length > 1
                      ? `Copied page ${page.pageNumber}`
                      : pageGeneral
                        ? 'Copied page text'
                        : 'Copied sheet'
                    : pages.length > 1
                      ? `Copy page ${page.pageNumber}`
                      : pageGeneral
                        ? 'Copy page text'
                        : 'Copy sheet'}
                </button>
                <button type="button" className="btn" onClick={selectAll}>
                  Select all
                </button>
                {pages.length <= 1 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      downloadText(
                        allText,
                        generalMode ? 'document-transcription.txt' : 'solfa-sheet.txt'
                      )
                    }
                    disabled={!allText.trim()}
                  >
                    Download .txt
                  </button>
                )}
                {!pageGeneral && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => onUse?.(page.pageNumber)}
                      disabled={busy || !exact.trim() || pageNeedsCorrection}
                    >
                      {pages.length > 1
                        ? `Use page ${page.pageNumber} in player`
                        : 'Use sheet in player'}
                    </button>
                    {onUseAll && canMergeAll && pages.length > 1 && (
                      <button
                        type="button"
                        className="btn"
                        onClick={onUseAll}
                        disabled={busy || !allText.trim() || needsCorrection}
                      >
                        Use all pages in player
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          <div className="scanner-result-actions">
            {onReadGemini && (
              <button type="button" className="btn" onClick={onReadGemini} disabled={busy}>
                {busy
                  ? 'Reading with Gemini...'
                  : page
                    ? `Read page ${activePage} again`
                    : `Read page ${activePage} with Gemini`}
              </button>
            )}
            {onReadAll && pageCount > 1 && remainingCount > 0 && (
              <button type="button" className="btn" onClick={onReadAll} disabled={busy}>
                {readAllLabel}
              </button>
            )}
            {onRetryFailed &&
              failedPages.length > 0 &&
              remainingCount !== failedPages.length && (
                <button
                  type="button"
                  className="btn"
                  onClick={onRetryFailed}
                  disabled={busy}
                >
                  Retry failed ({failedPages.length})
                </button>
              )}
          </div>
        </>
      )}
    </div>
  )
}
