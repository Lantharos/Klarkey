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
    ssoLogin?: {
      provider?: string
      item?: { vaultUuid: string; itemUuid: string }
    }
    concealed?: string
    phone?: string
    menu?: string
    email?: { email_address?: string; provider?: string }
    date?: number
    address?: unknown
    url?: string
    monthYear?: number
    creditCardType?: string
    creditCardNumber?: string
    creditCardExpiry?: string
    bankAccount?: unknown
    iban?: string
    routingNumber?: string
  }
  guarded?: boolean
  multiline?: boolean
  dontGenerate?: boolean
}

export interface OnePuxSection {
  title?: string
  name?: string
  fields?: OnePuxSectionField[]
}

export interface OnePuxUrl {
  label?: string
  url?: string
  mode?: string
}

export interface OnePuxOverview {
  title?: string
  subtitle?: string
  ainfo?: string
  url?: string
  urls?: OnePuxUrl[]
}

export interface OnePuxDetails {
  loginFields?: OnePuxLoginField[]
  fields?: OnePuxLoginField[]
  sections?: OnePuxSection[]
  passwordHistory?: unknown[]
  notesPlain?: string
  ccnum?: string
  ccexp_m?: string
  ccexp_y?: string
  cvv?: string
  cardholder?: string
  firstname?: string
  initial?: string
  lastname?: string
  company?: string
  jobTitle?: string
  birthday?: string
  gender?: string
  street?: string
  city?: string
  country?: string
  zip?: string
  phone?: string
  email?: string
  username?: string
}

export interface OnePuxItem {
  uuid?: string
  templateUuid?: string
  categoryUuid?: string
  trashed?: string | boolean
  state?: string
  createdAt?: number
  updatedAt?: number
  overview?: OnePuxOverview
  details?: OnePuxDetails
}

export interface OnePuxVault {
  attrs?: { uuid?: string; name?: string; type?: string }
  items?: OnePuxItem[]
}

export interface OnePuxAccount {
  attrs?: { accountName?: string; email?: string; uuid?: string }
  vaults?: OnePuxVault[]
}

export interface OnePuxExport {
  accounts?: OnePuxAccount[]
}

export const CATEGORY_MAP: Record<string, ItemType> = {
  '001': 'login',
  '002': 'card',
  '003': 'identity',
  '004': 'note',
  '005': 'login',
  '006': 'note',
}
