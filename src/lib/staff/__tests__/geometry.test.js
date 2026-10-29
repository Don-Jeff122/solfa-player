import { describe, expect, it } from 'vitest'
import {
  findStaves,
  inkRows,
  otsuThreshold,
  runsOf,
  toLuma,
} from '../geometry.js'

/**
 * Draw a fake score page: `staffs` staves, each 5 lines spaced `spacing` px
 * apart, drawn as black horizontal bars. Returns RGBA plus the truth.
 */
function drawPage({ width = 900, height = 400, spacing = 10, lineH = 2, staffs = 2, gap = 90 }) {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255)
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 4
    rgba[i] = rgba[i + 1] = rgba[i + 2] = 0
  }

  const expected = []
  const staffSpan = 4 * spacing
  for (let s = 0; s < staffs; s++) {
    const top = 40 + s * (staffSpan + gap)
    const centres = []
    for (let l = 0; l < 5; l++) {
      const y = Math.round(top + l * spacing)
      centres.push(y)
      for (let dy = 0; dy < lineH; dy++) {
        for (let x = 20; x < width - 20; x++) put(x, y + dy)
      }
    }
    expected.push({ top: centres[0], bottom: centres[4], spacing, centres })
  }

  return { rgba, width, height, expected }
}

function analyse({ rgba, width, height }) {
  const luma = toLuma(rgba, width, height)
  const threshold = otsuThreshold(luma)
  const rows = inkRows(luma, width, height, threshold)
  return { staves: findStaves(rows), rows }
}

describe('toLuma', () => {
  it('converts RGB to luminance', () => {
    const luma = toLuma(new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0]), 2, 1)
    expect(luma[0]).toBe(255)
    expect(luma[1]).toBe(0)
  })
})

describe('otsuThreshold', () => {
  it('separates dark ink from white paper', () => {
    const { rgba, width, height } = drawPage({})
    expect(otsuThreshold(toLuma(rgba, width, height))).toBeGreaterThan(80)
  })

  it('returns null for a blank page', () => {
    const blank = new Uint8ClampedArray(100 * 10 * 4).fill(255)
    expect(otsuThreshold(toLuma(blank, 100, 10))).toBe(null)
  })
})

describe('runsOf', () => {
  it('groups consecutive dark rows into runs', () => {
    expect(runsOf([0, 1, 1, 0, 0, 1, 0])).toEqual([
      { start: 1, end: 2, height: 2 },
      { start: 5, end: 5, height: 1 },
    ])
  })

  it('returns nothing for an empty mask', () => {
    expect(runsOf([0, 0, 0])).toEqual([])
  })
})

describe('findStaves', () => {
  it('finds two staves at the right positions', () => {
    const page = drawPage({ staffs: 2 })
    const { staves } = analyse(page)
    expect(staves).toHaveLength(2)

    for (const found of staves) {
      const truth = page.expected.find(
        (e) => Math.abs(e.top - found.top) <= 3
      )
      expect(truth, `no matching staff for top=${found.top}`).toBeTruthy()
      expect(Math.abs(found.top - truth.top)).toBeLessThanOrEqual(3)
      expect(Math.abs(found.bottom - truth.bottom)).toBeLessThanOrEqual(3)
      expect(found.lines).toHaveLength(5)
    }
  })

  it('recovers the line spacing accurately', () => {
    for (const spacing of [6, 10, 16, 24]) {
      const { staves } = analyse(drawPage({ spacing }))
      expect(staves, `spacing ${spacing}`).toHaveLength(2)
      expect(Math.abs(staves[0].spacing - spacing)).toBeLessThan(1.5)
    }
  })

  it('reports a regular staff as regular', () => {
    const { staves } = analyse(drawPage({ spacing: 12 }))
    expect(staves[0].regularity).toBeLessThan(1)
  })

  it('finds a single staff', () => {
    const { staves } = analyse(drawPage({ staffs: 1, height: 200 }))
    expect(staves).toHaveLength(1)
  })

  it('finds three staves', () => {
    const { staves } = analyse(
      drawPage({ staffs: 3, height: 500, gap: 70, spacing: 9 })
    )
    expect(staves).toHaveLength(3)
  })

  it('finds nothing on a blank page', () => {
    const blank = new Uint8ClampedArray(400 * 200 * 4).fill(255)
    const luma = toLuma(blank, 400, 200)
    const t = otsuThreshold(luma)
    expect(t).toBe(null)
  })

  it('ignores a lone line that is not a staff', () => {
    const width = 600
    const height = 200
    const rgba = new Uint8ClampedArray(width * height * 4).fill(255)
    for (let x = 20; x < width - 20; x++) {
      for (let dy = 0; dy < 2; dy++) {
        const i = ((60 + dy) * width + x) * 4
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0
      }
    }
    const luma = toLuma(rgba, width, height)
    const rows = inkRows(luma, width, height, otsuThreshold(luma))
    expect(findStaves(rows)).toHaveLength(0)
  })

  it('ignores a page rule far wider than any staff gap', () => {
    const page = drawPage({ staffs: 1, height: 200 })
    // A horizontal rule with a huge gap above the staff.
    const { rgba, width, height } = page
    for (let x = 0; x < width; x++) {
      for (let dy = 0; dy < 3; dy++) {
        const i = ((5 + dy) * width + x) * 4
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0
      }
    }
    const { staves } = analyse({ rgba, width, height })
    expect(staves).toHaveLength(1)
  })
})
