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
  canMergeSolfaPages,
  mergeGeminiGeneralPages,
  mergeGeminiSolfaPages,
} from '../lib/scan/geminiResults.js'
import { runBatchScan } from '../lib/scan/batchScan.js'
import { parseSolfa } from '../lib/parseSolfa.js'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/bmp,image/gif,application/pdf'
const BATCH_DELAY_MS = 600

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

function canvasToJpeg(canvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('The page image could not be prepared.'))
      },
      'image/jpeg',
      quality
    )
  })
}

function releaseCanvas(canvas) {
  if (!canvas) return
  canvas.width = 0
  canvas.height = 0
}

function pageNoun(count) {
  return count === 1 ? 'page' : 'pages'
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
  const [geminiScope, setGeminiScope] = useState('page')
  const [batchTargets, setBatchTargets] = useState([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState('')
  const [batchFailures, setBatchFailures] = useState([])

  const geminiEnabled = isGeminiConfigured()
  const docRef = useRef(null)
  const resultRef = useRef(null)
  const pageMapRef = useRef(new Map())
  const batchAbortRef = useRef(null)
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
      batchAbortRef.current?.abort()
      batchAbortRef.current = null
      const current = docRef.current
      docRef.current = null
      current?.close?.().catch?.(() => {})
    }
  }, [])

  useEffect(() => {
    if (!batchRunning) return
    function onBeforeUnload(event) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [batchRunning])

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
    batchAbortRef.current?.abort()
    batchAbortRef.current = null
    pageMapRef.current = new Map()
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
    setGeminiScope('page')
    setBatchTargets([])
    setBatchRunning(false)
    setBatchProgress('')
    setBatchFailures([])
    setGeminiBusy(false)
    if (current) {
      try {
        await current.close()
      } catch {
        /* the handle is already gone */
      }
    }
  }

  function storePage(page) {
    pageMapRef.current.set(page.pageNumber, page)
    const merged = mergePages(scanMode, [...pageMapRef.current.values()])
    resultRef.current = merged
    setResult(merged)
    return merged
  }

  async function scanPage(pageNumber, { signal } = {}) {
    const current = docRef.current
    if (!current) throw new Error('The document is no longer open.')
    const page = await current.getPage(pageNumber - 1, {
      maxDimension: 2400,
      rotation,
    })
    let blob
    try {
      blob = await canvasToJpeg(page.canvas, 0.92)
    } finally {
      releaseCanvas(page.canvas)
    }
    const value = await requestGeminiScan({
      blob,
      mode: scanMode === 'general' ? 'general' : 'solfa',
      signal,
    })
    const converted =
      scanMode === 'general'
        ? createGeminiGeneralPage(pageNumber, value)
        : createGeminiHymnalPage(pageNumber, value)
    if (!converted.ok) throw new Error(converted.error)
    return converted.page
  }

  function openGemini() {
    if (!doc || geminiBusy || batchAbortRef.current || !geminiEnabled) return
    setGeminiScope('page')
    setGeminiError('')
    if (!hasGeminiConsent()) {
      setGeminiOpen(true)
      return
    }
    runGeminiRead()
  }

  function openGeminiAll(pageNumbers = null) {
    if (!doc || geminiBusy || batchAbortRef.current || !geminiEnabled) return
    const targets = [...new Set(pageNumbers || remainingPages)].filter(
      (pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0
    )
    if (!targets.length) return
    setGeminiScope('all')
    setBatchTargets(targets)
    setGeminiError('')
    setGeminiOpen(true)
  }

  async function runGeminiRead({ fromDialog = false } = {}) {
    if (!doc || geminiBusy || batchAbortRef.current) return
    const pageNumber = pageIndex + 1
    setGeminiBusy(true)
    setGeminiError('')
    setError(null)
    setNotice(`Sending page ${pageNumber} to Gemini...`)
    try {
      const page = await scanPage(pageNumber)
      storePage(page)
      setBatchFailures((current) =>
        current.filter((failure) => failure.pageNumber !== pageNumber)
      )
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

  async function startBatch(targets) {
    const pages = [...new Set(targets)]
      .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0)
      .sort((a, b) => a - b)
    if (!doc || geminiBusy || batchAbortRef.current || !pages.length) return

    const controller = new AbortController()
    batchAbortRef.current?.abort()
    batchAbortRef.current = controller
    const failures = []
    let lastPage = 0

    setGeminiOpen(false)
    setGeminiError('')
    setError(null)
    setGeminiScope('all')
    setBatchTargets(pages)
    setBatchRunning(true)
    setGeminiBusy(true)
    setBatchFailures((current) =>
      current.filter((failure) => !pages.includes(failure.pageNumber))
    )
    setBatchProgress(`Reading page ${pages[0]} (1 of ${pages.length})...`)
    setNotice(
      `Reading ${pages.length} ${pageNoun(pages.length)} with Gemini. Keep this tab open.`
    )

    try {
      const summary = await runBatchScan({
        pages,
        signal: controller.signal,
        delayMs: BATCH_DELAY_MS,
        scanPage: (pageNumber, options) => scanPage(pageNumber, options),
        onPageStart: (pageNumber, info) => {
          setBatchProgress(
            `Reading page ${pageNumber} (${info.index + 1} of ${info.total})...`
          )
        },
        onPageSuccess: (pageNumber, page, info) => {
          lastPage = pageNumber
          storePage(page)
          setBatchFailures((current) =>
            current.filter((failure) => failure.pageNumber !== pageNumber)
          )
          setBatchProgress(
            `Page ${pageNumber} read (${info.index + 1} of ${info.total}).`
          )
        },
        onPageFailure: (failure, info) => {
          failures.push(failure)
          setBatchFailures((current) => [
            ...current.filter(
              (existing) => existing.pageNumber !== failure.pageNumber
            ),
            failure,
          ])
          setBatchProgress(
            `Page ${failure.pageNumber} failed (${info.index + 1} of ${info.total}).`
          )
        },
      })

      if (batchAbortRef.current !== controller) return
      const total = docInfo?.pageCount || pageCount
      const readCount = pageMapRef.current.size
      const unread = Math.max(0, total - readCount)
      const failureCount = failures.filter(
        (failure) => !pageMapRef.current.has(failure.pageNumber)
      ).length
      const lastMessage = failures.at(-1)?.message

      if (summary.stopReason === 'rate-limit') {
        setNotice(
          `Free Gemini request limit reached. Read ${readCount} of ${total} pages; ${unread} remain. Try again later.`
        )
      } else if (summary.stopReason === 'unavailable') {
        setNotice(
          `Gemini is not responding. Read ${readCount} of ${total} pages; ${unread} remain. Try again.`
        )
      } else if (summary.stopReason === 'fatal') {
        setNotice(
          `Gemini stopped after page ${summary.failed.at(-1)?.pageNumber || lastPage}: ${
            lastMessage || 'the request was rejected'
          }. ${unread} pages remain.`
        )
      } else if (summary.stopReason === 'canceled') {
        setNotice(
          `Reading stopped. ${readCount} of ${total} pages read; ${unread} remain.`
        )
      } else if (failureCount > 0) {
        setNotice(
          `Read ${readCount} of ${total} pages. ${failureCount} failed; retry failed pages.`
        )
      } else if (unread > 0) {
        setNotice(`Read ${readCount} of ${total} pages. ${unread} remain.`)
      } else {
        setNotice(`Read all ${total} pages with Gemini. Check every page before playing.`)
      }
    } catch (reason) {
      if (batchAbortRef.current === controller) {
        setError(reason?.message || 'Gemini could not read the pages.')
        setNotice('')
      }
    } finally {
      if (batchAbortRef.current === controller) {
        batchAbortRef.current = null
        setBatchRunning(false)
        setGeminiBusy(false)
        setBatchProgress('')
        const firstUnread = Array.from(
          { length: docInfo?.pageCount || pageCount },
          (_, index) => index + 1
        ).find((pageNumber) => !pageMapRef.current.has(pageNumber))
        const nextPage =
          failures[0]?.pageNumber || firstUnread || lastPage || pageIndex + 1
        if (docRef.current && nextPage) {
          if (nextPage - 1 !== pageIndex) {
            setPreviewBusy(true)
            setPreview(null)
          }
          setActivePage(nextPage)
          setPageIndex(nextPage - 1)
        }
      }
    }
  }

  function stopBatch() {
    batchAbortRef.current?.abort()
  }

  function confirmGemini() {
    rememberGeminiConsent()
    if (geminiScope === 'all') {
      startBatch(batchTargets)
      return
    }
    runGeminiRead({ fromDialog: true })
  }

  async function loadFile(file) {
    if (!file) return
    batchAbortRef.current?.abort()
    batchAbortRef.current = null
    pageMapRef.current = new Map()
    setError(null)
    setNotice('')
    setGeminiOpen(false)
    setGeminiError('')
    setGeminiScope('page')
    setBatchTargets([])
    setBatchRunning(false)
    setBatchProgress('')
    setBatchFailures([])
    setGeminiBusy(false)
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
    pageMapRef.current = new Map()
    setScanMode(next)
    setResult(null)
    resultRef.current = null
    setError(null)
    setGeminiOpen(false)
    setGeminiError('')
    setGeminiScope('page')
    setBatchTargets([])
    setBatchProgress('')
    setBatchFailures([])
    setNotice(
      next === 'general'
        ? 'General document mode reads the page as editable text.'
        : 'Solfa mode reads the page as playable four-part notation.'
    )
  }

  function updatePageText(pageNumber, text) {
    const page = pageMapRef.current.get(pageNumber)
    if (!page) return
    setError(null)
    const updated =
      scanMode === 'general'
        ? { ...page, exactText: text }
        : {
            ...page,
            sheetText: text,
            exactText: text,
            ...(page.playable
              ? {
                  playable: (() => {
                    const parsed = parseSolfa(text)
                    return {
                      ...page.playable,
                      text,
                      sheetText: text,
                      ok: parsed.ok,
                      parseError: parsed.ok
                        ? null
                        : parsed.error?.message || 'The corrected sheet could not be read.',
                    }
                  })(),
                }
              : {}),
          }
    pageMapRef.current.set(pageNumber, updated)
    const merged = mergePages(scanMode, [...pageMapRef.current.values()])
    resultRef.current = merged
    setResult(merged)
  }

  function sendSheetToPlayer(sheetText, key) {
    const value = sheetText?.trim()
    if (!value) {
      setError('There is no playable sheet to send to the player.')
      return
    }
    const parsed = parseSolfa(value)
    if (!parsed.ok) {
      setError(parsed.error?.message || 'The corrected sheet could not be read.')
      return
    }
    setError(null)
    onApply?.(value, parsed.result.key || key)
  }

  function useInPlayer(pageNumber = activePage) {
    const current = resultRef.current
    if (!current || scanMode === 'general') return
    const page = current.pageResults?.find((entry) => entry.pageNumber === pageNumber)
    if (!page) {
      setError(`Page ${pageNumber} has not been read by Gemini yet.`)
      return
    }
    sendSheetToPlayer(
      page.sheetText || page.playable?.sheetText,
      page.key || page.playable?.key || current.key
    )
  }

  function useAllPagesInPlayer() {
    const current = resultRef.current
    if (!current || scanMode === 'general') return
    if (!canMergeSolfaPages(current.pageResults || [])) {
      setError(
        'These pages use different keys or are not consecutive. Use one page at a time instead.'
      )
      return
    }
    sendSheetToPlayer(current.sheetText, current.key)
  }

  const pageCount = docInfo?.pageCount || 1
  const hasResults = Boolean(result?.pageResults?.length)
  const readPageNumbers = new Set(
    (result?.pageResults || []).map((page) => page.pageNumber)
  )
  const remainingPages = Array.from({ length: pageCount }, (_, index) => index + 1)
    .filter((pageNumber) => !readPageNumbers.has(pageNumber))
  const failedPages = batchFailures.filter(
    (failure) => !readPageNumbers.has(failure.pageNumber)
  )
  const failedPageNumbers = new Set(failedPages.map((failure) => failure.pageNumber))
  const allRemainingFailed =
    remainingPages.length > 0 &&
    remainingPages.every((pageNumber) => failedPageNumbers.has(pageNumber))
  const readAllLabel =
    remainingPages.length === 0
      ? ''
      : allRemainingFailed
        ? `Retry ${failedPages.length} failed ${pageNoun(failedPages.length)}`
        : readPageNumbers.size === 0
          ? `Read all ${pageCount} pages`
          : `Read remaining ${remainingPages.length} ${pageNoun(remainingPages.length)}`
  const canMergeAll =
    scanMode !== 'general' && canMergeSolfaPages(result?.pageResults || [])

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
              Upload an image or PDF, then read the current page or all pages one at
              a time. Only the pages you read are uploaded.
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
            disabled={batchRunning}
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
                  onReadAll={() => openGeminiAll()}
                  readAllLabel={readAllLabel}
                  remainingCount={remainingPages.length}
                  onRetryFailed={() => openGeminiAll([...failedPageNumbers])}
                  failedCount={failedPages.length}
                  batchRunning={batchRunning}
                  batchProgress={batchProgress}
                  onStopBatch={stopBatch}
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
                onUseAll={useAllPagesInPlayer}
                onReadGemini={openGemini}
                onReadAll={() => openGeminiAll()}
                readAllLabel={readAllLabel}
                remainingCount={remainingPages.length}
                onRetryFailed={() => openGeminiAll([...failedPageNumbers])}
                failedPages={failedPages}
                canMergeAll={canMergeAll}
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
        scope={geminiScope}
        count={geminiScope === 'all' ? batchTargets.length : 1}
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
