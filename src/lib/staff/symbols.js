/**
 * Note symbol detection: find noteheads, stems, beams and dots on a staff and
 * turn them into note values (in beats, where a quarter note = 1).
 *
 * Staff lines are removed first, because a notehead sitting on a line would
 * otherwise merge with that line into one long horizontal run and become
 * invisible. Removal is thickness-aware: ink that is only as thick as the staff
 * line is erased, while ink standing proud of the line (a notehead or a stem)
 * is kept. Both filled and hollow heads then show up as ellipse-shaped runs,
 * and hollowness can be read from the paper left in the middle.
 */

/** Binary ink mask from a luminance array. */
export function toMask(luma, width, height, threshold) {
  const mask = new Uint8Array(width * height)
  for (let p = 0; p < luma.length; p++) mask[p] = luma[p] <= threshold ? 1 : 0
  return mask
}

/** Vertical position of the nth staff step below the top line. */
export function staffFrame(staff) {
  const { top, bottom, spacing } = staff
  return {
    ...staff,
    halfStep: spacing / 2,
    // A stem on the top line reaches about 3.5 spaces up and its beam adds more,
    // so look further above than below. Printed solfa sits close under the staff,
    // so the lower limit stays tight to avoid reading text as noteheads.
    searchTop: top - spacing * 4.2,
    searchBottom: bottom + spacing * 3,
    stepY: (n) => top + n * (spacing / 2),
  }
}

/**
 * Erase staff-line ink while leaving noteheads and stems in place.
 * Returns a new mask.
 */
export function removeStaffLines(mask, width, height, staff) {
  const out = mask.slice()
  const thicknesses = staff.lineThickness || [2, 2, 2, 2, 2]
  const pad = Math.max(2, Math.round(staff.spacing * 0.14))
  // An augmentation dot can be exactly as thick as a staff line, so thickness
  // alone cannot tell them apart. A real line is long, so require length too.
  const minRun = Math.max(6, Math.round(staff.spacing * 1.5))

  staff.lines.forEach((ly, idx) => {
    const t = Math.max(1, thicknesses[idx] ?? 2)
    const lineY = Math.round(ly)
    const top = Math.max(0, lineY - pad)
    const bot = Math.min(height - 1, lineY + pad)

    for (let x = 0; x < width; x++) {
      let first = -1
      let last = -1
      for (let y = top; y <= bot; y++) {
        if (out[y * width + x]) {
          if (first < 0) first = y
          last = y
        }
      }
      if (first < 0) continue
      // Only erase ink as thin as the line itself. A notehead or a stem is
      // thicker than the line over that span and stays, which also keeps the
      // paper inside a hollow head - a ring is recognised by its walls.
      if (last - first + 1 > t + 1) continue
      if (horizontalRun(out, width, height, first, x) < minRun) continue
      for (let y = first; y <= last; y++) out[y * width + x] = 0
    }
  })

  // A hollow head is plugged shut by the line crossing it: the paper inside the
  // ring is only as thick as the line, so it goes with the line and the ring
  // reads as solid. The rows just above the line still show the ring's two thin
  // walls, so the hole between them is opened here. A solid head shows one wide
  // run there instead, so it is left alone.
  const wallMax = Math.max(2, Math.round(staff.spacing * 0.35))
  const minHole = Math.max(2, Math.round(staff.spacing * 0.25))
  const maxHole = Math.round(staff.spacing * 0.8)
  const minSpan = Math.round(staff.spacing * 0.65)
  const maxSpan = Math.round(staff.spacing * 1.45)

  staff.lines.forEach((ly, idx) => {
    const t = Math.max(1, thicknesses[idx] ?? 2)
    const first = Math.round(ly - (t - 1) / 2)
    if (first < 1) return

    const runs = rowRuns(mask, width, height, first - 1)
    for (let i = 0; i + 1 < runs.length; i++) {
      const a = runs[i]
      const b = runs[i + 1]
      if (a.width > wallMax || b.width > wallMax) continue
      const hole = b.start - a.end - 1
      if (hole < minHole || hole > maxHole) continue
      const span = b.end - a.start + 1
      if (span < minSpan || span > maxSpan) continue

      for (let y = first; y <= first + t - 1 && y < height; y++) {
        for (let x = a.end + 1; x < b.start; x++) out[y * width + x] = 0
      }
    }
  })

  return out
}

/** Length of the horizontal run of ink through (x, y). */
function horizontalRun(mask, width, height, y, x) {
  if (y < 0 || y >= height) return 0
  let s = x
  while (s > 0 && mask[y * width + s - 1]) s--
  let e = x
  while (e < width - 1 && mask[y * width + e + 1]) e++
  return e - s + 1
}

/**
 * Find noteheads as ellipse-shaped horizontal runs. Works for hollow heads too,
 * because the ring's upper and lower arcs are still continuous runs.
 */
