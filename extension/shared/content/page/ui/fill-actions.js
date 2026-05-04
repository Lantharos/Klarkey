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

export const applyLoginFill = (input, login) => {
  if (login.ssoProvider) {
    suppressInlineMenu(input)
    removeInlineUi()
    clickMatchingSsoControl(login.ssoProvider)
    return
  }

  const inputs = getInputs(input)
  suppressInlineMenu(input)
  writeValue(inputs.username, login.username)
  writePasswordGroup(input, login.password)
  if (inputs.splitOtpTargets?.length && login.otp) {
    writeSplitOtp(inputs.splitOtpTargets, login.otp)
  } else {
    writeValue(inputs.otp, login.otp)
  }
  setPendingUsername(login.username || '')
  setPendingOtp(login.otp || '')
  removeInlineUi()
  scheduleLoginAutoSubmit(input)
}

export const findFieldByKind = (preferredInput, kind) =>
  getFillableFields(preferredInput).find((field) => fieldKindFor(field) === kind)

export const applyIdentityFill = (input, identity) => {
  suppressInlineMenu(input)

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
  suppressInlineMenu(input)

  const fieldMap = {
    cardholderName: card.cardholderName,
    fullName: card.cardholderName,
    cardNumber: card.cardNumber,
    cardExpiry: card.cardExpiry,
    cardExpiryMonth: card.cardExpiryMonth,
    cardExpiryYear: card.cardExpiryYear,
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

  removeInlineUi()
}

export { clickMatchingSsoControl }
