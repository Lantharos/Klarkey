import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/shared/types'

const unlockedContents = JSON.stringify({
  items: [
    {
      itemId: 'item_1',
      itemType: 'login',
      itemName: 'Passkeys Demo',
      username: 'person@example.com',
      websites: ['https://passkeys-demo.appspot.com'],
      customFields: [],
      recoveryCodes: [],
      passkeys: [],
      updatedAt: '2026-05-16T00:00:00.000Z',
    },
  ],
  settings: DEFAULT_SETTINGS,
  systemUnlockEnabled: true,
  vaultPasskeys: [],
  sitePasskeys: [],
  pendingPasskeys: [],
  deletedItemIds: {},
  deletedSitePasskeyIds: {},
  recents: [],
  locked: false,
})

describe('local vault external unlock hydration', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('does not treat unlocked metadata as an empty unlocked vault before decrypted state loads', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    let metadataCalls = 0
    const nativeCall = vi.fn(async (command: string): Promise<unknown> => {
      if (command === 'load_vault_metadata') {
        metadataCalls += 1
        return {
          locked: metadataCalls === 1,
          passcodeEnabled: true,
          passcodeSet: true,
          masterPasswordSet: false,
          systemUnlockEnabled: true,
          autoLockMinutes: 15,
          systemUnlockPolicy: 'timed',
          sshAgentEnabled: false,
        }
      }
      if (command === 'load_vault_state') {
        return unlockedContents
      }
      if (command === 'system_auth_support') {
        return { available: true, keychainAvailable: true }
      }
      return undefined
    })

    const { createLocalVaultApi } = await import('@/tauri/local-vault')
    const api = createLocalVaultApi(nativeCall as unknown as <Result>(command: string, args?: Record<string, unknown>) => Promise<Result>)

    await Promise.resolve()
    await Promise.resolve()

    expect(await api.item.get('item_1')).toBeUndefined()
    expect((await api.vault.lockState()).state).not.toBe('unlocked')

    await vi.advanceTimersByTimeAsync(2000)

    expect(await api.item.get('item_1')).toMatchObject({ itemName: 'Passkeys Demo' })
    expect((await api.vault.lockState()).state).toBe('unlocked')
  })
})
