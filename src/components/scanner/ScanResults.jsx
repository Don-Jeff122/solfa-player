import { useEffect, useRef, useState } from 'react'
import { notesOnly } from '../../lib/scan/notesOnly.js'

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

function modeLabel(result) {
  if (!result) return 'not scanned'
  if (result.mode === 'hymnal') return 'four-part solfa'
  if (result.mode === 'staff') {
    return `rhythm from ${result.staves} staff${result.staves === 1 ? '' : 's'}`
  }
  if (result.mode === 'text') return 'PDF text layer'
  return 'solfa text'
}

function sourceNote(result) {
  const notes = 'Only solfa note lines are kept; headings, lyrics, key lines and part labels are hidden.'
  if (result?.sourceKind === 'pdf-text-layer') {
    return `Notes come from the PDF text layer. ${notes}`
  }
  if (result?.sourceKind === 'layout') {
    return `Notes come from the printed rows and barlines. ${notes}`
  }
  return `Notes come from the page in reading order. ${notes}`
}

function RegionPanel({ region, copied, scanning, onInsert, onReplace, onCopy, onDismiss }) {
  const [draft, setDraft] = useState(region.text || '')

  return (
    <div className="scanner-region-panel">
      <div className="scanner-pane-head">
        <span className="scanner-preview-label">Selected region</span>
        <span className="tag">{Math.round(region.confidence)}% confident</span>
      </div>
      <textarea
        className="scanner-text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={Math.min(12, Math.max(4, draft.split('\n').length + 1))}
        spellCheck={false}
        aria-label="Recognized notes from the selected region"
      />
      <div className="scanner-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onInsert(draft)}
          disabled={!draft.trim() || scanning}
        >
          Insert into notes
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onReplace(draft)}
          disabled={!draft.trim() || scanning}
        >
          Replace page notes
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onCopy(draft)}
          disabled={!draft.trim() || scanning}
        >
          {copied ? 'Copied region' : 'Copy region'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  )
}

function UncertainChips({ entries, onPick }) {
  if (!entries?.length) return null
  const shown = entries.slice(0, 60)
  return (
    <div className="scanner-uncertain">
      <p className="scanner-uncertain-head">
        Check these low-confidence tokens against the page:
      </p>
      <div className="scanner-chips">
        {shown.map((entry, index) => (
          <button
            type="button"
            className="scanner-chip"
            key={`${entry.text}-${entry.line}-${index}`}
            onClick={() => onPick?.(entry)}
            title={`Line ${entry.line}: ${entry.text} (${entry.confidence}% confidence)`}
          >
            <code>{entry.text}</code>
            <span>{entry.confidence}%</span>
          </button>
        ))}
        {entries.length > shown.length && (
          <span className="scanner-chip more">+{entries.length - shown.length} more</span>
        )}
      </div>
    </div>
  )
}

