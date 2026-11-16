const DB_NAME = 'solfa-piano-scanner'
const DB_VERSION = 1
const STORE_NAME = 'session'
const STATE_KEY = 'state'
const FILE_KEY = 'source'
const STATE_VERSION = 1
const SCAN_MODES = new Set(['solfa', 'general'])
const DOC_KINDS = new Set(['pdf', 'image'])

let dbPromise = null

function indexedDb() {
  return typeof indexedDB === 'undefined' ? null : indexedDB
}

function openDatabase() {
  const idb = indexedDb()
  if (!idb) return Promise.reject(new Error('Browser storage is not available.'))
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        resolve(db)
      }
      request.onerror = () =>
        reject(request.error || new Error('Could not open browser storage.'))
      request.onblocked = () =>
        reject(new Error('Browser storage is blocked by another tab.'))
    }).catch((reason) => {
      dbPromise = null
      throw reason
    })
  }
  return dbPromise
}

function writeRecord(record) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).put(record)
        tx.oncomplete = () => resolve()
        tx.onerror = () =>
          reject(tx.error || new Error('Could not save scanner data.'))
        tx.onabort = () =>
          reject(tx.error || new Error('Could not save scanner data.'))
      })
  )
}

function readRecord(key) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const request = tx.objectStore(STORE_NAME).get(key)
        request.onsuccess = () => resolve(request.result || null)
        request.onerror = () =>
          reject(request.error || new Error('Could not read scanner data.'))
      })
  )
}

function removeRecords() {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        store.delete(STATE_KEY)
        store.delete(FILE_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () =>
          reject(tx.error || new Error('Could not clear scanner data.'))
        tx.onabort = () =>
          reject(tx.error || new Error('Could not clear scanner data.'))
      })
  )
}

