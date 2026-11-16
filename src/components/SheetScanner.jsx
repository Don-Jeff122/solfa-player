import { useCallback, useEffect, useRef, useState } from 'react'
import DocumentViewer from './scanner/DocumentViewer.jsx'
import GeminiDialog from './scanner/GeminiDialog.jsx'
import ScanResults from './scanner/ScanResults.jsx'
import {
  createGeminiPage,
  hasGeminiConsent,
  isGeminiConfigured,
  rememberGeminiConsent,
  requestGeminiScan,
} from '../lib/scan/geminiService.js'
import {
  canMergeSolfaPages,
  mergeGeminiPages,
} from '../lib/scan/geminiResults.js'
import { runBatchScan } from '../lib/scan/batchScan.js'
import { parseSolfa } from '../lib/parseSolfa.js'
import {
  isMusicXmlFile,
  readMusicXmlFile,
} from '../lib/music/musicXml.js'
import { createMusicXmlPage, reconvertStaffPage } from '../lib/scan/staffConversion.js'
import {
  createScannerSessionWriter,
  loadScannerSession,
} from '../lib/scannerSessionStore.js'

const ACCEPT =
  'image/png,image/jpeg,image/webp,image/bmp,image/gif,application/pdf,.xml,.musicxml,.mxl'
const BATCH_DELAY_MS = 600

const SCAN_MODES = [
  {
    id: 'auto',
    label: 'Automatic',
    hint: 'Let Gemini detect solfa, staff notation or text',
  },
  {
    id: 'solfa',
    label: 'Solfa sheet',
    hint: 'Read printed tonic solfa rows',
  },
  {
    id: 'staff',
    label: 'Staff notation',
    hint: 'Read staff notes and convert them to tonic solfa',
  },
  {
    id: 'general',
    label: 'General document',
    hint: 'Read editable page text',
  },
]

function mergePages(mode, pages) {
  const ordered = [...pages].sort(
    (a, b) => (a.index ?? a.pageNumber - 1) - (b.index ?? b.pageNumber - 1)
  )
  return mergeGeminiPages(ordered, mode)
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

function makeDocId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  )
}

function storageWarningFor(reason) {
  const message = reason?.message || ''
  if (reason?.name === 'QuotaExceededError' || /quota/i.test(message)) {
    return 'This scan could not be saved because browser storage is full. Keep the scanner open or clear space on this device.'
  }
  return 'This scan could not be saved in this browser. Keep the scanner open to avoid losing it.'
}

async function openSourceDocument(file, { onProgress } = {}) {
  const { openDocument } = await import('../lib/documentService.js')
  return openDocument(file, { onProgress })
}

