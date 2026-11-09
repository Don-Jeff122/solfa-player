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
  geminiEnabled,
  geminiBusy,
  onReadGemini,
  onReadAll,
  readAllLabel,
  remainingCount = 0,
  onRetryFailed,
  failedCount = 0,
  batchRunning = false,
  batchProgress = '',
  onStopBatch,
  progress,
  onClearDocument,
  docKind,
}) {
  return (
    <div className="scanner-viewer">
      <div className="scanner-viewer-bar">
        <div className="scanner-page-nav">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onPageChange(pageIndex - 1)}
            disabled={pageIndex <= 0 || geminiBusy}
            aria-label="Previous page"
          >
            &lt;
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
              disabled={geminiBusy}
              aria-label="Page number"
            />
            <span>/ {pageCount}</span>
          </label>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onPageChange(pageIndex + 1)}
            disabled={pageIndex >= pageCount - 1 || geminiBusy}
            aria-label="Next page"
          >
            &gt;
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
            -
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
            className="icon-btn"
            onClick={() => onRotate(rotation - 90)}
            disabled={geminiBusy}
            aria-label="Rotate left"
            title="Rotate left"
          >
            &larr;
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onRotate(rotation + 90)}
            disabled={geminiBusy}
            aria-label="Rotate right"
            title="Rotate right"
          >
            &rarr;
          </button>
        </div>
      </div>

      <div className="scanner-viewport">
        {preview ? (
          <div className="scanner-page" style={{ width: `${zoom * 100}%` }}>
            <img
              src={preview.url}
              alt={`Page ${pageIndex + 1} of the document`}
              draggable="false"
            />
          </div>
        ) : (
          <div className="scanner-preview-empty">
            {previewBusy ? (
              <>
                <div className="spinner" aria-hidden="true" />
                <p>{progress || 'Rendering the page...'}</p>
              </>
            ) : (
              <p>No page preview yet.</p>
            )}
          </div>
        )}
        {previewBusy && preview && (
          <div className="scanner-preview-busy" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <span>Rendering...</span>
          </div>
        )}
      </div>

      <div className="scanner-scan-row">
        {geminiEnabled ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onReadGemini}
              disabled={geminiBusy || previewBusy || !preview}
            >
              {batchRunning
                ? 'Reading pages...'
                : geminiBusy
                  ? 'Reading with Gemini...'
                  : 'Read with Gemini'}
            </button>
            {!batchRunning && pageCount > 1 && remainingCount > 0 && (
              <button
                type="button"
                className="btn"
                onClick={onReadAll}
                disabled={geminiBusy}
              >
                {readAllLabel}
              </button>
            )}
            {!batchRunning && failedCount > 0 && remainingCount !== failedCount && (
              <button
                type="button"
                className="btn"
                onClick={onRetryFailed}
                disabled={geminiBusy}
              >
                Retry failed ({failedCount})
              </button>
            )}
            {batchRunning && (
              <button type="button" className="btn btn-quiet" onClick={onStopBatch}>
                Stop reading
              </button>
            )}
          </>
        ) : (
          <p className="scanner-hint">Gemini is not configured for this build.</p>
        )}
      </div>

      {batchRunning && batchProgress && (
        <p className="scanner-progress" aria-live="polite">
          <span className="spinner tiny" aria-hidden="true" />
          {batchProgress}
        </p>
      )}

      {!batchRunning && geminiBusy && progress && (
        <p className="scanner-progress" aria-live="polite">
          <span className="spinner tiny" aria-hidden="true" />
          {progress}
        </p>
      )}

      <div className="scanner-viewer-foot">
        <span className="scanner-hint">
          {docKind === 'pdf'
            ? 'The PDF page is rendered locally. It is sent to Gemini only when you press Read with Gemini or read all pages.'
            : 'The image is processed locally. It is sent to Gemini only when you press Read with Gemini or read all pages.'}
        </span>
        <button
          type="button"
          className="btn btn-quiet btn-small"
          onClick={onClearDocument}
          disabled={geminiBusy}
        >
          Clear document
        </button>
      </div>
    </div>
  )
}
