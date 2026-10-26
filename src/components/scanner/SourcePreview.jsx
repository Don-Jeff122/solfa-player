import { useEffect, useRef } from 'react'

export default function SourcePreview({ src, page, selectedChar, compact = false }) {
  const box = selectedChar?.bbox
  const frameRef = useRef(null)
  const hitRef = useRef(null)

  useEffect(() => {
    if (!box) return
    const frame = frameRef.current
    const hit = hitRef.current
    if (!frame || !hit) return
    frame.scrollTop = Math.max(0, hit.offsetTop - frame.clientHeight / 2 + hit.offsetHeight / 2)
    frame.scrollLeft = Math.max(0, hit.offsetLeft - frame.clientWidth / 2 + hit.offsetWidth / 2)
  }, [box, selectedChar?.id])

  return (
    <div className={`scan-source${compact ? ' compact' : ''}`}>
      <div className="scan-source-frame" ref={frameRef}>
        <div className="scan-source-image">
          {src ? (
            <img src={src} alt={`Scanned source page ${page || ''}`} />
          ) : (
            <div className="scan-source-empty">No page preview</div>
          )}
          {box && (
            <span
              className="scan-source-hit"
              ref={hitRef}
              style={{
                left: `${(box.x0 / (page?.width || 1)) * 100}%`,
                top: `${(box.y0 / (page?.height || 1)) * 100}%`,
                width: `${((box.x1 - box.x0) / (page?.width || 1)) * 100}%`,
                height: `${((box.y1 - box.y0) / (page?.height || 1)) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
      {!compact && (
        <p className="scan-source-caption">
          Scanned source, deskewed for OCR. The highlighted box follows the selected character.
        </p>
      )}
    </div>
  )
}
