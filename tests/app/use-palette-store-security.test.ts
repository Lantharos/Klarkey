import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KlarkeyApi } from '@/shared/ipc'
import { DEFAULT_SETTINGS, type VaultLockInfo } from '@/shared/types'
import type { SyncStatus } from '@/shared/sync'

const syncStatus: SyncStatus = {
  configured: false,
  signedIn: false,
  syncing: false,
  deviceId: 'test-device',
  deviceName: 'Test device',
  conflictCount: 0,
  serverSequence: 0,
}

function lockInfo(state: VaultLockInfo['state']): VaultLockInfo {
  return {
    state,
    primaryMethods: ['windowsHello'],
    passcodeEnabled: true,
    passcodeSet: true,
    passcodeLength: 4,
    masterPasswordSet: true,
    autoLockMinutes: 15,
    safeStorageAvailable: true,
  }
}

function installApi(initialLockInfo = lockInfo('unlocked')) {
  let lockListener: ((info: VaultLockInfo) => void) | undefined
  const api = {
    settings: {
      get: vi.fn(async () => DEFAULT_SETTINGS),
    },
    vault: {
      lockState: vi.fn(async () => initialLockInfo),
    },
    sync: {
      status: vi.fn(async () => syncStatus),
    },
    search: {
      resolve: vi.fn(async () => ({
        actions: [],
        locked: false,
        hasMore: false,
        nextOffset: 0,
      })),
    },
    onLockStateChanged: vi.fn((listener: (info: VaultLockInfo) => void) => {
      lockListener = listener
      return vi.fn()
    }),
    onSyncChanged: vi.fn(() => vi.fn()),
  } as unknown as KlarkeyApi

  window.klarkey = api
  return {
    api,
    emitLockInfo: (info: VaultLockInfo) => lockListener?.(info),
  }
}

describe('palette store secret lifecycle', () => {
  afterEach(() => {
    delete window.klarkey
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it.each(['locked', 'passcode'] as const)('clears revealed secrets on %s lock events', async (state) => {
    const { emitLockInfo } = installApi()
    const { usePaletteStore } = await import('@/app/usePaletteStore')
    await usePaletteStore.getState().boot()

    usePaletteStore.setState({
      page: 'detail',
      query: {
        raw: 'github password',
        intent: 'search',
        tokens: [],
        trailingText: 'github password',
      },
      actions: [
        {
          id: 'show:item_1:password',
          kind: 'show-password',
          title: 'GitHub',
          subtitle: 'person@example.com',
          itemId: 'item_1',
          primaryHint: 'Return',
          requiresUnlock: true,
          score: 1,
        },
      ],
      hasMoreResults: true,
      nextOffset: 20,
      selectedIndex: 1,
      detailAction: {
        id: 'show:item_1:password',
        kind: 'show-password',
        title: 'GitHub',
        subtitle: 'person@example.com',
        itemId: 'item_1',
        primaryHint: 'Return',
        requiresUnlock: true,
        score: 1,
      },
      execution: {
        status: 'info',
        title: 'Password revealed',
        message: 'Use this only when needed.',
        secret: 'super-secret',
      },
    })

    emitLockInfo(lockInfo(state))

    const current = usePaletteStore.getState()
    expect(current.page).toBe(state)
    expect(current.execution).toBeUndefined()
    expect(current.detailAction).toBeUndefined()
    expect(current.actions).toEqual([])
    expect(current.query.raw).toBe('')
    expect(current.hasMoreResults).toBe(false)
    expect(current.nextOffset).toBe(0)
  })
})
