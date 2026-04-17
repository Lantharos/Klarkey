import type { ModifierKey, TotpDetails } from '@/shared/types'
import type { User } from 'lucide-react'
import type { CreatableItemType } from '@/shared/item-types'

export type DetailAction = {
  id: string
  title: string
  icon: typeof User
  iconUrl?: string
  actionId?: string
  modifier?: ModifierKey
  disabled?: boolean
  tone?: 'default' | 'success' | 'danger'
  otp?: TotpDetails
}

export type ItemFormValues = {
  itemType: CreatableItemType
  itemName: string
  username: string
  password: string
  otp: string
  fullName: string
  firstName: string
  middleName: string
  lastName: string
  email: string
  phone: string
  address: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
  content: string
  notes: string
  websites: string[]
  customFields: Array<{ id: string; label: string; value: string }>
}
