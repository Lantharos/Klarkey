import type { ItemDetails, ResolvedAction } from '@/shared/types'
import type { ItemFormValues } from '@/app/palette-types'

const newCustomField = () => ({
  id: `field_${Math.random().toString(16).slice(2, 8)}`,
  label: '',
  value: '',
})

export function actionKindLabel(action: ResolvedAction) {
  switch (action.kind) {
    case 'login':
      return 'Item'
    case 'open-settings':
      return 'Command'
    case 'create-login':
      return 'Create'
    case 'generate-passkey':
      return 'Passkey'
    case 'show-otp':
    case 'copy-otp':
      return 'Code'
    case 'show-password':
    case 'copy-password':
      return 'Secret'
    case 'switch-identity':
      return 'Identity'
    default:
      return 'Command'
  }
}

export function createFormValues(seed?: Partial<ItemDetails>): ItemFormValues {
  return {
    serviceName: seed?.serviceName ?? '',
    username: seed?.username ?? '',
    password: seed?.password ?? '',
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
