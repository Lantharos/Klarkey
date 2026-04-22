import { getTotpCode } from '@/shared/totp'
import type { BrowserFillCard, BrowserFillLogin, ItemDetails } from '@/shared/types'

export function buildBrowserFillLogin(item: ItemDetails | undefined, hasPasskey: boolean): BrowserFillLogin | undefined {
  if (!item || item.itemType !== 'login') {
    return undefined
  }

  return {
    itemId: item.itemId,
    itemName: item.itemName,
    username: item.username || undefined,
    password: item.password,
    otp: item.otp ? getTotpCode(item.otp).value : undefined,
    websites: item.websites,
    hasPasskey,
    ssoProvider: item.ssoProvider,
  } satisfies BrowserFillLogin
}

export function buildBrowserFillIdentity(item: ItemDetails | undefined) {
  if (!item || item.itemType !== 'identity') {
    return undefined
  }

  return {
    itemId: item.itemId,
    itemName: item.itemName,
    username: item.username || undefined,
    fullName: item.fullName,
    firstName: item.firstName,
    middleName: item.middleName,
    lastName: item.lastName,
    company: item.company,
    jobTitle: item.jobTitle,
    birthDate: item.birthDate,
    email: item.email,
    phone: item.phone,
    address: item.address,
    addressLine1: item.addressLine1,
    addressLine2: item.addressLine2,
    city: item.city,
    state: item.state,
    postalCode: item.postalCode,
    country: item.country,
  }
}

export function buildBrowserFillCard(item: ItemDetails | undefined): BrowserFillCard | undefined {
  if (!item || item.itemType !== 'card') {
    return undefined
  }

  return {
    itemId: item.itemId,
    itemName: item.itemName,
    cardholderName: item.cardholderName,
    cardNumber: item.cardNumber,
    cardLastFour: item.cardLastFour,
    cardExpiry: item.cardExpiry,
    cardExpiryMonth: item.cardExpiryMonth,
    cardExpiryYear: item.cardExpiryYear,
    cardCvc: item.cardCvc,
    cardBrand: item.cardBrand,
    billingPostalCode: item.billingPostalCode,
  } satisfies BrowserFillCard
}
