export function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function context(canvas) {
  return canvas.getContext('2d')
}

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

export function canvasPreview(canvas, { maxDimension = 2400, quality = 0.92 } = {}) {
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
