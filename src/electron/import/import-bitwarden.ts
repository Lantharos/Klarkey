import type { ItemType } from '@/shared/item-types'
import type { CreateItemInput } from '@/shared/types'
import type { ImportResult } from '@/shared/import-export'
import type { VaultRepository } from '@/electron/repository'
import { importItems, MAX_IMPORT_ITEMS, readImportFileText, tooManyImportItemsResult } from '@/electron/import/import-utils'

interface BitwardenUri {
  uri?: string
}

interface BitwardenField {
  name?: string
  value?: string
  type?: number
}

interface BitwardenLogin {
  username?: string
  password?: string
  totp?: string
  uris?: BitwardenUri[]
}

interface BitwardenCard {
  cardholderName?: string
  number?: string
  brand?: string
  expMonth?: string
  expYear?: string
  code?: string
}

interface BitwardenIdentity {
  title?: string
  firstName?: string
  middleName?: string
  lastName?: string
  address1?: string
  address2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  company?: string
  email?: string
  phone?: string
  jobTitle?: string
}

interface BitwardenItem {
  type?: number
  name?: string
  notes?: string
  login?: BitwardenLogin
  card?: BitwardenCard
  identity?: BitwardenIdentity
  secureNote?: Record<string, unknown>
  fields?: BitwardenField[]
}

interface BitwardenExport {
  encrypted?: boolean
  items?: BitwardenItem[]
}

const BW_TYPE_MAP: Record<number, ItemType> = {
  1: 'login',
  2: 'note',
  3: 'card',
  4: 'identity',
}

export async function importBitwardenJson(repository: VaultRepository, filePath: string): Promise<ImportResult> {
  const content = readImportFileText(filePath)
  const data = JSON.parse(content) as BitwardenExport

  if (data.encrypted) {
    return {
      success: false,
      importedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      message: 'Encrypted Bitwarden exports are not supported. Please export as unencrypted JSON.',
    }
  }

  if ((data.items ?? []).length > MAX_IMPORT_ITEMS) {
    return tooManyImportItemsResult()
  }

  const inputs: CreateItemInput[] = (data.items ?? []).map(convertBitwardenItem).filter((input): input is CreateItemInput => Boolean(input?.itemName))

  return importItems(repository, inputs)
}

function convertBitwardenItem(item: BitwardenItem): CreateItemInput | null {
  const itemType = BW_TYPE_MAP[item.type ?? 1] || 'login'
  const itemName = item.name?.trim() || 'Untitled'
  const notes = item.notes || ''

  if (itemType === 'card' && item.card) {
    return {
      itemType: 'card',
      itemName,
      cardholderName: item.card.cardholderName,
      cardNumber: item.card.number,
      cardBrand: item.card.brand,
      cardExpiryMonth: item.card.expMonth,
      cardExpiryYear: item.card.expYear,
      cardCvc: item.card.code,
      notes,
    }
  }

  if (itemType === 'identity' && item.identity) {
    const id = item.identity
    return {
      itemType: 'identity',
      itemName,
      firstName: id.firstName,
      middleName: id.middleName,
      lastName: id.lastName,
      company: id.company,
      jobTitle: id.jobTitle,
      email: id.email,
      phone: id.phone,
      addressLine1: id.address1,
      addressLine2: id.address2,
      city: id.city,
      state: id.state,
      postalCode: id.postalCode,
      country: id.country,
      notes,
    }
  }

  if (itemType === 'note') {
    return {
      itemType: 'note',
      itemName,
      content: notes || itemName,
    }
  }

  // Login (default)
  const login = item.login
  const customFields = item.fields
    ?.filter((f) => f.name && f.value)
    .map((f) => ({ id: `field_${f.name}`, label: f.name!, value: f.value! }))

  return {
    itemType: 'login',
    itemName,
    username: login?.username,
    password: login?.password,
    otp: login?.totp,
    websites: login?.uris?.map((u) => u.uri).filter((uri): uri is string => Boolean(uri)),
    notes,
    customFields,
  }
}
