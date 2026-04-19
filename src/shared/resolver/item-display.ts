import { normalizeLoginLogoDomain } from '@/shared/login-logo'
import type { ItemProfile } from '@/shared/types'

export function itemSubtitle(item: ItemProfile) {
  return item.itemType === 'login'
    ? item.username || item.itemName
    : item.itemType === 'identity'
      ? item.fullName || item.email || item.username || item.itemName
      : item.itemType === 'card'
        ? [item.cardBrand, item.cardLastFour ? `•••• ${item.cardLastFour}` : undefined, item.cardholderName]
            .filter(Boolean)
            .join(' · ') || item.itemName
        : item.content?.trim() || item.notes?.trim() || 'Text note'
}

export function getLogoMeta(item: ItemProfile) {
  return {
    logoDomain: item.itemType === 'login' ? (item.websites ?? []).map((website) => normalizeLoginLogoDomain(website)).find(Boolean) : undefined,
    logoName: item.itemType === 'login' ? item.itemName.trim() || undefined : undefined,
  }
}
