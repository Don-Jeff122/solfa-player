/**
 * A tiny engraver used only by tests: it draws note symbols onto a synthetic
 * page so duration detection can be measured against known ground truth.
 */

export function createCanvas(width, height) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)

  const set = (x, y, v = 0) => {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 4
    data[i] = data[i + 1] = data[i + 2] = v
  }

  const hLine = (x0, x1, y, thickness = 2) => {
    for (let x = Math.round(x0); x <= Math.round(x1); x++) {
      for (let t = 0; t < thickness; t++) set(x, y + t)
    }
  }

  const vLine = (x, y0, y1, thickness = 2) => {
    for (let y = Math.round(y0); y <= Math.round(y1); y++) {
      for (let t = 0; t < thickness; t++) set(x + t, y)
    }
  }

  /** Filled notehead: an ellipse roughly one space wide. */
  const filledHead = (cx, cy, s) => {
    const rx = s * 0.52
    const ry = s * 0.33
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx
        const dy = (y - cy) / ry
        if (dx * dx + dy * dy <= 1) set(x, y)
      }
    }
  }

  /**
   * Hollow notehead: an elliptical ring with the same outer size as a filled
   * one. The ring is pen-thin, like real engraving, which is what makes hollow
   * heads harder to find than solid ones.
   */
  const hollowHead = (cx, cy, s) => {
    const rx = s * 0.52
    const ry = s * 0.33
    const t = Math.max(1, Math.round(s * 0.1))
    const inner = (1 - t / ry) ** 2
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx
        const dy = (y - cy) / ry
        const d = dx * dx + dy * dy
        if (d <= 1 && d >= inner) set(x, y)
      }
    }
  }

  const dot = (cx, cy, s) => filledHead(cx, cy, s * 0.3)

  return { data, width, height, set, hLine, vLine, filledHead, hollowHead, dot }
}

/** Draw a five-line staff and return its geometry. */
export function drawStaff(canvas, { top, left, right, spacing, lineThickness = 2 }) {
  for (let l = 0; l < 5; l++) canvas.hLine(left, right, top + l * spacing, lineThickness)
  return { top, bottom: top + 4 * spacing, spacing, left, right }
}

/**
 * Join the stems of consecutive flagged notes with `levels` beam bars.
 * Real beams run from one stem to the next, so this spans the whole group.
 */
export function drawBeamBetween(canvas, staff, { fromX, toX, step = 2, levels = 1 }) {
  const s = staff.spacing
  const cy = staff.top + step * (s / 2)
  // Must match `drawNote`'s stem-direction rule, or the beam lands at the
  // wrong end of the stems.
  const up = cy > staff.top + 2 * s
  const stemOffset = s * 0.52
  const len = s * 3.5
  const anchorY = up ? cy - len : cy + len

  for (let l = 0; l < levels; l++) {
    const y = up ? anchorY - l * s * 0.3 : anchorY + l * s * 0.3
    canvas.hLine(fromX - stemOffset, toX + stemOffset, y, 3)
  }
}

/**
 * Draw one note. Beams are added separately with `drawBeamBetween`, because a
 * beam has to span a group of notes rather than sit on a single stem.
 *
 * 4 = whole (no stem), 2 = half (hollow), 1 = quarter (filled),
 * 0.5 / 0.25 = flagged (filled; the beam supplies the flag).
 */
export function drawNote(canvas, staff, { x, step = 2, beats, dotted = false }) {
  const s = staff.spacing
  const y = staff.top + step * (s / 2)
  const filled = beats !== 4 && beats !== 2

  if (filled) canvas.filledHead(x, y, s)
  else canvas.hollowHead(x, y, s)

  if (beats !== 4) {
    const up = y > staff.top + 2 * s
    const stemX = up ? x - s * 0.52 : x + s * 0.52
    const len = s * 3.5
    canvas.vLine(stemX, up ? y - len : y, up ? y : y + len, 2)
  }

  if (dotted) canvas.dot(x + s * 0.95, y, s)
  return { x, y, beats, dotted }
}
