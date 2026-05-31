import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { createLocalVaultApi } from '@/tauri/local-vault'
import type { KlarkeyApi } from '@/shared/ipc'
import type { ExternalWindowContext } from '@/shared/types'
import type { SyncUpdateEvent } from '@/shared/sync'

const TAURI_EVENTS = {
  palettePrepare: 'palette-prepare',
  paletteFocus: 'palette-focus',
  targetWindowChanged: 'palette-target-changed',
  syncChanged: 'sync-changed',
  oauthCallback: 'oauth-callback',
} as const

const call = <Result>(command: string, args?: Record<string, unknown>) =>
  args === undefined ? invoke<Result>(command) : invoke<Result>(command, args)

const deliveredOAuthCallbacks = new Set<string>()

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

const onTauriEvent = <Payload>(eventName: string, callback: (payload: Payload) => void) => {
  let disposed = false
  let unlisten: UnlistenFn | undefined
  void listen<Payload>(eventName, (event) => {
    if (!disposed) {
      callback(event.payload)
    }
  }).then((cleanup) => {
    if (disposed) {
      cleanup()
      return
    }
    unlisten = cleanup
  })

  return () => {
    disposed = true
    unlisten?.()
  }
}

const createTauriApi = (): KlarkeyApi => {
  const api = createLocalVaultApi(call)
  const initialExternalUnlock = new URLSearchParams(window.location.search).get('externalUnlock') === '1'
  let initialExternalUnlockDelivered = false

  api.onPrepareOpen = (callback) => {
    const unsubscribe = onTauriEvent<
      { externalUnlock?: boolean; nativeTranslucent?: boolean; nativeContentTranslucent?: boolean; nativeHostTranslucent?: boolean } | undefined
    >(
      TAURI_EVENTS.palettePrepare,
      callback,
    )
    if (initialExternalUnlock && !initialExternalUnlockDelivered) {
      initialExternalUnlockDelivered = true
      queueMicrotask(() => callback({ externalUnlock: true }))
    }
    return unsubscribe
  }
  api.onFocusRequest = (callback) => onTauriEvent<void>(TAURI_EVENTS.paletteFocus, callback)
  api.onTargetWindowChange = (callback) =>
    onTauriEvent<ExternalWindowContext>(TAURI_EVENTS.targetWindowChanged, callback)
  api.nativeWindowMaterial = {
    get: () => call('native_window_material'),
  }
  api.onSyncChanged = (callback) => {
    const localHandler = (event: Event) => callback((event as CustomEvent<SyncUpdateEvent>).detail)
    window.addEventListener('klarkey-sync-changed', localHandler)
    const unlistenTauri = onTauriEvent<SyncUpdateEvent>(TAURI_EVENTS.syncChanged, callback)
    return () => {
      window.removeEventListener('klarkey-sync-changed', localHandler)
      unlistenTauri()
    }
  }
  const drainPendingOAuthCallbacks = () => {
    void call<string[]>('oauth_pending_callbacks').then(deliverOAuthCallbacks).catch(() => undefined)
  }
  onTauriEvent<{ urls?: string[] }>(TAURI_EVENTS.oauthCallback, (payload) => {
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

  const isDev = window.location.protocol === 'http:' || window.location.hostname === 'localhost' || window.location.port === '5173'
  if (isDev) {
    const clearVaultStorage = () => {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('klarkey.tauri.vault.v1')
        }
      } catch {
        // Ignore localStorage availability issues in non-browser or unsupported runtimes.
      }
    }

    api.dev = {
      forceLock: async () => {
        await api.vault.lock()
        return api.vault.lockState()
      },
      forceUnlock: async () => {
        const state = await api.vault.lockState()
        if (state.primaryMethods.includes('masterPassword')) {
          return state
        }
        return {
          ...state,
          state: 'unlocked',
          keyInMemory: true,
          keyFileExists: true,
        }
      },
      forcePasscode: async () => {
        await api.vault.lock()
        return api.vault.lockState()
      },
      dumpLockInfo: async () => ({
        ...await api.vault.lockState(),
        keyInMemory: true,
        keyFileExists: true,
      }),
      resetVault: async () => {
        clearVaultStorage()
        await call('reset_vault_state')
        window.location.reload()
        return { status: 'success' }
      },
    }
  }

  return api
}

const isTauriRuntime = () =>
  typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)

if (isTauriRuntime() && !window.klarkey) {
  window.klarkey = createTauriApi()
}
