import type { CreateItemInput } from '@/shared/types'
import type { ImportResult } from '@/shared/import-export'
import type { VaultRepository } from '@/electron/repository'
import { importItems, MAX_IMPORT_ITEMS, readImportFileText, tooManyImportItemsResult } from '@/electron/import/import-utils'

interface DashlaneCredential {
  title?: string
  login?: string
  password?: string
  url?: string | { href?: string; domain?: string }
  note?: string
  otpSecret?: string
}

interface DashlaneSecureNote {
  title?: string
  content?: string
}

interface DashlaneIdentity {
  fullName?: string
  firstName?: string
  lastName?: string
  pseudo?: string
  birthDate?: string
  email?: string
  phoneNumber?: string
  address?: string
  city?: string
  state?: string
  zipCode?: string
  country?: string
}

interface DashlanePaymentCard {
  name?: string
  cardNumber?: string
  securityCode?: string
  expireMonth?: string
  expireYear?: string
}

interface DashlaneExport {
  credentials?: DashlaneCredential[]
  secureNotes?: DashlaneSecureNote[]
  identities?: DashlaneIdentity[]
  paymentCards?: DashlanePaymentCard[]
}

function extractUrl(url: unknown): string | undefined {
  if (typeof url === 'string') return url
  if (url && typeof url === 'object' && 'href' in url && typeof (url as { href?: string }).href === 'string') {
    return (url as { href: string }).href
  }
  return undefined
}

export async function importDashlaneJson(repository: VaultRepository, filePath: string): Promise<ImportResult> {
  const content = readImportFileText(filePath)
  const data = JSON.parse(content) as DashlaneExport
  const itemCount =
    (data.credentials?.length ?? 0) +
    (data.secureNotes?.length ?? 0) +
    (data.identities?.length ?? 0) +
    (data.paymentCards?.length ?? 0)

  if (itemCount > MAX_IMPORT_ITEMS) {
    return tooManyImportItemsResult()
  }

  const inputs: CreateItemInput[] = []

  for (const cred of data.credentials ?? []) {
    inputs.push({
      itemType: 'login',
      itemName: cred.title?.trim() || cred.login?.trim() || 'Untitled',
      username: cred.login,
      password: cred.password,
      websites: extractUrl(cred.url) ? [extractUrl(cred.url)!] : undefined,
      notes: cred.note,
      otp: cred.otpSecret,
    })
  }

  for (const note of data.secureNotes ?? []) {
    inputs.push({
      itemType: 'note',
      itemName: note.title?.trim() || 'Untitled note',
      content: note.content,
    })
  }

  for (const id of data.identities ?? []) {
    inputs.push({
      itemType: 'identity',
      itemName: id.fullName?.trim() || `${id.firstName ?? ''} ${id.lastName ?? ''}`.trim() || 'Untitled identity',
      firstName: id.firstName,
      lastName: id.lastName,
      email: id.email,
      phone: id.phoneNumber,
      address: id.address,
      city: id.city,
      state: id.state,
      postalCode: id.zipCode,
      country: id.country,
      birthDate: id.birthDate,
    })
  }

  for (const card of data.paymentCards ?? []) {
    inputs.push({
      itemType: 'card',
      itemName: card.name?.trim() || 'Untitled card',
      cardNumber: card.cardNumber,
      cardCvc: card.securityCode,
      cardExpiryMonth: card.expireMonth,
      cardExpiryYear: card.expireYear,
    })
  }

  return importItems(repository, inputs)
}
