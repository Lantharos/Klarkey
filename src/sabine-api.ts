import { appWindow, invoke, isAvailable, listen } from '@lantharos/sabine'
import { createLocalVaultApi } from '@/desktop/local-vault'
import type { KlarkeyApi } from '@/shared/ipc'
import type { SyncUpdateEvent } from '@/shared/sync'

type PalettePrepareOptions = Parameters<KlarkeyApi['onPrepareOpen']>[0] extends (options?: infer Options) => void
  ? Options
  : never

type LaunchContext = {
  externalUnlock?: boolean
  openPalette?: boolean
}

type PaletteOpenOptions = {
  externalUnlock?: boolean
  activationToken?: string
}

const SABINE_EVENTS = {
  trayActivate: 'tray.activate',
  globalShortcutActivate: 'globalShortcut.activate',
  singleInstanceActivate: 'singleInstance.activate',
} as const

const deliveredOAuthCallbacks = new Set<string>()

const call = async <Result>(command: string, args?: Record<string, unknown>) => {
  return invoke<Result>(command, args)
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

function onSabineEvent<Payload>(eventName: string, callback: (payload: Payload) => void) {
  return listen(eventName, callback)
}

function createSabineApi(): KlarkeyApi {
  const prepareOpen = createEmitter<PalettePrepareOptions | undefined>()
  const focusRequest = createEmitter<void>()
  const api = createLocalVaultApi(call, {
    launchOnStartup: {
      isEnabled: (fallback) => call<boolean>('autostart_status').catch(() => fallback),
      setEnabled: (enabled) => call<boolean>('autostart_set', { enabled }).catch(() => false),
    },
  })

  const openPalette = async (options: PaletteOpenOptions = {}) => {
    const prepared = await call<PalettePrepareOptions>('palette_open', {
      externalUnlock: Boolean(options.externalUnlock),
      activationToken: options.activationToken,
    })
    prepareOpen.emit(prepared)
    focusRequest.emit()
  }

  api.palette = {
    open: () => openPalette(),
    close: async () => {
      appWindow.hide()
    },
  }
  api.onPrepareOpen = prepareOpen.subscribe
  api.onFocusRequest = focusRequest.subscribe
  api.onSyncChanged = (callback) => {
    const localHandler = (event: Event) => callback((event as CustomEvent<SyncUpdateEvent>).detail)
    window.addEventListener('klarkey-sync-changed', localHandler)
    return () => {
      window.removeEventListener('klarkey-sync-changed', localHandler)
    }
  }

  const drainPendingOAuthCallbacks = () => {
    void call<string[]>('oauth_pending_callbacks').then(deliverOAuthCallbacks).catch(() => undefined)
  }
  drainPendingOAuthCallbacks()
  window.addEventListener('focus', drainPendingOAuthCallbacks)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      drainPendingOAuthCallbacks()
    }
  })

  onSabineEvent<{ action?: string | null; itemId?: string | null }>(SABINE_EVENTS.trayActivate, (payload) => {
    if (payload.action === 'quit' || payload.itemId === 'quit') {
      appWindow.close()
      return
    }
    void openPalette().catch(() => undefined)
  })

  onSabineEvent<{ action?: string | null; activationToken?: string | null }>(SABINE_EVENTS.globalShortcutActivate, (payload) => {
    if (!payload.action || payload.action === 'open-palette') {
      void openPalette({ activationToken: payload.activationToken ?? undefined }).catch(() => undefined)
    }
  })

  onSabineEvent<{ arguments?: string[] }>(SABINE_EVENTS.singleInstanceActivate, (payload) => {
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

  const openInitialPalette = () => {
    void call<LaunchContext>('app_launch_context').then((context) => {
      if (context.openPalette || context.externalUnlock) {
        void openPalette({ externalUnlock: context.externalUnlock }).catch(() => undefined)
      }
    }).catch(() => undefined)
  }
  if (document.readyState === 'complete') {
    window.setTimeout(openInitialPalette, 0)
  } else {
    window.addEventListener('load', openInitialPalette, { once: true })
  }

  return api
}

const isSabineRuntime = () =>
  typeof window !== 'undefined'
  && isAvailable()

if (isSabineRuntime() && !window.klarkey) {
  window.klarkey = createSabineApi()
}
