function charClass(char, selected) {
  let className = 'scan-layout-char'
  if (char.uncertain && !char.corrected) className += ' uncertain'
  if (char.corrected) className += ' corrected'
  if (selected) className += ' selected'
  return className
}

export default function LayoutPage({ page, selectedId, onSelect }) {
  if (!page) return null

  return (
    <svg
      className="scan-layout-svg"
      viewBox={`0 0 ${page.width} ${page.height}`}
      role="group"
      aria-label={`Reconstructed layout for page ${page.page}`}
    >
      <rect width={page.width} height={page.height} fill="#fffdf7" />
      {(page.rules || []).map((rule) => (
        <line
          key={rule.id}
          x1={rule.x0}
          y1={rule.y0}
          x2={rule.x1}
          y2={rule.y1}
          className={`scan-layout-rule ${rule.orientation}`}
        />
      ))}
      {(page.lines || []).map((line) => {
        const height = line.bbox.y1 - line.bbox.y0
        const width = Math.max(line.bbox.x1 - line.bbox.x0, 1)
        return (
          <g key={line.id}>
            {line.underline && (
              <line
                x1={line.underline.x0}
                y1={line.underline.y0}
                x2={line.underline.x1}
                y2={line.underline.y1}
                className="scan-layout-underline"
              />
            )}
            {line.chars.map((char) => {
              const charHeight = char.bbox.y1 - char.bbox.y0
              const charWidth = char.bbox.x1 - char.bbox.x0
              const selected = char.id === selectedId
              return (
                <g
                  key={char.id}
                  className={charClass(char, selected)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`Character ${char.text}${char.uncertain ? ', uncertain' : ''}`}
                  onClick={() => onSelect(char)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(char)
                    }
                  }}
                >
                  <title>
                    {`${char.text} · ${Math.round(char.confidence * 100)}% confidence${
                      char.uncertain ? ' · uncertain' : ''
                    }${char.corrected ? ' · corrected' : ''}`}
                  </title>
                  <rect
                    x={char.bbox.x0}
                    y={char.bbox.y0}
                    width={Math.max(charWidth, 2)}
                    height={Math.max(charHeight, 2)}
                    rx={charHeight * 0.12}
                  />
                </g>
              )
            })}
            <text
              className="scan-layout-line-text"
              x={line.bbox.x0}
              y={line.bbox.y1 - height * 0.16}
              fontSize={Math.max(height * 0.8, 4)}
              textLength={width}
              lengthAdjust="spacingAndGlyphs"
              aria-hidden="true"
            >
              {line.text || line.raw_text}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
