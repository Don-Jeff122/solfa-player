import { useEffect, useRef, useState } from 'react'
import DocumentViewer from './scanner/DocumentViewer.jsx'
import ScanResults from './scanner/ScanResults.jsx'
import { notesOnly } from '../lib/scan/notesOnly.js'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/bmp,image/gif,application/pdf'

function emptyRegionPage(pageNumber, text) {
  return {
    pageNumber,
    index: pageNumber - 1,
    exactText: text,
    sourceKind: 'raw-ocr',
    uncertainty: [],
    uncertaintyCount: 0,
    usedTextLayer: false,
    mode: 'classic',
    key: null,
    playable: {
      mode: 'classic',
      ok: false,
      text: '',
      key: null,
      confidence: 0,
      warnings: [],
      unreadable: 0,
      unmatchedNotes: 0,
      lowResolution: false,
      timed: false,
      staves: 0,
      systems: 0,
      rows: 0,
      bars: 0,
      emptyCells: 0,
      parseError: null,
    },
  }
}

export default function SheetScanner({ onApply, onClose }) {
  const [doc, setDoc] = useState(null)
  const [docInfo, setDocInfo] = useState(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [preview, setPreview] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [selectMode, setSelectMode] = useState(false)
  const [selection, setSelection] = useState(null)
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [activePage, setActivePage] = useState(1)
  const [playableText, setPlayableText] = useState('')
  const [exactDirty, setExactDirty] = useState(false)
  const [region, setRegion] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [enhance, setEnhance] = useState(true)
  const [denoise, setDenoise] = useState(false)

  const docRef = useRef(null)
  const resultRef = useRef(null)
  const stopRef = useRef(false)
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
      .getPreview(pageIndex, { rotation })
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
    setPlayableText('')
    setRegion(null)
    setSelection(null)
    setSelectMode(false)
    setActivePage(1)
    setPageIndex(0)
    setExactDirty(false)
    setProgress('')
    setError(null)
    setNotice('')
    if (current) {
      try {
        await current.close()
      } catch {
        /* the handle is already gone */
      }
    }
  }

  async function loadFile(file) {
    if (!file) return
    setError(null)
    setNotice('')
    setPreview(null)
    setResult(null)
    resultRef.current = null
    setPlayableText('')
    setRegion(null)
    setSelection(null)
    setSelectMode(false)
    setExactDirty(false)
    setLoading(true)
    setPreviewBusy(true)
    setProgress('Opening the document…')

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
    if (!docInfo) return
    const clamped = Math.min(docInfo.pageCount - 1, Math.max(0, next))
    if (clamped === pageIndex) return
    setPreviewBusy(true)
    setPreview(null)
    setError(null)
    setPageIndex(clamped)
    setActivePage(clamped + 1)
    setSelection(null)
    setSelectMode(false)
    setRegion(null)
  }

  function rotate(delta) {
    setPreviewBusy(true)
    setPreview(null)
    setError(null)
    setSelection(null)
    setSelectMode(false)
    setRegion(null)
    setRotation((current) => ((current + delta) % 360 + 360) % 360)
  }

  function updateExact(pageNumber, text) {
    setExactDirty(true)
    setRegion(null)
    setResult((current) => {
      if (!current) return current
      const pageResults = current.pageResults.map((page) =>
        page.pageNumber === pageNumber ? { ...page, exactText: text } : page
      )
      const sourceText = pageResults
        .map((page) => page.exactText)
        .filter(Boolean)
        .join('\n\n')
      return { ...current, pageResults, sourceText }
    })
  }

  async function mergeRegionText(text, mode) {
    const pageNumber = pageIndex + 1
    const current = resultRef.current
    const page = current?.pageResults?.find((entry) => entry.pageNumber === pageNumber)
    const previous = page?.exactText || ''
    const nextText =
      mode === 'replace' ? text : previous ? `${previous.trimEnd()}\n${text}` : text

    if (current && page) {
      updateExact(pageNumber, nextText)
    } else {
      const { mergePageResults } = await import('../lib/scan/scanService.js')
      const pages = current
        ? [...current.pageResults, emptyRegionPage(pageNumber, nextText)]
        : [emptyRegionPage(pageNumber, nextText)]
      setResult(mergePageResults(pages.sort((a, b) => a.index - b.index)))
      setExactDirty(true)
      setActivePage(pageNumber)
    }
    setRegion(null)
    setNotice(
      `Region ${mode === 'replace' ? 'replaced' : 'added to'} the page notes. Rebuild the playable copy when you are ready.`
    )
  }

  function allExactText() {
    return (resultRef.current?.pageResults || [])
      .map((page) => page.exactText)
      .filter(Boolean)
      .join('\n\n')
  }

  async function applyPages(indexes) {
    if (!doc || scanning || !indexes.length) return
    stopRef.current = false
    setScanning(true)
    setError(null)
    setNotice('')
    setProgress(
      indexes.length > 1
        ? `Scanning ${indexes.length} pages…`
        : `Scanning page ${indexes[0] + 1}…`
    )

    try {
      const { scanDocument, mergePageResults } = await import('../lib/scan/scanService.js')
      const { pages } = await scanDocument(doc, indexes, {
        rotation,
        autoStraighten: enhance,
        contrast: enhance,
        denoise,
        shouldStop: () => stopRef.current,
        onProgress: setProgress,
      })

      if (!pages.length) {
        setNotice('Recognition stopped before any page finished.')
        return
      }

      const existing = new Map(
        (resultRef.current?.pageResults || []).map((page) => [page.index, page])
      )
      for (const page of pages) existing.set(page.index, page)
      const merged = mergePageResults(
        [...existing.values()].sort((a, b) => a.index - b.index)
      )

      setResult(merged)
      setPlayableText(merged.text || '')
      setExactDirty(false)
      if (indexes.includes(pageIndex)) setActivePage(pageIndex + 1)
      else {
        setActivePage(pages[0].index + 1)
        setPageIndex(pages[0].index)
      }
      if (!merged.ok) {
        setError(merged.error || 'No playable notes were found on that page.')
      } else {
        const stopped = stopRef.current || pages.length < indexes.length
        setNotice(
          stopped
            ? `Stopped after ${pages.length} page${pages.length === 1 ? '' : 's'}. Check the flagged tokens against the original.`
            : `Scanned ${pages.length} page${pages.length === 1 ? '' : 's'} on this device. Check the flagged tokens against the original.`
        )
      }
    } catch (reason) {
      setError(reason?.message || 'The scan could not be completed.')
    } finally {
      setScanning(false)
      setProgress('')
      stopRef.current = false
    }
  }

  async function scanSelectedRegion() {
    if (!doc || !selection || scanning) return
    setScanning(true)
    setError(null)
    setNotice('')
    setProgress('Reading the selected region…')
    try {
      const { scanRegion } = await import('../lib/scan/scanService.js')
      const found = await scanRegion(doc, pageIndex, selection, {
        rotation,
        denoise,
        onProgress: setProgress,
      })
      const text = notesOnly(found.text)
      const region = {
        ...found,
        text,
        ok: Boolean(text),
        error: text ? null : found.error || 'No solfa note lines were found in the region.',
      }
      setRegion(region)
      setSelectMode(false)
      if (!region.ok) setError(region.error)
      else {
        setNotice(
          'Region read. Check the notes, then insert them into the page or replace the page notes.'
        )
      }
    } catch (reason) {
      setError(reason?.message || 'The selected region could not be read.')
    } finally {
      setScanning(false)
      setProgress('')
    }
  }

  async function rebuildPlayableCopy({ quiet = false } = {}) {
    const text = allExactText()
    if (!text.trim()) {
      setError('The notes are empty.')
      return null
    }
    const { rebuildPlayable } = await import('../lib/scan/scanService.js')
    const rebuilt = rebuildPlayable(text)
    if (!rebuilt.ok) {
      setError(rebuilt.error || 'The corrected notes could not be read.')
      return null
    }
    setPlayableText(rebuilt.text)
    setExactDirty(false)
    setError(null)
    if (!quiet) setNotice('Playable copy rebuilt from your corrected notes.')
    setResult((current) => {
      if (!current) return current
      return {
        ...current,
        mode: rebuilt.mode || current.mode,
        text: rebuilt.text,
        key: rebuilt.key || current.key,
        lineCount: rebuilt.text.split('\n').filter(Boolean).length,
        ok: true,
        error: null,
        parseError: null,
      }
    })
    return rebuilt
  }

  async function useInPlayer() {
    if (!resultRef.current) return
    let text = playableText.trim()
    let key = resultRef.current.key
    if (exactDirty) {
      const rebuilt = await rebuildPlayableCopy({ quiet: true })
      if (!rebuilt) return
      text = rebuilt.text
      key = rebuilt.key || key
    }
    if (!text) {
      setError('There is no playable text to send to the player.')
      return
    }
    onApply?.(text, key)
  }

  function stopScan() {
    stopRef.current = true
    setNotice('Stopping after the page being read…')
  }

  const pageCount = docInfo?.pageCount || 1
  const hasResults = Boolean(result?.pageResults?.length)

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label="Sheet scanner">
      <section className="scanner">
        <header className="scanner-head">
          <div>
            <h2>Scan a tonic solfa sheet</h2>
            <p className="scanner-subtitle">
              Read the printed notation as editable text. Recognition happens on this
              device; nothing is uploaded.
            </p>
          </div>
          <button
            type="button"
            className="scanner-close"
            onClick={() => onClose?.()}
            aria-label="Close scanner"
          >
            ×
          </button>
        </header>

        {notice && <p className="scanner-notice">{notice}</p>}
        {error && !doc && (
          <p className="scanner-error" role="alert">
            {error}
          </p>
        )}

        {!doc ? (
          loading ? (
            <div className="dropzone busy">
              <div className="dropzone-body">
                <div className="spinner" aria-hidden="true" />
                <p>{progress || 'Opening the document…'}</p>
                <p className="muted">The OCR engine loads only when you scan.</p>
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
                  <strong>Drop a photo, screenshot or PDF here</strong>
                </p>
                <p className="muted">
                  JPG, PNG, WebP, BMP or PDF · multi-page PDFs supported
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
            <div className="scanner-filebar">
              <span className="scanner-file-name" title={docInfo?.name}>
                {docInfo?.name}
              </span>
              <span className="tag">{docInfo?.kind === 'pdf' ? 'PDF' : 'image'}</span>
              <span className="tag">
                {pageCount} page{pageCount === 1 ? '' : 's'}
              </span>
            </div>

            <div className="scanner-split">
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
                selectMode={selectMode}
                onSelectModeChange={(next) => {
                  setSelectMode(next)
                  if (!next) setSelection(null)
                }}
                selection={selection}
                onSelectionChange={setSelection}
                onScanPage={() => applyPages([pageIndex])}
                onScanAll={() => applyPages([...Array(pageCount).keys()])}
                onScanRegion={scanSelectedRegion}
                onStopScan={stopScan}
                scanning={scanning}
                progress={progress}
                onClearDocument={closeDocument}
                enhance={enhance}
                onEnhanceChange={setEnhance}
                denoise={denoise}
                onDenoiseChange={setDenoise}
                docKind={docInfo?.kind}
                hasResults={hasResults}
              />

              <ScanResults
                result={result}
                activePage={activePage}
                pageCount={pageCount}
                onPageChange={changePage}
                onExactChange={updateExact}
                playableText={playableText}
                onPlayableChange={setPlayableText}
                onRebuild={() => rebuildPlayableCopy()}
                onUse={useInPlayer}
                onRescanPage={() => applyPages([pageIndex])}
                onRescanAll={() => applyPages([...Array(pageCount).keys()])}
                onScanUnscannedPage={() => applyPages([pageIndex])}
                exactDirty={exactDirty}
                region={region}
                onInsertRegion={(text) => mergeRegionText(text, 'insert')}
                onReplaceRegion={(text) => mergeRegionText(text, 'replace')}
                onDismissRegion={() => setRegion(null)}
                error={doc ? error : null}
                scanning={scanning}
              />
            </div>
          </div>
        )}

        <p className="scanner-note">
          Recognition is never perfect. The notes pane keeps printed note symbols, barlines
          and rhythm marks; headings, lyrics, key lines and part labels are hidden. The
          playable pane is a separate derived copy. Low-confidence tokens are flagged, not
          guessed. Nothing leaves your device. For best results use a straight 300 DPI scan
          or the original PDF.
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
    </div>
  )
}
