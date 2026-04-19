import { getInputSignals, markerMatches, isTextLikeInput } from '../dom.js'

const isUsernameInput = (input) => {
  const { autocomplete, marker } = getInputSignals(input)
  return isTextLikeInput(input) && (autocomplete.includes('username') || autocomplete.includes('email') || /(user|email|login)/.test(marker))
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

const isFullNameInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  if (autocomplete.includes('given-name') || autocomplete.includes('family-name') || autocomplete.includes('additional-name')) {
    return false
  }
  if (isFirstNameInput(input) || isMiddleNameInput(input) || isLastNameInput(input)) {
    return false
  }
  return autocomplete === 'name' || markerMatches(input, /(full[\s_-]*name|your[\s_-]*name|\bname\b)/)
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

const isOtpInput = (input) => {
  const { autocomplete, marker } = getInputSignals(input)
  return (
    (autocomplete.includes('one-time-code') || /(otp|2fa|totp|one[-\s]?time|verification|authenticator|security code|auth code)/.test(marker)) &&
    !/\bemail\b/.test(marker)
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
}