export function findHeads(mask, width, height, staff) {
  const f = staffFrame(staff)
  const found = [
    ...scanFilledHeads(mask, width, height, f),
    ...scanHollowHeads(mask, width, height, f),
  ]

  // The same head is sighted on many rows and often straddles the centre
  // column, so sightings a pixel apart must collapse to one. Comparing real
  // positions avoids the rounding boundaries that split one head in two.
  const sorted = found.sort((a, b) => a.cx - b.cx)
  const kept = []
  for (const h of sorted) {
    const prev = kept[kept.length - 1]
    if (prev && Math.abs(h.cx - prev.cx) < f.spacing * 0.45) {
      if (score(h) > score(prev)) kept[kept.length - 1] = h
      continue
    }
    kept.push(h)
  }

  return kept
    .map((h) => ({
      ...h,
      filled: isFilled(mask, width, h),
      density: inkDensity(mask, width, h),
      // Distance from the nearest staff position, in steps. Noteheads are
      // engraved exactly on a line or space, so this stays near zero. The
      // tolerance loosens on tiny staves, where one pixel is already a
      // sizeable fraction of a step.
      stepOffset: stepOffsetOf(f, h.cy),
      stepTolerance: Math.max(0.2, Math.min(0.35, 1 / f.halfStep)),
    }))
    .filter(isNoteheadShape)
    .sort((a, b) => a.cx - b.cx)
}

const score = (h) => h.width * h.height

/** Horizontal ink runs in one row. */
function rowRuns(mask, width, height, y) {
  const runs = []
  let x = 0
  while (x < width) {
    if (!mask[y * width + x]) {
      x++
      continue
    }
    const start = x
    while (x < width && mask[y * width + x]) x++
    runs.push({ start, end: x - 1, width: x - start })
  }
  return runs
}

/** Solid noteheads: a single ellipse-wide run. */
function scanFilledHeads(mask, width, height, f) {
  const minWidth = Math.max(3, Math.round(f.spacing * 0.5))
  const maxWidth = Math.round(f.spacing * 1.5)
  const minHeight = Math.max(3, Math.round(f.spacing * 0.3))
  const maxHeight = Math.round(f.spacing * 1.0)
  const y0 = Math.max(0, Math.round(f.searchTop))
  const y1 = Math.min(height - 1, Math.round(f.searchBottom))

  const found = []
  for (let y = y0; y <= y1; y++) {
    for (const run of rowRuns(mask, width, height, y)) {
      if (run.width < minWidth || run.width > maxWidth) continue
      const cx = Math.round((run.start + run.end) / 2)
      // Measure the blob's true height across the whole run. A hollow head
      // has paper down its centre, so measuring only at cx would cut the
      // height in half; stem columns are ignored instead of trusted.
      let top = y
      let bot = y
      let bestH = 0
      for (let xx = run.start; xx <= run.end; xx++) {
        let t2 = y
        let b2 = y
        while (t2 - 1 >= y0 && mask[(t2 - 1) * width + xx]) t2--
        while (b2 + 1 <= y1 && mask[(b2 + 1) * width + xx]) b2++
        const h2 = b2 - t2 + 1
        if (h2 > maxHeight) continue
        if (h2 > bestH) {
          bestH = h2
          top = t2
          bot = b2
        }
      }
      if (bestH >= minHeight) {
        found.push({ cx, cy: (top + bot) / 2, top, bottom: bot, width: run.width, height: bestH })
      }
    }
  }
  return found
}

/**
 * Hollow noteheads: a ring, so the widest part of the shape is a *pair* of thin
 * walls with paper between them. A solid head is one wide run, and a thin
 * engraved ring never reaches the solid width threshold, so it is measured here
 * instead by the gap it encloses.
 */
function scanHollowHeads(mask, width, height, f) {
  const wallMax = Math.max(2, Math.round(f.spacing * 0.35))
  const minGap = Math.max(2, Math.round(f.spacing * 0.25))
  const maxGap = Math.round(f.spacing * 0.8)
  const minSpan = Math.round(f.spacing * 0.65)
  const maxSpan = Math.round(f.spacing * 1.45)
  const minHeight = Math.max(3, Math.round(f.spacing * 0.3))
  const maxHeight = Math.round(f.spacing * 1.0)
  const y0 = Math.max(0, Math.round(f.searchTop))
  const y1 = Math.min(height - 1, Math.round(f.searchBottom))

  const sightings = []
  for (let y = y0; y <= y1; y++) {
    const runs = rowRuns(mask, width, height, y)
    for (let i = 0; i + 1 < runs.length; i++) {
      const a = runs[i]
      const b = runs[i + 1]
      // Both walls are pen-thin, and at a tight spacing a wall can be a single
      // pixel wide. A solid head beside another mark would otherwise pair up
      // with it and read as hollow, so the cluster checks below reject that.
      if (a.width > wallMax || b.width > wallMax) continue
      const gap = b.start - a.end - 1
      if (gap < minGap || gap > maxGap) continue
      const span = b.end - a.start + 1
      if (span < minSpan || span > maxSpan) continue
      sightings.push({ cx: (a.start + b.end) / 2, y, span })
    }
  }
  return clusterByColumn(sightings, f, minHeight, maxHeight)
}

