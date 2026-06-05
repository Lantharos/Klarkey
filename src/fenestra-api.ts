import { createLocalVaultApi } from '@/desktop/local-vault'
import type { KlarkeyApi } from '@/shared/ipc'
import type { ExternalWindowContext } from '@/shared/types'
import type { SyncUpdateEvent } from '@/shared/sync'

type NativeBridge = {
  commands: string[]
  invoke: <Result>(name: string, params?: Record<string, unknown>) => Promise<Result>
  listen?: <Payload>(name: string, callback: (payload: Payload) => void) => () => void
}

type FenestraWindowControls = {
  show?: () => void
  hide?: () => void
  focus?: () => void
}

type PalettePrepareOptions = Parameters<KlarkeyApi['onPrepareOpen']>[0] extends (options?: infer Options) => void
  ? Options
  : never

declare global {
  interface Window {
    fenestra?: {
      bridge?: NativeBridge
      window?: FenestraWindowControls
    }
  }
}

const FENESTRA_EVENTS = {
  palettePrepare: 'palette-prepare',
  paletteFocus: 'palette-focus',
  targetWindowChanged: 'palette-target-changed',
  syncChanged: 'sync-changed',
  oauthCallback: 'oauth-callback',
  trayActivate: 'tray.activate',
  globalShortcutActivate: 'globalShortcut.activate',
  singleInstanceActivate: 'singleInstance.activate',
} as const

const deliveredOAuthCallbacks = new Set<string>()

const call = async <Result>(command: string, args?: Record<string, unknown>) => {
  const bridge = await waitForBridge()
  return bridge.invoke<Result>(command, args ?? {})
}

function createEmitter<Payload>() {
  const callbacks = new Set<(payload: Payload) => void>()
  return {
    emit: (payload: Payload) => {
      for (const callback of Array.from(callbacks)) {
        callback(payload)
      }
    },
    subscribe: (callback: (payload: Payload) => void) => {
      callbacks.add(callback)
      return () => callbacks.delete(callback)
    },
  }
}

function deliverOAuthCallbacks(urls: string[]) {
  const nextUrls = urls.filter((url) => {
    if (deliveredOAuthCallbacks.has(url)) {
      return false
    }
    deliveredOAuthCallbacks.add(url)
    return true
  })
  if (nextUrls.length > 0) {
    window.dispatchEvent(new CustomEvent('klarkey-oauth-callback', { detail: nextUrls }))
  }
}

function oauthCallbacksFromArgs(args: string[]) {
  return args.filter((arg) => {
    try {
      const url = new URL(arg)
      return url.protocol === 'klarkey:' && url.hostname === 'oauth' && url.pathname === '/callback'
    } catch {
      return false
    }
  })
}

function onFenestraEvent<Payload>(eventName: string, callback: (payload: Payload) => void) {
  let disposed = false
  let unlisten: (() => void) | undefined

  const fallback = () => {
    const listener = (event: Event) => {
      if (!disposed) {
        callback((event as CustomEvent<Payload>).detail)
      }
    }
    window.addEventListener(`fenestra:${eventName}`, listener)
    return () => window.removeEventListener(`fenestra:${eventName}`, listener)
  }

  void waitForBridge().then((bridge) => {
    if (disposed) return
    unlisten = bridge.listen ? bridge.listen(eventName, callback) : fallback()
  }).catch(() => {
    if (!disposed) {
      unlisten = fallback()
    }
  })

  return () => {
    disposed = true
    unlisten?.()
  }
}

function waitForBridge(timeoutMs = 2500): Promise<NativeBridge> {
  if (window.fenestra?.bridge) return Promise.resolve(window.fenestra.bridge)
  return new Promise((resolve, reject) => {
    const startedAt = performance.now()
    const poll = () => {
      if (window.fenestra?.bridge) {
        resolve(window.fenestra.bridge)
        return
      }
      if (performance.now() - startedAt > timeoutMs) {
        reject(new Error('Klarkey desktop bridge is not available.'))
        return
      }
      window.setTimeout(poll, 16)
    }
    poll()
  })
}

function showPaletteWindow() {
  window.fenestra?.window?.show?.()
  window.fenestra?.window?.focus?.()
}

function hidePaletteWindow() {
  window.fenestra?.window?.hide?.()
}

