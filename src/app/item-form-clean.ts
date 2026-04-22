import type { ItemFormValues } from '@/app/palette-types'
import type { CreateItemInput } from '@/shared/types'

export function cleanFormValue(value: ItemFormValues): CreateItemInput {
  const identityFullName = [value.firstName, value.middleName, value.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  const identityAddress = [
    [value.addressLine1, value.addressLine2].map((part) => part.trim()).filter(Boolean).join(', '),
    [value.city, value.state, value.postalCode].map((part) => part.trim()).filter(Boolean).join(', '),
    value.country.trim(),
  ]
    .filter(Boolean)
    .join(', ')

  return {
    itemType: value.itemType,
    itemName: value.itemName.trim() || 'New item',
    username:
      value.itemType === 'login' || value.itemType === 'identity'
        ? value.username.trim() || undefined
        : undefined,
    password: value.itemType === 'login' ? value.password.trim() || undefined : undefined,
    otp: value.itemType === 'login' ? value.otp.trim() : undefined,
    fullName:
      value.itemType === 'identity'
        ? value.fullName.trim() || identityFullName || undefined
        : undefined,
    firstName: value.itemType === 'identity' ? value.firstName.trim() || undefined : undefined,
    middleName: value.itemType === 'identity' ? value.middleName.trim() || undefined : undefined,
    lastName: value.itemType === 'identity' ? value.lastName.trim() || undefined : undefined,
    company: value.itemType === 'identity' ? value.company.trim() || undefined : undefined,
    jobTitle: value.itemType === 'identity' ? value.jobTitle.trim() || undefined : undefined,
    birthDate: value.itemType === 'identity' ? value.birthDate.trim() || undefined : undefined,
    email: value.itemType === 'identity' ? value.email.trim() || undefined : undefined,
    phone: value.itemType === 'identity' ? value.phone.trim() || undefined : undefined,
    address:
      value.itemType === 'identity'
        ? value.address.trim() || identityAddress || undefined
        : undefined,
    addressLine1: value.itemType === 'identity' ? value.addressLine1.trim() || undefined : undefined,
    addressLine2: value.itemType === 'identity' ? value.addressLine2.trim() || undefined : undefined,
    city: value.itemType === 'identity' ? value.city.trim() || undefined : undefined,
    state: value.itemType === 'identity' ? value.state.trim() || undefined : undefined,
    postalCode: value.itemType === 'identity' ? value.postalCode.trim() || undefined : undefined,
    country: value.itemType === 'identity' ? value.country.trim() || undefined : undefined,
    cardholderName: value.itemType === 'card' ? value.cardholderName.trim() || undefined : undefined,
    cardNumber: value.itemType === 'card' ? value.cardNumber.replace(/\s+/g, '').trim() || undefined : undefined,
    cardExpiry:
      value.itemType === 'card'
        ? value.cardExpiry.trim() ||
          (value.cardExpiryMonth.trim() && value.cardExpiryYear.trim()
            ? `${value.cardExpiryMonth.trim()}/${value.cardExpiryYear.trim()}`
            : undefined)
        : undefined,
    cardExpiryMonth: value.itemType === 'card' ? value.cardExpiryMonth.trim() || undefined : undefined,
    cardExpiryYear: value.itemType === 'card' ? value.cardExpiryYear.trim() || undefined : undefined,
    cardCvc: value.itemType === 'card' ? value.cardCvc.trim() || undefined : undefined,
    cardBrand: value.itemType === 'card' ? value.cardBrand.trim() || undefined : undefined,
    billingPostalCode: value.itemType === 'card' ? value.billingPostalCode.trim() || undefined : undefined,
    sshPublicKey: undefined,
    sshPrivateKey: value.itemType === 'ssh-key' ? value.sshPrivateKey.trim() || undefined : undefined,
    sshComment: value.itemType === 'ssh-key' ? value.sshComment.trim() || undefined : undefined,
    content: value.itemType === 'note' ? value.content.trim() || undefined : undefined,
    notes: value.itemType !== 'note' ? value.notes.trim() || undefined : undefined,
    websites: value.itemType === 'login' ? value.websites.map((website) => website.trim()).filter(Boolean) : [],
    customFields:
      value.itemType !== 'note'
        ? value.customFields
            .map((field) => ({
              ...field,
              label: field.label.trim(),
              value: field.value.trim(),
            }))
            .filter((field) => field.label || field.value)
        : [],
    ssoProvider: value.itemType === 'login' ? value.ssoProvider.trim() || undefined : undefined,
  }
}
