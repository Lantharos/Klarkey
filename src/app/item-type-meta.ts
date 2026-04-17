import { getItemTypeDefinition, type CreatableItemType, type ItemType } from '@/shared/item-types'
import type { DetailAction } from '@/app/palette-types'
import type { ExternalWindowContext, ItemDetails } from '@/shared/types'
import { ContactRound, FileText, KeyRound, Mail, MapPinned, Pencil, Phone, ShieldCheck, TimerReset, Trash2, User } from 'lucide-react'

export function getItemTypeIcon(itemType: ItemType) {
  if (itemType === 'identity') {
    return 'identity'
  }

  if (itemType === 'note') {
    return 'note'
  }

  return undefined
}

export function getItemTypeAccent(itemType: ItemType) {
  if (itemType === 'identity') {
    return {
      container: 'bg-emerald-500/18 text-emerald-200',
      subtleContainer: 'bg-emerald-500/12 text-emerald-200/82',
    }
  }

  if (itemType === 'note') {
    return {
      container: 'bg-amber-400/18 text-amber-200',
      subtleContainer: 'bg-amber-400/12 text-amber-200/82',
    }
  }

  return undefined
}

export function getCreateTitle(itemType: CreatableItemType) {
  return getItemTypeDefinition(itemType).createLabel
}

const getPasteTitle = (label: string, target?: ExternalWindowContext) =>
  target?.appName?.trim() ? `Paste ${label} into ${target.appName.trim()}` : `Insert ${label}`

const getPasteIconUrl = (target?: ExternalWindowContext) => target?.iconDataUrl
const hasValue = (value?: string | null) => Boolean(value?.trim())

export function buildDetailActions(item?: ItemDetails, target?: ExternalWindowContext): DetailAction[] {
  if (!item) {
    return []
  }

  if (item.itemType === 'login') {
    const hasUsername = hasValue(item.username)
    const hasPassword = hasValue(item.password)
    const hasOtp = Boolean(item.otp)

    return [
      ...(hasUsername ? [{ id: 'paste-username', title: getPasteTitle('username', target), icon: User, iconUrl: getPasteIconUrl(target), actionId: `paste:${item.itemId}:username` }] : []),
      ...(hasPassword ? [{ id: 'paste-password', title: getPasteTitle('password', target), icon: KeyRound, iconUrl: getPasteIconUrl(target), actionId: `paste:${item.itemId}:password` }] : []),
      ...(hasOtp ? [{ id: 'paste-otp', title: getPasteTitle('one-time code', target), icon: TimerReset, iconUrl: getPasteIconUrl(target), actionId: `paste:${item.itemId}:otp`, otp: item.otp }] : []),
      ...(hasUsername ? [{ id: 'copy-username', title: 'Copy username', icon: User, actionId: `copy:${item.itemId}:username` }] : []),
      ...(hasPassword ? [{ id: 'copy-password', title: 'Copy password', icon: KeyRound, actionId: `copy:${item.itemId}:password` }] : []),
      ...(hasOtp ? [{ id: 'copy-otp', title: 'Copy one-time code', icon: TimerReset, actionId: `copy:${item.itemId}:otp`, otp: item.otp }] : []),
      ...(hasPassword ? [{ id: 'show-password', title: 'Show password', icon: ShieldCheck, actionId: `show:${item.itemId}:password` }] : []),
      ...(hasOtp ? [{ id: 'show-otp', title: 'Show one-time code', icon: TimerReset, actionId: `show:${item.itemId}:otp` }] : []),
      { id: 'edit-item', title: 'Edit item', icon: Pencil, tone: 'success' },
      { id: 'delete-item', title: 'Delete item', icon: Trash2, tone: 'danger' },
    ]
  }

  if (item.itemType === 'identity') {
    return [
      ...(hasValue(item.fullName) ? [{ id: 'paste-full-name', title: getPasteTitle('full name', target), icon: ContactRound, iconUrl: getPasteIconUrl(target), actionId: `paste:${item.itemId}:fullName` }] : []),
      ...(hasValue(item.email) ? [{ id: 'paste-email', title: getPasteTitle('email', target), icon: Mail, iconUrl: getPasteIconUrl(target), actionId: `paste:${item.itemId}:email` }] : []),
      ...(hasValue(item.phone) ? [{ id: 'paste-phone', title: getPasteTitle('phone', target), icon: Phone, iconUrl: getPasteIconUrl(target), actionId: `paste:${item.itemId}:phone` }] : []),
      ...(hasValue(item.address) ? [{ id: 'paste-address', title: getPasteTitle('address', target), icon: MapPinned, iconUrl: getPasteIconUrl(target), actionId: `paste:${item.itemId}:address` }] : []),
      ...(hasValue(item.fullName) ? [{ id: 'copy-full-name', title: 'Copy full name', icon: ContactRound, actionId: `copy:${item.itemId}:fullName` }] : []),
      ...(hasValue(item.email) ? [{ id: 'copy-email', title: 'Copy email', icon: Mail, actionId: `copy:${item.itemId}:email` }] : []),
      ...(hasValue(item.phone) ? [{ id: 'copy-phone', title: 'Copy phone', icon: Phone, actionId: `copy:${item.itemId}:phone` }] : []),
      ...(hasValue(item.address) ? [{ id: 'copy-address', title: 'Copy address', icon: MapPinned, actionId: `copy:${item.itemId}:address` }] : []),
      { id: 'edit-item', title: 'Edit item', icon: Pencil, tone: 'success' },
      { id: 'delete-item', title: 'Delete item', icon: Trash2, tone: 'danger' },
    ]
  }

  return [
    ...(hasValue(item.content) || hasValue(item.notes)
      ? [
          { id: 'paste-note', title: getPasteTitle('note', target), icon: FileText, iconUrl: getPasteIconUrl(target), actionId: `paste:${item.itemId}:content` },
          { id: 'copy-note', title: 'Copy note', icon: FileText, actionId: `copy:${item.itemId}:content` },
        ]
      : []),
    { id: 'edit-item', title: 'Edit item', icon: Pencil, tone: 'success' },
    { id: 'delete-item', title: 'Delete item', icon: Trash2, tone: 'danger' },
  ]
}