function createFenestraApi(): KlarkeyApi {
  const prepareOpen = createEmitter<PalettePrepareOptions | undefined>()
  const focusRequest = createEmitter<void>()
  const targetWindowChanged = createEmitter<ExternalWindowContext>()
  const api = createLocalVaultApi(call, {
    launchOnStartup: {
      isEnabled: (fallback) => call<boolean>('autostart_status').catch(() => fallback),
      setEnabled: (enabled) => call<boolean>('autostart_set', { enabled }).catch(() => false),
    },
  })

  const initialParams = new URLSearchParams(window.location.search)
  const initialExternalUnlock = initialParams.get('externalUnlock') === '1'
  const initialOpenPalette = initialExternalUnlock || initialParams.get('openPalette') === '1'
  let initialExternalUnlockDelivered = false

  const openPalette = async (options: { externalUnlock?: boolean } = {}) => {
    await call('palette_open', { externalUnlock: Boolean(options.externalUnlock) })
    showPaletteWindow()
  }

  api.palette = {
    open: () => openPalette(),
    close: async () => {
      if (window.fenestra?.bridge?.commands.includes('palette_close')) {
        void call('palette_close').catch(() => hidePaletteWindow())
        return
      }
      hidePaletteWindow()
    },
  }
  api.nativeWindowMaterial = {
    get: () => call('native_window_material'),
  }
  api.onPrepareOpen = (callback) => {
    const unsubscribe = prepareOpen.subscribe(callback)
    if (initialExternalUnlock && !initialExternalUnlockDelivered) {
      initialExternalUnlockDelivered = true
      queueMicrotask(() => callback({ externalUnlock: true }))
    }
    return unsubscribe
  }
  api.onFocusRequest = focusRequest.subscribe
  api.onTargetWindowChange = targetWindowChanged.subscribe
  api.onSyncChanged = (callback) => {
    const localHandler = (event: Event) => callback((event as CustomEvent<SyncUpdateEvent>).detail)
    window.addEventListener('klarkey-sync-changed', localHandler)
    const unlistenFenestra = onFenestraEvent<SyncUpdateEvent>(FENESTRA_EVENTS.syncChanged, callback)
    return () => {
      window.removeEventListener('klarkey-sync-changed', localHandler)
      unlistenFenestra()
    }
  }

  onFenestraEvent<PalettePrepareOptions | undefined>(FENESTRA_EVENTS.palettePrepare, prepareOpen.emit)
  onFenestraEvent<void>(FENESTRA_EVENTS.paletteFocus, focusRequest.emit)
  onFenestraEvent<ExternalWindowContext>(FENESTRA_EVENTS.targetWindowChanged, targetWindowChanged.emit)

  const drainPendingOAuthCallbacks = () => {
    void call<string[]>('oauth_pending_callbacks').then(deliverOAuthCallbacks).catch(() => undefined)
  }
  onFenestraEvent<{ urls?: string[] }>(FENESTRA_EVENTS.oauthCallback, (payload) => {
    deliverOAuthCallbacks(payload.urls ?? [])
    drainPendingOAuthCallbacks()
  })
  drainPendingOAuthCallbacks()
  window.addEventListener('focus', drainPendingOAuthCallbacks)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      drainPendingOAuthCallbacks()
    }
  })

  onFenestraEvent<{ action?: string | null; itemId?: string | null }>(FENESTRA_EVENTS.trayActivate, (payload) => {
    if (payload.action === 'quit' || payload.itemId === 'quit') {
      void call('app_quit').catch(() => undefined)
      return
    }
    void openPalette().catch(() => undefined)
  })

  onFenestraEvent<{ action?: string | null }>(FENESTRA_EVENTS.globalShortcutActivate, (payload) => {
    if (!payload.action || payload.action === 'open-palette') {
      void openPalette().catch(() => undefined)
    }
  })

  onFenestraEvent<{ arguments?: string[] }>(FENESTRA_EVENTS.singleInstanceActivate, (payload) => {
    const args = payload.arguments ?? []
    const callbacks = oauthCallbacksFromArgs(args)
    if (callbacks.length > 0) {
      deliverOAuthCallbacks(callbacks)
      drainPendingOAuthCallbacks()
    }
    if (callbacks.length > 0 || args.includes('--open-palette') || args.includes('--external-unlock')) {
      void openPalette({ externalUnlock: args.includes('--external-unlock') }).catch(() => undefined)
    }
  })

  if (initialOpenPalette) {
    window.setTimeout(() => {
      void openPalette({ externalUnlock: initialExternalUnlock }).catch(() => undefined)
    }, 0)
  }

  return api
}

const isFenestraRuntime = () =>
  typeof window !== 'undefined'
  && (Boolean(window.fenestra?.bridge) || new URLSearchParams(window.location.search).has('fenestra'))

if (isFenestraRuntime() && !window.klarkey) {
  window.klarkey = createFenestraApi()
}
