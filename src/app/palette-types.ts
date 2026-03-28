import type { ModifierKey } from '@/shared/types'
import type { User } from 'lucide-react'

export type DetailAction = {
  id: string
  title: string
  icon: typeof User
  actionId?: string
  modifier?: ModifierKey
  disabled?: boolean
  tone?: 'default' | 'success' | 'danger'
}

export type ItemFormValues = {
  serviceName: string
  username: string
  password: string
  notes: string
  websites: string[]
  customFields: Array<{ id: string; label: string; value: string }>
}
