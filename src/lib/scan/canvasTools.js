import {
  autoContrast,
  binarize,
  despeckle,
  estimateSkewAngle,
  lumaFromRgba,
  medianFilter3,
  otsuThreshold,
} from './imageProcessing.js'

export function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function context(canvas, readOften = false) {
  return canvas.getContext('2d', readOften ? { willReadFrequently: true } : undefined)
}

/** Draw a source (image, canvas or bitmap) onto a canvas at a target long side. */
export function canvasFrom(
  source,
  maxDimension = Infinity,
  background = null,
  allowUpscale = false
) {
  const width = source.width || source.naturalWidth || 1
  const height = source.height || source.naturalHeight || 1
  const longSide = Math.max(width, height)
  const limit = Number.isFinite(maxDimension)
    ? allowUpscale
      ? maxDimension
      : Math.min(maxDimension, longSide)
    : longSide
  const scale = limit / longSide
  const canvas = createCanvas(width * scale, height * scale)
  const ctx = context(canvas)
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Rotate a canvas clockwise by an arbitrary angle, expanding the canvas so no
 * part of the page is clipped. Returns the source unchanged for 0/360 degrees.
 */
export function rotateCanvas(source, degrees) {
  const normalized = ((Number(degrees) || 0) % 360 + 360) % 360
  if (Math.abs(normalized) < 1e-6) return source

  const width = source.width
  const height = source.height
  let outWidth = width
  let outHeight = height

  if (normalized === 90 || normalized === 270) {
    outWidth = height
    outHeight = width
  } else if (normalized !== 180) {
    const radians = (normalized * Math.PI) / 180
    const cos = Math.abs(Math.cos(radians))
    const sin = Math.abs(Math.sin(radians))
    outWidth = Math.ceil(width * cos + height * sin)
    outHeight = Math.ceil(width * sin + height * cos)
  }

  const canvas = createCanvas(outWidth, outHeight)
  const ctx = context(canvas)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, outWidth, outHeight)
  ctx.translate(outWidth / 2, outHeight / 2)
  ctx.rotate((normalized * Math.PI) / 180)
  ctx.drawImage(source, -width / 2, -height / 2)
  return canvas
}

/** Crop a rectangle measured in source-image pixels. */
export function cropCanvas(source, rect) {
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  const width = Math.max(1, Math.min(source.width - x, Math.ceil(rect.width)))
  const height = Math.max(1, Math.min(source.height - y, Math.ceil(rect.height)))
  const canvas = createCanvas(width, height)
  const ctx = context(canvas)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, x, y, width, height, 0, 0, width, height)
  return canvas
}

/** Crop using fractions (0-1) of the source size, as sent by the region UI. */
export function cropFraction(source, selection) {
  return cropCanvas(source, {
    x: selection.x * source.width,
    y: selection.y * source.height,
    width: selection.width * source.width,
    height: selection.height * source.height,
  })
}

function scaleForOcr(source, { maxDimension, minLongSide }) {
  const longSide = Math.max(source.width, source.height)
  const shortSide = Math.min(source.width, source.height)
  let scale = Math.min(1, maxDimension / longSide)
  if (shortSide * scale < 720 || longSide * scale < minLongSide) {
    scale = Math.min(3, Math.max(scale, minLongSide / longSide))
    scale = Math.min(scale, (maxDimension * 1.15) / longSide)
  }
  return Math.max(0.05, scale)
}

/**
 * The OCR copy of a page: upscaled if small, optionally deskewed, high-contrast,
 * optionally denoised/binarised. The original canvas is never changed, so the
 * preview and the result stay comparable.
 */
export function prepareCanvas(
  source,
  {
    maxDimension = 2400,
    minLongSide = 1600,
    rotation = 0,
    autoStraighten = true,
    contrast = true,
    denoise = false,
    binarize: shouldBinarize = false,
    maxSkew = 6,
  } = {}
) {
  const scale = scaleForOcr(source, { maxDimension, minLongSide })
  let canvas = canvasFrom(
    source,
    Math.max(source.width, source.height) * scale,
    null,
    true
  )
  if (rotation % 360 !== 0) canvas = rotateCanvas(canvas, rotation)

  let ctx = context(canvas, true)
  let image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let luma = lumaFromRgba(image.data, canvas.width, canvas.height)

  let skewAngle = 0
  if (autoStraighten) {
    skewAngle = estimateSkewAngle(luma, canvas.width, canvas.height, { maxAngle: maxSkew })
    if (skewAngle) {
      canvas = rotateCanvas(canvas, -skewAngle)
      ctx = context(canvas, true)
      image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      luma = lumaFromRgba(image.data, canvas.width, canvas.height)
    }
  }

  if (contrast) luma = autoContrast(luma)
  if (denoise && canvas.width * canvas.height <= 7_000_000) {
    luma = medianFilter3(luma, canvas.width, canvas.height)
    luma = despeckle(luma, canvas.width, canvas.height)
  }
  let threshold = null
  if (shouldBinarize) {
    threshold = otsuThreshold(luma) ?? 128
    luma = binarize(luma, threshold)
  }

  for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
    const value = luma[p]
    image.data[i] = value
    image.data[i + 1] = value
    image.data[i + 2] = value
    image.data[i + 3] = 255
  }
  ctx.putImageData(image, 0, 0)

  return { canvas, skewAngle, threshold, scale }
}

/** Canvas -> object URL plus its pixel size, for a lightweight page preview. */
export function canvasPreview(canvas, { maxDimension = 1500, quality = 0.88 } = {}) {
  const target = canvasFrom(canvas, maxDimension)
  return new Promise((resolve, reject) => {
    target.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not prepare the page preview.'))
          return
        }
        resolve({
          url: URL.createObjectURL(blob),
          width: target.width,
          height: target.height,
        })
      },
      'image/jpeg',
      quality
    )
  })
}
