import { useRef } from 'react'

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function normalizeRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export default function DocumentViewer({
  preview,
  previewBusy,
  pageIndex,
  pageCount,
  onPageChange,
  rotation,
  onRotate,
  zoom,
  onZoom,
  selectMode,
  onSelectModeChange,
  selection,
  onSelectionChange,
  onScanPage,
  onScanAll,
  onScanRegion,
  onStopScan,
  scanning,
  progress,
  onClearDocument,
  enhance,
  onEnhanceChange,
  denoise,
  onDenoiseChange,
  docKind,
  hasResults,
}) {
  const dragRef = useRef(null)

  function point(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp01((event.clientY - rect.top) / Math.max(1, rect.height)),
    }
  }

  function startSelection(event) {
    if (!selectMode || !preview) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const start = point(event)
    dragRef.current = start
    onSelectionChange({ ...start, width: 0, height: 0 })
  }

  function moveSelection(event) {
    if (!dragRef.current) return
    event.preventDefault()
    onSelectionChange(normalizeRect(dragRef.current, point(event)))
  }

  function endSelection(event) {
    if (!dragRef.current) return
    const rect = normalizeRect(dragRef.current, point(event))
    dragRef.current = null
    if (rect.width < 0.012 || rect.height < 0.012) {
      onSelectionChange(null)
      return
    }
    onSelectionChange(rect)
  }

  function cancelSelection() {
    dragRef.current = null
    onSelectionChange(null)
    onSelectModeChange(false)
  }

  const selectionStyle = selection
    ? {
        left: `${selection.x * 100}%`,
        top: `${selection.y * 100}%`,
        width: `${selection.width * 100}%`,
        height: `${selection.height * 100}%`,
      }
    : null

  return (
    <div className="scanner-viewer">
      <div className="scanner-viewer-bar">
        <div className="scanner-page-nav">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onPageChange(pageIndex - 1)}
            disabled={pageIndex <= 0 || scanning}
            aria-label="Previous page"
          >
            ‹
          </button>
          <label className="scanner-page-label">
            <span className="sr-only">Page</span>
            <input
              type="number"
              min="1"
              max={pageCount}
              value={pageIndex + 1}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next)) onPageChange(next - 1)
              }}
              aria-label="Page number"
            />
            <span>/ {pageCount}</span>
          </label>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onPageChange(pageIndex + 1)}
            disabled={pageIndex >= pageCount - 1 || scanning}
            aria-label="Next page"
          >
            ›
          </button>
        </div>

        <div className="scanner-zoom">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onZoom(zoom - 0.25)}
            disabled={zoom <= 0.5}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="scanner-zoom-label"
            onClick={() => onZoom(1)}
            title="Fit width"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onZoom(zoom + 0.25)}
            disabled={zoom >= 3}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>

        <div className="scanner-view-actions">
          <button
            type="button"
            className={`btn btn-small${selectMode ? ' active' : ''}`}
            onClick={() => {
              if (selectMode) cancelSelection()
              else onSelectModeChange(true)
            }}
            disabled={scanning || previewBusy || !preview}
          >
            {selectMode ? 'Cancel selection' : 'Select area'}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onRotate(rotation - 90)}
            disabled={scanning}
            aria-label="Rotate left"
            title="Rotate left"
          >
            ⟲
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onRotate(rotation + 90)}
            disabled={scanning}
            aria-label="Rotate right"
            title="Rotate right"
          >
            ⟳
          </button>
        </div>
      </div>

      <div className="scanner-viewport">
        {preview ? (
          <div className="scanner-page" style={{ width: `${zoom * 100}%` }}>
            <img src={preview.url} alt={`Page ${pageIndex + 1} of the document`} draggable="false" />
            <div
              className={`scanner-select-layer${selectMode ? ' selecting' : ''}`}
              onPointerDown={startSelection}
              onPointerMove={moveSelection}
              onPointerUp={endSelection}
              onPointerCancel={cancelSelection}
            >
              {selectionStyle && <div className="scanner-selection" style={selectionStyle} />}
            </div>
          </div>
        ) : (
          <div className="scanner-preview-empty">
            {previewBusy ? (
              <>
                <div className="spinner" aria-hidden="true" />
                <p>{progress || 'Rendering the page…'}</p>
              </>
            ) : (
              <p>No page preview yet.</p>
            )}
          </div>
        )}
        {previewBusy && preview && (
          <div className="scanner-preview-busy" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <span>Rendering…</span>
          </div>
        )}
      </div>

      <div className="scanner-scan-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onScanPage}
          disabled={scanning || previewBusy || !preview}
        >
          {scanning ? 'Scanning…' : hasResults ? 'Rescan this page' : 'Scan this page'}
        </button>
        {pageCount > 1 && (
          <button
            type="button"
            className="btn"
            onClick={onScanAll}
            disabled={scanning || previewBusy || !preview}
          >
            Scan all {pageCount} pages
          </button>
        )}
        {selection && (
          <button
            type="button"
            className="btn"
            onClick={onScanRegion}
            disabled={scanning || previewBusy}
          >
            Scan selection
          </button>
        )}
        {selection && (
          <button type="button" className="btn btn-quiet" onClick={cancelSelection}>
            Clear selection
          </button>
        )}
        {scanning && (
          <button type="button" className="btn btn-quiet" onClick={onStopScan}>
            Stop after this page
          </button>
        )}
      </div>

      {scanning && progress && (
        <p className="scanner-progress" aria-live="polite">
          <span className="spinner tiny" aria-hidden="true" />
          {progress}
        </p>
      )}

      <div className="scanner-viewer-foot">
        <label className="scanner-toggle">
          <input
            type="checkbox"
            checked={enhance}
            onChange={(event) => onEnhanceChange(event.target.checked)}
            disabled={scanning}
          />
          <span>Enhance scan</span>
        </label>
        <label className="scanner-toggle">
          <input
            type="checkbox"
            checked={denoise}
            onChange={(event) => onDenoiseChange(event.target.checked)}
            disabled={scanning}
          />
          <span>Reduce noise</span>
        </label>
        <span className="scanner-hint">
          {docKind === 'pdf'
            ? 'The PDF page is rendered locally. Nothing is uploaded.'
            : 'The picture is processed locally. Nothing is uploaded.'}
        </span>
        <button
          type="button"
          className="btn btn-quiet btn-small"
          onClick={onClearDocument}
          disabled={scanning}
        >
          Clear document
        </button>
      </div>
    </div>
  )
}
