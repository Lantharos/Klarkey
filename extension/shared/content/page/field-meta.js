import { pageState } from './state.js'
import {
  isCardholderNameInput,
  isCardNumberInput,
  isCardExpiryMonthInput,
  isCardExpiryYearInput,
  isCardExpiryInput,
  isCardCvcInput,
  isCardBrandInput,
  isPasswordInput,
  isOtpInput,
  isEmailInput,
  isPhoneInput,
  isCountryInput,
  isStateInput,
  isPostalCodeInput,
  isCityInput,
  isAddressLine2Input,
  isAddressLine1Input,
  isFirstNameInput,
  isMiddleNameInput,
  isLastNameInput,
  isCompanyInput,
  isJobTitleInput,
  isBirthDateInput,
  isFullNameInput,
  isUsernameInput,
  isConfirmPasswordInput,
} from './forms/field-classifiers.js'
import { isPaymentContextInput, detectAuthFlow, getPendingOtp } from './forms/forms.js'

const fieldKindFor = (input) => {
  if (isCardholderNameInput(input)) {
    return 'cardholderName'
  }

  if (isCardNumberInput(input)) {
    return 'cardNumber'
  }

  if (isCardExpiryMonthInput(input)) {
    return 'cardExpiryMonth'
  }

  if (isCardExpiryYearInput(input)) {
    return 'cardExpiryYear'
  }

  if (isCardExpiryInput(input)) {
    return 'cardExpiry'
  }

  if (isCardCvcInput(input)) {
    return 'cardCvc'
  }

  if (isCardBrandInput(input)) {
    return 'cardBrand'
  }

  if (isPasswordInput(input)) {
    return 'password'
  }

  if (isOtpInput(input)) {
    return 'otp'
  }

  if (isEmailInput(input)) {
    return 'email'
  }

  if (isPhoneInput(input)) {
    return 'phone'
  }

  if (isCountryInput(input)) {
    return 'country'
  }

  if (isStateInput(input)) {
    return 'state'
  }

  if (isPostalCodeInput(input)) {
    return 'postalCode'
  }

  if (isCityInput(input)) {
    return 'city'
  }

  if (isAddressLine2Input(input)) {
    return 'addressLine2'
  }

  if (isAddressLine1Input(input)) {
    return 'addressLine1'
  }

  if (isFirstNameInput(input)) {
    return 'firstName'
  }

  if (isMiddleNameInput(input)) {
    return 'middleName'
  }

  if (isLastNameInput(input)) {
    return 'lastName'
  }

  if (isCompanyInput(input)) {
    return 'company'
  }

  if (isJobTitleInput(input)) {
    return 'jobTitle'
  }

  if (isBirthDateInput(input)) {
    return 'birthDate'
  }

  if (isFullNameInput(input)) {
    return 'fullName'
  }

  if (isUsernameInput(input)) {
    return 'username'
  }

  return undefined
}

const fieldLabelFor = (fieldKind) => {
  switch (fieldKind) {
    case 'cardholderName':
      return 'Name on card'
    case 'cardNumber':
      return 'Card number'
    case 'cardExpiry':
      return 'Expiration'
    case 'cardExpiryMonth':
      return 'Expiration month'
    case 'cardExpiryYear':
      return 'Expiration year'
    case 'cardCvc':
      return 'Security code'
    case 'cardBrand':
      return 'Card type'
    case 'password':
      return 'Password'
    case 'otp':
      return 'One-time code'
    case 'email':
      return 'Email'
    case 'phone':
      return 'Phone'
    case 'fullName':
      return 'Full name'
    case 'firstName':
      return 'First name'
    case 'middleName':
      return 'Middle name'
    case 'lastName':
      return 'Last name'
    case 'company':
      return 'Company'
    case 'jobTitle':
      return 'Job title'
    case 'birthDate':
      return 'Birthday'
    case 'addressLine1':
      return 'Address'
    case 'addressLine2':
      return 'Address line 2'
    case 'city':
      return 'City'
    case 'state':
      return 'State'
    case 'postalCode':
      return 'Postal code'
    case 'country':
      return 'Country'
    default:
      return 'Username'
  }
}

const inputModeFor = fieldKindFor
const suggestionFlowFor = (input, fieldKind) => {
  if (
    fieldKind &&
    ['cardholderName', 'cardNumber', 'cardExpiry', 'cardExpiryMonth', 'cardExpiryYear', 'cardCvc', 'cardBrand'].includes(fieldKind)
  ) {
    return 'payment'
  }

  if (fieldKind && ['postalCode', 'fullName', 'address', 'addressLine1', 'addressLine2', 'city', 'state', 'country'].includes(fieldKind) && isPaymentContextInput(input)) {
    return 'payment'
  }

  if (
    fieldKind &&
    [
      'fullName',
        'firstName',
        'middleName',
        'lastName',
        'company',
        'jobTitle',
        'birthDate',
        'phone',
      'address',
      'addressLine1',
      'addressLine2',
      'city',
      'state',
      'postalCode',
      'country',
    ].includes(fieldKind)
  ) {
    return 'register'
  }

  return detectAuthFlow(input)
}

const shouldOfferSuggestedPassword = (input) => {
  if (suggestionFlowFor(input, fieldKindFor(input)) !== 'register') {
    return false
  }

  if (isConfirmPasswordInput(input)) {
    return false
  }

  return !(input instanceof HTMLInputElement && input.value?.trim())
}

const shouldAutoOpenFieldMenu = (input) => {
  const fieldKind = fieldKindFor(input)
  const authFlow = suggestionFlowFor(input, fieldKind)

  if (fieldKind === 'password') {
    return shouldOfferSuggestedPassword(input) || (authFlow !== 'register' && pageState.matches.some((match) => match.hasPassword))
  }

  if (fieldKind === 'otp') {
    return Boolean(getPendingOtp())
  }

  return pageState.fieldSuggestions.length > 0
}


export { fieldKindFor, fieldLabelFor, inputModeFor, suggestionFlowFor, shouldOfferSuggestedPassword, shouldAutoOpenFieldMenu }
