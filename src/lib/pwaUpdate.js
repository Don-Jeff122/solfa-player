export const PWA_RELOAD_KEY = 'solfa-pwa-reload-at'
export const PWA_RELOAD_COOLDOWN_MS = 10000

const CHUNK_ERROR_RE =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css/i

function safeGet(storage, key) {
  try {
    return storage?.getItem?.(key)
  } catch {
    return null
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value)
    return true
  } catch {
    return false
  }
}

export function isChunkLoadError(reason) {
  const message = typeof reason === 'string' ? reason : reason?.message || ''
  return CHUNK_ERROR_RE.test(String(message))
}

export function requestReload({
  storage = typeof window !== 'undefined' ? window.sessionStorage : null,
  reload = typeof window !== 'undefined' ? () => window.location.reload() : null,
  now = Date.now(),
} = {}) {
  if (typeof reload !== 'function') return false
  const last = Number(safeGet(storage, PWA_RELOAD_KEY)) || 0
  if (last && now - last < PWA_RELOAD_COOLDOWN_MS) return false
  safeSet(storage, PWA_RELOAD_KEY, String(now))
  reload()
  return true
}

export function installPwaUpdateHandlers({
  windowObject = typeof window !== 'undefined' ? window : null,
  navigatorObject = typeof navigator !== 'undefined' ? navigator : null,
  storage = windowObject?.sessionStorage ??
    (typeof window !== 'undefined' ? window.sessionStorage : null),
  reload = () => windowObject?.location?.reload?.(),
  now = Date.now,
} = {}) {
  if (!windowObject?.addEventListener) return () => {}

  let reloading = false
  const reloadForUpdate = () => {
    if (reloading) return false
    const didReload = requestReload({ storage, reload, now: now() })
    if (didReload) reloading = true
    return didReload
  }

  const onPreloadError = (event) => {
    event?.preventDefault?.()
    reloadForUpdate()
  }

  const onUnhandledRejection = (event) => {
    if (!isChunkLoadError(event?.reason)) return
    event?.preventDefault?.()
    reloadForUpdate()
  }

  const serviceWorker = navigatorObject?.serviceWorker
  let hadController = Boolean(serviceWorker?.controller)
  const onControllerChange = () => {
    if (!hadController) {
      hadController = true
      return
    }
    reloadForUpdate()
  }

  windowObject.addEventListener('vite:preloadError', onPreloadError)
  windowObject.addEventListener('unhandledrejection', onUnhandledRejection)
  serviceWorker?.addEventListener?.('controllerchange', onControllerChange)

  return () => {
    windowObject.removeEventListener?.('vite:preloadError', onPreloadError)
    windowObject.removeEventListener?.('unhandledrejection', onUnhandledRejection)
    serviceWorker?.removeEventListener?.('controllerchange', onControllerChange)
  }
}
