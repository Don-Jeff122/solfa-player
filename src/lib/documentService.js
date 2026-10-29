/**
 * Lazy access to an uploaded image or PDF.
 *
 * A PDF is opened once, then pages are rendered on demand so a big hymnal never
 * fills memory with every page at OCR resolution. Previews are separate,
 * smaller JPEG blobs and live in a tiny LRU cache.
 */

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { textItemsToLines } from './pdfText.js'
import { canvasFrom, createCanvas, rotateCanvas } from './scan/canvasTools.js'

GlobalWorkerOptions.workerSrc = workerUrl

const IMAGE_RE = /^image\//
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|bmp|gif|avif)$/i
const PDF_RE = /^(application\/pdf|application\/x-pdf)$/i

export function isPdfFile(file) {
  return Boolean(file) && (PDF_RE.test(file.type || '') || /\.pdf$/i.test(file.name || ''))
}

export function isImageFile(file) {
  return Boolean(file) && (IMAGE_RE.test(file.type || '') || IMAGE_EXT_RE.test(file.name || ''))
}

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image file.'))
    }
    image.src = url
  })
}

function makePage(rendered, rotation) {
  const source = rendered.canvas || rendered
  const canvas = rotation % 360 === 0 ? source : rotateCanvas(source, rotation)
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    textLayer: rendered.textLayer || [],
    rotation,
  }
}

function imageDocument(image, file) {
  let closed = false
  const previews = new Map()
  const previewOrder = []

  function dropPreview(key) {
    const entry = previews.get(key)
    if (!entry) return
    URL.revokeObjectURL(entry.url)
    previews.delete(key)
  }

  async function renderPreview(index, { maxDimension = 1600, rotation = 0 } = {}) {
    const key = `${index}:${maxDimension}:${rotation}`
    if (previews.has(key)) return previews.get(key)
    const rendered = canvasFrom(image, maxDimension)
    const page = makePage(rendered, rotation)
    const { canvasPreview } = await import('./scan/canvasTools.js')
    const preview = await canvasPreview(page.canvas, { maxDimension })
    previews.set(key, preview)
    previewOrder.push(key)
    while (previewOrder.length > 3) dropPreview(previewOrder.shift())
    return preview
  }

  return {
    kind: 'image',
    name: file.name || 'Scanned image',
    pageCount: 1,
    get textLayers() {
      return [[]]
    },
    async getPage(index, { maxDimension = 2400, rotation = 0 } = {}) {
      if (closed) throw new Error('The document was closed.')
      if (index !== 0) throw new Error('This image has only one page.')
      const rendered = canvasFrom(image, maxDimension)
      return makePage(rendered, rotation)
    },
    getPreview: renderPreview,
    async close() {
      closed = true
      for (const key of [...previewOrder]) dropPreview(key)
      image.src = ''
    },
  }
}

async function pdfDocument(file, onProgress) {
  const buffer = await file.arrayBuffer()
  onProgress?.('Opening the PDF…')
  const task = getDocument({ data: buffer })
  const pdf = await task.promise
  let closed = false
  const previews = new Map()
  const previewOrder = []

  function dropPreview(key) {
    const entry = previews.get(key)
    if (!entry) return
    URL.revokeObjectURL(entry.url)
    previews.delete(key)
  }

  async function renderPage(index, maxDimension) {
    if (index < 0 || index >= pdf.numPages) {
      throw new Error(`Page ${index + 1} does not exist.`)
    }
    const page = await pdf.getPage(index + 1)
    try {
      const base = page.getViewport({ scale: 1 })
      const scale = Math.max(
        0.2,
        Math.min(maxDimension / base.width, maxDimension / base.height, 4)
      )
      const viewport = page.getViewport({ scale })
      const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
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
      return { canvas, textLayer }
    } finally {
      try {
        page.cleanup()
      } catch {
        /* pdf.js can already have released the page */
      }
    }
  }

  async function getPreview(index, { maxDimension = 1500, rotation = 0 } = {}) {
    const key = `${index}:${maxDimension}:${rotation}`
    if (previews.has(key)) return previews.get(key)
    if (closed) throw new Error('The document was closed.')
    onProgress?.(`Rendering page ${index + 1} of ${pdf.numPages}…`)
    const rendered = await renderPage(index, maxDimension)
    const page = makePage(rendered, rotation)
    const { canvasPreview } = await import('./scan/canvasTools.js')
    const preview = await canvasPreview(page.canvas, { maxDimension })
    previews.set(key, preview)
    previewOrder.push(key)
    while (previewOrder.length > 3) dropPreview(previewOrder.shift())
    return preview
  }

  return {
    kind: 'pdf',
    name: file.name || 'Scanned PDF',
    pageCount: pdf.numPages,
    async getPage(index, { maxDimension = 2400, rotation = 0 } = {}) {
      if (closed) throw new Error('The document was closed.')
      const rendered = await renderPage(index, maxDimension)
      return makePage(rendered, rotation)
    },
    getPreview,
    async close() {
      closed = true
      for (const key of [...previewOrder]) dropPreview(key)
      try {
        await pdf.destroy()
      } catch {
        /* already destroyed */
      }
    },
  }
}

/** Open an image or PDF and return a page-at-a-time document handle. */
export async function openDocument(file, { onProgress } = {}) {
  if (!file) throw new Error('Choose an image or PDF first.')
  if (isPdfFile(file)) return pdfDocument(file, onProgress)
  if (!isImageFile(file)) {
    throw new Error('Use a JPG, PNG, WebP, BMP or PDF file.')
  }
  onProgress?.('Reading the image…')
  const image = await decodeImage(file)
  return imageDocument(image, file)
}
