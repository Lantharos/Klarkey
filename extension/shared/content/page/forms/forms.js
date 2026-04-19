import {
  visible,
  isEditableHost,
  isFieldElement,
  isTextLikeInput,
  queryAllDeep,
  getAssociatedForm,
  getDeepActiveElement,
  getInputSignals,
  markerMatches,
} from '../dom.js'
import {
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
  isFullNameInput,
  isFirstNameInput,
  isMiddleNameInput,
  isLastNameInput,
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
} from './field-classifiers.js'
import { pendingUsernameStorageKey, pendingOtpStorageKey } from '../state.js'
import { sendMessage } from '../runtime.js'
import { browserSettings } from '../state.js'

const pickForm = (preferredInput) => {
  const preferredForm = preferredInput && isFieldElement(preferredInput) ? getAssociatedForm(preferredInput) : undefined
  if (preferredForm) {
    return preferredForm
  }

  const activeElement = document.activeElement
  if (isFieldElement(activeElement)) {
    const activeForm = getAssociatedForm(activeElement)
    if (activeForm) {
      return activeForm
    }
  }

  return Array.from(document.forms).find((form) => getFillableFields(form).some((element) => element instanceof HTMLInputElement && isPasswordInput(element)))
}

const getFillableFields = (preferredInput) => {
  const root = preferredInput instanceof HTMLFormElement ? preferredInput : pickForm(preferredInput) || document
  return queryAllDeep(root, 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')
    .filter((field) => isFieldElement(field) && visible(field))
}

const getSplitOtpTargets = (preferredInput) => {
  const candidates = getFillableFields(preferredInput).filter(
    (field) =>
      field instanceof HTMLInputElement &&
      !isPasswordInput(field) &&
      (field.maxLength === 1 || field.size === 1 || field.inputMode === 'numeric' || field.pattern === '\\d*'),
  )

  const targeted = candidates.filter((field) => isOtpInput(field) || markerMatches(field, /(digit|token|code|verification)/))
  const pool = targeted.length >= 4 ? targeted : candidates
  return pool.length >= 4 && pool.length <= 8 ? pool.slice(0, 8) : []
}

const getInputs = (preferredInput) => {
  const form = pickForm(preferredInput)
  const fields = getFillableFields(preferredInput)
  const textFields = fields.filter((field) => isTextLikeInput(field))
  const inputs = fields.filter((field) => field instanceof HTMLInputElement)
  const passwordInputs = inputs.filter((input) => isPasswordInput(input))
  const preferredPassword =
    preferredInput instanceof HTMLInputElement && passwordInputs.includes(preferredInput) ? preferredInput : undefined
  const password =
    preferredPassword ||
    passwordInputs.find((input) => (input.autocomplete || '').toLowerCase().includes('current-password')) ||
    passwordInputs[0]
  const username = textFields.find((input) => isUsernameInput(input)) || textFields[0]
  const splitOtpTargets = getSplitOtpTargets(preferredInput)
  const otp = inputs.find((input) => isOtpInput(input)) || splitOtpTargets[0]

  return {
    form,
    username,
    password,
    passwordInputs,
    otp,
    splitOtpTargets,
  }
}

const formContainsPaymentField = (preferredInput) =>
  getFillableFields(preferredInput).some((field) =>
    [
      isCardholderNameInput,
      isCardNumberInput,
      isCardExpiryInput,
      isCardExpiryMonthInput,
      isCardExpiryYearInput,
      isCardCvcInput,
      isCardBrandInput,
    ].some((matcher) => matcher(field)),
  )

const isPaymentContextInput = (input) =>
  formContainsPaymentField(input) || /(checkout|payment|billing|cardholder|credit card|debit card|card number|cvv|cvc|expiration|expiry|valid thru)/.test(getAuthContextText(input))

const getAuthContextText = (input) => {
  const form = pickForm(input)
  const formText = form?.innerText || ''
  const formAction = form?.getAttribute('action') || ''
  const submitCopy = form
    ? Array.from(form.querySelectorAll('button, [role="button"], input[type="submit"]'))
        .map((node) => node.textContent || node.getAttribute('value') || '')
        .join(' ')
    : ''
  const { autocomplete, marker } = getInputSignals(input)

  return [
    window.location.pathname,
    window.location.href,
    document.title,
    formAction,
    autocomplete,
    marker,
    formText,
    submitCopy,
  ]
    .join(' ')
    .toLowerCase()
}

const hasRegisterSignals = (input) => {
  const context = getAuthContextText(input)
  const { passwordInputs } = getInputs(input)
  const hasNewPasswordAutocomplete = passwordInputs.some((candidate) =>
    (candidate.autocomplete || '').toLowerCase().includes('new-password'),
  )
  const hasMultiplePasswordFields = passwordInputs.length > 1

  return (
    hasNewPasswordAutocomplete ||
    hasMultiplePasswordFields ||
    /(register|sign[\s-]?up|signup|create[\s-]?account|create your account|create account|join|start trial|start for free|get started|continue\b|check your email|verify your email|confirm password|new password|already have an account)/.test(
      context,
    )
  )
}

const hasLoginSignals = (input) =>
  /(sign[\s-]?in|log[\s-]?in|login|current password|welcome back|forgot password|reset password)/.test(getAuthContextText(input))

const detectAuthFlow = (input) => {
  if (isPaymentContextInput(input)) {
    return 'payment'
  }

  if (hasRegisterSignals(input)) {
    return 'register'
  }

  if (hasLoginSignals(input)) {
    return 'login'
  }

  return 'login'
}

const randomPassword = (length = 20) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

const getPendingUsername = () => {
  try {
    return window.sessionStorage.getItem(pendingUsernameStorageKey) || ''
  } catch {
    return ''
  }
}

const setPendingUsername = (username) => {
  try {
    if (username) {
      window.sessionStorage.setItem(pendingUsernameStorageKey, username)
    } else {
      window.sessionStorage.removeItem(pendingUsernameStorageKey)
    }
  } catch {
    return
  }
}

const injectPageBridge = () => {
  if (!document.documentElement || document.documentElement.getAttribute('data-klarkey-bridge') === 'ready') {
    return
  }
}

const ensurePageBridgeReady = async () => {
  injectPageBridge()
  if (document.documentElement?.getAttribute('data-klarkey-bridge') === 'ready') {
    return
  }

  const start = Date.now()
  while (Date.now() - start < 4000) {
    if (document.documentElement?.getAttribute('data-klarkey-bridge') === 'ready') {
      return
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 8)
    })
  }
}

const getPendingOtp = () => {
  try {
    return window.sessionStorage.getItem(pendingOtpStorageKey) || ''
  } catch {
    return ''
  }
}

const setPendingOtp = (otp) => {
  try {
    if (otp) {
      window.sessionStorage.setItem(pendingOtpStorageKey, otp)
    } else {
      window.sessionStorage.removeItem(pendingOtpStorageKey)
    }
  } catch {
    return
  }
}

export {
  pickForm,
  getFillableFields,
  getSplitOtpTargets,
  getInputs,
  formContainsPaymentField,
  isPaymentContextInput,
  getAuthContextText,
  hasRegisterSignals,
  hasLoginSignals,
  detectAuthFlow,
  randomPassword,
  getPendingUsername,
  setPendingUsername,
  injectPageBridge,
  ensurePageBridgeReady,
  getPendingOtp,
  setPendingOtp,
  isPasswordInput,
}
