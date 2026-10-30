import { createWorker } from 'tesseract.js'
import { extractWords } from './ocr.js'

// Bundle the OCR engine + English language data with the app so scanning works
// with no network connection. These live in `public/tesseract/` and are also
// precached by the service worker (see vite.config.js).
const OCR_BASE = `${import.meta.env.BASE_URL}tesseract`

/**
 * Upscale, convert to greyscale and stretch contrast. Tesseract is far more
 * reliable on clean, high-contrast glyphs than on a photographed sheet.
 */
function preprocess(canvas) {
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
