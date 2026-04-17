import type { CreatableItemType } from '@/shared/item-types'
import type { ItemDetails, ResolvedAction } from '@/shared/types'
import type { ItemFormValues } from '@/app/palette-types'

const newCustomField = () => ({
  id: `field_${Math.random().toString(16).slice(2, 8)}`,
  label: '',
  value: '',
})

export function actionKindLabel(action: ResolvedAction) {
  switch (action.kind) {
    case 'open-item':
      return 'Item'
    case 'open-settings':
      return 'Command'
    case 'create-item':
      return 'Create'
    case 'show-otp':
    case 'copy-otp':
      return 'Code'
    case 'show-password':
    case 'copy-password':
      return 'Secret'
    case 'copy-value':
      return 'Copy'
    case 'switch-item':
      return 'Identity'
    case 'coming-soon':
      return 'Soon'
    default:
      return 'Command'
  }
}

export function createFormValues(
  itemType: CreatableItemType,
  seed?: Partial<Omit<ItemDetails, 'otp'>> & { otp?: ItemDetails['otp'] | string },
): ItemFormValues {
  return {
    itemType,
    itemName: seed?.itemName ?? '',
    username: seed?.username ?? '',
    password: seed?.password ?? '',
    otp: typeof seed?.otp === 'string' ? seed.otp : seed?.otp?.secret ?? '',
    fullName: seed?.fullName ?? '',
    firstName: seed?.firstName ?? '',
    middleName: seed?.middleName ?? '',
    lastName: seed?.lastName ?? '',
    company: seed?.company ?? '',
    jobTitle: seed?.jobTitle ?? '',
    birthDate: seed?.birthDate ?? '',
    email: seed?.email ?? '',
    phone: seed?.phone ?? '',
    address: seed?.address ?? '',
    addressLine1: seed?.addressLine1 ?? '',
    addressLine2: seed?.addressLine2 ?? '',
    city: seed?.city ?? '',
    state: seed?.state ?? '',
    postalCode: seed?.postalCode ?? '',
    country: seed?.country ?? '',
    cardholderName: seed?.cardholderName ?? '',
    cardNumber: seed?.cardNumber ?? '',
    cardExpiry: seed?.cardExpiry ?? '',
    cardExpiryMonth: seed?.cardExpiryMonth ?? '',
    cardExpiryYear: seed?.cardExpiryYear ?? '',
    cardCvc: seed?.cardCvc ?? '',
    cardBrand: seed?.cardBrand ?? '',
    billingPostalCode: seed?.billingPostalCode ?? '',
    content: seed?.content ?? '',
    notes: seed?.notes ?? '',
    websites: seed?.websites?.length ? seed.websites : [''],
    customFields: seed?.customFields?.length ? seed.customFields : [newCustomField()],
  }
}

export function itemInitials(title: string) {
  const trimmed = title.trim()
  if (!trimmed) {
    return 'Kl'
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 1) {
    const first = words[0].slice(0, 2)
    return `${first.slice(0, 1).toUpperCase()}${first.slice(1, 2).toLowerCase()}`
  }

  return `${words[0][0].toUpperCase()}${words[1][0].toLowerCase()}`
}
