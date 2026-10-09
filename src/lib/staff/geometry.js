/**
 * Staff geometry: find the five lines of every staff on a page.
 *
 * Everything here works on a plain luminance array so it can be tested without
 * a browser. The browser side only has to hand over `getImageData`.
 */

/** Convert RGBA bytes to a luminance array (0-255). */
export function toLuma(rgba, width, height) {
  const luma = new Uint8ClampedArray(width * height)
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
    luma[p] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) | 0
  }
  return luma
}

/**
 * Otsu's method: pick the threshold that best separates ink from paper.
 * Returns null for a blank or near-uniform image.
 */
export function otsuThreshold(luma) {
  const hist = new Float64Array(256)
  for (let i = 0; i < luma.length; i++) hist[luma[i]]++

  let total = 0
  let sum = 0
  for (let t = 0; t < 256; t++) {
    total += hist[t]
    sum += t * hist[t]
  }
  if (total === 0) return null

  const between = new Float64Array(256)
  let sumB = 0
  let wB = 0
  let bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    sumB += t * hist[t]
    if (wB === 0 || wB === total) {
      between[t] = -1
      continue
    }
    const wF = total - wB
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    between[t] = wB * wF * (mB - mF) * (mB - mF)
    if (between[t] > bestVar) bestVar = between[t]
  }
  if (bestVar <= 0) return null

  // On a clean black-on-white scan every threshold between the two modes scores
  // the same, so take the midpoint of that plateau rather than its first
  // element, which would collapse to 0 and match only pure black.
  let lo = -1
  let hi = -1
  for (let t = 0; t < 256; t++) {
    if (between[t] >= bestVar * 0.999) {
      if (lo < 0) lo = t
      hi = t
    }
  }
  if (lo < 0) return null
  return Math.round((lo + hi) / 2)
}

/** Rows dark enough to be ink, given a threshold. */
export function inkRows(luma, width, height, threshold, minRatio = 0.12) {
  const rows = new Uint8ClampedArray(height)
  const need = Math.max(2, Math.round(width * minRatio))
  for (let y = 0; y < height; y++) {
    let dark = 0
    const base = y * width
    for (let x = 0; x < width; x++) if (luma[base + x] <= threshold) dark++
    rows[y] = dark >= need ? 1 : 0
  }
  return rows
}

/**
 * Group dark rows into runs. A staff line is a thin run; the gap between two
 * lines is roughly the same size, which is what links them into a staff.
 */
export function runsOf(rows) {
  const runs = []
  let start = -1
  for (let y = 0; y < rows.length; y++) {
    if (rows[y] && start < 0) start = y
    else if (!rows[y] && start >= 0) {
      runs.push({ start, end: y - 1, height: y - start })
      start = -1
    }
  }
  if (start >= 0) runs.push({ start, end: rows.length - 1, height: rows.length - start })
  return runs
}

/**
 * Find every staff: groups of five evenly spaced lines.
 *
 * `minSpacing`/`maxSpacing` bound the line gap in pixels, so page rules,
 * underlines and scan artefacts cannot be mistaken for a staff. A candidate
 * group is only accepted once its five gaps are genuinely even, and a rejected
 * group releases its lines so a real staff underneath can still be found.
 */
export function findStaves(
  rows,
  { minSpacing = 4, maxSpacing = 40, tolerance = 0.35, maxJitter = 0.25 } = {}
) {
  const candidates = runsOf(rows).filter((r) => r.height <= Math.max(3, maxSpacing / 3))
  const staves = []
  const claimed = new Set()

  for (let i = 0; i < candidates.length; i++) {
    if (claimed.has(i)) continue

    const group = [i]
    let spacing = 0
    for (let j = i + 1; j < candidates.length && group.length < 5; j++) {
      if (claimed.has(j)) continue
      const prev = candidates[group[group.length - 1]]
      const gap = candidates[j].start - prev.end
      if (gap < minSpacing - 1) continue
      if (spacing === 0) {
        if (gap > maxSpacing) break
        spacing = gap
      } else if (Math.abs(gap - spacing) > spacing * tolerance) {
        if (gap > maxSpacing) break
        continue
      }
      group.push(j)
    }
    if (group.length < 5) continue

    const centres = group.map((k) => (candidates[k].start + candidates[k].end) / 2)
    const gaps = []
    for (let k = 1; k < centres.length; k++) gaps.push(centres[k] - centres[k - 1])
    const spacingAvg = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const variance = gaps.reduce((a, g) => a + (g - spacingAvg) ** 2, 0) / gaps.length
    const regularity = Math.sqrt(variance)

    // Uneven gaps mean this was not a staff (e.g. a page rule sitting above
    // one), so drop it and let the loop try again from the next line.
    if (regularity > Math.max(1.5, spacingAvg * maxJitter)) continue

    for (const k of group) claimed.add(k)
    staves.push({
      top: centres[0],
      bottom: centres[4],
      lines: centres,
      // Line thickness matters later: staff-line removal must not eat noteheads.
      lineThickness: group.map((k) => candidates[k].height),
      spacing: spacingAvg,
      regularity,
    })
  }

  return staves
}
