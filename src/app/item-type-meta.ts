import { getItemTypeDefinition, type CreatableItemType, type ItemType } from '@/shared/item-types'
import type { DetailAction } from '@/app/palette-types'
import type { ItemDetails } from '@/shared/types'
import { ContactRound, CreditCard, FileText, Fingerprint, KeyRound, Mail, MapPinned, Pencil, Phone, RefreshCw, Settings, ShieldCheck, TimerReset, Trash2, User } from 'lucide-react'

export function getItemTypeIcon(itemType: ItemType) {
  if (itemType === 'identity') {
    return 'identity'
  }

  if (itemType === 'note') {
    return 'note'
  }

  if (itemType === 'card') {
    return 'card'
  }

  if (itemType === 'ssh-key') {
    return 'ssh-key'
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

  if (itemType === 'card') {
    return {
      container: 'bg-sky-400/18 text-sky-200',
      subtleContainer: 'bg-sky-400/12 text-sky-200/82',
    }
  }

  if (itemType === 'ssh-key') {
    return {
      container: 'bg-violet-400/18 text-violet-200',
      subtleContainer: 'bg-violet-400/12 text-violet-200/82',
    }
  }

  return undefined
}

export function getCreateTitle(itemType: CreatableItemType) {
  return getItemTypeDefinition(itemType).createLabel
}

const hasValue = (value?: string | null) => Boolean(value?.trim())

export function buildDetailActions(item?: ItemDetails): DetailAction[] {
  if (!item) {
    return []
  }

  if (item.itemType === 'login') {
    const hasUsername = hasValue(item.username)
    const hasPassword = hasValue(item.password)
    const hasOtp = Boolean(item.otp)
    const hasRecoveryCodes = item.recoveryCodes && item.recoveryCodes.length > 0

    return [
      ...(hasUsername ? [{ id: 'copy-username', title: 'Copy username', icon: User, actionId: `copy:${item.itemId}:username` }] : []),
      ...(hasPassword ? [{ id: 'copy-password', title: 'Copy password', icon: KeyRound, actionId: `copy:${item.itemId}:password` }] : []),
      ...(hasOtp ? [{ id: 'copy-otp', title: 'Copy one-time code', icon: TimerReset, actionId: `copy:${item.itemId}:otp`, otp: item.otp }] : []),
      ...(hasPassword ? [{ id: 'show-password', title: 'Show password', icon: ShieldCheck, actionId: `show:${item.itemId}:password` }] : []),
      ...(hasOtp ? [{ id: 'show-otp', title: 'Show one-time code', icon: TimerReset, actionId: `show:${item.itemId}:otp` }] : []),
      ...(hasRecoveryCodes
        ? [{ id: 'view-recovery-codes', title: 'View recovery codes', icon: RefreshCw }]
        : [{ id: 'add-recovery-codes', title: 'Add recovery codes', icon: RefreshCw, tone: 'success' as const }]),
      { id: 'edit-item', title: 'Edit item', icon: Pencil, tone: 'success' },
      { id: 'delete-item', title: 'Delete item', icon: Trash2, tone: 'danger' },
    ]
  }

  if (item.itemType === 'identity') {
    return [
      ...(hasValue(item.fullName) ? [{ id: 'copy-full-name', title: 'Copy full name', icon: ContactRound, actionId: `copy:${item.itemId}:fullName` }] : []),
      ...(hasValue(item.email) ? [{ id: 'copy-email', title: 'Copy email', icon: Mail, actionId: `copy:${item.itemId}:email` }] : []),
      ...(hasValue(item.phone) ? [{ id: 'copy-phone', title: 'Copy phone', icon: Phone, actionId: `copy:${item.itemId}:phone` }] : []),
      ...(hasValue(item.address) ? [{ id: 'copy-address', title: 'Copy address', icon: MapPinned, actionId: `copy:${item.itemId}:address` }] : []),
      { id: 'edit-item', title: 'Edit item', icon: Pencil, tone: 'success' },
      { id: 'delete-item', title: 'Delete item', icon: Trash2, tone: 'danger' },
    ]
  }

  if (item.itemType === 'card') {
    const hasCardholderName = hasValue(item.cardholderName)
    const hasCardNumber = hasValue(item.cardNumber)
    const hasCardExpiry = hasValue(item.cardExpiry) || (hasValue(item.cardExpiryMonth) && hasValue(item.cardExpiryYear))
    const hasCardCvc = hasValue(item.cardCvc)
    const hasBillingPostalCode = hasValue(item.billingPostalCode)

    return [
      ...(hasCardNumber ? [{ id: 'copy-card-number', title: 'Copy card number', icon: CreditCard, actionId: `copy:${item.itemId}:cardNumber` }] : []),
      ...(hasCardholderName ? [{ id: 'copy-cardholder-name', title: 'Copy name on card', icon: ContactRound, actionId: `copy:${item.itemId}:cardholderName` }] : []),
      ...(hasCardExpiry ? [{ id: 'copy-card-expiry', title: 'Copy expiry', icon: TimerReset, actionId: `copy:${item.itemId}:cardExpiry` }] : []),
      ...(hasCardCvc ? [{ id: 'copy-card-cvc', title: 'Copy security code', icon: ShieldCheck, actionId: `copy:${item.itemId}:cardCvc` }] : []),
      ...(hasBillingPostalCode ? [{ id: 'copy-billing-postal-code', title: 'Copy billing postal code', icon: MapPinned, actionId: `copy:${item.itemId}:billingPostalCode` }] : []),
      ...(hasCardNumber ? [{ id: 'show-card-number', title: 'Show card number', icon: CreditCard, actionId: `show:${item.itemId}:cardNumber` }] : []),
      ...(hasCardCvc ? [{ id: 'show-card-cvc', title: 'Show security code', icon: ShieldCheck, actionId: `show:${item.itemId}:cardCvc` }] : []),
      { id: 'edit-item', title: 'Edit item', icon: Pencil, tone: 'success' },
      { id: 'delete-item', title: 'Delete item', icon: Trash2, tone: 'danger' },
    ]
  }

  if (item.itemType === 'ssh-key') {
    return [
      ...(hasValue(item.sshPublicKey) ? [{ id: 'copy-ssh-public-key', title: 'Copy public key', icon: KeyRound, actionId: `copy:${item.itemId}:sshPublicKey` }] : []),
      ...(hasValue(item.sshPrivateKey) ? [{ id: 'copy-ssh-private-key', title: 'Copy private key', icon: ShieldCheck, actionId: `copy:${item.itemId}:sshPrivateKey` }] : []),
      ...(hasValue(item.sshFingerprint) ? [{ id: 'copy-ssh-fingerprint', title: 'Copy fingerprint', icon: Fingerprint, actionId: `copy:${item.itemId}:sshFingerprint` }] : []),
      ...(hasValue(item.sshPublicKey) ? [{ id: 'configure-git-signing', title: 'Configure Git signing', icon: Settings, actionId: `configure:${item.itemId}:gitSigning` }] : []),
      ...(hasValue(item.sshPublicKey) ? [{ id: 'copy-git-signing-snippet', title: 'Copy Git signing config', icon: FileText, actionId: `copy:${item.itemId}:sshGitConfig` }] : []),
      { id: 'edit-item', title: 'Edit item', icon: Pencil, tone: 'success' },
      { id: 'delete-item', title: 'Delete item', icon: Trash2, tone: 'danger' },
    ]
  }

  return [
    ...(hasValue(item.content) || hasValue(item.notes)
      ? [
          { id: 'copy-note', title: 'Copy note', icon: FileText, actionId: `copy:${item.itemId}:content` },
        ]
      : []),
    { id: 'edit-item', title: 'Edit item', icon: Pencil, tone: 'success' },
    { id: 'delete-item', title: 'Delete item', icon: Trash2, tone: 'danger' },
  ]
}
