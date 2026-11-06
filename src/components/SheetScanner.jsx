import { useEffect, useRef, useState } from 'react'
import DocumentViewer from './scanner/DocumentViewer.jsx'
import GeminiDialog from './scanner/GeminiDialog.jsx'
import ScanResults from './scanner/ScanResults.jsx'
import {
  createGeminiGeneralPage,
  createGeminiHymnalPage,
  hasGeminiConsent,
  isGeminiConfigured,
  rememberGeminiConsent,
  requestGeminiScan,
} from '../lib/scan/geminiService.js'
import {
  mergeGeminiGeneralPages,
  mergeGeminiSolfaPages,
} from '../lib/scan/geminiResults.js'
import { parseSolfa } from '../lib/parseSolfa.js'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/bmp,image/gif,application/pdf'

const SCAN_MODES = [
  {
    id: 'solfa',
    label: 'Solfa sheet',
    hint: 'Ask Gemini for playable tonic solfa rows',
  },
  {
    id: 'general',
    label: 'General document',
    hint: 'Ask Gemini for editable page text',
  },
]

function mergePages(mode, pages) {
  const ordered = [...pages].sort(
    (a, b) => (a.index ?? a.pageNumber - 1) - (b.index ?? b.pageNumber - 1)
  )
  return mode === 'general'
    ? mergeGeminiGeneralPages(ordered)
    : mergeGeminiSolfaPages(ordered)
}

