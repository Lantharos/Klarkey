import { getInputSignals, markerMatches, isTextLikeInput } from '../dom.js'

const hasExplicitCredentialAutocomplete = (autocomplete) =>
  /(username|email|current-password|new-password|one-time-code|cc-|tel|name|address|postal-code|country|bday|organization)/.test(autocomplete)

const isGenericSearchInput = (input) => {
  const { autocomplete, marker, inputType } = getInputSignals(input)
  if (hasExplicitCredentialAutocomplete(autocomplete)) {
    return false
  }

  const form = input.closest?.('form')
  const formMarker = `${form?.getAttribute('role') || ''} ${form?.getAttribute('aria-label') || ''} ${form?.getAttribute('id') || ''} ${form?.getAttribute('class') || ''} ${form?.getAttribute('action') || ''}`.toLowerCase()
  const searchSignals = `${marker} ${formMarker}`

  return (
    inputType === 'search' ||
    input.getAttribute?.('role') === 'searchbox' ||
    /\bsearch\b/.test(searchSignals) ||
    /(^|[\s_-])(search|query|keywords?)([\s_-]|$)/.test(searchSignals)
  )
}

const nearbyText = (input) => {
  const root = input.closest?.('form') || input.closest?.('[role="dialog"], [aria-modal="true"], main, section, article') || input.parentElement
  return (root?.textContent || '').slice(0, 4000).toLowerCase()
}

const hasNearbyPasswordInput = (input) => {
  const root = input.closest?.('form') || input.closest?.('[role="dialog"], [aria-modal="true"], main, section, article') || input.parentElement
  if (!root) {
    return false
  }

  return Array.from(root.querySelectorAll('input')).some((field) => field !== input && isPasswordInput(field))
}

const isUsernameInput = (input) => {
  const { autocomplete, marker } = getInputSignals(input)
  const context = `${marker} ${nearbyText(input)}`
  return (
    isTextLikeInput(input) &&
    (autocomplete.includes('username') ||
      autocomplete.includes('email') ||
      /(user|email|login|identifier)/.test(marker) ||
      (hasNearbyPasswordInput(input) && /(sign[\s-]?in|log[\s-]?in|login|username|email|account)/.test(context)))
  )
}

const isEmailInput = (input) => {
  const { autocomplete, marker } = getInputSignals(input)
  return isTextLikeInput(input) && (autocomplete.includes('email') || /\bemail\b/.test(marker))
}

const isCardholderNameInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('cc-name') || markerMatches(input, /(name on card|cardholder|card holder|name as it appears|name printed on card)/)
}

const isCardNumberInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('cc-number') || markerMatches(input, /(card number|credit card|debit card|cc[-\s_]*number|card no|card #|pan\b)/)
}

const isCardExpiryMonthInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('cc-exp-month') || markerMatches(input, /(expir|expiry|exp date|valid thru).*(month|\bmm\b)|month.*(expir|expiry|exp date|valid thru)/)
}

const isCardExpiryYearInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('cc-exp-year') || markerMatches(input, /(expir|expiry|exp date|valid thru).*(year|\byy\b|\byyyy\b)|year.*(expir|expiry|exp date|valid thru)/)
}

const isCardExpiryInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  if (autocomplete.includes('cc-exp-month') || autocomplete.includes('cc-exp-year')) {
    return false
  }

  return autocomplete.includes('cc-exp') || markerMatches(input, /(expir|expiry|exp date|valid thru|mm\s*\/\s*yy|mm\s*\/\s*yyyy)/)
}

const isCardCvcInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('cc-csc') || markerMatches(input, /(cvc|cvv|cvn|security code|card security code|verification code)/)
}

const isCardBrandInput = (input) => markerMatches(input, /(card type|card brand|payment network|network)/)

const isPhoneInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('tel') || markerMatches(input, /(phone|mobile|tel)/)
}

const isFirstNameInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('given-name') || markerMatches(input, /(first[\s_-]*name|given[\s_-]*name|forename|fname)/)
}

const isMiddleNameInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('additional-name') || markerMatches(input, /(middle[\s_-]*name|middle[\s_-]*initial|additional[\s_-]*name|mname)/)
}

const isLastNameInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('family-name') || markerMatches(input, /(last[\s_-]*name|family[\s_-]*name|surname|lname)/)
}

const relevantPersonNameContextExpression =
  /(sign[\s-]?up|signup|register|create[\s-]?(your[\s-]?)?account|join|checkout|payment|billing|shipping|delivery|address|contact|profile|personal information|recipient|order|account details|account info)/

const isFullNameInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  if (autocomplete.includes('given-name') || autocomplete.includes('family-name') || autocomplete.includes('additional-name')) {
    return false
  }
  if (isFirstNameInput(input) || isMiddleNameInput(input) || isLastNameInput(input)) {
    return false
  }
  return (
    autocomplete === 'name' ||
    markerMatches(input, /(full[\s_-]*name|your[\s_-]*name|legal[\s_-]*name|contact[\s_-]*name|customer[\s_-]*name|recipient[\s_-]*name)/) ||
    (markerMatches(input, /\bname\b/) && relevantPersonNameContextExpression.test(nearbyText(input)))
  )
}

const isCompanyInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('organization') || markerMatches(input, /(company|organisation|organization|employer|business|workplace)/)
}

const isJobTitleInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('organization-title') || markerMatches(input, /(job[\s_-]*title|title|role|position|occupation)/)
}

const isBirthDateInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('bday') || markerMatches(input, /(birthday|birth[\s_-]*date|date of birth|dob)/)
}

const isCountryInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('country') || markerMatches(input, /(country|country[\s_-]*name)/)
}

const isStateInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('address-level1') || markerMatches(input, /\b(state|province|region|county|admin[\s_-]*area)\b/)
}

const isPostalCodeInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('postal-code') || markerMatches(input, /(zip|postal|post[\s_-]*code)/)
}

const isCityInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('address-level2') || markerMatches(input, /\b(city|town|locality|suburb)\b/)
}

const isAddressLine2Input = (input) => markerMatches(input, /(address line 2|suite|apartment|apt|unit|floor|building)/)

const isAddressLine1Input = (input) => {
  const { autocomplete } = getInputSignals(input)
  return (
    autocomplete.includes('street-address') ||
    autocomplete.includes('address-line1') ||
    markerMatches(input, /(street address|address line 1|address|street|line1)/)
  )
}

const otpMarkerExpression =
  /(otp|2fa|mfa|totp|one[-\s_]?time|verification[\s_-]*(code|token)|authenticator[\s_-]*(code|token)|auth[\s_-]*(code|token)|security[\s_-]*code|login[\s_-]*code|two[-\s_]?factor|authentication[\s_-]*code)/
const otpContextExpression =
  /(otp|2fa|mfa|totp|one[-\s_]?time|verification[\s_-]*(code|token)|authenticator|security[\s_-]*code|login[\s_-]*code|two[-\s_]?factor|authentication[\s_-]*code|enter\s+the\s+code|code\s+from\s+your\s+authenticator)/
const nonOtpMarkerExpression = /\b(api[\s_-]*key|secret[\s_-]*key|restricted[\s_-]*key|key[\s_-]*name|product[\s_-]*key|license[\s_-]*key)\b/

const isOtpInput = (input) => {
  const { autocomplete, marker, inputMode, inputType, maxLength, pattern } = getInputSignals(input)
  const context = `${marker} ${nearbyText(input)}`
  const numericShortCode =
    input instanceof HTMLInputElement &&
    isTextLikeInput(input) &&
    maxLength >= 4 &&
    maxLength <= 8 &&
    (inputMode === 'numeric' ||
      inputMode === 'tel' ||
      inputType === 'number' ||
      inputType === 'tel' ||
      /\\d|\[0-9\]/.test(pattern) ||
      /^[\d\s-]{4,8}$/.test(input.placeholder || ''))

  return (
    isTextLikeInput(input) &&
    !/\b(email|postal|zip|coupon|promo|gift|card number)\b/.test(context) &&
    !nonOtpMarkerExpression.test(marker) &&
    (autocomplete.includes('one-time-code') ||
      otpMarkerExpression.test(marker) ||
      (numericShortCode && otpContextExpression.test(context)))
  )
}

const isPasswordInput = (input) => {
  const { autocomplete, marker } = getInputSignals(input)
  return (
    input instanceof HTMLInputElement &&
    (input.type === 'password' ||
      autocomplete.includes('current-password') ||
      autocomplete.includes('new-password') ||
      /(pass|secret)/.test(marker))
  )
}

const isConfirmPasswordInput = (input) => markerMatches(input, /(confirm|repeat|verify|re-enter)/)

export {
  isUsernameInput,
  isEmailInput,
  isCardholderNameInput,
  isCardNumberInput,
  isCardExpiryMonthInput,
  isCardExpiryYearInput,
  isCardExpiryInput,
  isCardCvcInput,
  isCardBrandInput,
  isPhoneInput,
  isFirstNameInput,
  isMiddleNameInput,
  isLastNameInput,
  isFullNameInput,
  isCompanyInput,
  isJobTitleInput,
  isBirthDateInput,
  isCountryInput,
  isStateInput,
  isPostalCodeInput,
  isCityInput,
  isAddressLine2Input,
  isAddressLine1Input,
  isOtpInput,
  isPasswordInput,
  isConfirmPasswordInput,
  isGenericSearchInput,
}
