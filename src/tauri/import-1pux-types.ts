import type { ItemType } from '@/shared/item-types'

export interface OnePuxLoginField {
  value?: string
  id?: string
  name?: string
  fieldType?: 'E' | 'P' | 'T' | 'N' | 'U' | string
  designation?: 'username' | 'password' | string
}

export interface OnePuxSectionField {
  title?: string
  id?: string
  value?: {
    string?: string
    totp?: string
    ssoLogin?: { provider?: string }
    concealed?: string
    phone?: string
    menu?: string
    email?: { email_address?: string }
    date?: number
    url?: string
    monthYear?: number
    creditCardNumber?: string
    creditCardExpiry?: string
    iban?: string
    routingNumber?: string
    address?: {
      street?: string
      city?: string
      state?: string
      zip?: string
      country?: string
      countryCode?: string
    }
    sshKey?: string | {
      privateKey?: string
      publicKey?: string
      fingerprint?: string
      keyType?: string
      comment?: string
      metadata?: {
        privateKey?: string
        publicKey?: string
        fingerprint?: string
        keyType?: string
        comment?: string
      }
    }
  }
  multiline?: boolean
}

export interface OnePuxSection {
  title?: string
  name?: string
  fields?: OnePuxSectionField[]
}

export interface OnePuxUrl {
  url?: string
}

export interface OnePuxOverview {
  title?: string
  subtitle?: string
  url?: string
  urls?: OnePuxUrl[]
}

export interface OnePuxDetails {
  loginFields?: OnePuxLoginField[]
  fields?: OnePuxLoginField[]
  sections?: OnePuxSection[]
  notesPlain?: string
  password?: string
  ccnum?: string
  ccexp_m?: string
  ccexp_y?: string
  cvv?: string
  cardholder?: string
  firstname?: string
  lastname?: string
  company?: string
  jobTitle?: string
  street?: string
  city?: string
  country?: string
  zip?: string
  phone?: string
  email?: string
}

export interface OnePuxItem {
  templateUuid?: string
  categoryUuid?: string
  trashed?: string | boolean
  state?: string
  overview?: OnePuxOverview
  details?: OnePuxDetails
}

export interface OnePuxVault {
  items?: OnePuxItem[]
}

export interface OnePuxAccount {
  vaults?: OnePuxVault[]
}

export interface OnePuxExport {
  accounts?: OnePuxAccount[]
}

export const CATEGORY_MAP: Record<string, ItemType> = {
  '001': 'login',
  '002': 'card',
  '003': 'note',
  '004': 'identity',
  '005': 'login',
  '006': 'note',
  '114': 'ssh-key',
}