function finiteNumber(value, fallback) {
  if (value == null || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizePage(page) {
  if (!page || typeof page !== 'object') return null
  const pageNumber = Math.round(finiteNumber(page.pageNumber, 0))
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null
  const index = Math.round(finiteNumber(page.index, pageNumber - 1))
  return { ...page, pageNumber, index }
}

function normalizePages(value) {
  const pages = new Map()
  for (const page of Array.isArray(value) ? value : []) {
    const normalized = normalizePage(page)
    if (normalized) pages.set(normalized.pageNumber, normalized)
  }
  return [...pages.values()].sort((a, b) => a.pageNumber - b.pageNumber)
}

function normalizeDocInfo(value) {
  if (!value || typeof value !== 'object') return null
  const kind = DOC_KINDS.has(value.kind) ? value.kind : 'image'
  const pageCount = Math.max(1, Math.round(finiteNumber(value.pageCount, 1)))
  const name =
    typeof value.name === 'string' && value.name.trim()
      ? value.name.trim().slice(0, 240)
      : kind === 'pdf'
        ? 'Scanned PDF'
        : 'Scanned image'
  return { name, kind, pageCount }
}

function normalizeFailures(value, pageCount) {
  const failures = new Map()
  for (const failure of Array.isArray(value) ? value : []) {
    if (!failure || typeof failure !== 'object') continue
    const pageNumber = Math.round(finiteNumber(failure.pageNumber, 0))
    if (!Number.isInteger(pageNumber) || pageNumber < 1) continue
    if (pageNumber > pageCount) continue
    failures.set(pageNumber, {
      pageNumber,
      message:
        typeof failure.message === 'string' && failure.message
          ? failure.message.slice(0, 500)
          : 'Gemini could not read this page.',
      status:
        failure.status == null || !Number.isFinite(Number(failure.status))
          ? null
          : Number(failure.status),
      code: typeof failure.code === 'string' ? failure.code : null,
    })
  }
  return [...failures.values()].sort((a, b) => a.pageNumber - b.pageNumber)
}

export function normalizeScannerState(value) {
  if (!value || typeof value !== 'object') return null
  if (value.version != null && value.version !== STATE_VERSION) return null

  const pageResults = normalizePages(value.pageResults)
  const docInfo = normalizeDocInfo(value.docInfo)
  if (!docInfo && !pageResults.length) return null

  const pageCount = Math.max(
    1,
    docInfo?.pageCount || 0,
    ...pageResults.map((page) => page.pageNumber)
  )
  const pageIndex = clamp(
    Math.round(finiteNumber(value.pageIndex, 0)),
    0,
    pageCount - 1
  )
  const rotation =
    (((Math.round(finiteNumber(value.rotation, 0) / 90) * 90) % 360) + 360) % 360
  const zoom = clamp(finiteNumber(value.zoom, 1), 0.5, 3)
  const docId =
    typeof value.docId === 'string' && value.docId ? value.docId.slice(0, 120) : null

  return {
    version: STATE_VERSION,
    docId,
    scanMode: SCAN_MODES.has(value.scanMode) ? value.scanMode : 'solfa',
    docInfo: docInfo
      ? { ...docInfo, pageCount }
      : { name: 'Gemini result', kind: 'image', pageCount },
    pageResults,
    batchFailures: normalizeFailures(value.batchFailures, pageCount),
    pageIndex,
    rotation,
    zoom,
    updatedAt: Math.max(0, Math.round(finiteNumber(value.updatedAt, 0))),
  }
}

function normalizeStoredFile(record, docId) {
  if (!record || record.docId !== docId || !record.blob) return null
  if (typeof record.blob.arrayBuffer !== 'function') return null
  return {
    blob: record.blob,
    name:
      typeof record.name === 'string' && record.name.trim()
        ? record.name.trim().slice(0, 240)
        : 'Scanned document',
    type: typeof record.type === 'string' ? record.type : record.blob.type || '',
    lastModified: Math.max(0, Math.round(finiteNumber(record.lastModified, 0))),
    size: Math.max(0, Math.round(finiteNumber(record.size, record.blob.size))),
  }
}

export async function loadScannerSession() {
  const [stateRecord, fileRecord] = await Promise.all([
    readRecord(STATE_KEY),
    readRecord(FILE_KEY),
  ])
  const state = normalizeScannerState(stateRecord)
  if (!state) return null
  const file = normalizeStoredFile(fileRecord, state.docId)
  if (!file && !state.pageResults.length) return null
  return { ...state, file }
}

export async function saveScannerState(state) {
  const normalized = normalizeScannerState(state)
  if (!normalized) return { ok: false, reason: new Error('Nothing to save.') }
  const record = { key: STATE_KEY, ...normalized, updatedAt: Date.now() }
  try {
    await writeRecord(record)
    return { ok: true, state: record }
  } catch (reason) {
    return { ok: false, reason }
  }
}

export async function saveScannerFile(file, docId) {
  if (!file || !docId) {
    return { ok: false, reason: new Error('No source document to save.') }
  }
  let blob = file
  if (typeof blob.arrayBuffer !== 'function') {
    blob = new Blob([file], { type: file.type || '' })
  }
  const record = {
    key: FILE_KEY,
    docId,
    blob,
    name:
      typeof file.name === 'string' && file.name ? file.name.slice(0, 240) : 'Scanned document',
    type: file.type || blob.type || '',
    lastModified: Math.max(0, Math.round(finiteNumber(file.lastModified, Date.now()))),
    size: Math.max(0, Math.round(finiteNumber(blob.size, 0))),
  }
  try {
    await writeRecord(record)
    return { ok: true, file: record }
  } catch (reason) {
    return { ok: false, reason }
  }
}

export async function clearScannerSession() {
  try {
    await removeRecords()
    return { ok: true }
  } catch (reason) {
    return { ok: false, reason }
  }
}

export function createScannerSessionWriter({ delayMs = 300, onError } = {}) {
  let timer = 0
  let pending = null
  let queue = Promise.resolve()
  let errorHandler = onError || null

  function enqueue(task) {
    const run = queue.then(task)
    queue = run.catch(() => {})
    return run
  }

  function report(result) {
    if (result?.ok === false && errorHandler) errorHandler(result.reason)
    return result
  }

  function commit(state) {
    if (!state) return Promise.resolve({ ok: false })
    return enqueue(() => saveScannerState(state)).then(report)
  }

  return {
    setErrorHandler(handler) {
      errorHandler = handler || null
    },
    save(state) {
      pending = state
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = 0
        const next = pending
        pending = null
        if (next) commit(next).catch(() => {})
      }, delayMs)
    },
    saveNow(state) {
      if (timer) {
        clearTimeout(timer)
        timer = 0
      }
      pending = null
      return commit(state)
    },
    saveFile(file, docId) {
      return enqueue(() => saveScannerFile(file, docId)).then(report)
    },
    async flush() {
      if (timer) {
        clearTimeout(timer)
        timer = 0
      }
      const next = pending
      pending = null
      if (next) return commit(next)
      await queue
      return { ok: true }
    },
    clear() {
      if (timer) {
        clearTimeout(timer)
        timer = 0
      }
      pending = null
      return enqueue(() => clearScannerSession()).then(report)
    },
  }
}
