import { createWorker } from 'tesseract.js'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { extractWords } from './ocr.js'

GlobalWorkerOptions.workerSrc = workerUrl

const MAX_DIMENSION = 2200

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image file.'))
    }
    img.src = url
  })
}

function canvasFrom(source, scale = 1) {
  const width = Math.min(MAX_DIMENSION, Math.round(source.width * scale))
  const height = Math.round(source.height * ((width / source.width) || 1))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

/**
 * Upscale, convert to greyscale and stretch contrast. Tesseract is far more
 * reliable on clean, high-contrast glyphs than on a photographed sheet.
 */
export function preprocess(canvas) {
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data

  let min = 255
  let max = 0
  const luma = new Uint8ClampedArray(width * height)

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const v = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0
    luma[p] = v
    if (v < min) min = v
    if (v > max) max = v
  }

  const range = Math.max(1, max - min)
  for (let p = 0; p < luma.length; p++) {
    const v = ((luma[p] - min) * 255) / range
    data[p * 4] = v
    data[p * 4 + 1] = v
    data[p * 4 + 2] = v
    data[p * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

async function pdfToCanvases(file, onProgress) {
  const buffer = await file.arrayBuffer()
  const doc = await getDocument({ data: buffer }).promise
  const canvases = []

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    onProgress?.(`Rendering page ${pageNo} of ${doc.numPages}…`)
    const page = await doc.getPage(pageNo)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(3, MAX_DIMENSION / base.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    canvases.push(canvas)
  }
  return canvases
}

let workerPromise = null
function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          onProgress?.(`Reading music… ${Math.round((m.progress || 0) * 100)}%`)
        } else if (m.status) {
          onProgress?.('Preparing OCR engine…')
        }
      },
    })
  }
  return workerPromise
}

export function terminateOcr() {
  if (workerPromise) {
    workerPromise.then((w) => w.terminate()).catch(() => {})
    workerPromise = null
  }
}

/**
 * OCR an image or PDF. Returns the recognised text per page together with the
 * preprocessed canvases and positioned words, so staff detection can run in the
 * exact same pixel space the OCR read from.
 */
export async function recognizeFile(file, onProgress) {
  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  let canvases
  if (isPdf) {
    canvases = await pdfToCanvases(file, onProgress)
  } else {
    onProgress?.('Preparing image…')
    const img = await loadImage(file)
    canvases = [canvasFrom(img, img.width < 900 ? 2 : 1)]
  }

  const worker = await getWorker(onProgress)
  const pages = []

  for (let i = 0; i < canvases.length; i++) {
    onProgress?.(`Reading music… page ${i + 1} of ${canvases.length}`)
    const prepared = preprocess(canvases[i])
    const result = await worker.recognize(prepared, {}, { text: true, blocks: true })
    pages.push({
      text: result.data.text || '',
      confidence: result.data.confidence ?? 0,
      words: extractWords(result.data.blocks),
      canvas: prepared,
    })
  }

  return pages
}
