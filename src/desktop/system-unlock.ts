import type { VaultOperationResult } from '@/shared/types'

type NativeCall = <Result>(command: string, args?: Record<string, unknown>) => Promise<Result>

type SystemAuthSupport = {
  available?: boolean
  keychainAvailable?: boolean
  systemAuthenticationAvailable?: boolean
}

type SystemAuthMutation = VaultOperationResult & {
  configured?: boolean
}

const status = {
  available: false,
  keychainAvailable: false,
}
let refreshStarted = false

export const systemUnlockAvailable = () => status.available
export const systemUnlockSafeStorageAvailable = () => status.keychainAvailable

export async function refreshSystemUnlock(nativeCall: NativeCall) {
  const support = await nativeCall<SystemAuthSupport>('system_auth_support')
  status.available = Boolean(support.available)
  status.keychainAvailable = Boolean(support.keychainAvailable)
}

export function startSystemUnlockRefresh(nativeCall: NativeCall, onChange: () => void) {
  const update = () => void refreshSystemUnlock(nativeCall).then(onChange).catch(() => undefined)
  update()
  if (refreshStarted) return
  refreshStarted = true
  window.setInterval(update, 5000)
}

export async function ensureSystemUnlock(nativeCall: NativeCall) {
  const result = await nativeCall<SystemAuthMutation>('system_auth_ensure_vault_key')
  await refreshSystemUnlock(nativeCall).catch(() => undefined)
  return result.success === true
}

export async function deleteSystemUnlock(nativeCall: NativeCall) {
  await nativeCall<SystemAuthMutation>('system_auth_delete_vault_key').catch(() => undefined)
  await refreshSystemUnlock(nativeCall).catch(() => undefined)
}

export async function unlockWithSystem(nativeCall: NativeCall, strict: boolean) {
  const result = await nativeCall<VaultOperationResult>('system_auth_unlock', { reason: 'unlock Klarkey', strict })
  await refreshSystemUnlock(nativeCall).catch(() => undefined)
  return result
}
