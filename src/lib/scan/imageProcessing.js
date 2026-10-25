/**
 * Dependency-free image maths for the sheet scanner.
 *
 * Everything here works on a luminance plane (0 = black, 255 = paper) so it can
 * run under Node in tests and in a worker-free browser path. The scanner never
 * writes these pixels back to the user's file; they are only used for OCR.
 */

/** Build a luminance plane from RGBA bytes. */
export function lumaFromRgba(rgba, width, height) {
  const luma = new Uint8ClampedArray(width * height)
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
    luma[p] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) | 0
  }
  return luma
}

/** Otsu's threshold for an 8-bit luminance plane. */
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

  let sumB = 0
  let wB = 0
  let bestVar = -1
  let bestT = 0
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    sumB += t * hist[t]
    if (wB === 0 || wB === total) continue
    const wF = total - wB
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > bestVar) {
      bestVar = between
      bestT = t
    }
  }
  return bestVar <= 0 ? null : bestT
}

/**
 * Stretch the ink/paper range to full contrast. Percentiles ignore a few
 * scanner speckles that would otherwise flatten the useful range.
 */
export function autoContrast(luma, { lowPercentile = 0.02, highPercentile = 0.98 } = {}) {
  const copy = new Uint8ClampedArray(luma)
  const hist = new Uint32Array(256)
  for (let i = 0; i < luma.length; i++) hist[luma[i]]++

  const total = luma.length
  const lowNeed = Math.max(1, Math.round(total * lowPercentile))
  const highNeed = Math.max(1, Math.round(total * (1 - highPercentile)))
  let low = 0
  let high = 255
  let seen = 0
  for (let v = 0; v < 256; v++) {
    seen += hist[v]
    if (seen >= lowNeed) {
      low = v
      break
    }
  }
  seen = 0
  for (let v = 255; v >= 0; v--) {
    seen += hist[v]
    if (seen >= highNeed) {
      high = v
      break
    }
  }

  if (high - low < 8) {
    low = 0
    while (low < 256 && !hist[low]) low++
    high = 255
    while (high > low && !hist[high]) high--
    if (high - low < 8) return copy
  }

  const range = Math.max(1, high - low)
  const out = new Uint8ClampedArray(total)
  for (let i = 0; i < total; i++) {
    out[i] = ((luma[i] - low) * 255) / range
  }
  return out
}

/** 3x3 median filter, useful for camera noise and JPEG speckle. */
export function medianFilter3(luma, width, height) {
  if (width < 3 || height < 3) return new Uint8ClampedArray(luma)
  const out = new Uint8ClampedArray(luma.length)
  const window = new Uint8ClampedArray(9)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy))
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx))
          window[n++] = luma[yy * width + xx]
        }
      }
      // Nine values: insertion sort is cheaper than a general sort here.
      for (let i = 1; i < 9; i++) {
        const value = window[i]
        let j = i - 1
        while (j >= 0 && window[j] > value) {
          window[j + 1] = window[j]
          j--
        }
        window[j + 1] = value
      }
      out[y * width + x] = window[4]
    }
  }
  return out
}

/** Convert a luminance plane to pure black/white. */
export function binarize(luma, threshold) {
  const out = new Uint8ClampedArray(luma.length)
  for (let i = 0; i < luma.length; i++) out[i] = luma[i] <= threshold ? 0 : 255
  return out
}

/**
 * Estimate page skew by projecting ink onto candidate baselines and keeping the
 * angle whose projection is tightest (the sum of squared bin counts).
 *
 * Positive angles mean the printed lines run downhill to the right; correcting
 * the page therefore needs the opposite rotation.
 */
export function estimateSkewAngle(
  luma,
  width,
  height,
  { maxAngle = 6, step = 0.5, darkThreshold = 160, maxSamples = 120000 } = {}
) {
  if (width < 8 || height < 8) return 0

  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / maxSamples)))
  const points = []
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      if (luma[y * width + x] < darkThreshold) {
        points.push(x - width / 2, y - height / 2)
      }
    }
  }
  if (points.length < 60) return 0

  const bins = new Int32Array(Math.ceil(height * 1.5) + 2)
  const offset = Math.floor(bins.length / 2)
  let bestAngle = 0
  let bestScore = -1

  for (let angle = -maxAngle; angle <= maxAngle + 1e-9; angle += step) {
    const radians = (angle * Math.PI) / 180
    const sin = Math.sin(radians)
    const cos = Math.cos(radians)
    bins.fill(0)

    for (let p = 0; p < points.length; p += 2) {
      const projected = -points[p] * sin + points[p + 1] * cos
      const bin = Math.round(projected) + offset
      if (bin >= 0 && bin < bins.length) bins[bin]++
    }

    let score = 0
    for (let i = 0; i < bins.length; i++) score += bins[i] * bins[i]
    if (score > bestScore) {
      bestScore = score
      bestAngle = angle
    }
  }

  return Math.abs(bestAngle) < 0.25 ? 0 : Number(bestAngle.toFixed(2))
}

/**
 * Remove isolated dark pixels (salt noise) while leaving strokes alone.
 * A pixel is only cleared when fewer than two of its neighbours are dark.
 */
export function despeckle(luma, width, height, threshold = 160) {
  const out = new Uint8ClampedArray(luma)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x
      if (luma[index] > threshold) continue
      let dark = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (luma[(y + dy) * width + x + dx] <= threshold) dark++
        }
      }
      if (dark < 2) out[index] = 255
    }
  }
  return out
}