/** Group row sightings of one head into a single head with a height. */
function clusterByColumn(sightings, f, minHeight, maxHeight) {
  const heads = []
  const open = []

  for (const s of sightings.sort((a, b) => a.y - b.y || a.cx - b.cx)) {
    const target = open.find(
      (c) => s.y - c.lastY <= 3 && Math.abs(s.cx - c.cx) < f.spacing * 0.3
    )
    if (target) {
      target.lastY = s.y
      target.top = Math.min(target.top, s.y)
      target.bottom = Math.max(target.bottom, s.y)
      target.sumX += s.cx
      // The ring's true width is its widest row, not the average: the arcs at
      // the top and bottom are much narrower than the middle of the ring.
      target.maxSpan = Math.max(target.maxSpan, s.span)
      target.count++
    } else {
      open.push({
        cx: s.cx,
        sumX: s.cx,
        maxSpan: s.span,
        count: 1,
        top: s.y,
        bottom: s.y,
        lastY: s.y,
      })
    }

    // Retire clusters that can no longer collect rows.
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].lastY < s.y - 3) heads.push(finishCluster(open[i], minHeight, maxHeight))
      if (open[i].lastY < s.y - 3) open.splice(i, 1)
    }
  }

  for (const c of open) heads.push(finishCluster(c, minHeight, maxHeight))
  return heads.filter(Boolean)
}

function finishCluster(c, minHeight, maxHeight) {
  const height = c.bottom - c.top + 1
  if (height < minHeight || height > maxHeight) return null
  const width = Math.max(1, Math.round(c.maxSpan))
  const cx = c.sumX / c.count
  return { cx, cy: (c.top + c.bottom) / 2, top: c.top, bottom: c.bottom, width, height }
}


/**
 * Tell a notehead from a blob of printed solfa.
 *
 * A notehead is always wider than it is tall and sits on a line or space.
 * Printed syllables sit just under the staff, so position alone cannot rule them
 * out, but their glyphs are tall and narrow and drift off the staff positions.
 */
function isNoteheadShape(h) {
  return h.width > h.height * 1.15 && h.stepOffset < h.stepTolerance
}

/** Fraction of a blob's bounding box that is ink. */
function inkDensity(mask, width, head) {
  let dark = 0
  let total = 0
  for (let y = head.top; y <= head.bottom; y++) {
    for (let x = head.cx - Math.floor(head.width / 2); x <= head.cx + Math.floor(head.width / 2); x++) {
      if (x < 0 || x >= width) continue
      total++
      if (mask[y * width + x]) dark++
    }
  }
  return total ? dark / total : 0
}

/** How far a y sits from the nearest line or space, measured in steps. */
function stepOffsetOf(f, cy) {
  const steps = (cy - f.top) / f.halfStep
  return Math.abs(steps - Math.round(steps))
}

/** A solid head is inked through its middle; a hollow one is not. */
function isFilled(mask, width, head) {
  const inset = Math.max(1, Math.round(head.height * 0.25))
  const top = head.top + inset
  const bot = head.bottom - inset
  if (bot <= top) return true
  let dark = 0
  let total = 0
  for (let y = top; y <= bot; y++) {
    for (let x = head.cx - 1; x <= head.cx + 1; x++) {
      if (x < 0) continue
      total++
      if (mask[y * width + x]) dark++
    }
  }
  return total > 0 && dark / total > 0.6
}

/** Stems: narrow and tall columns of ink. */
export function findStems(mask, width, height, staff) {
  const f = staffFrame(staff)
  const maxWidth = Math.max(2, Math.round(f.spacing * 0.25))
  const minHeight = Math.round(f.spacing * 1.5)
  const y0 = Math.max(0, Math.round(f.searchTop))
  const y1 = Math.min(height - 1, Math.round(f.searchBottom))

  const stems = []
  for (let x = 0; x < width; x++) {
    let y = y0
    while (y <= y1) {
      if (!mask[y * width + x]) {
        y++
        continue
      }
      let end = y
      while (end <= y1 && mask[end * width + x]) end++
      const h = end - y
      if (h >= minHeight) {
        let w = 1
        const mid = y + (h >> 1)
        while (x + w < width && mask[mid * width + x + w] && w <= maxWidth) w++
        if (w <= maxWidth) stems.push({ x, y0: y, y1: end - 1, height: h })
      }
      y = end
    }
  }
  return stems
}

