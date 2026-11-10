import { describe, expect, it, vi } from 'vitest'
import {
  PWA_RELOAD_KEY,
  installPwaUpdateHandlers,
  isChunkLoadError,
  requestReload,
} from '../pwaUpdate.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: vi.fn((key) => (values.has(key) ? values.get(key) : null)),
    setItem: vi.fn((key, value) => values.set(key, value)),
  }
}

function createWindow() {
  const target = new EventTarget()
  target.sessionStorage = createStorage()
  return target
}

function createNavigator(controller = null) {
  const serviceWorker = new EventTarget()
  serviceWorker.controller = controller
  return { serviceWorker }
}

function chunkErrorEvent() {
  const event = new Event('unhandledrejection', { cancelable: true })
  event.reason = new TypeError(
    'Failed to fetch dynamically imported module: https://example.com/documentService.js'
  )
  return event
}

describe('PWA update recovery', () => {
  it('limits reloads to one per cooldown window', () => {
    const storage = createStorage()
    const reload = vi.fn()

    expect(requestReload({ storage, reload, now: 1000 })).toBe(true)
    expect(storage.getItem(PWA_RELOAD_KEY)).toBe('1000')
    expect(reload).toHaveBeenCalledTimes(1)

    expect(requestReload({ storage, reload, now: 2000 })).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)

    expect(requestReload({ storage, reload, now: 12000 })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('recognizes stale chunk-load failures', () => {
    expect(
      isChunkLoadError(
        new TypeError('Failed to fetch dynamically imported module: /assets/old.js')
      )
    ).toBe(true)
    expect(isChunkLoadError('Importing a module script failed.')).toBe(true)
    expect(isChunkLoadError('A different error')).toBe(false)
  })

  it('reloads when Vite reports a preload failure', () => {
    const windowObject = createWindow()
    const reload = vi.fn()
    installPwaUpdateHandlers({
      windowObject,
      navigatorObject: createNavigator(),
      reload,
      now: () => 5000,
    })
    const event = new Event('vite:preloadError', { cancelable: true })

    windowObject.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads on an unhandled stale chunk rejection', () => {
    const windowObject = createWindow()
    const reload = vi.fn()
    installPwaUpdateHandlers({
      windowObject,
      navigatorObject: createNavigator(),
      reload,
      now: () => 5000,
    })
    const event = chunkErrorEvent()

    windowObject.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('ignores the first controller change and reloads on updates', () => {
    const windowObject = createWindow()
    const navigatorObject = createNavigator()
    const reload = vi.fn()
    installPwaUpdateHandlers({
      windowObject,
      navigatorObject,
      reload,
      now: () => 5000,
    })

    navigatorObject.serviceWorker.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()

    navigatorObject.serviceWorker.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('removes listeners when cleaned up', () => {
    const windowObject = createWindow()
    const navigatorObject = createNavigator()
    const reload = vi.fn()
    const cleanup = installPwaUpdateHandlers({
      windowObject,
      navigatorObject,
      reload,
      now: () => 5000,
    })

    cleanup()
    windowObject.dispatchEvent(chunkErrorEvent())
    navigatorObject.serviceWorker.dispatchEvent(new Event('controllerchange'))

    expect(reload).not.toHaveBeenCalled()
  })
})