export default function ScanResults({
  result,
  activePage,
  onPageChange,
  onExactChange,
  playableText,
  onPlayableChange,
  onRebuild,
  onUse,
  onRescanPage,
  onRescanAll,
  onScanUnscannedPage,
  exactDirty,
  region,
  onInsertRegion,
  onReplaceRegion,
  onDismissRegion,
  error,
  scanning,
  pageCount,
}) {
  const [copied, setCopied] = useState('')
  const copyTimer = useRef(0)
  const exactRef = useRef(null)
  const playableRef = useRef(null)

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const page = result?.pageResults?.find((entry) => entry.pageNumber === activePage) || null
  const allExact = (result?.pageResults || [])
    .map((entry) => notesOnly(entry.exactText))
    .filter(Boolean)
    .join('\n\n')
  const exact = notesOnly(page?.exactText || '')
  const uncertain = page?.uncertainty || []
  const warnings = result?.warnings || []
  const key = result?.key

  async function copy(label, text) {
    if (!text) return
    const ok = await copyToClipboard(text)
    setCopied(ok ? label : '')
    clearTimeout(copyTimer.current)
    if (ok) copyTimer.current = setTimeout(() => setCopied(''), 1600)
  }

  function selectAll(ref) {
    const area = ref.current
    if (!area) return
    area.focus()
    area.select()
  }

  function pickUncertain(entry) {
    const area = exactRef.current
    if (!area) return
    const index = exact.indexOf(entry.text)
    if (index >= 0) {
      area.focus()
      area.setSelectionRange(index, index + entry.text.length)
      return
    }
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
          <h3>Recognized notes will appear here</h3>
          <p>
            Choose a page, then press <b>Scan this page</b>. Only solfa note lines are
            kept; the original stays visible so you can check every symbol.
          </p>
          <ul>
            <li>Nothing is uploaded; OCR runs on this device.</li>
            <li>Unclear notes are flagged instead of guessed.</li>
            <li>Lyrics, headings, key lines and part labels are hidden.</li>
          </ul>
        </div>
      ) : (
        <>
          <div className="scanner-meta">
            <span className={result.confidence >= 75 ? 'tag good' : 'tag warn'}>
              {Math.round(result.confidence)}% confident
            </span>
            <span className="tag">
              {result.pages} page{result.pages === 1 ? '' : 's'}
            </span>
            <span className="tag">
              {result.lineCount} line{result.lineCount === 1 ? '' : 's'}
            </span>
            {key && <span className="tag">key {key}</span>}
            <span className={result.mode === 'hymnal' ? 'tag good' : 'tag'}>
              {modeLabel(result)}
            </span>
            {result.mode === 'hymnal' && result.bars > 0 && (
              <span className="tag">
                {result.bars} bar{result.bars === 1 ? '' : 's'}
              </span>
            )}
            {result.uncertainCount > 0 && (
              <span className="tag warn">
                {result.uncertainCount} to check
              </span>
            )}
            {result.unreadable > 0 && (
              <span className="tag warn">{result.unreadable} unreadable</span>
            )}
          </div>

          {result.pageResults.length > 1 && (
            <div className="scanner-page-tabs" role="tablist" aria-label="Scanned pages">
              {result.pageResults.map((entry) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={entry.pageNumber === activePage}
                  className={`scanner-page-tab${entry.pageNumber === activePage ? ' active' : ''}`}
                  key={entry.pageNumber}
                  onClick={() => onPageChange(entry.pageNumber - 1)}
                  disabled={scanning}
                >
                  Page {entry.pageNumber}
                  {entry.uncertaintyCount > 0 && <span className="dot" aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}

          {warnings.map((warning) => (
            <p className="scanner-warn" key={warning}>
              {warning}
            </p>
          ))}

          {!page ? (
            <div className="scanner-empty compact">
              <p>
                Page {activePage} has not been scanned yet.
                {pageCount > 1 ? ' Scan it on its own or scan the whole document.' : ''}
              </p>
              <div className="scanner-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onScanUnscannedPage || onRescanPage}
                  disabled={scanning}
                >
                  Scan page {activePage}
                </button>
                {pageCount > 1 && (
                  <button type="button" className="btn" onClick={onRescanAll} disabled={scanning}>
                    Scan all pages
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="scanner-pane-head">
                <label className="scanner-preview-label" htmlFor="scanner-source-text">
                  Notes only · page {activePage}
                </label>
                <span className="tag">
                  {page.sourceKind === 'layout'
                    ? 'rows and bars'
                    : page.sourceKind === 'pdf-text-layer'
                      ? 'PDF text layer'
                      : 'raw OCR'}
                </span>
              </div>
              <p className="scanner-pane-note">{sourceNote(page)}</p>
              <textarea
                id="scanner-source-text"
                ref={exactRef}
                className="scanner-text exact"
                value={exact}
                onChange={(event) => onExactChange(page.pageNumber, event.target.value)}
                rows={Math.min(20, Math.max(8, exact.split('\n').length + 2))}
                spellCheck={false}
                disabled={scanning}
                aria-label={`Notes only for page ${activePage}`}
              />
              <div className="scanner-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => copy('exact', allExact)}
                  disabled={!allExact}
                >
                  {copied === 'exact' ? 'Copied all notes' : 'Copy notes'}
                </button>
                <button type="button" className="btn" onClick={() => selectAll(exactRef)}>
                  Select all
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => downloadText(allExact, 'solfa-notes.txt')}
                  disabled={!allExact}
                >
                  Download .txt
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => copy('playable', playableText)}
                  disabled={!playableText}
                >
                  {copied === 'playable' ? 'Copied playable' : 'Copy playable'}
                </button>
              </div>

              <UncertainChips entries={uncertain} onPick={pickUncertain} />

              {region && (
                    <RegionPanel
                      key={`${region.text || ''}|${region.confidence}`}
                      region={region}
                      copied={copied === 'region'}
                      scanning={scanning}
                      onInsert={onInsertRegion}
                  onReplace={onReplaceRegion}
                  onCopy={(text) => copy('region', text)}
                  onDismiss={onDismissRegion}
                />
              )}

              <div className="scanner-playable">
                <div className="scanner-pane-head">
                  <label className="scanner-preview-label" htmlFor="scanner-text">
                    Playable interpretation
                  </label>
                  <span className="tag">derived · editable</span>
                </div>
                <p className="scanner-pane-note">
                  This is the copy the player will receive. Edit the notes above
                  and rebuild if recognition needs correcting.
                </p>
                <textarea
                  id="scanner-text"
                  ref={playableRef}
                  className="scanner-text"
                  value={playableText}
                  onChange={(event) => onPlayableChange(event.target.value)}
                  rows={Math.min(12, Math.max(4, playableText.split('\n').length + 1))}
                  spellCheck={false}
                  disabled={scanning}
                  aria-label="Playable tonic solfa copy"
                />
                {exactDirty && (
                  <p className="scanner-warn">
                    The notes changed. Rebuild the playable copy so your corrections
                    are the ones that play.
                  </p>
                )}
                <div className="scanner-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={onRebuild}
                    disabled={scanning}
                  >
                    Rebuild playable
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={onUse}
                    disabled={!playableText.trim() || scanning}
                  >
                    Use playable notes
                  </button>
                  <button type="button" className="btn" onClick={() => selectAll(playableRef)}>
                    Select playable
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => copy('playable2', playableText)}
                    disabled={!playableText.trim()}
                  >
                    {copied === 'playable2' ? 'Copied' : 'Copy playable'}
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="scanner-result-actions">
            <button type="button" className="btn" onClick={onRescanPage} disabled={scanning}>
              {scanning ? 'Scanning...' : `Rescan page ${activePage}`}
            </button>
            {pageCount > 1 && (
              <button type="button" className="btn btn-quiet" onClick={onRescanAll} disabled={scanning}>
                Rescan all pages
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

