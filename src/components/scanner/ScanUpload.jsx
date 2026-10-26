import { useRef, useState } from 'react'

export default function ScanUpload({ onFile, disabled }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const choose = () => {
    if (!disabled) inputRef.current?.click()
  }

  const receive = (file) => {
    if (!disabled && file) onFile(file)
  }

  return (
    <div
      className={`scan-drop${dragging ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer?.files?.[0]
        receive(file)
      }}
    >
      <div className="scan-drop-icon" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="scan-drop-title">Drop a solfa sheet here</p>
      <p className="scan-drop-copy">
        PNG, JPG, JPEG or PDF. Multipage PDFs are processed one page at a time.
      </p>
      <button type="button" className="btn btn-primary" onClick={choose} disabled={disabled}>
        Choose file
      </button>
      <p className="scan-drop-note">
        Up to 25 MB and 40 PDF pages by default. Files are temporary and removed by the backend.
      </p>
      <input
        ref={inputRef}
        className="scan-file-input"
        type="file"
        accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
        onChange={(event) => {
          receive(event.target.files?.[0])
          event.target.value = ''
        }}
        tabIndex={-1}
      />
    </div>
  )
}
