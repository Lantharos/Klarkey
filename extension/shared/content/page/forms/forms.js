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
import { sendMessage } from '../runtime.js'
import { browserSettings } from '../state.js'
import { clearTransientState, getTransientState, hydrateTransientState, setTransientState } from '../transient-state.js'

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
  const contextRoot = form || input.closest?.('[role="dialog"], [aria-modal="true"], main, section, article') || input.parentElement
  const formText = contextRoot?.innerText || contextRoot?.textContent || ''
  const formAction = form?.getAttribute('action') || ''
  const submitCopy = contextRoot
    ? Array.from(contextRoot.querySelectorAll('button, [role="button"], input[type="submit"]'))
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

const getSubmitContextText = (input) => {
  const form = pickForm(input)
  if (!form) {
    return ''
  }

  return Array.from(form.querySelectorAll('button, [role="button"], input[type="submit"]'))
    .map((node) => node.textContent || node.getAttribute('value') || '')
    .join(' ')
    .toLowerCase()
}

const registerSubmitExpression =
  /(register|sign[\s-]?up|signup|create[\s-]?(your[\s-]?)?account|join|start trial|start for free|get started|set password|save password|change password|reset password)/
const registerContextExpression =
  /(register|sign[\s-]?up|signup|create[\s-]?(your[\s-]?)?account|join|start trial|start for free|get started|already have an account)/
const strongRegisterContextExpression =
  /(confirm password|new password|create password|choose password|set password|repeat password|re[\s-]?enter password|retype password)/
const loginExpression = /(sign[\s-]?in|log[\s-]?in|login|current password|welcome back|forgot password)/

const hasRegisterSubmitSignals = (input) => registerSubmitExpression.test(getSubmitContextText(input))
const hasLoginSubmitSignals = (input) => loginExpression.test(getSubmitContextText(input))

const hasStrongRegisterSignals = (input) => {
  const context = getAuthContextText(input)
  const { passwordInputs } = getInputs(input)
  const hasNewPasswordAutocomplete = passwordInputs.some((candidate) =>
    (candidate.autocomplete || '').toLowerCase().includes('new-password'),
  )
  const hasMultiplePasswordFields = passwordInputs.length > 1
  const hasConfirmPasswordField = passwordInputs.some((candidate) => isConfirmPasswordInput(candidate))

  return (
    hasNewPasswordAutocomplete ||
    hasMultiplePasswordFields ||
    hasConfirmPasswordField ||
    strongRegisterContextExpression.test(context)
  )
}

const hasRegisterSignals = (input) => {
  const context = getAuthContextText(input)
  return hasStrongRegisterSignals(input) || registerContextExpression.test(context)
}

const hasLoginSignals = (input) =>
  loginExpression.test(getAuthContextText(input))

const detectAuthFlow = (input) => {
  if (isPaymentContextInput(input)) {
    return 'payment'
  }

  const hasStrongRegister = hasStrongRegisterSignals(input)
  const hasRegisterSubmit = hasRegisterSubmitSignals(input)
  const hasLoginSubmit = hasLoginSubmitSignals(input)
  const hasLogin = hasLoginSignals(input)

  if (hasStrongRegister || (hasRegisterSubmit && !hasLoginSubmit)) {
    return 'register'
  }

  if (hasLoginSubmit || hasLogin) {
    return 'login'
  }

  return hasRegisterSignals(input) ? 'register' : 'login'
}

const passwordGroups = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%^&*',
]
const passwordAlphabet = passwordGroups.join('')
const randomByte = new Uint8Array(1)

const randomIndex = (max) => {
  const limit = Math.floor(256 / max) * max
  let value
  do {
    crypto.getRandomValues(randomByte)
    value = randomByte[0]
  } while (value >= limit)
  return value % max
}

const randomChar = (alphabet) => alphabet[randomIndex(alphabet.length)]

const shufflePasswordChars = (chars) => {
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1)
    const current = chars[index]
    chars[index] = chars[swapIndex]
    chars[swapIndex] = current
  }
  return chars
}

const randomPassword = (length = 24) => {
  const resolvedLength = Math.max(passwordGroups.length, Math.min(Number.isFinite(length) ? Math.trunc(length) : 24, 128))
  const chars = passwordGroups.map(randomChar)
  while (chars.length < resolvedLength) {
    chars.push(randomChar(passwordAlphabet))
  }
  return shufflePasswordChars(chars).join('')
}

const getPendingUsername = () => getTransientState('pending-username', '')

const setPendingUsername = (username) => {
  if (username) {
    return setTransientState('pending-username', username)
  }

  return clearTransientState('pending-username')
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

const getPendingOtp = () => getTransientState('pending-otp', '')

const setPendingOtp = (otp) => {
  if (otp) {
    return setTransientState('pending-otp', otp, 90_000)
  }

  return clearTransientState('pending-otp')
}

const hydratePendingAuthState = () => Promise.all([hydrateTransientState('pending-username'), hydrateTransientState('pending-otp')])

void hydratePendingAuthState()

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
  hydratePendingAuthState,
  injectPageBridge,
  ensurePageBridgeReady,
  getPendingOtp,
  setPendingOtp,
  isPasswordInput,
}
