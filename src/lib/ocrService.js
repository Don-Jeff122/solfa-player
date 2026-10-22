import { createWorker } from 'tesseract.js'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { extractWords } from './ocr.js'
import { textItemsToLines } from './pdfText.js'

GlobalWorkerOptions.workerSrc = workerUrl

// Bundle the OCR engine + English language data with the app so scanning works
// with no network connection. These live in `public/tesseract/` and are also
// precached by the service worker (see vite.config.js).
const OCR_BASE = `${import.meta.env.BASE_URL}tesseract`

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

async function pdfToPages(file, onProgress) {
  const buffer = await file.arrayBuffer()
  const doc = await getDocument({ data: buffer }).promise
  const pages = []

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

    let textLayer = []
    try {
      const content = await page.getTextContent()
      textLayer = textItemsToLines(content.items)
    } catch {
      textLayer = []
    }

    pages.push({ canvas, textLayer })
  }
  return pages
}

let workerPromise = null
let activeProgress = null

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: `${OCR_BASE}/worker/worker.min.js`,
      corePath: `${OCR_BASE}/core/tesseract-core-lstm.wasm.js`,
      langPath: `${OCR_BASE}/lang`,
      logger: (m) => {
        if (m.status === 'recognizing text') {
          activeProgress?.(`Reading music… ${Math.round((m.progress || 0) * 100)}%`)
        } else if (m.status) {
          activeProgress?.('Preparing OCR engine…')
        }
      },
    })
  }
  return workerPromise
}

/**
 * OCR a single canvas with the shared worker. Used for full pages as well as
 * the per-row and per-bar crops the hymnal reader needs.
 */
export async function recognizeCanvas(
  canvas,
  { onProgress, psm = '6', whitelist = '', preprocess: shouldPreprocess = true } = {}
) {
  if (onProgress) activeProgress = onProgress
  const worker = await getWorker()
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    tessedit_char_whitelist: whitelist,
  })
  const prepared = shouldPreprocess ? preprocess(canvas) : canvas
  const result = await worker.recognize(prepared, {}, { text: true, blocks: true })
  return {
    text: result.data.text || '',
    confidence: result.data.confidence ?? 0,
    words: extractWords(result.data.blocks),
    canvas: prepared,
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

  let sourcePages
  if (isPdf) {
    sourcePages = await pdfToPages(file, onProgress)
  } else {
    onProgress?.('Preparing image…')
    const img = await loadImage(file)
    sourcePages = [
      {
        canvas: canvasFrom(img, img.width < 900 ? 2 : 1),
        textLayer: [],
        hymnalCanvas: canvasFrom(img, 1),
      },
    ]
  }

  const pages = []
  for (let i = 0; i < sourcePages.length; i++) {
    onProgress?.(`Reading music… page ${i + 1} of ${sourcePages.length}`)
    const result = await recognizeCanvas(sourcePages[i].canvas, {
      onProgress,
      psm: '6',
    })
    pages.push({
      text: result.text,
      confidence: result.confidence,
      words: result.words,
      canvas: result.canvas,
      hymnalCanvas: sourcePages[i].hymnalCanvas || null,
      textLayer: sourcePages[i].textLayer || [],
    })
  }

  return pages
}
