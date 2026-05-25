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
  isGenericSearchInput,
} from './forms/field-classifiers.js'
import { isPaymentContextInput, detectAuthFlow, getPendingOtp, getAuthContextText } from './forms/forms.js'
import { getInputSignals } from './dom.js'

const identityFieldKinds = new Set([
  'username',
  'email',
  'phone',
  'fullName',
  'firstName',
  'middleName',
  'lastName',
  'company',
  'jobTitle',
  'birthDate',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'country',
])

const strongAutocompleteExpression =
  /(username|email|given-name|additional-name|family-name|tel|street-address|address-line|address-level|postal-code|country|bday|organization)/
const fullNameAutocompleteExpression = /(^|\s)name($|\s)/
const nonAutofillFieldExpression =
  /(nickname|nick[\s_-]?name|display[\s_-]?name|alias|label|memo|note|comment|description|card[\s_-]?nickname)/
const resourceNamingContextExpression =
  /\b(rename|create|new|edit|update|add)\s+(an?\s+)?(app|application|project|workspace|team|organization|resource|site|deployment|service|bucket|database|repo|repository|environment|product|price|plan|subscription|item|sku|catalog|api[\s_-]*key|restricted[\s_-]*api[\s_-]*key)\b|\bname\s+of\s+the\s+(product|service|plan|subscription|item)\b/
const personNameMarkerExpression =
  /(full[\s_-]*name|your[\s_-]*name|legal[\s_-]*name|contact[\s_-]*name|customer[\s_-]*name|recipient[\s_-]*name)/
const relevantIdentityContextExpression =
  /(sign[\s-]?up|signup|register|create[\s-]?(your[\s-]?)?account|join|checkout|payment|billing|shipping|delivery|address|contact|profile|personal information|order|account details|account info)/
const relevantLoginContextExpression = /(sign[\s-]?in|log[\s-]?in|login|welcome back)/

const hasStrongIdentityAutocomplete = (input) => strongAutocompleteExpression.test(getInputSignals(input).autocomplete)

const isRelevantIdentityField = (input, fieldKind) => {
  if (!identityFieldKinds.has(fieldKind)) {
    return true
  }

  const { autocomplete, marker } = getInputSignals(input)
  if (nonAutofillFieldExpression.test(marker)) {
    return false
  }

  const context = getAuthContextText(input)
  if (fieldKind === 'fullName' && resourceNamingContextExpression.test(context) && !personNameMarkerExpression.test(marker)) {
    return false
  }

  const relevantContext =
    relevantIdentityContextExpression.test(context) ||
    ((fieldKind === 'username' || fieldKind === 'email') && relevantLoginContextExpression.test(context))
  if (fieldKind === 'fullName' && fullNameAutocompleteExpression.test(autocomplete)) {
    return personNameMarkerExpression.test(marker) || relevantContext
  }

  return hasStrongIdentityAutocomplete(input) || relevantContext
}

const fieldKindFor = (input) => {
  if (isGenericSearchInput(input)) {
    return undefined
  }

  if (isCardholderNameInput(input)) {
    return 'cardholderName'
  }

  if (isCardNumberInput(input)) {
    return 'cardNumber'
  }

  if (isCardExpiryInput(input)) {
    return 'cardExpiry'
  }

  if (isCardExpiryMonthInput(input)) {
    return 'cardExpiryMonth'
  }

  if (isCardExpiryYearInput(input)) {
    return 'cardExpiryYear'
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

  const fieldKind =
    isEmailInput(input) ? 'email'
    : isPhoneInput(input) ? 'phone'
    : isCountryInput(input) ? 'country'
    : isStateInput(input) ? 'state'
    : isPostalCodeInput(input) ? 'postalCode'
    : isCityInput(input) ? 'city'
    : isAddressLine2Input(input) ? 'addressLine2'
    : isAddressLine1Input(input) ? 'addressLine1'
    : isFirstNameInput(input) ? 'firstName'
    : isMiddleNameInput(input) ? 'middleName'
    : isLastNameInput(input) ? 'lastName'
    : isCompanyInput(input) ? 'company'
    : isJobTitleInput(input) ? 'jobTitle'
    : isBirthDateInput(input) ? 'birthDate'
    : isFullNameInput(input) ? 'fullName'
    : isUsernameInput(input) ? 'username'
    : undefined

  return fieldKind && isRelevantIdentityField(input, fieldKind) ? fieldKind : undefined
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