export default function SheetScanner({ onApply, onClose }) {
  const [doc, setDoc] = useState(null)
  const [docInfo, setDocInfo] = useState(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [preview, setPreview] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [activePage, setActivePage] = useState(1)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [scanMode, setScanMode] = useState('solfa')
  const [geminiOpen, setGeminiOpen] = useState(false)
  const [geminiBusy, setGeminiBusy] = useState(false)
  const [geminiError, setGeminiError] = useState('')

  const geminiEnabled = isGeminiConfigured()
  const docRef = useRef(null)
  const resultRef = useRef(null)
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const scrollingRef = useRef('')

  useEffect(() => {
    resultRef.current = result
  }, [result])

  useEffect(() => {
    scrollingRef.current = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = scrollingRef.current
      const current = docRef.current
      docRef.current = null
      current?.close?.().catch?.(() => {})
    }
  }, [])

  useEffect(() => {
    if (!doc) return
    let alive = true
    doc
      .getPreview(pageIndex, { rotation, maxDimension: 2400 })
      .then((next) => {
        if (alive) setPreview(next)
      })
      .catch((reason) => {
        if (alive) setError(reason?.message || 'Could not render that page.')
      })
      .finally(() => {
        if (alive) setPreviewBusy(false)
      })
    return () => {
      alive = false
    }
  }, [doc, pageIndex, rotation])

  async function closeDocument() {
    const current = docRef.current
    docRef.current = null
    setDoc(null)
    setDocInfo(null)
    setPreview(null)
    setPreviewBusy(false)
    setResult(null)
    resultRef.current = null
    setActivePage(1)
    setPageIndex(0)
    setProgress('')
    setError(null)
    setNotice('')
    setGeminiOpen(false)
    setGeminiError('')
    if (current) {
      try {
        await current.close()
      } catch {
        /* the handle is already gone */
      }
    }
  }

  async function pageImageBlob() {
    const page = await doc.getPage(pageIndex, { maxDimension: 2400, rotation })
    return new Promise((resolve, reject) => {
      page.canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('The page image could not be prepared.'))
        },
        'image/jpeg',
        0.92
      )
    })
  }

  function openGemini() {
    if (!doc || geminiBusy || !geminiEnabled) return
    setGeminiError('')
    if (!hasGeminiConsent()) {
      setGeminiOpen(true)
      return
    }
    runGeminiRead()
  }

  async function runGeminiRead({ fromDialog = false } = {}) {
    if (!doc || geminiBusy) return
    setGeminiBusy(true)
    setGeminiError('')
    setError(null)
    setNotice(`Sending page ${pageIndex + 1} to Gemini...`)
    try {
      const blob = await pageImageBlob()
      const value = await requestGeminiScan({
        blob,
        mode: scanMode === 'general' ? 'general' : 'solfa',
      })
      const pageNumber = pageIndex + 1
      const existing = new Map(
        (resultRef.current?.pageResults || []).map((entry) => [entry.index, entry])
      )
      const converted =
        scanMode === 'general'
          ? createGeminiGeneralPage(pageNumber, value)
          : createGeminiHymnalPage(pageNumber, value)
      if (!converted.ok) throw new Error(converted.error)
      existing.set(converted.page.index, converted.page)
      const merged = mergePages(scanMode, [...existing.values()])
      setResult(merged)
      setError(null)
      setActivePage(pageNumber)
      setPageIndex(pageNumber - 1)
      setNotice(
        scanMode === 'general'
          ? `Page ${pageNumber} read by Gemini. Check every line against the original.`
          : `Page ${pageNumber} read by Gemini. Check every row, key and lyric before playing.`
      )
      setGeminiOpen(false)
    } catch (reason) {
      const message = reason?.message || 'Gemini could not read this page.'
      if (fromDialog) setGeminiError(message)
      else setError(message)
      setNotice('')
    } finally {
      setGeminiBusy(false)
    }
  }

  function confirmGemini() {
    rememberGeminiConsent()
    runGeminiRead({ fromDialog: true })
  }

  async function loadFile(file) {
    if (!file) return
    setError(null)
    setNotice('')
    setGeminiOpen(false)
    setGeminiError('')
    setPreview(null)
    setResult(null)
    resultRef.current = null
    setLoading(true)
    setPreviewBusy(true)
    setProgress('Opening the document...')

    const previous = docRef.current
    docRef.current = null
    setDoc(null)
    if (previous) {
      try {
        await previous.close()
      } catch {
        /* ignore a stale handle */
      }
    }

    try {
      const { openDocument } = await import('../lib/documentService.js')
      const handle = await openDocument(file, { onProgress: setProgress })
      docRef.current = handle
      setDoc(handle)
      setDocInfo({
        name: handle.name,
        kind: handle.kind,
        pageCount: handle.pageCount,
      })
      setPageIndex(0)
      setActivePage(1)
      setRotation(0)
      setZoom(1)
      setProgress('')
    } catch (reason) {
      setError(reason?.message || 'Could not open that file.')
      setPreviewBusy(false)
      setProgress('')
    } finally {
      setLoading(false)
    }
  }

  function changePage(next) {
    if (!docInfo || geminiBusy) return
    const clamped = Math.min(docInfo.pageCount - 1, Math.max(0, next))
    if (clamped === pageIndex) return
    setPreviewBusy(true)
    setPreview(null)
    setError(null)
    setPageIndex(clamped)
    setActivePage(clamped + 1)
  }

  function rotate(delta) {
    if (geminiBusy) return
    setPreviewBusy(true)
    setPreview(null)
    setError(null)
    setRotation((current) => ((current + delta) % 360 + 360) % 360)
  }

  function changeScanMode(next) {
    if (next === scanMode || geminiBusy) return
    setScanMode(next)
    setResult(null)
    resultRef.current = null
    setError(null)
    setGeminiOpen(false)
    setGeminiError('')
    setNotice(
      next === 'general'
        ? 'General document mode reads the page as editable text.'
        : 'Solfa mode reads the page as playable four-part notation.'
    )
  }

  function updatePageText(pageNumber, text) {
    setError(null)
    setResult((current) => {
      if (!current) return current
      const pageResults = current.pageResults.map((page) =>
        page.pageNumber === pageNumber
          ? {
              ...page,
              ...(scanMode === 'general'
                ? { exactText: text }
                : { sheetText: text, exactText: text }),
            }
          : page
      )
      return mergePages(scanMode, pageResults)
    })
  }

  function useInPlayer() {
    const current = resultRef.current
    if (!current || scanMode === 'general') return
    const sheetText = current.sheetText?.trim()
    if (!sheetText) {
      setError('There is no playable sheet to send to the player.')
      return
    }
    const parsed = parseSolfa(sheetText)
    if (!parsed.ok) {
      setError(parsed.error?.message || 'The corrected sheet could not be read.')
      return
    }
    setError(null)
    onApply?.(sheetText, parsed.result.key || current.key)
  }

  const pageCount = docInfo?.pageCount || 1
  const hasResults = Boolean(result?.pageResults?.length)

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label="Gemini sheet reader">
      <section className="scanner">
        <header className="scanner-head">
          <div>
            <h2>
              {scanMode === 'general'
                ? 'Read a document with Gemini'
                : 'Read a solfa sheet with Gemini'}
            </h2>
            <p className="scanner-subtitle">
              Upload an image or PDF, then send the current page to Gemini. Only the
              page you are viewing is uploaded.
            </p>
            <div className="scanner-mode-tabs" role="tablist" aria-label="Page type">
              {SCAN_MODES.map((mode) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={scanMode === mode.id}
                  className={`scanner-mode-tab${scanMode === mode.id ? ' active' : ''}`}
                  key={mode.id}
                  onClick={() => changeScanMode(mode.id)}
                  disabled={geminiBusy}
                  title={mode.hint}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="scanner-close"
            onClick={() => onClose?.()}
            aria-label="Close scanner"
          >
            x
          </button>
        </header>

        {notice && <p className="scanner-notice">{notice}</p>}
        {error && !doc && !hasResults && (
          <p className="scanner-error" role="alert">
            {error}
          </p>
        )}

        {!doc && !hasResults ? (
          loading ? (
            <div className="dropzone busy">
              <div className="dropzone-body">
                <div className="spinner" aria-hidden="true" />
                <p>{progress || 'Opening the document...'}</p>
              </div>
            </div>
          ) : (
            <div
              className="dropzone"
              onDragOver={(event) => {
                event.preventDefault()
                event.currentTarget.classList.add('dragging')
              }}
              onDragLeave={(event) => event.currentTarget.classList.remove('dragging')}
              onDrop={(event) => {
                event.preventDefault()
                event.currentTarget.classList.remove('dragging')
                loadFile(event.dataTransfer.files?.[0])
              }}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click()
              }}
              role="button"
              tabIndex={0}
            >
              <div className="dropzone-body">
                <div className="dropzone-icon" aria-hidden="true" />
                <p>
                  <strong>Drop an image or PDF here</strong>
                </p>
                <p className="muted">
                  JPG, PNG, WebP, BMP or PDF - multi-page PDFs supported
                </p>
                <div
                  className="dropzone-actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose file
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    Take photo
                  </button>
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="scanner-body">
            {doc ? (
              <div className="scanner-filebar">
                <span className="scanner-file-name" title={docInfo?.name}>
                  {docInfo?.name}
                </span>
                <span className="tag">{docInfo?.kind === 'pdf' ? 'PDF' : 'image'}</span>
                <span className="tag">
                  {pageCount} page{pageCount === 1 ? '' : 's'}
                </span>
                <span className="tag">
                  {scanMode === 'general' ? 'document text' : 'solfa'}
                </span>
                <button
                  type="button"
                  className="btn btn-small scanner-clear-mobile"
                  onClick={closeDocument}
                  disabled={geminiBusy}
                >
                  Clear document
                </button>
              </div>
            ) : (
              <div className="scanner-filebar">
                <span className="scanner-file-name">Gemini result</span>
                <span className="tag">Gemini AI</span>
                <button type="button" className="btn btn-quiet" onClick={closeDocument}>
                  Start over
                </button>
              </div>
            )}

            <div className={`scanner-split${doc ? '' : ' text-only'}`}>
              {doc && (
                <DocumentViewer
                  preview={preview}
                  previewBusy={previewBusy || loading}
                  pageIndex={pageIndex}
                  pageCount={pageCount}
                  onPageChange={changePage}
                  rotation={rotation}
                  onRotate={rotate}
                  zoom={zoom}
                  onZoom={(value) => setZoom(Math.min(3, Math.max(0.5, value)))}
                  geminiEnabled={geminiEnabled}
                  geminiBusy={geminiBusy}
                  onReadGemini={openGemini}
                  progress={progress}
                  onClearDocument={closeDocument}
                  docKind={docInfo?.kind}
                />
              )}

              <ScanResults
                result={result}
                activePage={activePage}
                pageCount={pageCount}
                onPageChange={changePage}
                onTextChange={updatePageText}
                onUse={useInPlayer}
                onReadGemini={openGemini}
                geminiBusy={geminiBusy}
                scanMode={scanMode}
                error={error}
              />
            </div>
          </div>
        )}

        <p className="scanner-note">
          {geminiEnabled
            ? 'Gemini reads the page image on Google servers. Recognition can be wrong, so check every row, key, lyric and word against the original before using it in the player. The API key stays on the proxy.'
            : 'Gemini is not configured for this build. Set VITE_GEMINI_PROXY_URL and rebuild to enable page reading.'}
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          onChange={(event) => {
            loadFile(event.target.files?.[0])
            event.target.value = ''
          }}
          hidden
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            loadFile(event.target.files?.[0])
            event.target.value = ''
          }}
          hidden
        />
      </section>
      <GeminiDialog
        open={geminiOpen}
        mode={scanMode}
        busy={geminiBusy}
        error={geminiError}
        onCancel={() => {
          if (geminiBusy) return
          setGeminiOpen(false)
          setGeminiError('')
        }}
        onConfirm={confirmGemini}
      />
    </div>
  )
}
