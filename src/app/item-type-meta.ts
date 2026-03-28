import { getItemTypeDefinition, type CreatableItemType, type ItemType } from '@/shared/item-types'
import type { DetailAction } from '@/app/palette-types'
import type { ItemDetails } from '@/shared/types'
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

export function buildDetailActions(item?: ItemDetails): DetailAction[] {
  if (!item) {
    return []
  }

  if (item.itemType === 'login') {
    return [
      { id: 'paste-username', title: 'Insert username', icon: User, actionId: `paste:${item.itemId}:username` },
      { id: 'paste-password', title: 'Insert password', icon: KeyRound, actionId: `paste:${item.itemId}:password` },
      ...(item.otp ? [{ id: 'paste-otp', title: 'Insert one-time code', icon: TimerReset, actionId: `paste:${item.itemId}:otp`, otp: item.otp }] : []),
      { id: 'copy-username', title: 'Copy username', icon: User, actionId: `copy:${item.itemId}:username` },
      { id: 'copy-password', title: 'Copy password', icon: KeyRound, actionId: `copy:${item.itemId}:password` },
      ...(item.otp ? [{ id: 'copy-otp', title: 'Copy one-time code', icon: TimerReset, actionId: `copy:${item.itemId}:otp`, otp: item.otp }] : []),
      { id: 'show-password', title: 'Show password', icon: ShieldCheck, actionId: `show:${item.itemId}:password` },
      ...(item.otp ? [{ id: 'show-otp', title: 'Show one-time code', icon: TimerReset, actionId: `show:${item.itemId}:otp` }] : []),
      { id: 'edit-item', title: 'Edit item', icon: Pencil, tone: 'success' },
      { id: 'delete-item', title: 'Delete item', icon: Trash2, tone: 'danger' },
    ]
  }

  if (item.itemType === 'identity') {
    return [
      ...(item.fullName ? [{ id: 'paste-full-name', title: 'Insert full name', icon: ContactRound, actionId: `paste:${item.itemId}:fullName` }] : []),
      ...(item.email ? [{ id: 'paste-email', title: 'Insert email', icon: Mail, actionId: `paste:${item.itemId}:email` }] : []),
      ...(item.phone ? [{ id: 'paste-phone', title: 'Insert phone', icon: Phone, actionId: `paste:${item.itemId}:phone` }] : []),
      ...(item.address ? [{ id: 'paste-address', title: 'Insert address', icon: MapPinned, actionId: `paste:${item.itemId}:address` }] : []),
      ...(item.fullName ? [{ id: 'copy-full-name', title: 'Copy full name', icon: ContactRound, actionId: `copy:${item.itemId}:fullName` }] : []),
      ...(item.email ? [{ id: 'copy-email', title: 'Copy email', icon: Mail, actionId: `copy:${item.itemId}:email` }] : []),
      ...(item.phone ? [{ id: 'copy-phone', title: 'Copy phone', icon: Phone, actionId: `copy:${item.itemId}:phone` }] : []),
      ...(item.address ? [{ id: 'copy-address', title: 'Copy address', icon: MapPinned, actionId: `copy:${item.itemId}:address` }] : []),
      { id: 'edit-item', title: 'Edit item', icon: Pencil, tone: 'success' },
      { id: 'delete-item', title: 'Delete item', icon: Trash2, tone: 'danger' },
    ]
  }

  return [
    ...(item.content || item.notes
      ? [
          { id: 'paste-note', title: 'Insert note', icon: FileText, actionId: `paste:${item.itemId}:content` },
          { id: 'copy-note', title: 'Copy note', icon: FileText, actionId: `copy:${item.itemId}:content` },
        ]
      : []),
    { id: 'edit-item', title: 'Edit item', icon: Pencil, tone: 'success' },
    { id: 'delete-item', title: 'Delete item', icon: Trash2, tone: 'danger' },
  ]
}
