import { describe, expect, it } from 'vitest'
import {
  autoContrast,
  binarize,
  despeckle,
  estimateSkewAngle,
  lumaFromRgba,
  medianFilter3,
  otsuThreshold,
} from '../imageProcessing.js'

function white(width, height, value = 255) {
  return new Uint8ClampedArray(width * height).fill(value)
}

function drawLine(luma, width, height, { slope = 0, top = 40, gap = 24, thickness = 2 } = {}) {
  for (let x = 0; x < width; x++) {
    for (let line = 0; line < 4; line++) {
      const y = Math.round(top + line * gap + x * Math.tan((slope * Math.PI) / 180))
      for (let t = 0; t < thickness; t++) {
        if (y + t >= 0 && y + t < height) luma[(y + t) * width + x] = 0
      }
    }
  }
  return luma
}

describe('image processing', () => {
  it('reads luminance from RGBA bytes', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255])
    expect([...lumaFromRgba(rgba, 3, 1)]).toEqual([255, 0, 76])
  })

  it('stretches a narrow tonal range to full contrast', () => {
    const luma = new Uint8ClampedArray([100, 110, 130, 150])
    expect([...autoContrast(luma)]).toEqual([0, 51, 153, 255])
  })

  it('keeps sparse ink readable instead of turning the page black', () => {
    const luma = white(100, 100)
    for (let i = 0; i < 20; i++) luma[i] = 0
    const contrasted = autoContrast(luma)
    expect(contrasted[0]).toBe(0)
    expect(contrasted[90]).toBe(255)
    expect([...contrasted].filter((value) => value < 128)).toHaveLength(20)
  })

  it('leaves a blank page blank', () => {
    const luma = white(100, 100)
    expect([...autoContrast(luma)].every((value) => value === 255)).toBe(true)
  })

  it('finds an Otsu threshold between ink and paper', () => {
    const luma = new Uint8ClampedArray([10, 10, 12, 240, 245, 250])
    const threshold = otsuThreshold(luma)
    expect(threshold).toBeGreaterThanOrEqual(12)
    expect(threshold).toBeLessThan(240)
  })

  it('binarises around the threshold', () => {
    expect([...binarize(new Uint8ClampedArray([0, 100, 101, 255]), 100)]).toEqual([0, 0, 255, 255])
  })

  it('removes isolated speckle with a median filter', () => {
    const luma = white(9, 9)
    luma[4 * 9 + 4] = 0
    const filtered = medianFilter3(luma, 9, 9)
    expect(filtered[4 * 9 + 4]).toBe(255)
  })

  it('clears salt noise but keeps a stroke', () => {
    const luma = white(9, 9)
    luma[4 * 9 + 4] = 0
    luma[2 * 9 + 2] = 0
    luma[2 * 9 + 3] = 0
    luma[2 * 9 + 4] = 0
    const cleaned = despeckle(luma, 9, 9)
    expect(cleaned[4 * 9 + 4]).toBe(255)
    expect(cleaned[2 * 9 + 3]).toBe(0)
  })

  it('reports no skew for level lines', () => {
    const width = 400
    const height = 200
    const luma = drawLine(white(width, height), width, height)
    expect(estimateSkewAngle(luma, width, height)).toBe(0)
  })

  it('estimates a downhill skew', () => {
    const width = 400
    const height = 200
    const luma = drawLine(white(width, height), width, height, { slope: 3 })
    const angle = estimateSkewAngle(luma, width, height)
    expect(angle).toBeGreaterThan(2)
    expect(angle).toBeLessThan(4)
  })

  it('returns zero for a blank page', () => {
    expect(estimateSkewAngle(white(100, 100), 100, 100)).toBe(0)
  })
})
