import type { ItemDetails, VaultSnapshot } from '@/shared/types'

function itemProfile(item: ItemDetails): VaultSnapshot['items'][number] {
  return {
    ...item,
    id: item.itemId,
    hasPassword: Boolean(item.password),
    hasOtp: Boolean(item.otp),
    hasPasskey: item.passkeys.length > 0,
    hasRecoveryCodes: item.recoveryCodes.length > 0,
    passwordPreview: item.password ? '••••••••' : undefined,
  }
}

export function vaultSnapshot(items: ItemDetails[], recents: VaultSnapshot['recents']): VaultSnapshot {
  return {
    items: items.map(itemProfile),
    recents,
  }
}
