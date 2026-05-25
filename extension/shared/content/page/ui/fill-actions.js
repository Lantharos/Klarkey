import { fieldKindFor } from '../field-meta.js'
import {
  getInputs,
  setPendingUsername,
  setPendingOtp,
  getFillableFields,
} from '../forms/forms.js'
import { writePasswordGroup, writeValue, writeSplitOtp, scheduleLoginAutoSubmit } from '../autofill/write-submit.js'
import { suppressInlineMenu } from '../menu-suppress.js'
import { removeInlineUi } from './inline-ui.js'

const expiryDigits = (value) => String(value || '').replace(/\D/g, '')

const normalizeExpiryMonth = (value) => {
  const digits = expiryDigits(value)
  if (!digits) {
    return undefined
  }

  const month = Number.parseInt(digits.slice(0, 2), 10)
  return month >= 1 && month <= 12 ? String(month).padStart(2, '0') : undefined
}

const normalizeExpiryYear = (value) => {
  const digits = expiryDigits(value)
  if (digits.length === 2) {
    return { full: `20${digits}`, short: digits }
  }
  if (digits.length >= 4) {
    const full = digits.slice(-4)
    return { full, short: full.slice(-2) }
  }
  return undefined
}

const cardExpiryParts = (card) => {
  let month = normalizeExpiryMonth(card.cardExpiryMonth)
  let year = normalizeExpiryYear(card.cardExpiryYear)
  const expiryParts = String(card.cardExpiry || '').match(/\d+/g) || []

  if (!month && expiryParts[0]) {
    month = normalizeExpiryMonth(expiryParts[0])
  }
  if (!year && expiryParts[1]) {
    year = normalizeExpiryYear(expiryParts[1])
  }

  return { month, year }
}

const fieldText = (field) =>
  [
    field?.getAttribute?.('placeholder'),
    field?.getAttribute?.('aria-label'),
    field?.getAttribute?.('name'),
    field?.getAttribute?.('id'),
    field?.getAttribute?.('autocomplete'),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

const expiryYearForField = (field, year) => {
  if (!year) {
    return undefined
  }

  const marker = fieldText(field)
  const maxLength =
    field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.maxLength : -1
  return /\byyyy\b|20\d{2}/.test(marker) || maxLength === 4 ? year.full : year.short
}

const expiryForField = (field, card) => {
  const { month, year } = cardExpiryParts(card)
  if (!month || !year) {
    return card.cardExpiry
  }

  const marker = fieldText(field)
  const separator = marker.includes('-') ? '-' : marker.includes(' / ') ? ' / ' : '/'
  return `${month}${separator}${expiryYearForField(field, year)}`
}

const clickMatchingSsoControl = (provider) => {
  const allButtons = document.querySelectorAll('a, button, [role="button"]')
  for (const el of allButtons) {
    const text = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase()
    if (text.includes('sign in with') && text.includes(provider.toLowerCase())) {
      el.click()
      return true
    }
  }
  return false
}

export const applyLoginFill = async (input, login) => {
  if (login.ssoProvider) {
    suppressInlineMenu(input, { untilUserInteraction: true })
    removeInlineUi()
    clickMatchingSsoControl(login.ssoProvider)
    return
  }

  const inputs = getInputs(input)
  const passwordTargets = inputs.passwordInputs.length ? inputs.passwordInputs : inputs.password ? [inputs.password] : []
  const otpTargets = inputs.splitOtpTargets?.length ? inputs.splitOtpTargets : inputs.otp ? [inputs.otp] : []
  const filledSecretOnThisStep = Boolean((login.password && passwordTargets.length) || (login.otp && otpTargets.length))
  suppressInlineMenu(input, { untilUserInteraction: filledSecretOnThisStep, durationMs: filledSecretOnThisStep ? undefined : 250 })
  writeValue(inputs.username, login.username)
  writePasswordGroup(input, login.password)
  if (inputs.splitOtpTargets?.length && login.otp) {
    writeSplitOtp(inputs.splitOtpTargets, login.otp)
  } else {
    writeValue(inputs.otp, login.otp)
  }
  await Promise.all([setPendingUsername(login.username || ''), setPendingOtp(login.otp || '')])
  removeInlineUi()
  scheduleLoginAutoSubmit(input)
}

export const findFieldByKind = (preferredInput, kind) =>
  getFillableFields(preferredInput).find((field) => fieldKindFor(field) === kind)

export const applyIdentityFill = (input, identity) => {
  suppressInlineMenu(input, { untilUserInteraction: true })

  const fieldMap = {
    username: identity.username,
    email: identity.email,
    fullName: identity.fullName,
    firstName: identity.firstName,
    middleName: identity.middleName,
    lastName: identity.lastName,
    company: identity.company,
    jobTitle: identity.jobTitle,
    birthDate: identity.birthDate,
    phone: identity.phone,
    address: identity.address,
    addressLine1: identity.addressLine1 || identity.address,
    addressLine2: identity.addressLine2,
    city: identity.city,
    state: identity.state,
    postalCode: identity.postalCode,
    country: identity.country,
  }

  for (const [kind, value] of Object.entries(fieldMap)) {
    if (!value) {
      continue
    }

    const target = findFieldByKind(input, kind)
    if (target) {
      writeValue(target, value)
    }
  }

  if (!identity.firstName && identity.fullName) {
    const firstNameField = findFieldByKind(input, 'firstName')
    if (firstNameField && !(firstNameField.value || '').trim()) {
      writeValue(firstNameField, identity.fullName.split(/\s+/)[0] || identity.fullName)
    }
  }

  if (!identity.lastName && identity.fullName) {
    const parts = identity.fullName.split(/\s+/).filter(Boolean)
    const lastNameField = findFieldByKind(input, 'lastName')
    if (lastNameField && !(lastNameField.value || '').trim() && parts.length > 1) {
      writeValue(lastNameField, parts.slice(1).join(' '))
    }
  }

  if (identity.username || identity.email) {
    setPendingUsername(identity.username || identity.email || '')
  }

  removeInlineUi()
}

export const applyCardFill = (input, card) => {
  suppressInlineMenu(input, { untilUserInteraction: true })
  const expiry = cardExpiryParts(card)

  const fieldMap = {
    cardholderName: card.cardholderName,
    fullName: card.cardholderName,
    cardNumber: card.cardNumber,
    cardCvc: card.cardCvc,
    cardBrand: card.cardBrand,
    postalCode: card.billingPostalCode,
  }

  for (const [kind, value] of Object.entries(fieldMap)) {
    if (!value) {
      continue
    }

    const target = findFieldByKind(input, kind)
    if (target) {
      writeValue(target, value)
    }
  }

  const expiryTarget = findFieldByKind(input, 'cardExpiry')
  if (expiryTarget) {
    writeValue(expiryTarget, expiryForField(expiryTarget, card))
  } else {
    const monthTarget = findFieldByKind(input, 'cardExpiryMonth')
    const yearTarget = findFieldByKind(input, 'cardExpiryYear')
    writeValue(monthTarget, expiry.month || card.cardExpiryMonth)
    writeValue(yearTarget, expiryYearForField(yearTarget, expiry.year) || card.cardExpiryYear)
  }

  removeInlineUi()
}

export { clickMatchingSsoControl }
