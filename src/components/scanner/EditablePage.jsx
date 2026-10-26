function spaces(value) {
  return value.replaceAll(' ', '\u00a0')
}

function charWidths(lines) {
  const widths = lines
    .flatMap((line) => line.chars)
    .map((char) => char.bbox.x1 - char.bbox.x0)
    .filter((width) => width > 0)
    .sort((a, b) => a - b)
  return widths.length ? widths[Math.floor(widths.length / 2)] : 10
}

function lineChars(line) {
  const raw = line.raw_text || line.text || ''
  let previousOffset = -1
  return line.chars.map((char) => {
    const gap = raw.slice(previousOffset + 1, char.offset)
    previousOffset = char.offset
    return { char, gap }
  })
}

export default function EditablePage({ page, selectedId, onSelect }) {
  if (!page) return null
  const ordered = [...page.lines].sort(
    (a, b) => a.row - b.row || a.bbox.x0 - b.bbox.x0
  )
  if (!ordered.length) {
    return (
      <div className="scan-empty-result">
        <strong>No notation found on this page.</strong>
        <span>Try a sharper image or rescan with the page upright.</span>
      </div>
    )
  }

  const median = charWidths(ordered)
  const rows = []
  for (const line of ordered) {
    const current = rows[rows.length - 1]
    if (current && current.row === line.row) current.lines.push(line)
    else rows.push({ row: line.row, lines: [line] })
  }

  return (
    <div
      className="scan-editable"
      role="group"
      aria-label={`Editable transcription for page ${page.page}`}
    >
      {rows.map((group) => {
        const first = group.lines[0]
        const indent = Math.min(30, Math.max(0, Math.round((first.bbox.x0 / page.width) * 28)))
        return (
          <div
            className="scan-edit-line"
            key={`row-${group.row}`}
            style={{ paddingLeft: `${indent}%` }}
          >
            {group.lines.map((line, lineIndex) => {
              const previous = group.lines[lineIndex - 1]
              const columnGap = previous
                ? Math.min(12, Math.max(1, Math.round((line.bbox.x0 - previous.bbox.x1) / median)))
                : 0
              return (
                <span className="scan-edit-segment" key={line.id}>
                  {columnGap > 0 && (
                    <span className="scan-edit-gap">{'\u00a0'.repeat(columnGap)}</span>
                  )}
                  {lineChars(line).map(({ char, gap }) => (
                    <span className="scan-edit-char-wrap" key={char.id}>
                      {gap && <span className="scan-edit-gap">{spaces(gap)}</span>}
                      <button
                        type="button"
                        className={[
                          'scan-edit-char',
                          char.id === selectedId ? 'selected' : '',
                          char.uncertain && !char.corrected ? 'uncertain' : '',
                          char.corrected ? 'corrected' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => onSelect(char)}
                        aria-pressed={char.id === selectedId}
                        title={
                          char.uncertain
                            ? `${char.text} · uncertain, ${Math.round(char.confidence * 100)}%`
                            : `${char.text} · ${Math.round(char.confidence * 100)}%`
                        }
                      >
                        {char.text}
                      </button>
                    </span>
                  ))}
                </span>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