function restoredFile(record) {
  return new File([record.blob], record.name, {
    type: record.type || record.blob.type || '',
    lastModified: record.lastModified || Date.now(),
  })
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
  const [scanMode, setScanMode] = useState('auto')
  const [geminiOpen, setGeminiOpen] = useState(false)
  const [geminiBusy, setGeminiBusy] = useState(false)
  const [geminiError, setGeminiError] = useState('')
  const [geminiScope, setGeminiScope] = useState('page')
  const [batchTargets, setBatchTargets] = useState([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState('')
  const [batchFailures, setBatchFailures] = useState([])
  const [restoring, setRestoring] = useState(true)
  const [sourceMissing, setSourceMissing] = useState(false)
  const [storageWarning, setStorageWarning] = useState('')

  const geminiEnabled = isGeminiConfigured()
  const docRef = useRef(null)
  const resultRef = useRef(null)
  const pageMapRef = useRef(new Map())
  const batchAbortRef = useRef(null)
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const scrollingRef = useRef('')
  const docIdRef = useRef(null)
  const hydratedRef = useRef(false)
  const mountedRef = useRef(true)
  const sessionMetaRef = useRef({})
  const [writer] = useState(() => createScannerSessionWriter())

  const sessionSnapshot = useCallback((overrides = {}) => {
    const meta = sessionMetaRef.current
    const pageResults = overrides.pageResults ?? [...pageMapRef.current.values()]
    const info = overrides.docInfo ?? meta.docInfo
    if (!info && !pageResults.length) return null
    return {
      docId: overrides.docId ?? docIdRef.current,
      scanMode: overrides.scanMode ?? meta.scanMode,
      docInfo: info,
      pageResults,
      batchFailures: overrides.batchFailures ?? meta.batchFailures,
      pageIndex: overrides.pageIndex ?? meta.pageIndex,
      rotation: overrides.rotation ?? meta.rotation,
      zoom: overrides.zoom ?? meta.zoom,
    }
  }, [])

  function updateBatchFailures(compute) {
    const next = compute(sessionMetaRef.current.batchFailures)
    sessionMetaRef.current = {
      ...sessionMetaRef.current,
      batchFailures: next,
    }
    setBatchFailures(next)
    return next
  }

  const persistSoon = useCallback(
    (overrides) => {
      if (!hydratedRef.current) return
      const snapshot = sessionSnapshot(overrides)
      if (snapshot) writer.save(snapshot)
    },
    [sessionSnapshot, writer]
  )

  function persistNow(overrides) {
    if (!hydratedRef.current) return Promise.resolve({ ok: false })
    const snapshot = sessionSnapshot(overrides)
    if (!snapshot) return Promise.resolve({ ok: false })
    return writer.saveNow(snapshot)
  }

  function flushSession() {
    writer.flush().catch(() => {})
  }

  function handleClose() {
    flushSession()
    onClose?.()
  }

  useEffect(() => {
    resultRef.current = result
  }, [result])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    writer.setErrorHandler((reason) => {
      if (mountedRef.current) setStorageWarning(storageWarningFor(reason))
    })
    return () => writer.setErrorHandler(null)
  }, [writer])

  useEffect(() => {
    let alive = true
    loadScannerSession()
      .then(async (session) => {
        if (!alive) return
        if (!session) {
          hydratedRef.current = true
          setRestoring(false)
          return
        }

        docIdRef.current = session.docId
        pageMapRef.current = new Map(
          session.pageResults.map((page) => [page.pageNumber, page])
        )
        const merged = session.pageResults.length
          ? mergePages(session.scanMode, session.pageResults)
          : null
        resultRef.current = merged
        setResult(merged)
        setScanMode(session.scanMode)
        setDocInfo(session.docInfo)
        setBatchFailures(session.batchFailures)
        setPageIndex(session.pageIndex)
        setActivePage(session.pageIndex + 1)
        setRotation(session.rotation)
        setZoom(session.zoom)
        setNotice('Restored your previous scan from this device.')

        if (!session.file) {
          setSourceMissing(true)
        } else {
          setProgress('Restoring the document...')
          setPreviewBusy(true)
          try {
            const handle = await openSourceDocument(restoredFile(session.file), {
              onProgress: setProgress,
            })
            if (!alive) {
              handle.close().catch(() => {})
              return
            }
            docRef.current = handle
            setDoc(handle)
            setDocInfo({
              name: handle.name,
              kind: handle.kind,
              pageCount: handle.pageCount,
            })
            const nextIndex = Math.min(session.pageIndex, handle.pageCount - 1)
            setPageIndex(nextIndex)
            setActivePage(nextIndex + 1)
            setSourceMissing(false)
          } catch {
            if (!alive) return
            setPreviewBusy(false)
            setSourceMissing(true)
            setNotice(
              'Restored the last scan, but the source document could not be reopened. Your results are still available.'
            )
          }
        }

        if (!alive) return
        hydratedRef.current = true
        setRestoring(false)
        setProgress('')
      })
      .catch((reason) => {
        if (!alive) return
        hydratedRef.current = true
        setRestoring(false)
        setStorageWarning(storageWarningFor(reason))
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    sessionMetaRef.current = {
      docInfo,
      scanMode,
      batchFailures,
      pageIndex,
      rotation,
      zoom,
    }
  }, [docInfo, scanMode, batchFailures, pageIndex, rotation, zoom])

  useEffect(() => {
    if (!hydratedRef.current || restoring) return
    persistSoon()
  }, [scanMode, batchFailures, pageIndex, rotation, zoom, docInfo, restoring, persistSoon])

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
      writer.flush().catch(() => {})
    }
  }, [writer])

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
    docIdRef.current = null
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
    setRestoring(false)
    setSourceMissing(false)
    setStorageWarning('')
    if (current) {
      try {
        await current.close()
      } catch {
        /* the handle is already gone */
      }
    }
    await writer.clear()
  }

  function storePage(page) {
    pageMapRef.current.set(page.pageNumber, page)
    const merged = mergePages(scanMode, [...pageMapRef.current.values()])
    resultRef.current = merged
    setResult(merged)
    persistNow({ pageResults: [...pageMapRef.current.values()] })
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
      mode: scanMode,
      signal,
    })
    const converted = createGeminiPage(pageNumber, value, scanMode)
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
      const nextFailures = updateBatchFailures((current) =>
        current.filter((failure) => failure.pageNumber !== pageNumber)
      )
      persistNow({ batchFailures: nextFailures })
      setError(null)
      setActivePage(pageNumber)
      setPageIndex(pageNumber - 1)
      const kind = page.mode === 'general' ? 'text' : page.notationType || 'solfa'
      setNotice(
        page.mode === 'general'
          ? `Page ${pageNumber} read by Gemini. Check every line against the original.`
          : `Page ${pageNumber} read as ${kind}. Check every row, note, key and voice before playing.`
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
    const clearedFailures = updateBatchFailures((current) =>
      current.filter((failure) => !pages.includes(failure.pageNumber))
    )
    persistNow({ batchFailures: clearedFailures })
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
          const nextFailures = updateBatchFailures((current) =>
            current.filter((failure) => failure.pageNumber !== pageNumber)
          )
          persistNow({
            pageResults: [...pageMapRef.current.values()],
            batchFailures: nextFailures,
          })
          setBatchProgress(
            `Page ${pageNumber} read (${info.index + 1} of ${info.total}).`
          )
        },
        onPageFailure: (failure, info) => {
          failures.push(failure)
          const nextFailures = updateBatchFailures((current) => [
            ...current.filter(
              (existing) => existing.pageNumber !== failure.pageNumber
            ),
            failure,
          ])
          persistNow({ batchFailures: nextFailures })
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
    docIdRef.current = null
    setError(null)
    setNotice('')
    setStorageWarning('')
    setSourceMissing(false)
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
    setDocInfo(null)
    if (previous) {
      try {
        await previous.close()
      } catch {
        /* ignore a stale handle */
      }
    }

    try {
      if (isMusicXmlFile(file)) {
        setProgress('Reading the MusicXML score...')
        const score = await readMusicXmlFile(file)
        const converted = createMusicXmlPage(1, score, { name: file.name })
        if (!converted.ok) throw new Error(converted.error)
        const page = converted.page
        const docId = makeDocId()
        const info = { name: file.name, kind: 'score', pageCount: 1 }
        docIdRef.current = docId
        pageMapRef.current.set(1, page)
        const merged = mergePages('auto', [page])
        resultRef.current = merged
        setResult(merged)
        setDocInfo(info)
        setDoc(null)
        setPreview(null)
        setPreviewBusy(false)
        setPageIndex(0)
        setActivePage(1)
        setRotation(0)
        setZoom(1)
        setProgress('')
        setNotice(
          `Converted ${file.name} to tonic solfa. Check the key, rhythm, notes and voices before playing.`
        )
        const snapshot = sessionSnapshot({
          docId,
          docInfo: info,
          pageResults: [page],
          batchFailures: [],
          pageIndex: 0,
          rotation: 0,
          zoom: 1,
        })
        writer.saveNow(snapshot).then((stateResult) => {
          if (mountedRef.current && stateResult?.ok) setStorageWarning('')
        })
        return
      }

      const handle = await openSourceDocument(file, { onProgress: setProgress })
      const info = {
        name: handle.name,
        kind: handle.kind,
        pageCount: handle.pageCount,
      }
      const docId = makeDocId()
      docIdRef.current = docId
      docRef.current = handle
      setDoc(handle)
      setDocInfo(info)
      setPageIndex(0)
      setActivePage(1)
      setRotation(0)
      setZoom(1)
      setProgress('')
      const snapshot = sessionSnapshot({
        docId,
        docInfo: info,
        pageResults: [],
        batchFailures: [],
        pageIndex: 0,
        rotation: 0,
        zoom: 1,
      })
      Promise.all([
        writer.saveNow(snapshot),
        writer.saveFile(file, docId),
      ]).then(([stateResult, fileResult]) => {
        if (!mountedRef.current) return
        if (stateResult?.ok && fileResult?.ok) setStorageWarning('')
      })
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
    persistNow({
      scanMode: next,
      pageResults: [],
      batchFailures: [],
    })
    const messages = {
      auto: 'Automatic mode detects solfa, staff notation or plain text.',
      solfa: 'Solfa mode reads printed tonic solfa rows as playable notation.',
      staff: 'Staff mode reads staff notes and converts them to tonic solfa.',
      general: 'General document mode reads the page as editable text.',
    }
    setNotice(messages[next] || messages.auto)
  }

  function updatePageText(pageNumber, text) {
    const page = pageMapRef.current.get(pageNumber)
    if (!page) return
    setError(null)
    const updated =
      page.mode === 'general'
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
    persistSoon({ pageResults: [...pageMapRef.current.values()] })
  }

  function reconvertPage(pageNumber, changes) {
    const page = pageMapRef.current.get(pageNumber)
    if (!page) return
    const converted = reconvertStaffPage(page, changes)
    if (!converted.ok) {
      setError(converted.error || 'The staff notes could not be converted again.')
      return
    }
    setError(null)
    pageMapRef.current.set(pageNumber, converted.page)
    const merged = mergePages(
      scanMode === 'general' ? 'auto' : scanMode,
      [...pageMapRef.current.values()]
    )
    resultRef.current = merged
    setResult(merged)
    persistSoon({ pageResults: [...pageMapRef.current.values()] })
    setNotice(
      `Page ${pageNumber} converted as ${converted.page.conversion.displayKey}. Check the notes before playing.`
    )
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
    flushSession()
    onApply?.(value, parsed.result.key || key)
  }

  function useInPlayer(pageNumber = activePage) {
    const current = resultRef.current
    if (!current) return
    const page = current.pageResults?.find((entry) => entry.pageNumber === pageNumber)
    if (!page) {
      setError(`Page ${pageNumber} has not been read yet.`)
      return
    }
    if (page.mode === 'general') {
      setError('This page was read as text and cannot be played.')
      return
    }
    sendSheetToPlayer(
      page.sheetText || page.playable?.sheetText,
      page.key || page.playable?.key || current.key
    )
  }

  function useAllPagesInPlayer() {
    const current = resultRef.current
    if (!current) return
    if (current.mode === 'general') {
      setError('These pages were read as text and cannot be played.')
      return
    }
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
    result?.mode !== 'general' && canMergeSolfaPages(result?.pageResults || [])

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label="Gemini sheet reader">
      <section className="scanner">
        <header className="scanner-head">
          <div>
            <h2>
              {scanMode === 'general'
                ? 'Read a document with Gemini'
                : scanMode === 'staff'
                  ? 'Read staff notation'
                  : scanMode === 'auto'
                    ? 'Read a hymn page'
                    : 'Read a solfa sheet with Gemini'}
            </h2>
            <p className="scanner-subtitle">
              Upload an image, PDF, MusicXML or MXL file, then read the current page or
              all pages one at a time. Only the pages you choose are uploaded.
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
                  disabled={geminiBusy || restoring}
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
            onClick={handleClose}
            disabled={batchRunning}
            aria-label="Close scanner"
          >
            x
          </button>
        </header>

        {notice && <p className="scanner-notice">{notice}</p>}
        {storageWarning && (
          <p className="scanner-warn" role="status">
            {storageWarning}
          </p>
        )}
        {error && !doc && !hasResults && (
          <p className="scanner-error" role="alert">
            {error}
          </p>
        )}

        {restoring ? (
          <div className="dropzone busy">
            <div className="dropzone-body">
              <div className="spinner" aria-hidden="true" />
              <p>{progress || 'Restoring your previous scan...'}</p>
            </div>
          </div>
        ) : !doc && !hasResults ? (
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
                <span className="tag">
                  {docInfo?.kind === 'pdf'
                    ? 'PDF'
                    : docInfo?.kind === 'score'
                      ? 'score'
                      : 'image'}
                </span>
                <span className="tag">
                  {pageCount} page{pageCount === 1 ? '' : 's'}
                </span>
                <span className="tag">
                  {docInfo?.kind === 'score'
                    ? 'staff notation'
                    : scanMode === 'general'
                      ? 'document text'
                      : scanMode === 'auto'
                        ? 'automatic'
                        : scanMode}
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
                <span className="scanner-file-name">
                  {docInfo?.kind === 'score' ? docInfo.name : 'Gemini result'}
                </span>
                <span className="tag">
                  {docInfo?.kind === 'score' ? 'MusicXML' : 'Gemini AI'}
                </span>
                <button type="button" className="btn btn-quiet" onClick={closeDocument}>
                  Start over
                </button>
              </div>
            )}

            {sourceMissing && !doc && (
              <p className="scanner-warn">
                The saved source file could not be reopened. Your results are still
                available for editing, copying and playing. Start over to upload the
                source again.
              </p>
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
                onReconvert={reconvertPage}
                onUse={useInPlayer}
                onUseAll={useAllPagesInPlayer}
                onReadGemini={doc ? openGemini : null}
                onReadAll={doc ? () => openGeminiAll() : null}
                readAllLabel={readAllLabel}
                remainingCount={remainingPages.length}
                onRetryFailed={doc ? () => openGeminiAll([...failedPageNumbers]) : null}
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
        <p className="scanner-note">
          The source file and Gemini results are kept in this browser so you can resume.
          Clear document deletes the saved copy from this device.
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
