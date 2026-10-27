import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  apiUrl,
  checkHealth,
  deleteDocument,
  getScan,
  getScanPage,
  saveCorrections,
  startDocumentScan,
  uploadDocument,
} from '../lib/scanApi.js'
import {
  baseName,
  countUncertain,
  downloadBlob,
  findChar,
  orderedPages,
  pagesToPlayerText,
  pagesToSvg,
  pagesToText,
  patchPageChar,
  validateScanFile,
} from '../lib/scanLayout.js'
import { buildScannedScore } from '../lib/scanScore.ts'
import CorrectionBar from './scanner/CorrectionBar.jsx'
import EditablePage from './scanner/EditablePage.jsx'
import LayoutPage from './scanner/LayoutPage.jsx'
import MusicReview from './scanner/MusicReview.tsx'
import ScanUpload from './scanner/ScanUpload.jsx'
import SourcePreview from './scanner/SourcePreview.jsx'

const MODES = [
  ['compare', 'Compare'],
  ['layout', 'Original layout'],
  ['text', 'Editable text'],
  ['parts', 'Parts'],
]

function asError(err) {
  return {
    message: err?.message || 'Something went wrong while scanning.',
    hint: err?.hint || '',
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const copied = document.execCommand('copy')
  area.remove()
  if (!copied) throw new Error('Clipboard access is not available.')
}

export default function SolfaScanner({ open, onClose, onUseText }) {
  const [doc, setDoc] = useState(null)
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageResults, setPageResults] = useState({})
  const [mode, setMode] = useState('compare')
  const [scope, setScope] = useState('all')
  const [zoom, setZoom] = useState(1)
  const [selected, setSelected] = useState(null)
  const [draft, setDraft] = useState('')
  const [history, setHistory] = useState({})
  const [partOverrides, setPartOverrides] = useState({})
  const [partHistory, setPartHistory] = useState({ undo: [], redo: [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [backend, setBackend] = useState({ state: 'checking', detail: '' })
  const closeRef = useRef(null)
  const dialogRef = useRef(null)

  const processing = status?.status === 'queued' || status?.status === 'processing'
  const failed = status?.status === 'failed'
  const pageCount = doc?.page_count || 1
  const currentResult = pageResults[pageNumber] || null
  const currentPageSummary =
    status?.pages?.find((page) => page.page === pageNumber) ||
    doc?.pages?.[pageNumber - 1] ||
    null
  const pageForOverlay = currentResult || {
    page: pageNumber,
    width: currentPageSummary?.width || 1,
    height: currentPageSummary?.height || 1,
  }
  const currentSource = doc
    ? apiUrl(
        currentResult?.image_url ||
          doc.preview_urls?.[pageNumber - 1] ||
          `/api/documents/${doc.id}/pages/${pageNumber}/preview`
      )
    : ''
  const selectedInfo = useMemo(
    () => (currentResult && selected?.page === pageNumber ? findChar(currentResult, selected.charId) : null),
    [currentResult, selected, pageNumber]
  )
  const currentHistory = history[pageNumber] || { undo: [], redo: [] }
  const scannedPages = useMemo(
    () =>
      orderedPages(pageResults).map((page) => page.page).filter((page) =>
        status?.pages?.find((item) => item.page === page)?.status === 'completed'
      ),
    [pageResults, status]
  )
  const hasResults = scannedPages.length > 0
  const anyCorrections = Object.values(history).some((entry) => entry.undo.length > 0)
  const uncertainTotal = Object.values(pageResults).reduce(
    (count, page) => count + countUncertain(page),
    0
  )
  const scoreState = useMemo(() => {
    if (!hasResults) return { score: null, error: null }
    try {
      return {
        score: buildScannedScore(pageResults, { partOverrides }),
        error: null,
      }
    } catch (err) {
      return { score: null, error: asError(err) }
    }
  }, [hasResults, pageResults, partOverrides])
  const score = scoreState.score
  const selectedEventId = useMemo(() => {
    if (!score || !selected) return null
    return (
      score.events.find(
        (event) => event.page === selected.page && event.source?.charIds.includes(selected.charId)
      )?.id || null
    )
  }, [score, selected])

  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previous = document.body.style.overflow
    const app = document.querySelector('.app')
    const previousInert = app?.inert
    document.body.style.overflow = 'hidden'
    if (app) app.inert = true
    const timer = setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 20)
    return () => {
      document.body.style.overflow = previous
      if (app) app.inert = previousInert
      clearTimeout(timer)
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    checkHealth(controller.signal, {
      onRetry: () =>
        setBackend({
          state: 'waking',
          detail: 'The OCR service is starting. This can take up to a minute.',
        }),
    })
      .then((payload) => {
        setBackend({ state: 'ready', detail: payload.ocr || 'OCR ready' })
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          setBackend({ state: 'offline', detail: err?.hint || err?.message || '' })
        }
      })
    return () => controller.abort()
  }, [open])

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!open || !error) return undefined
    const timer = setTimeout(() => {
      dialogRef.current
        ?.querySelector('.scan-error')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 40)
    return () => clearTimeout(timer)
  }, [error, open])

  useEffect(() => {
    if (!open) return undefined
    const handler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !doc || !status) return undefined
    if (status.status !== 'completed' && status.status !== 'failed') return undefined
    const completed = (status.pages || [])
      .filter((page) => page.status === 'completed')
      .map((page) => page.page)
    if (!completed.length) return undefined
    if (completed.every((page) => pageResults[page])) return undefined
    const controller = new AbortController()
    Promise.all(completed.map((page) => getScanPage(doc.id, page, controller.signal)))
      .then((pages) => {
        setPageResults((previous) => {
          const next = { ...previous }
          for (const page of pages) next[page.page] = page
          return next
        })
        setPageNumber((current) => (completed.includes(current) ? current : completed[0]))
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(asError(err))
      })
    return () => controller.abort()
  }, [open, doc, status, pageResults])

  useEffect(() => {
    if (!open || !doc || !processing) return undefined
    const controller = new AbortController()
    let stopped = false
    let timer = 0
    const poll = async () => {
      try {
        const next = await getScan(doc.id, controller.signal)
        if (stopped) return
        setStatus(next)
        if (next.status === 'completed' || next.status === 'failed') return
        timer = setTimeout(poll, 1100)
      } catch (err) {
        if (stopped || err?.name === 'AbortError') return
        if (err?.status === 404) {
          setStatus((previous) =>
            previous
              ? {
                  ...previous,
                  status: 'failed',
                  stage: 'Scan expired',
                  error: err.message,
                  error_hint: 'The backend no longer has this scan. Upload the document again.',
                }
              : previous
          )
          return
        }
        setError(asError(err))
        timer = setTimeout(poll, 3000)
      }
    }
    timer = setTimeout(poll, 350)
    return () => {
      stopped = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, doc, processing])

  const resetRecognition = () => {
    setStatus(null)
    setPageResults({})
    setHistory({})
    setPartOverrides({})
    setPartHistory({ undo: [], redo: [] })
    setSelected(null)
    setDraft('')
    setPageNumber(1)
    setMode('compare')
    setZoom(1)
    setError(null)
    setNotice(null)
  }

  const handleFile = async (nextFile) => {
    const validation = validateScanFile(nextFile)
    if (validation) {
      setError({ message: validation, hint: '' })
      return
    }
    setFile(nextFile)
    setDoc(null)
    resetRecognition()
    setUploading(true)
    setScope('all')
    try {
      const uploaded = await uploadDocument(nextFile)
      setDoc(uploaded)
      setNotice(`Loaded ${uploaded.filename}. Choose a page scope and scan.`)
    } catch (err) {
      setError(asError(err))
    } finally {
      setUploading(false)
    }
  }

  const handleNewFile = () => {
    if (processing || uploading || saving) return
    if (anyCorrections && !window.confirm('Start over with a new file? Current corrections will be lost.')) {
      return
    }
    if (doc) deleteDocument(doc.id).catch(() => {})
    setDoc(null)
    setFile(null)
    resetRecognition()
  }

  const handleScan = async () => {
    if (!doc || processing || uploading || saving) return
    if (anyCorrections && !window.confirm('Rescan this document? Recognition and corrections will be replaced.')) {
      return
    }
    if (
      hasResults &&
      doc.kind === 'pdf' &&
      scope === 'current' &&
      !window.confirm(
        'A page scan starts a fresh job. Results and corrections for other pages will be cleared. Continue?'
      )
    ) {
      return
    }
    const pages =
      doc.kind === 'image' || scope === 'all'
        ? Array.from({ length: doc.page_count }, (_, index) => index + 1)
        : [pageNumber]
    setError(null)
    setNotice(null)
    try {
      const next = await startDocumentScan(doc.id, pages)
      setPageResults({})
      setHistory({})
      setPartOverrides({})
      setPartHistory({ undo: [], redo: [] })
      setSelected(null)
      setDraft('')
      setStatus(next)
      if (!pages.includes(pageNumber)) setPageNumber(pages[0])
    } catch (err) {
      setError(asError(err))
    }
  }

  const changePage = (next) => {
    if (saving) return
    const value = Math.min(pageCount, Math.max(1, Number(next) || 1))
    setPageNumber(value)
    setSelected(null)
    setDraft('')
    setError(null)
  }

  const selectChar = (char) => {
    if (!currentResult) return
    setSelected({ page: pageNumber, charId: char.id })
    setDraft(char.text)
    setError(null)
  }

  const commitCorrection = async (charId, text) => {
    const page = pageResults[pageNumber]
    const info = findChar(page, charId)
    if (!page || !info || text === info.char.text) return { ok: false, page }
    setSaving(true)
    setError(null)
    setPageResults((previous) => ({
      ...previous,
      [page.page]: patchPageChar(page, charId, text),
    }))
    try {
      const saved = await saveCorrections(doc.id, [{ char_id: charId, text }])
      setPageResults((previous) => ({ ...previous, [saved.page]: saved }))
      return { ok: true, page: saved }
    } catch (err) {
      setPageResults((previous) => ({ ...previous, [page.page]: page }))
      setError(asError(err))
      return { ok: false, page }
    } finally {
      setSaving(false)
    }
  }

  const recordAction = (page, charId, from, to) => {
    setHistory((previous) => {
      const state = previous[page] || { undo: [], redo: [] }
      return {
        ...previous,
        [page]: {
          undo: [...state.undo, { charId, from, to }],
          redo: [],
        },
      }
    })
  }

  const applyCorrection = async (text) => {
    if (!selectedInfo || !text || text === selectedInfo.char.text) return
    const { char } = selectedInfo
    const result = await commitCorrection(char.id, text)
    if (!result.ok) return
    recordAction(pageNumber, char.id, char.text, text)
    setDraft(text)
    setSelected({ page: pageNumber, charId: char.id })
    setNotice('Correction saved.')
  }

  const moveHistory = async (direction) => {
    const state = history[pageNumber] || { undo: [], redo: [] }
    const source = direction === 'undo' ? state.undo : state.redo
    const entry = source[source.length - 1]
    if (!entry || saving) return
    const targetText = direction === 'undo' ? entry.from : entry.to
    const result = await commitCorrection(entry.charId, targetText)
    if (!result.ok) return
    setSelected({ page: pageNumber, charId: entry.charId })
    setDraft(targetText)
    setHistory((previous) => {
      const current = previous[pageNumber] || { undo: [], redo: [] }
      if (direction === 'undo') {
        return {
          ...previous,
          [pageNumber]: {
            undo: current.undo.slice(0, -1),
            redo: [...current.redo, entry],
          },
        }
      }
      return {
        ...previous,
        [pageNumber]: {
          undo: [...current.undo, entry],
          redo: current.redo.slice(0, -1),
        },
      }
    })
    setNotice(direction === 'undo' ? 'Correction undone.' : 'Correction redone.')
  }

  const assignPart = (lineId, value) => {
    const hasOverride = Object.prototype.hasOwnProperty.call(partOverrides, lineId)
    const from = hasOverride ? partOverrides[lineId] : undefined
    if (from === value) return
    setPartOverrides((previous) => {
      const next = { ...previous }
      if (value === undefined) delete next[lineId]
      else next[lineId] = value
      return next
    })
    setPartHistory((previous) => ({
      undo: [...previous.undo, { lineId, from, to: value }],
      redo: [],
    }))
    setError(null)
  }

  const movePartHistory = (direction) => {
    const source = direction === 'undo' ? partHistory.undo : partHistory.redo
    const entry = source[source.length - 1]
    if (!entry) return
    const value = direction === 'undo' ? entry.from : entry.to
    setPartOverrides((previous) => {
      const next = { ...previous }
      if (value === undefined) delete next[entry.lineId]
      else next[entry.lineId] = value
      return next
    })
    setPartHistory((previous) => {
      if (direction === 'undo') {
        return {
          undo: previous.undo.slice(0, -1),
          redo: [...previous.redo, entry],
        }
      }
      return {
        undo: [...previous.undo, entry],
        redo: previous.redo.slice(0, -1),
      }
    })
  }

  const selectScoreEvent = (event) => {
    const charId = event.source?.charIds?.[0]
    if (!charId) return
    if (event.page !== pageNumber) setPageNumber(event.page)
    const info = findChar(pageResults[event.page], charId)
    setSelected({ page: event.page, charId })
    setDraft(info?.char.text || '')
    setError(null)
  }

  const handleCopy = async () => {
    if (!hasResults) return
    try {
      await copyText(pagesToText(pageResults))
      setNotice('Recognized text copied.')
    } catch (err) {
      setError(asError(err))
    }
  }

  const handleDownloadText = () => {
    if (!hasResults) return
    downloadBlob(
      pagesToText(pageResults),
      'text/plain;charset=utf-8',
      `${baseName(doc.filename)}-scan.txt`
    )
    setNotice('Editable text downloaded.')
  }

  const handleDownloadSvg = () => {
    if (!hasResults) return
    try {
      downloadBlob(
        pagesToSvg(pageResults),
        'image/svg+xml;charset=utf-8',
        `${baseName(doc.filename)}-layout.svg`
      )
      setNotice('Layout SVG downloaded.')
    } catch (err) {
      setError(asError(err))
    }
  }

  const handleUseText = () => {
    if (scoreState.error) {
      setMode('parts')
      setError(scoreState.error)
      return
    }
    if (score?.stats.unassignedLines) {
      setMode('parts')
      setError({
        message: 'Assign every recognized music line before sending the score.',
        hint: 'Open the Parts tab, then choose Soprano, Alto, Tenor, Bass or Main for each line.',
      })
      return
    }
    const scoreErrors = score?.warnings.filter((warning) => warning.severity === 'error') || []
    if (scoreErrors.length > 0) {
      setMode('parts')
      setError({
        message: `${scoreErrors.length} score error${scoreErrors.length === 1 ? '' : 's'} must be corrected before sending the score.`,
        hint: scoreErrors[0].message,
      })
      return
    }
    const aligned = score?.playerText?.trim() || ''
    if (aligned) {
      onUseText?.(aligned)
      onClose()
      return
    }
    const raw = pagesToPlayerText(pageResults).trim()
    if (!raw) {
      setError({ message: 'There is no recognized text to send to the player.', hint: '' })
      return
    }
    if (
      !window.confirm(
        'No measure-aligned notes were found. Send the raw recognized text to the player instead? It may include labels or lyrics that are not playable.'
      )
    ) {
      return
    }
    onUseText?.(raw)
    onClose()
  }

  const zoomBy = (delta) => {
    setZoom((value) => Math.min(2.5, Math.max(0.5, Math.round((value + delta) * 100) / 100)))
  }

  if (!open) return null

  const content = (
    <div
      className="scan-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="scan-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-title"
        ref={dialogRef}
      >
        <header className="scan-header">
          <div>
            <p className="scan-eyebrow">Layout-aware OCR</p>
            <h2 id="scan-title">Scan Solfa</h2>
            <p className="scan-subtitle">
              Read notation from images and PDFs, then correct and export it without changing the
              player.
            </p>
          </div>
          <div className="scan-header-actions">
            <span
              className={`scan-backend ${backend.state}`}
              title={backend.detail || 'Scanner backend status'}
            >
              {backend.state === 'ready'
                ? 'OCR service online'
                : backend.state === 'offline'
                  ? 'OCR backend offline'
                  : backend.state === 'waking'
                    ? 'Waking OCR service…'
                    : 'Checking OCR backend…'}
            </span>
            {doc && (
              <button
                type="button"
                className="btn btn-small"
                onClick={handleNewFile}
                disabled={processing || uploading || saving}
              >
                New file
              </button>
            )}
            <button
              type="button"
              className="scan-close"
              onClick={onClose}
              aria-label="Close scanner"
              ref={closeRef}
            >
              ×
            </button>
          </div>
        </header>

        <div className="scan-body">
          {error && (
            <div className="error-box scan-error" role="alert">
              <div>
                <strong>{error.message}</strong>
                {error.hint && <span>{error.hint}</span>}
              </div>
              <button type="button" className="btn btn-small" onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          )}
          {notice && (
            <div className="scan-notice" role="status">
              {notice}
            </div>
          )}
          {scoreState.error && (
            <div className="error-box scan-error" role="alert">
              <div>
                <strong>Could not align the recognized music.</strong>
                <span>{scoreState.error.message}</span>
              </div>
              <button type="button" className="btn btn-small" onClick={() => setMode('text')}>
                Review text
              </button>
            </div>
          )}

          {!doc && (
            <div className="scan-start">
              <ScanUpload onFile={handleFile} disabled={uploading} />
              {uploading && (
                <div className="scan-uploading" role="status">
                  <span className="scan-spinner" />
                  Uploading {file?.name || 'document'}…
                </div>
              )}
              <div className="scan-steps">
                <div>
                  <b>1</b>
                  <span>Upload</span>
                  <small>Images, screenshots, photos or multipage PDFs.</small>
                </div>
                <div>
                  <b>2</b>
                  <span>Recognize</span>
                  <small>PaddleOCR reads text boxes; the layout is rebuilt from coordinates.</small>
                </div>
                <div>
                  <b>3</b>
                  <span>Correct & export</span>
                  <small>Fix uncertain characters, copy text or export the visual layout.</small>
                </div>
              </div>
              <p className="scan-privacy">
                Files are held only for the configured temporary window (two hours by default).
                Recognition is never described as perfect; confidence and uncertain characters are
                shown for review.
              </p>
            </div>
          )}

          {doc && (
            <>
              <div className="scan-document-bar">
                <div className="scan-document-name">
                  <strong title={doc.filename}>{doc.filename}</strong>
                  <span>
                    {doc.kind === 'pdf'
                      ? `${doc.page_count} page PDF`
                      : 'Image'}{' '}
                    · {currentPageSummary?.width || 0} × {currentPageSummary?.height || 0} px
                  </span>
                </div>
                <div className="scan-page-nav">
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => changePage(pageNumber - 1)}
                    disabled={pageNumber <= 1 || saving}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>
                  <label>
                    Page
                    <select
                      value={pageNumber}
                      onChange={(event) => changePage(event.target.value)}
                      disabled={saving}
                    >
                      {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
                        <option key={page} value={page}>
                          {page}
                          {status?.pages?.find((item) => item.page === page)?.status === 'completed'
                            ? ' · scanned'
                            : ''}
                        </option>
                      ))}
                    </select>
                    of {pageCount}
                  </label>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => changePage(pageNumber + 1)}
                    disabled={pageNumber >= pageCount || saving}
                    aria-label="Next page"
                  >
                    ›
                  </button>
                </div>
              </div>

              <div className="scan-controls">
                {doc.kind === 'pdf' && doc.page_count > 1 ? (
                  <fieldset className="scan-scope" disabled={processing || uploading}>
                    <legend>Scan scope</legend>
                    <label>
                      <input
                        type="radio"
                        name="scan-scope"
                        value="current"
                        checked={scope === 'current'}
                        onChange={() => setScope('current')}
                      />
                      Current page ({pageNumber})
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="scan-scope"
                        value="all"
                        checked={scope === 'all'}
                        onChange={() => setScope('all')}
                      />
                      Whole document ({doc.page_count} pages)
                    </label>
                  </fieldset>
                ) : (
                  <p className="scan-scope-note">
                    {doc.kind === 'image' ? 'Single image scan.' : 'One-page PDF scan.'}
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-primary scan-scan-btn"
                  onClick={handleScan}
                  disabled={processing || uploading || saving}
                >
                  {processing
                    ? 'Scanning…'
                    : scope === 'current'
                      ? `${currentResult ? 'Rescan' : 'Scan'} page ${pageNumber}`
                      : hasResults
                        ? 'Rescan document'
                        : `Scan ${doc.page_count === 1 ? 'page' : `all ${doc.page_count} pages`}`}
                </button>
              </div>
              {hasResults && doc.kind === 'pdf' && scope === 'current' && (
                <p className="scan-scope-warning">
                  A page scan starts a fresh job and clears results for the other pages.
                </p>
              )}

              {(processing || uploading) && (
                <div className="scan-progress" role="status" aria-live="polite">
                  <div className="scan-progress-label">
                    <span>{uploading ? 'Uploading document…' : status?.stage || 'Scanning…'}</span>
                    <span>{status?.progress ?? 0}%</span>
                  </div>
                  <div
                    className="scan-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={status?.progress ?? 0}
                  >
                    <span style={{ width: `${status?.progress ?? 3}%` }} />
                  </div>
                  <p>
                    The first scan initializes and may download the PaddleOCR models. Audio playback
                    is not touched.
                  </p>
                </div>
              )}

              {failed && (
                <div className="error-box scan-error" role="alert">
                  <div>
                    <strong>{status?.error || 'Scan failed.'}</strong>
                    <span>{status?.error_hint || 'Check the backend log, then retry.'}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={handleScan}
                    disabled={saving}
                  >
                    Retry scan
                  </button>
                </div>
              )}

              {currentResult ? (
                <div className="scan-result">
                  {currentResult.lines.length === 0 && (
                    <div className="scan-empty-banner" role="status">
                      <strong>No text was recognized on this page.</strong>
                      <span>
                        Check that the scan is sharp and upright, or try a tighter crop with more
                        contrast. An empty result is not treated as an error or filled with sample
                        notation.
                      </span>
                    </div>
                  )}
                  <div className="scan-result-bar">
                    <div className="scan-tabs" role="group" aria-label="Result view">
                      {MODES.map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={mode === value}
                          className={mode === value ? 'active' : ''}
                          onClick={() => setMode(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="scan-result-meta">
                      <span>
                        {mode === 'parts' && score
                          ? `${score.stats.systems} systems | ${score.stats.measures} measures | ${score.stats.events} scored notes`
                          : `${currentResult.lines.length} lines | ${currentResult.uncertain_count} uncertain | ${Math.round(currentResult.mean_confidence * 100)}% mean confidence`}
                      </span>
                      {(mode === 'compare' || mode === 'layout') && (
                        <div className="scan-zoom" aria-label="Layout zoom">
                          <button type="button" onClick={() => zoomBy(-0.25)} disabled={zoom <= 0.5}>
                            −
                          </button>
                          <span>{Math.round(zoom * 100)}%</span>
                          <button type="button" onClick={() => zoomBy(0.25)} disabled={zoom >= 2.5}>
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <CorrectionBar
                    page={pageForOverlay}
                    char={selectedInfo?.char}
                    line={selectedInfo?.line}
                    source={currentSource}
                    draft={draft}
                    onDraft={setDraft}
                    onApply={applyCorrection}
                    onUndo={() => moveHistory('undo')}
                    onRedo={() => moveHistory('redo')}
                    canUndo={currentHistory.undo.length > 0}
                    canRedo={currentHistory.redo.length > 0}
                    saving={saving}
                  />

                  {mode === 'compare' && (
                    <div className="scan-compare">
                      <SourcePreview
                        src={currentSource}
                        page={pageForOverlay}
                        selectedChar={selectedInfo?.char}
                      />
                      <div className="scan-layout-scroll">
                        <div className="scan-layout-sheet" style={{ width: `${zoom * 100}%` }}>
                          <LayoutPage
                            page={currentResult}
                            selectedId={selectedInfo?.char?.id}
                            onSelect={selectChar}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  {mode === 'layout' && (
                    <div className="scan-layout-scroll">
                      <div className="scan-layout-sheet" style={{ width: `${zoom * 100}%` }}>
                        <LayoutPage
                          page={currentResult}
                          selectedId={selectedInfo?.char?.id}
                          onSelect={selectChar}
                        />
                      </div>
                    </div>
                  )}
                  {mode === 'text' && (
                    <>
                      <EditablePage
                        page={currentResult}
                        selectedId={selectedInfo?.char?.id}
                        onSelect={selectChar}
                      />
                      <p className="scan-mode-note">
                        This view preserves detected lines and wide column gaps. Copying into another
                        app may change spacing or formatting.
                      </p>
                    </>
                  )}
                  {mode === 'parts' &&
                    (score ? (
                      <MusicReview
                        score={score}
                        overrides={partOverrides}
                        onAssign={assignPart}
                        onUndo={() => movePartHistory('undo')}
                        onRedo={() => movePartHistory('redo')}
                        canUndo={partHistory.undo.length > 0}
                        canRedo={partHistory.redo.length > 0}
                        onSelectEvent={selectScoreEvent}
                        selectedEventId={selectedEventId}
                      />
                    ) : (
                      <div className="scan-score-empty-state">
                        Scan a page with recognized notation to build an aligned score.
                      </div>
                    ))}

                  <div className="scan-actions">
                    <button type="button" className="btn btn-small" onClick={handleCopy}>
                      Copy text
                    </button>
                    <button type="button" className="btn btn-small" onClick={handleDownloadText}>
                      Download .txt
                    </button>
                    <button type="button" className="btn btn-small" onClick={handleDownloadSvg}>
                      Export layout .svg
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-primary"
                      onClick={handleUseText}
                      disabled={Boolean(scoreState.error)}
                    >
                      Send aligned score
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={handleScan}
                      disabled={processing || saving}
                    >
                      Rescan
                    </button>
                  </div>
                  <p className="scan-result-note">
                    {uncertainTotal > 0
                      ? `${uncertainTotal} uncertain character${uncertainTotal === 1 ? '' : 's'} marked in amber across ${scannedPages.length} scanned page${scannedPages.length === 1 ? '' : 's'}.`
                      : `No uncertain characters are currently marked across ${scannedPages.length} scanned page${scannedPages.length === 1 ? '' : 's'}.`}{' '}
                    Confidence reflects the OCR model and is not proof of correctness.
                  </p>
                </div>
              ) : (
                <div className="scan-preview">
                  <SourcePreview src={currentSource} page={pageForOverlay} />
                  <div className="scan-preview-side">
                    {processing ? (
                      <div className="scan-waiting">
                        <span className="scan-spinner" />
                        <strong>Recognizing page {pageNumber}…</strong>
                        <span>Progress and stage appear above.</span>
                      </div>
                    ) : (
                      <>
                        <h3>
                          {failed
                            ? 'Scan failed'
                            : hasResults
                              ? `Page ${pageNumber} is not scanned`
                              : 'Ready to scan'}
                        </h3>
                        <p>
                          {failed
                            ? 'Review the error above, then retry the scan or upload a clearer file.'
                            : hasResults
                              ? 'This page was outside the last scan scope. Rescan the page or the whole document.'
                              : 'The source preview is ready. Choose a scope above and start the layout-aware scan.'}
                        </p>
                        <ul>
                          <li>Characters keep their page coordinates, confidence and uncertainty.</li>
                          <li>Underlines, rules and wide gaps become layout metadata.</li>
                          <li>You can correct individual characters after scanning.</li>
                        </ul>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="scan-footer">
          <span>
            OCR is probabilistic. Check uncertain characters and compare with the source before
            exporting.
          </span>
          <span>
            Layout export is SVG; editable export is TXT. PDF export is not included because a
            browser-printed page would not remain editable.
          </span>
        </footer>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
