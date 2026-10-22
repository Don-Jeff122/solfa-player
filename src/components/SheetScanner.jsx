import { useRef, useState } from 'react'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/bmp,application/pdf'

export default function SheetScanner({ onApply }) {
  const [state, setState] = useState('idle')
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState(null)
  const inputRef = useRef(null)
  const previewRef = useRef(null)

  async function handleFile(file) {
    if (!file) return
    setError(null)
    setResult(null)
    setState('working')
    setProgress('Starting…')

    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    if (file.type.startsWith('image/')) {
      previewRef.current = URL.createObjectURL(file)
      setPreview(previewRef.current)
    } else {
      previewRef.current = null
      setPreview(null)
    }

    try {
      // Loaded on demand: pdf.js and the OCR engine are far too large to
      // burden the main bundle for users who just type solfa.
      const { recognizeSheet } = await import('../lib/sheetRecognition.js')
      const converted = await recognizeSheet(file, setProgress)
      if (!converted.text.trim()) {
        setState('error')
        setError(
          converted.error ||
            'No solfa notes were found in that file. Make sure the sheet shows solfa ' +
              'syllables (Do Re Mi Fa So La Ti) or single letters, and that the text is clear and upright.'
        )
        return
      }
      setResult(converted)
      setState('done')
    } catch (e) {
      setState('error')
      setError(e?.message || 'Could not read that file.')
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  function apply() {
    if (!result) return
    onApply(result.text, result.key)
    setState('idle')
    setResult(null)
  }

  function reset() {
    setState('idle')
    setProgress('')
    setResult(null)
    setError(null)
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
    setPreview(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const lowConfidence = result && result.confidence < 75
  const noisy = result && result.unreadable > 0
  const timed = result && result.timed
  const mode = result?.mode || 'classic'
  const modeLabel =
    mode === 'hymnal'
      ? 'four-part solfa'
      : mode === 'staff'
        ? `rhythm from ${result.staves} staff${result.staves === 1 ? '' : 's'}`
        : mode === 'text'
          ? 'PDF text layer'
          : 'solfa text'
  const warnings = result?.warnings || []

  return (
    <section className="scanner">
      <header className="scanner-head">
        <h2>Read a sheet from a picture</h2>
        <button type="button" className="scanner-close" onClick={reset} aria-label="Close scanner">
          ×
        </button>
      </header>

      <div
        className={`dropzone${dragging ? ' dragging' : ''}${state === 'working' ? ' busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => state !== 'working' && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={(e) => handleFile(e.target.files?.[0])}
          hidden
        />
        {preview && <img className="dropzone-preview" src={preview} alt="Uploaded sheet" />}
        {state === 'working' ? (
          <div className="dropzone-body">
            <div className="spinner" aria-hidden="true" />
            <p>{progress}</p>
            <p className="muted">First scan loads the OCR engine.</p>
          </div>
        ) : (
          <div className="dropzone-body">
            <div className="dropzone-icon" aria-hidden="true" />
            <p>
              <strong>Drop a screenshot or PDF here</strong>
            </p>
            <p className="muted">or click to choose a file · PNG, JPG or PDF</p>
          </div>
        )}
      </div>

      {error && (
        <p className="scanner-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="scanner-result">
          <div className="scanner-meta">
            <span className={result.confidence >= 75 ? 'tag good' : 'tag warn'}>
              {Math.round(result.confidence)}% confident
            </span>
            <span className="tag">{result.pages} page{result.pages === 1 ? '' : 's'}</span>
            <span className="tag">{result.lineCount} line{result.lineCount === 1 ? '' : 's'}</span>
            {result.key && <span className="tag">key {result.key}</span>}
            <span className={timed || mode === 'hymnal' || mode === 'text' ? 'tag good' : 'tag'}>
              {modeLabel}
            </span>
            {mode === 'hymnal' && result.bars > 0 && (
              <span className="tag">
                {result.bars} bar{result.bars === 1 ? '' : 's'}
              </span>
            )}
            {result.unmatchedNotes > 0 && (
              <span className="tag warn">{result.unmatchedNotes} note{result.unmatchedNotes === 1 ? '' : 's'} unmatched</span>
            )}
            {noisy && <span className="tag warn">{result.unreadable} unreadable</span>}
          </div>

          {warnings.map((warning) => (
            <p className="scanner-warn" key={warning}>
              {warning}
            </p>
          ))}

          {(lowConfidence || noisy || result.unmatchedNotes > 0) && (
            <p className="scanner-warn">
              Music recognition is never perfect. Read the notes below against your
              original and correct anything wrong before playing.
            </p>
          )}

          <label className="scanner-preview-label" htmlFor="scanner-text">
            Recognised notes (edit if needed)
          </label>
          <textarea
            id="scanner-text"
            className="scanner-text"
            value={result.text}
            onChange={(e) => setResult({ ...result, text: e.target.value })}
            rows={Math.min(10, Math.max(3, result.lineCount + 1))}
            spellCheck={false}
          />

          <div className="scanner-actions">
            <button type="button" className="btn btn-primary" onClick={apply}>
              Use these notes
            </button>
            <button type="button" className="btn" onClick={reset}>
              Discard
            </button>
          </div>
        </div>
      )}

      <p className="scanner-note">
        Reads <b>solfa syllables</b>: Do Re Mi Fa So La Ti, or letters D R M F S L T,
        plus the chromatic Di Ri Fi Si Li and Ra Me Se Le Te.
        Four-part hymn sheets are read voice by voice from their S A T B rows and
        barlines; use the original PDF or a clean 300 DPI scan.
        Solfa printed under a five-line staff also gives the <b>note lengths</b>, which
        are measured from the staff itself. Upload a sheet that prints solfa, or type
        solfa directly for anything else.
      </p>
    </section>
  )
}
