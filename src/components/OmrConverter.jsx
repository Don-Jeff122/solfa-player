import { useEffect, useRef, useState } from 'react'
import {
  MAX_OMR_PDF_BYTES,
  fetchOmrMusicXml,
  getOmrJob,
  jobFailure,
  musicXmlDownloadUrl,
  uploadOmrJob,
} from '../lib/omr/omrService.js'

const STAGES = [
  { id: 'uploading', label: 'Uploading PDF' },
  { id: 'preparing', label: 'Preparing document' },
  { id: 'recognizing', label: 'Recognizing notation' },
  { id: 'generating', label: 'Generating MusicXML' },
  { id: 'validating', label: 'Validating MusicXML' },
  { id: 'complete', label: 'Conversion completed' },
]
const STAGE_IDS = STAGES.map((stage) => stage.id)
const PREVIEW_LIMIT = 24_000
const POLL_RETRIES = 60
const POLL_RETRY_MS = 2000
const DOWNLOAD_RETRIES = 30

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isPdfFile(file) {
  return Boolean(file) && (/\.pdf$/i.test(file.name || '') || file.type === 'application/pdf')
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Aborted')
      error.name = 'AbortError'
      reject(error)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      const error = new Error('Aborted')
      error.name = 'AbortError'
      reject(error)
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function isRetryableRequest(reason) {
  return !reason?.status || reason.status === 429 || reason.status >= 500
}

async function getJobWithRetry(id, { signal, onRetry }) {
  for (let attempt = 0; attempt <= POLL_RETRIES; attempt += 1) {
    try {
      return await getOmrJob(id, { signal })
    } catch (reason) {
      if (signal?.aborted || reason?.name === 'AbortError') throw reason
      if (!isRetryableRequest(reason) || attempt === POLL_RETRIES) throw reason
      onRetry?.()
      await wait(POLL_RETRY_MS, signal)
    }
  }
}

async function fetchMusicXmlWithRetry(id, { signal, onRetry }) {
  for (let attempt = 0; attempt <= DOWNLOAD_RETRIES; attempt += 1) {
    try {
      return await fetchOmrMusicXml(id, { signal })
    } catch (reason) {
      if (signal?.aborted || reason?.name === 'AbortError') throw reason
      if (!isRetryableRequest(reason) || attempt === DOWNLOAD_RETRIES) throw reason
      onRetry?.()
      await wait(POLL_RETRY_MS, signal)
    }
  }
}

function keyLabel(key) {
  if (!key) return 'Not found'
  const count = Math.abs(key.fifths)
  const accidentals =
    count === 0
      ? 'No sharps or flats'
      : `${count} ${key.fifths > 0 ? 'sharp' : 'flat'}${count === 1 ? '' : 's'}`
  return `${accidentals} · ${key.mode}`
}

function satbLabel(summary) {
  if (!summary) return 'Not available'
  if (summary.satbConfirmed) return 'SATB confirmed'
  if (summary.satbInferred) return 'SATB inferred'
  if (summary.parts === 4) return '4 parts · unconfirmed'
  return 'Not a 4-part score'
}

function stageState(stageId, { job, converting }) {
  const current = job?.stage || (converting ? 'uploading' : null)
  if (!current) return 'pending'
  if (job?.status === 'complete') return 'done'
  if (job?.status === 'failed') {
    const failedIndex = Math.max(0, STAGE_IDS.indexOf(job.failedStage || current))
    const index = STAGE_IDS.indexOf(stageId)
    if (index < failedIndex) return 'done'
    if (index === failedIndex) return 'failed'
    return 'pending'
  }
  if (current === 'queued') {
    if (stageId === 'uploading') return 'done'
    if (stageId === 'preparing') return 'active'
    return 'pending'
  }
  const currentIndex = STAGE_IDS.indexOf(current)
  const index = STAGE_IDS.indexOf(stageId)
  if (index < currentIndex) return 'done'
  if (index === currentIndex) return 'active'
  return 'pending'
}

export default function OmrConverter({ onClose }) {
  const [file, setFile] = useState(null)
  const [fileInfo, setFileInfo] = useState(null)
  const [fileBusy, setFileBusy] = useState(false)
  const [fileProgress, setFileProgress] = useState('')
  const [job, setJob] = useState(null)
  const [xml, setXml] = useState('')
  const [error, setError] = useState(null)
  const [uploadPct, setUploadPct] = useState(0)
  const [converting, setConverting] = useState(false)
  const [connectionNotice, setConnectionNotice] = useState('')

  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const inspectTokenRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  function clearResult() {
    setJob(null)
    setXml('')
    setError(null)
    setUploadPct(0)
    setConnectionNotice('')
  }

  function stopConversion() {
    abortRef.current?.abort()
    abortRef.current = null
    setConverting(false)
  }

  async function chooseFile(nextFile) {
    if (!nextFile) return
    if (converting) return
    if (!isPdfFile(nextFile)) {
      setError({
        message: 'Choose a PDF file. Handwritten pages and image files are not accepted here.',
        retryable: false,
      })
      return
    }

    const token = ++inspectTokenRef.current
    setFile(nextFile)
    setFileInfo(null)
    setError(null)
    setXml('')
    setJob(null)
    setUploadPct(0)
    setFileBusy(true)
    setFileProgress('Reading the PDF…')

    if (nextFile.size > MAX_OMR_PDF_BYTES) {
      setFileBusy(false)
      setFileProgress('')
      setError({
        message: `This PDF is ${formatBytes(nextFile.size)}. The limit is ${formatBytes(MAX_OMR_PDF_BYTES)}.`,
        retryable: false,
      })
      return
    }

    let document = null
    try {
      const { openDocument } = await import('../lib/documentService.js')
      document = await openDocument(nextFile, {
        onProgress: (message) => {
          if (mountedRef.current && inspectTokenRef.current === token) {
            setFileProgress(message)
          }
        },
      })
      if (!mountedRef.current || inspectTokenRef.current !== token) return
      setFileInfo({
        pages: document.pageCount,
        kind: document.kind,
      })
    } catch (reason) {
      if (!mountedRef.current || inspectTokenRef.current !== token) return
      setError({
        message: reason?.message || 'This PDF could not be opened.',
        retryable: false,
      })
    } finally {
      try {
        await document?.close()
      } catch {
        /* already released */
      }
      if (mountedRef.current && inspectTokenRef.current === token) {
        setFileBusy(false)
        setFileProgress('')
      }
    }
  }

  function handleDrop(event) {
    event.preventDefault()
    if (converting) return
    chooseFile(event.dataTransfer?.files?.[0])
  }

  function replaceFile(event) {
    chooseFile(event.target.files?.[0])
    event.target.value = ''
  }

  function reset() {
    stopConversion()
    inspectTokenRef.current += 1
    setFile(null)
    setFileInfo(null)
    setFileBusy(false)
    setFileProgress('')
    clearResult()
  }

  async function startConversion() {
    if (!file || fileBusy || converting) return
    stopConversion()
    const controller = new AbortController()
    abortRef.current = controller
    clearResult()
    setConverting(true)

    try {
      const created = await uploadOmrJob({
        file,
        signal: controller.signal,
        onProgress: (pct) => {
          if (mountedRef.current) setUploadPct(pct)
        },
      })
      if (!mountedRef.current) return
      if (!created?.id) {
        throw new Error('The OMR service returned no job.')
      }
      setJob(created)

      let current = created
      while (current.status !== 'complete' && current.status !== 'failed') {
        await wait(900, controller.signal)
        current = await getJobWithRetry(current.id, {
          signal: controller.signal,
          onRetry: () => {
            if (mountedRef.current) {
              setConnectionNotice('Reconnecting to the OMR service...')
            }
          },
        })
        if (!mountedRef.current) return
        setConnectionNotice('')
        setJob(current)
      }

      if (current.status === 'failed') {
        setError(jobFailure(current))
        return
      }

      const generated = await fetchMusicXmlWithRetry(current.id, {
        signal: controller.signal,
        onRetry: () => {
          if (mountedRef.current) {
            setConnectionNotice('Reconnecting to download the MusicXML...')
          }
        },
      })
      if (!mountedRef.current) return
      setConnectionNotice('')
      setXml(generated)
    } catch (reason) {
      if (reason?.name === 'AbortError' || controller.signal.aborted) return
      setError(reason)
    } finally {
      if (mountedRef.current) {
        setConverting(false)
        setConnectionNotice('')
      }
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const canConvert = Boolean(file && !fileBusy && !converting && !error)
  const progress = job ? job.progress : converting ? Math.min(5, Math.round(uploadPct * 0.05)) : 0
  const message = job?.message || (converting ? 'Uploading PDF' : 'Choose a PDF score to begin.')
  const detail =
    connectionNotice ||
    job?.detail ||
    fileProgress ||
    (converting && !job && uploadPct > 0 ? `${uploadPct}% uploaded` : '')
  const preview = xml.length > PREVIEW_LIMIT ? `${xml.slice(0, PREVIEW_LIMIT)}\n…preview shortened…` : xml
  const failureErrors = error?.validation?.errors || []
  const summary = job?.summary
  const warnings = summary ? job?.warnings || [] : []

  return (
    <div className="omr-overlay">
      <section className="omr-modal" role="dialog" aria-modal="true" aria-labelledby="omr-title">
        <div className="omr-head">
          <div>
            <h2 id="omr-title">PDF to MusicXML</h2>
            <p className="omr-subtitle">
              Optical music recognition with Audiveris. Printed scores only; review every generated
              note and voice against the original page.
            </p>
          </div>
          <button type="button" className="omr-close" onClick={onClose} aria-label="Close OMR">
            ×
          </button>
        </div>

        <div className="omr-body">
          <button
            type="button"
            className={`omr-dropzone${converting ? ' busy' : ''}`}
            onClick={() => !converting && inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            disabled={converting}
          >
            <span className="omr-drop-icon" aria-hidden="true" />
            <span className="omr-drop-title">
              {file ? 'Choose another PDF' : 'Choose a PDF score'}
            </span>
            <span className="omr-drop-note">
              Drag and drop, or click to browse. Up to {formatBytes(MAX_OMR_PDF_BYTES)}. Multi-page
              PDFs are supported.
            </span>
          </button>
          <input
            ref={inputRef}
            className="omr-file-input"
            type="file"
            accept="application/pdf,.pdf"
            onChange={replaceFile}
          />

          {file && (
            <div className="omr-file">
              <div>
                <strong>{file.name}</strong>
                <span>
                  {formatBytes(file.size)}
                  {fileInfo?.pages
                    ? ` · ${fileInfo.pages} page${fileInfo.pages === 1 ? '' : 's'}`
                    : fileBusy
                      ? ' · reading pages…'
                      : ''}
                </span>
              </div>
              <button type="button" className="btn btn-small" onClick={reset} disabled={converting}>
                Clear
              </button>
            </div>
          )}

          {(converting || job) && (
            <div className="omr-progress-card" aria-live="polite">
              <div className="omr-progress-head">
                <span>{message}</span>
                <b>{progress}%</b>
              </div>
              <div className="omr-progress-track">
                <span style={{ width: `${progress}%` }} />
              </div>
              {detail && <p className="omr-detail">{detail}</p>}
              <ol className="omr-stages">
                {STAGES.map((stage) => {
                  const state = stageState(stage.id, { job, converting })
                  return (
                    <li key={stage.id} className={`omr-stage ${state}`}>
                      <span className="omr-stage-dot" aria-hidden="true" />
                      <span>{stage.label}</span>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}

          {error && (
            <div className="omr-error" role="alert">
              <strong>{error.message}</strong>
              {failureErrors.length > 0 && (
                <ul>
                  {failureErrors.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              )}
              {error.detail && (
                <details>
                  <summary>Technical detail</summary>
                  <pre>{String(error.detail).slice(-5000)}</pre>
                </details>
              )}
              <div className="omr-actions">
                {error.retryable !== false && file && (
                  <button type="button" className="btn btn-primary" onClick={startConversion}>
                    Retry this PDF
                  </button>
                )}
                <button type="button" className="btn" onClick={reset}>
                  Choose another PDF
                </button>
              </div>
            </div>
          )}

          {canConvert && !xml && (
            <div className="omr-actions">
              <button type="button" className="btn btn-primary" onClick={startConversion}>
                Convert to MusicXML
              </button>
            </div>
          )}

          {xml && job?.status === 'complete' && (
            <div className="omr-result">
              <div className="omr-result-head">
                <h3>Conversion completed</h3>
                <span className="omr-badge">MusicXML</span>
              </div>
              <p className="omr-success">
                Audiveris produced a structurally valid partwise MusicXML file. This is not a
                guarantee of note-for-note accuracy.
              </p>

              {summary && (
                <>
                  <div className="omr-grid">
                    <div>
                      <span>Voices</span>
                      <b>{summary.parts}</b>
                    </div>
                    <div>
                      <span>Measures</span>
                      <b>{summary.measures}</b>
                    </div>
                    <div>
                      <span>Pitched notes</span>
                      <b>{summary.notes}</b>
                    </div>
                    <div>
                      <span>Rests</span>
                      <b>{summary.rests}</b>
                    </div>
                    <div>
                      <span>SATB</span>
                      <b>{satbLabel(summary)}</b>
                    </div>
                    <div>
                      <span>Key</span>
                      <b>{keyLabel(summary.key)}</b>
                    </div>
                    <div>
                      <span>Time</span>
                      <b>{summary.time ? `${summary.time.beats}/${summary.time.beatType}` : 'Not found'}</b>
                    </div>
                  </div>
                  {summary.partNames?.length > 0 && (
                    <p className="omr-parts">
                      {summary.satbInferred
                        ? `Voices: ${summary.partNames.join(' · ')} (inferred from ${summary.xmlParts ?? 1} MusicXML part${summary.xmlParts === 1 ? '' : 's'})`
                        : `Parts: ${summary.partNames.join(' · ')}`}
                    </p>
                  )}
                </>
              )}

              {warnings.length > 0 ? (
                <div className="omr-warnings">
                  <strong>Review before use</strong>
                  <ul>
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="omr-detail">No structural warnings were found.</p>
              )}

              <div className="omr-actions">
                <a
                  className="btn btn-primary"
                  href={musicXmlDownloadUrl(job.id)}
                  download
                >
                  Download MusicXML
                </a>
                <button type="button" className="btn" onClick={reset}>
                  Convert another PDF
                </button>
              </div>

              <details className="omr-preview">
                <summary>MusicXML preview</summary>
                <pre>{preview}</pre>
              </details>
            </div>
          )}

          <p className="omr-footnote">
            Audiveris runs on the owner-hosted OMR backend. The PDF is processed there and deleted
            after conversion. It is not sent to Gemini. Scanned pages should be around 300 DPI with
            straight staff lines; handwritten music is not supported.
          </p>
        </div>
      </section>
    </div>
  )
}