/**
 * Beams: bars joining two or more stems. Counted per stem as the number of
 * separate bars covering it, which gives eighth (1) or sixteenth (2).
 */
export function findBeams(mask, width, height, staff, stems) {
  const f = staffFrame(staff)
  const minBar = f.spacing * 1.2
  const bars = []

  for (const s of stems) {
    for (const edge of [s.y0, s.y1]) {
      for (let dy = -2; dy <= 2; dy++) {
        const y = edge + dy
        if (y < 0 || y >= height) continue
        let x = s.x
        while (x > 0 && mask[y * width + x - 1]) x--
        let end = s.x
        while (end < width - 1 && mask[y * width + end + 1]) end++
        if (end - x + 1 >= minBar) {
          bars.push({ y, x0: x, x1: end })
          break
        }
      }
    }
  }

  // Merge bars that are the same level and overlapping in x.
  const merged = []
  for (const b of bars.sort((a, c) => a.y - c.y || a.x0 - c.x0)) {
    const hit = merged.find(
      (m) => Math.abs(m.y - b.y) <= 3 && b.x0 <= m.x1 + f.spacing && b.x1 >= m.x0 - f.spacing
    )
    if (hit) {
      hit.x0 = Math.min(hit.x0, b.x0)
      hit.x1 = Math.max(hit.x1, b.x1)
    } else {
      merged.push({ ...b })
    }
  }
  return merged
}

/**
 * Augmentation dots: a small compact blob just right of a notehead at the same
 * height. Stems are ruled out by requiring the blob to be vertically small.
 */
export function findDots(mask, width, height, staff, heads) {
  const f = staffFrame(staff)
  const halfH = Math.max(2, Math.round(f.spacing * 0.28))
  const maxH = Math.max(2, Math.round(f.spacing * 0.42))
  const dots = []

  for (const head of heads) {
    // Start past the head's own right edge: scanning inside the body would
    // read the head itself as a dot.
    const from = Math.round(head.cx + head.width / 2) + 1
    const to = from + Math.round(f.spacing * 1.2)
    for (let x = from; x <= to && x < width; x++) {
      let top = -1
      let bot = -1
      let dark = 0
      for (let y = head.cy - halfH; y <= head.cy + halfH; y++) {
        if (y < 0 || y >= height) continue
        if (mask[y * width + x]) {
          if (top < 0) top = y
          bot = y
          dark++
        }
      }
      if (top < 0) continue
      // A real dot is a compact blob with paper above and below it. A stem
      // also crosses this window but runs off the edge, so require the blob to
      // be fully enclosed.
      const enclosed = top > head.cy - halfH && bot < head.cy + halfH
      if (enclosed && bot - top + 1 <= maxH && dark >= 2) {
        dots.push({ x, y: head.cy, headX: head.cx })
        break
      }
    }
  }
  return dots
}

/** Combine head/stem/beam/dot evidence into note values. */
export function detectNotes({ mask, width, height, staff }) {
  const f = staffFrame(staff)
  const clean = removeStaffLines(mask, width, height, staff)
  const heads = findHeads(clean, width, height, staff)
  const stems = findStems(clean, width, height, staff)
  const beams = findBeams(clean, width, height, staff, stems)
  const dots = findDots(clean, width, height, staff, heads)

  const notes = heads.map((head) => {
    // A stem belongs to this notehead if it is close enough to reach it and
    // spans across it.
    const own = stems.filter(
      (s) =>
        Math.abs(s.x - head.cx) <= f.spacing * 0.8 &&
        s.y0 <= head.bottom + f.spacing * 0.6 &&
        s.y1 >= head.top - f.spacing * 0.6
    )
    const hasStem = own.length > 0

    // Count beams joined to this note through its own stem only. A beam merely
    // stretching past the notehead - one belonging to another staff, say - must
    // not turn a crotchet into a quaver.
    const levels = new Set()
    for (const s of own) {
      for (const b of beams) {
        if (b.y < s.y0 - 3 || b.y > s.y1 + 3) continue
        if (b.x0 - 2 > s.x || b.x1 + 2 < s.x) continue
        levels.add(b.y)
      }
    }
    const beamLevels = levels.size

    let beats
    if (!hasStem) beats = head.filled ? 1 : 4
    else if (beamLevels >= 2) beats = 0.25
    else if (beamLevels === 1) beats = 0.5
    else beats = head.filled ? 1 : 2

    const dotted = dots.some((d) => d.headX === head.cx)
    if (dotted) beats *= 1.5

    return {
      x: head.cx,
      step: Math.round((head.cy - f.top) / f.halfStep),
      beats,
      dotted,
      filled: head.filled,
      hasStem,
      beamLevels,
    }
  })

  return notes.sort((a, b) => a.x - b.x)
}
