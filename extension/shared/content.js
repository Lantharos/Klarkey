const runtimeApi = globalThis.browser ?? globalThis.chrome
const runtime = runtimeApi?.runtime
let pageState = {
  url: window.location.href,
  title: document.title,
  matches: [],
  fieldSuggestions: [],
  lastListUrl: '',
  overlayInput: undefined,
  formSnapshot: undefined,
  activeMenuButtons: [],
  activeMenuIndex: -1,
  lastSavePromptKey: '',
  activeSaveBannerKey: '',
  triggerInput: undefined,
  triggerElement: undefined,
  menuElement: undefined,
  menuOpen: false,
  layoutFrame: undefined,
  suppressedAutofillField: undefined,
  suppressedAutofillForm: undefined,
  suppressedFieldAttributes: undefined,
  suppressedFormAttributes: undefined,
}

let matchFetchGeneration = 0
let savePromptTimer
let autoSubmitTimer
let browserSettings = {
  browserAutoOpenMenu: true,
  browserAutoSubmitLogin: true,
  browserSavePrompts: true,
}

const pendingUsernameStorageKey = `klarkey:pending-username:${window.location.hostname}`
const pendingOtpStorageKey = `klarkey:pending-otp:${window.location.hostname}`
const pendingSaveStorageKey = `klarkey:pending-save:${window.location.hostname}`
let suppressInlineMenuUntil = 0
let suppressedInlineInput

const overlayRoot = document.createElement('div')
const overlayStyle = document.createElement('style')
const stateCodeToName = {
  AL: 'alabama',
  AK: 'alaska',
  AZ: 'arizona',
  AR: 'arkansas',
  CA: 'california',
  CO: 'colorado',
  CT: 'connecticut',
  DE: 'delaware',
  FL: 'florida',
  GA: 'georgia',
  HI: 'hawaii',
  ID: 'idaho',
  IL: 'illinois',
  IN: 'indiana',
  IA: 'iowa',
  KS: 'kansas',
  KY: 'kentucky',
  LA: 'louisiana',
  ME: 'maine',
  MD: 'maryland',
  MA: 'massachusetts',
  MI: 'michigan',
  MN: 'minnesota',
  MS: 'mississippi',
  MO: 'missouri',
  MT: 'montana',
  NE: 'nebraska',
  NV: 'nevada',
  NH: 'newhampshire',
  NJ: 'newjersey',
  NM: 'newmexico',
  NY: 'newyork',
  NC: 'northcarolina',
  ND: 'northdakota',
  OH: 'ohio',
  OK: 'oklahoma',
  OR: 'oregon',
  PA: 'pennsylvania',
  RI: 'rhodeisland',
  SC: 'southcarolina',
  SD: 'southdakota',
  TN: 'tennessee',
  TX: 'texas',
  UT: 'utah',
  VT: 'vermont',
  VA: 'virginia',
  WA: 'washington',
  WV: 'westvirginia',
  WI: 'wisconsin',
  WY: 'wyoming',
  DC: 'districtofcolumbia',
}
const regionDisplayNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : undefined

overlayStyle.textContent = `
  .klarkey-inline-root {
    --klarkey-surface: rgba(17, 18, 20, 0.76);
    --klarkey-surface-strong: rgba(26, 28, 31, 0.9);
    --klarkey-border: rgba(255, 255, 255, 0.09);
    --klarkey-accent: #8ed0ff;
    --klarkey-text: rgba(255, 255, 255, 0.92);
    --klarkey-muted: rgba(255, 255, 255, 0.56);
    --klarkey-faint: rgba(255, 255, 255, 0.34);
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483646;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--klarkey-text);
    letter-spacing: 0.01em;
  }

  .klarkey-inline-menu {
    position: fixed;
    min-width: 296px;
    max-width: 380px;
    background: var(--klarkey-surface);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--klarkey-border);
    border-radius: 14px;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.2),
      0 28px 60px rgba(0, 0, 0, 0.46);
    overflow: hidden;
    pointer-events: auto;
  }

  .klarkey-inline-trigger {
    position: fixed;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    pointer-events: auto;
    transition: transform 120ms ease, opacity 120ms ease;
    opacity: 0.92;
  }

  .klarkey-inline-trigger:hover {
    opacity: 1;
    transform: scale(1.04);
  }

  .klarkey-inline-trigger:focus-visible {
    outline: 2px solid var(--klarkey-accent);
    outline-offset: 2px;
  }

  .klarkey-inline-trigger img {
    width: 20px;
    height: 20px;
    display: block;
    filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.28));
  }

  .klarkey-inline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--klarkey-border);
  }

  .klarkey-inline-brand {
    font-size: 12px;
    font-weight: 600;
    color: var(--klarkey-text);
  }

  .klarkey-inline-subtle {
    font-size: 12px;
    color: var(--klarkey-muted);
  }

  .klarkey-inline-list {
    display: flex;
    flex-direction: column;
  }

  .klarkey-inline-loading {
    padding: 14px;
    color: var(--klarkey-muted);
    font-size: 13px;
  }

  .klarkey-inline-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 52px;
    padding: 12px 14px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 100ms ease, color 100ms ease;
  }

  .klarkey-inline-item + .klarkey-inline-item {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .klarkey-inline-item.active,
  .klarkey-inline-action.active {
    background: rgba(255, 255, 255, 0.08);
  }

  .klarkey-inline-item:hover,
  .klarkey-inline-action:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .klarkey-inline-copy {
    min-width: 0;
  }

  .klarkey-inline-title {
    font-size: 14px;
    font-weight: 560;
    color: var(--klarkey-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .klarkey-inline-secondary {
    margin-top: 2px;
    color: var(--klarkey-muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .klarkey-inline-empty,
  .klarkey-inline-footer {
    padding: 14px;
    color: var(--klarkey-muted);
    font-size: 13px;
  }

  .klarkey-inline-actions {
    border-top: 1px solid var(--klarkey-border);
  }

  .klarkey-inline-action {
    width: 100%;
    padding: 12px 14px;
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.86);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    transition: background 100ms ease;
  }

  .klarkey-inline-action + .klarkey-inline-action {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .klarkey-save-banner {
    position: fixed;
    top: 16px;
    right: 16px;
    width: min(360px, calc(100vw - 32px));
    background: var(--klarkey-surface);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--klarkey-border);
    border-radius: 14px;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.24),
      0 28px 60px rgba(0, 0, 0, 0.48);
    padding: 14px 16px;
    pointer-events: auto;
    transform: translateX(0);
    transition: transform 180ms ease, opacity 180ms ease;
    animation: klarkey-slide-in 200ms ease;
  }

  .klarkey-save-banner.hidden {
    opacity: 0;
    transform: translateX(20px);
  }

  .klarkey-save-title {
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 6px;
    letter-spacing: -0.02em;
  }

  .klarkey-save-copy {
    margin: 0;
    color: var(--klarkey-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .klarkey-save-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }

  .klarkey-save-choice-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 12px;
  }

  .klarkey-save-choice {
    width: 100%;
    border: 1px solid var(--klarkey-border);
    border-radius: 12px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.04);
    color: var(--klarkey-text);
    cursor: pointer;
    text-align: left;
    transition: background 120ms ease, border-color 120ms ease;
  }

  .klarkey-save-choice:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .klarkey-save-choice-title {
    font-size: 13px;
    font-weight: 560;
  }

  .klarkey-save-choice-copy {
    margin-top: 2px;
    color: var(--klarkey-muted);
    font-size: 12px;
  }

  .klarkey-save-button {
    border: 1px solid var(--klarkey-border);
    border-radius: 999px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.88);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 120ms ease, border-color 120ms ease;
  }

  .klarkey-save-button:hover {
    background: rgba(255, 255, 255, 0.09);
  }

  .klarkey-save-button.primary {
    background: var(--klarkey-accent);
    border-color: rgba(142, 208, 255, 0.5);
    color: #0a0a0b;
  }

  .klarkey-save-button.primary:hover {
    background: #b5e4ff;
  }

  @keyframes klarkey-slide-in {
    from {
      opacity: 0;
      transform: translateX(16px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
`

overlayRoot.className = 'klarkey-inline-root'
document.documentElement.appendChild(overlayStyle)
document.documentElement.appendChild(overlayRoot)

const sendMessage = (message) =>
  !runtime
    ? Promise.reject(new Error('Klarkey extension runtime is unavailable in this context.'))
    : runtime.sendMessage.length === 1
      ? runtime.sendMessage(message)
      : new Promise((resolve, reject) => {
          runtime.sendMessage(message, (result) => {
            const error = globalThis.chrome?.runtime?.lastError
            if (error) {
              reject(new Error(error.message))
              return
            }

            resolve(result)
          })
        })

const visible = (element) => {
  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
}

const isEditableHost = (element) => element instanceof HTMLElement && element.isContentEditable && element.getAttribute('contenteditable') !== 'false'
const isFieldElement = (element) =>
  element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement || isEditableHost(element)
const isTextLikeInput = (input) =>
  input instanceof HTMLTextAreaElement ||
  isEditableHost(input) ||
  (input instanceof HTMLInputElement && ['text', 'email', 'search', 'tel', 'url', 'number'].includes(input.type))
const normalizeLookupToken = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const readFieldValue = (field) =>
  field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement
    ? field.value || ''
    : isEditableHost(field)
      ? field.textContent || ''
      : ''

const queryAllDeep = (root, selector) => {
  const visited = new Set()
  const results = []
  const queue = [root]

  while (queue.length) {
    const current = queue.shift()
    if (!(current instanceof Document || current instanceof ShadowRoot || current instanceof Element)) {
      continue
    }

    for (const match of Array.from(current.querySelectorAll(selector))) {
      if (!visited.has(match)) {
        visited.add(match)
        results.push(match)
      }
    }

    for (const element of Array.from(current.querySelectorAll('*'))) {
      if (element.shadowRoot) {
        queue.push(element.shadowRoot)
      }
    }
  }

  return results
}

const getAssociatedForm = (element) => {
  let current = element

  while (current instanceof Element) {
    if (current instanceof HTMLInputElement || current instanceof HTMLSelectElement || current instanceof HTMLTextAreaElement) {
      if (current.form) {
        return current.form
      }
    }

    const form = current.closest('form')
    if (form) {
      return form
    }

    const root = current.getRootNode()
    current = root instanceof ShadowRoot ? root.host : undefined
  }

  return undefined
}

const getDeepActiveElement = (root = document) => {
  let current = root.activeElement

  while (current?.shadowRoot?.activeElement) {
    current = current.shadowRoot.activeElement
  }

  return current
}
const getInputSignals = (input) => {
  const autocomplete =
    input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? (input.autocomplete || '').toLowerCase() : ''
  const labels = []
  if ('labels' in input && input.labels) {
    labels.push(...Array.from(input.labels).map((label) => label.textContent || ''))
  }

  const describedBy = (input.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent || '')

  const marker = [
    input.name || '',
    input.id || '',
    input.placeholder || '',
    input.getAttribute('aria-label') || '',
    input.getAttribute('aria-labelledby') || '',
    input.getAttribute('data-testid') || '',
    input.getAttribute('data-qa') || '',
    input.getAttribute('role') || '',
    ...labels,
    ...describedBy,
  ]
    .join(' ')
    .toLowerCase()

  return {
    autocomplete,
    marker,
  }
}

const markerMatches = (input, expression) => expression.test(getInputSignals(input).marker)
const suppressInlineMenu = (input) => {
  suppressedInlineInput = input
  suppressInlineMenuUntil = Date.now() + 900
}

const stopInlineLayoutTracking = () => {
  if (pageState.layoutFrame === undefined) {
    return
  }

  window.cancelAnimationFrame(pageState.layoutFrame)
  pageState.layoutFrame = undefined
}

const loadBrowserSettings = async () => {
  const response = await sendMessage({ type: 'get-browser-settings' }).catch(() => undefined)
  if (response?.ok && response.settings) {
    browserSettings = {
      ...browserSettings,
      ...response.settings,
    }
  }

  return browserSettings
}

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

const isPhoneInput = (input) => {
  const { autocomplete } = getInputSignals(input)
  return autocomplete.includes('tel') || markerMatches(input, /(phone|mobile|tel)/)
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
  return autocomplete.includes('street-address') || autocomplete.includes('address-line1') || markerMatches(input, /(street address|address line 1|address|street|line1)/)
}

const isOtpInput = (input) => {
  const { autocomplete, marker } = getInputSignals(input)
  return (autocomplete.includes('one-time-code') || /(otp|2fa|totp|one[-\s]?time|verification|authenticator|security code|auth code)/.test(marker)) && !/\bemail\b/.test(marker)
}

const isPasswordInput = (input) => {
  const { autocomplete, marker } = getInputSignals(input)
  return input instanceof HTMLInputElement && (input.type === 'password' || autocomplete.includes('current-password') || autocomplete.includes('new-password') || /(pass|secret)/.test(marker))
}

const isConfirmPasswordInput = (input) => markerMatches(input, /(confirm|repeat|verify|re-enter)/)

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

const getPendingSavePrompt = () => {
  try {
    const raw = window.sessionStorage.getItem(pendingSaveStorageKey)
    if (!raw) {
      return undefined
    }

    const parsed = JSON.parse(raw)
    if (!parsed?.password || !parsed?.createdAt || Date.now() - parsed.createdAt > 30_000) {
      window.sessionStorage.removeItem(pendingSaveStorageKey)
      return undefined
    }

    return parsed
  } catch {
    return undefined
  }
}

const setPendingSavePrompt = (payload) => {
  try {
    window.sessionStorage.setItem(
      pendingSaveStorageKey,
      JSON.stringify({
        ...payload,
        createdAt: Date.now(),
      }),
    )
  } catch {
    return
  }
}

const clearPendingSavePrompt = () => {
  try {
    window.sessionStorage.removeItem(pendingSaveStorageKey)
  } catch {
    return
  }
}

const savePromptKeyFor = ({ username, password }) => `${window.location.hostname}|${username || ''}|${password || ''}`
const passkeyPromptKeyFor = (...parts) => `${window.location.hostname}|${parts.filter(Boolean).join('|')}`
const readAttributeSnapshot = (element, names) =>
  Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]))

const restoreAttributeSnapshot = (element, snapshot) => {
  if (!element || !snapshot) {
    return
  }

  for (const [name, value] of Object.entries(snapshot)) {
    if (value === null || value === undefined) {
      element.removeAttribute(name)
    } else {
      element.setAttribute(name, value)
    }
  }
}

const clearBrowserAutofillSuppression = () => {
  restoreAttributeSnapshot(pageState.suppressedAutofillField, pageState.suppressedFieldAttributes)
  restoreAttributeSnapshot(pageState.suppressedAutofillForm, pageState.suppressedFormAttributes)
  pageState.suppressedAutofillField = undefined
  pageState.suppressedAutofillForm = undefined
  pageState.suppressedFieldAttributes = undefined
  pageState.suppressedFormAttributes = undefined
}

const suppressBrowserAutofill = (input) => {
  clearBrowserAutofillSuppression()

  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) {
    return
  }

  pageState.suppressedAutofillField = input
  pageState.suppressedFieldAttributes = readAttributeSnapshot(input, [
    'autocomplete',
    'autocapitalize',
    'autocorrect',
    'spellcheck',
    'data-lpignore',
    'data-1p-ignore',
  ])

  input.setAttribute('autocomplete', 'off')
  input.setAttribute('autocapitalize', 'off')
  input.setAttribute('autocorrect', 'off')
  input.setAttribute('spellcheck', 'false')
  input.setAttribute('data-lpignore', 'true')
  input.setAttribute('data-1p-ignore', 'true')

  const form = getAssociatedForm(input)
  if (!form) {
    return
  }

  pageState.suppressedAutofillForm = form
  pageState.suppressedFormAttributes = readAttributeSnapshot(form, ['autocomplete'])
  form.setAttribute('autocomplete', 'off')
}

const setNativeFieldValue = (field, value) => {
  if (field instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter ? setter.call(field, value) : (field.value = value)
    return
  }

  if (field instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter ? setter.call(field, value) : (field.value = value)
    return
  }

  if (field instanceof HTMLSelectElement) {
    field.value = value
    return
  }

  if (isEditableHost(field)) {
    field.textContent = value
  }
}

const dispatchFieldEvents = (field, value) => {
  try {
    field.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        composed: true,
        cancelable: true,
        data: value,
        inputType: 'insertText',
      }),
    )
  } catch {
    void value
  }

  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  field.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

const resolveSelectValue = (input, value) => {
  const rawValue = String(value || '').trim()
  if (!rawValue) {
    return undefined
  }

  const normalizedValue = normalizeLookupToken(rawValue)
  const monthNumber = Number.parseInt(rawValue, 10)
  const paddedMonth = Number.isFinite(monthNumber) ? String(monthNumber).padStart(2, '0') : ''
  const fullYear = /\d{4}/.test(rawValue) ? rawValue.match(/\d{4}/)?.[0] : undefined
  const shortYear = fullYear ? fullYear.slice(-2) : rawValue.length === 2 ? rawValue : undefined

  const fieldKind = fieldKindFor(input)
  const stateAlias =
    fieldKind === 'state'
      ? rawValue.length === 2
        ? stateCodeToName[rawValue.toUpperCase()]
        : Object.entries(stateCodeToName).find(([, name]) => name === normalizedValue)?.[0]?.toLowerCase()
      : undefined

  const exactMatch = Array.from(input.options).find((option) => {
    const optionValue = option.value.trim().toLowerCase()
    const optionLabel = option.textContent?.trim().toLowerCase() || ''
    return optionValue === rawValue.toLowerCase() || optionLabel === rawValue.toLowerCase()
  })

  if (exactMatch) {
    return exactMatch.value
  }

  const fuzzyMatch = Array.from(input.options).find((option) => {
    const optionTokens = [option.value, option.textContent || ''].map(normalizeLookupToken).filter(Boolean)
    if (!optionTokens.length) {
      return false
    }

    if (optionTokens.some((token) => token === normalizedValue || token.includes(normalizedValue) || normalizedValue.includes(token))) {
      return true
    }

    if (stateAlias && optionTokens.some((token) => token === stateAlias || token === normalizeLookupToken(stateAlias))) {
      return true
    }

    if (paddedMonth && optionTokens.some((token) => token.startsWith(paddedMonth) || token === String(monthNumber))) {
      return true
    }

    if (fullYear && optionTokens.some((token) => token.endsWith(fullYear) || (shortYear && token.endsWith(shortYear)))) {
      return true
    }

    if (shortYear && optionTokens.some((token) => token === shortYear || token.endsWith(shortYear))) {
      return true
    }

    if (fieldKind === 'country' && regionDisplayNames) {
      const regionName = option.value.trim().length === 2 ? regionDisplayNames.of(option.value.trim().toUpperCase()) : undefined
      if (normalizeLookupToken(regionName) === normalizedValue) {
        return true
      }
    }

    return false
  })

  return fuzzyMatch?.value
}

const writeValue = (input, value) => {
  if (!input || value === undefined || value === null) {
    return
  }

  input.focus()
  if (input instanceof HTMLSelectElement) {
    setNativeFieldValue(input, resolveSelectValue(input, value) || value)
  } else {
    setNativeFieldValue(input, value)
  }
  dispatchFieldEvents(input, String(value))
}

const writePasswordGroup = (preferredInput, value) => {
  const inputs = getInputs(preferredInput)
  const targets = inputs.passwordInputs.length ? inputs.passwordInputs : inputs.password ? [inputs.password] : []
  for (const target of targets) {
    writeValue(target, value)
  }
}

const writeSplitOtp = (targets, value) => {
  const digits = String(value || '').trim().split('')
  for (const [index, target] of targets.entries()) {
    writeValue(target, digits[index] || '')
  }
}

const isSatisfiedField = (field) => {
  if (field.disabled || !visible(field)) {
    return true
  }

  if (field instanceof HTMLInputElement) {
    if (['hidden', 'button', 'submit', 'reset', 'image'].includes(field.type)) {
      return true
    }

    if (field.type === 'checkbox' || field.type === 'radio') {
      return field.checked
    }

    if (field.type === 'file') {
      return Boolean(field.files?.length)
    }

    return Boolean(field.value?.trim())
  }

  if (field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
    return Boolean(field.value?.trim())
  }

  if (isEditableHost(field)) {
    return Boolean((field.textContent || '').trim())
  }

  return true
}

const hasVisibleCaptcha = (form) => {
  const root = form || document
  return Array.from(
    root.querySelectorAll(`
      iframe[src*="recaptcha"],
      iframe[src*="hcaptcha"],
      iframe[src*="turnstile"],
      .g-recaptcha,
      .h-captcha,
      [data-sitekey],
      [name="cf-turnstile-response"],
      [name="g-recaptcha-response"],
      [name="h-captcha-response"],
      [id*="captcha"],
      [name*="captcha"]
    `),
  ).some((element) => element instanceof HTMLElement && visible(element))
}

const findSubmitter = (form) =>
  Array.from(form.querySelectorAll('button, input[type="submit"], input[type="image"], [role="button"]')).find((element) => {
    if (!(element instanceof HTMLElement) || !visible(element) || element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
      return false
    }

    if (element instanceof HTMLButtonElement) {
      return element.type !== 'button'
    }

    if (element instanceof HTMLInputElement) {
      return element.type === 'submit' || element.type === 'image'
    }

    return true
  })

const canAutoSubmitLogin = (preferredInput) => {
  if (!browserSettings.browserAutoSubmitLogin || !preferredInput || detectAuthFlow(preferredInput) !== 'login') {
    return false
  }

  const inputs = getInputs(preferredInput)
  if (!inputs.form || hasVisibleCaptcha(inputs.form)) {
    return false
  }

  if (!readFieldValue(inputs.username).trim() || !readFieldValue(inputs.password).trim()) {
    return false
  }

  if (inputs.splitOtpTargets?.length && inputs.splitOtpTargets.some((field) => !readFieldValue(field).trim())) {
    return false
  }

  if (inputs.otp && visible(inputs.otp) && !readFieldValue(inputs.otp).trim()) {
    return false
  }

  const requiredFields = Array.from(inputs.form.querySelectorAll('input, select, textarea')).filter(
    (field) =>
      (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) &&
      (field.required || field.getAttribute('aria-required') === 'true'),
  )

  return requiredFields.every((field) => isSatisfiedField(field))
}

const scheduleLoginAutoSubmit = (preferredInput) => {
  window.clearTimeout(autoSubmitTimer)
  if (!canAutoSubmitLogin(preferredInput)) {
    return
  }

  autoSubmitTimer = window.setTimeout(() => {
    if (!canAutoSubmitLogin(preferredInput)) {
      return
    }

    const { form } = getInputs(preferredInput)
    if (!form) {
      return
    }

    const submitter = findSubmitter(form)
    if (typeof form.requestSubmit === 'function') {
      submitter ? form.requestSubmit(submitter) : form.requestSubmit()
      return
    }

    if (submitter instanceof HTMLElement) {
      submitter.click()
    }
  }, 120)
}

const collectFormSnapshot = (preferredInput) => {
  const inputs = getInputs(preferredInput)
  const directUsername = readFieldValue(inputs.username).trim()
  const directPassword =
    preferredInput instanceof HTMLInputElement && isPasswordInput(preferredInput) ? preferredInput.value?.trim() || '' : ''
  return {
    username: directUsername || getPendingUsername(),
    password: directPassword || inputs.password?.value?.trim() || '',
  }
}

const removeInlineUi = () => {
  stopInlineLayoutTracking()
  clearBrowserAutofillSuppression()
  overlayRoot.innerHTML = ''
  pageState.activeMenuButtons = []
  pageState.activeMenuIndex = -1
  pageState.activeSaveBannerKey = ''
  pageState.triggerElement = undefined
  pageState.menuElement = undefined
  pageState.menuOpen = false
}

const setActiveMenuIndex = (index) => {
  pageState.activeMenuIndex = index
  pageState.activeMenuButtons.forEach((button, buttonIndex) => {
    button.classList.toggle('active', buttonIndex === index)
  })
}

const moveActiveMenuIndex = (delta) => {
  if (!pageState.activeMenuButtons.length) {
    return
  }

  const nextIndex =
    pageState.activeMenuIndex === -1
      ? 0
      : (pageState.activeMenuIndex + delta + pageState.activeMenuButtons.length) % pageState.activeMenuButtons.length
  setActiveMenuIndex(nextIndex)
}

const showSaveBanner = ({ username, password, reason }) => {
  if (!browserSettings.browserSavePrompts) {
    return
  }

  const promptKey = savePromptKeyFor({ username, password })
  if (pageState.activeSaveBannerKey === promptKey) {
    return
  }

  removeInlineUi()
  pageState.activeSaveBannerKey = promptKey
  const banner = document.createElement('section')
  banner.className = 'klarkey-save-banner'
  banner.innerHTML = `
    <div class="klarkey-save-title">${reason === 'update' ? 'Update login in Klarkey?' : 'Save login in Klarkey?'}</div>
    <p class="klarkey-save-copy">${
      reason === 'update'
        ? `${username || 'This account'} looks updated on ${window.location.hostname}.`
        : `${username || 'This account'} was used on ${window.location.hostname}.`
    }</p>
    <div class="klarkey-save-actions">
      <button class="klarkey-save-button primary" data-action="save">${reason === 'update' ? 'Update' : 'Save'}</button>
      <button class="klarkey-save-button" data-action="dismiss">Dismiss</button>
    </div>
  `

  const dismiss = () => {
    window.clearTimeout(savePromptTimer)
    pageState.lastSavePromptKey = promptKey
    pageState.activeSaveBannerKey = ''
    banner.classList.add('hidden')
    window.setTimeout(() => {
      if (banner.isConnected) {
        banner.remove()
      }
    }, 160)
  }

  banner.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const response = await sendMessage({
      type: 'save-login-payload',
      payload: {
        url: window.location.href,
        title: document.title,
        username,
        password,
      },
    }).catch((error) => ({
      ok: false,
      message: error instanceof Error ? error.message : 'Klarkey could not save this login.',
    }))

    banner.querySelector('.klarkey-save-copy').textContent = response.message || 'Saved.'
    if (response.ok) {
      pageState.matches = []
      pageState.lastSavePromptKey = promptKey
      setPendingUsername(username || '')
      clearPendingSavePrompt()
    }
    dismiss()
  })

  banner.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
    clearPendingSavePrompt()
    dismiss()
  })
  overlayRoot.appendChild(banner)
}

const presentPasskeyBanner = ({ promptKey, title, copy, choices, dismissLabel = 'Cancel' }) =>
  new Promise((resolve) => {
    removeInlineUi()
    pageState.activeSaveBannerKey = promptKey
    const banner = document.createElement('section')
    banner.className = 'klarkey-save-banner'
    banner.innerHTML = `
      <div class="klarkey-save-title">${title}</div>
      <p class="klarkey-save-copy">${copy}</p>
      <div class="klarkey-save-choice-list"></div>
      <div class="klarkey-save-actions">
        <button class="klarkey-save-button" data-action="dismiss">${dismissLabel}</button>
      </div>
    `

    const choiceList = banner.querySelector('.klarkey-save-choice-list')
    const dismiss = (value) => {
      pageState.activeSaveBannerKey = ''
      banner.classList.add('hidden')
      window.setTimeout(() => {
        if (banner.isConnected) {
          banner.remove()
        }
        resolve(value)
      }, 160)
    }

    for (const choice of choices) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'klarkey-save-choice'
      button.innerHTML = `
        <div class="klarkey-save-choice-title">${choice.title}</div>
        <div class="klarkey-save-choice-copy">${choice.copy}</div>
      `
      button.addEventListener('click', () => dismiss(choice.value))
      choiceList.appendChild(button)
    }

    banner.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
      dismiss(undefined)
    })

    overlayRoot.appendChild(banner)
  })

const promptPasskeyCreateChoice = async ({ rpId, userName, itemName, suggestedMatch }) => {
  const existingItemId = suggestedMatch?.itemId
  const existingLabel = suggestedMatch?.itemName
  const promptKey = passkeyPromptKeyFor('passkey-create', rpId, userName, existingItemId)
  const choices = [
    existingItemId && existingLabel
      ? {
          value: { itemId: existingItemId, createNew: false },
          title: `Save to ${existingLabel}`,
          copy: `${userName || itemName || 'This passkey'} will be linked to that existing login.`,
        }
      : {
          value: { itemId: undefined, createNew: true },
          title: 'Save as new item',
          copy: `${userName || itemName || 'This passkey'} will create a fresh login in Klarkey.`,
        },
    existingItemId
      ? {
          value: { itemId: undefined, createNew: true },
          title: 'Save as new item',
          copy: `${userName || itemName || 'This passkey'} will stay separate from your existing login.`,
        }
      : undefined,
  ].filter(Boolean)

  if (choices.length <= 1) {
    return choices[0]?.value
  }

  return presentPasskeyBanner({
    promptKey,
    title: 'Save passkey in Klarkey?',
    copy:
      existingItemId && existingLabel
        ? `${userName || 'This account'} matches ${existingLabel} on ${window.location.hostname}.`
        : `${userName || itemName || 'This account'} can be saved in Klarkey for ${window.location.hostname}.`,
    choices,
  })
}

const promptPasskeyGetChoice = async (choices) => {
  if (choices.length <= 1) {
    return choices[0]?.credentialId
  }

  return presentPasskeyBanner({
    promptKey: passkeyPromptKeyFor('passkey-get', window.location.pathname, choices.map((choice) => choice.credentialId).join(',')),
    title: 'Choose a passkey',
    copy: `Klarkey found multiple passkeys for ${window.location.hostname}.`,
    choices: choices.map((choice) => ({
      value: choice.credentialId,
      title: choice.itemName,
      copy: choice.userName || 'Passkey ready',
    })),
  })
}

const finalizePreparedPasskeySave = ({ pendingPasskeyId, requestDetailsJson, plan }) => {
  if (!pendingPasskeyId) {
    return
  }

  window.setTimeout(async () => {
    const selection = browserSettings.browserSavePrompts
      ? await promptPasskeyCreateChoice(plan)
      : { itemId: plan.suggestedMatch?.itemId, createNew: !plan.suggestedMatch?.itemId }

    if (!selection) {
      await sendMessage({
        type: 'discard-passkey-credential',
        payload: {
          pendingPasskeyId,
        },
      }).catch(() => undefined)
      return
    }

    await sendMessage({
      type: 'save-passkey-credential',
      payload: {
        url: window.location.href,
        title: document.title,
        requestDetailsJson,
        pendingPasskeyId,
        itemId: selection.itemId,
        createNew: selection.createNew,
      },
    }).catch(() => undefined)
  }, 0)
}

const openMenuFromTrigger = (input) => {
  const generation = ++matchFetchGeneration
  pageState.overlayInput = input
  const fieldKind = fieldKindFor(input)
  const authFlow = suggestionFlowFor(input, fieldKind)
  renderInlineMenu(input, pageState.matches, { loading: true })
  void Promise.all([
    refreshMatches(),
    fieldKind === 'password' || fieldKind === 'otp' || !fieldKind ? Promise.resolve([]) : refreshFieldSuggestions(fieldKind, authFlow),
  ]).then(() => {
    if (generation !== matchFetchGeneration || pageState.overlayInput !== input) {
      return
    }

    renderInlineMenu(input, pageState.matches, { loading: false })
  })
}

const renderInlineTrigger = (input, onOpen) => {
  const rect = input.getBoundingClientRect()
  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'klarkey-inline-trigger'
  trigger.setAttribute('aria-label', 'Open Klarkey')
  trigger.style.top = `${Math.max(8, rect.top + (rect.height - 24) / 2)}px`
  trigger.style.left = `${Math.max(8, Math.min(rect.right - 28, window.innerWidth - 32))}px`
  trigger.innerHTML = `<img alt="Klarkey" src="${runtime.getURL('icons/klarkey-128.png')}" />`
  trigger.addEventListener('mousedown', (event) => {
    event.preventDefault()
  })
  trigger.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    pageState.overlayInput = input
    onOpen()
  })
  overlayRoot.appendChild(trigger)
  pageState.triggerInput = input
  pageState.triggerElement = trigger
}

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

const renderInlineMenu = (input, matches, options = {}) => {
  void matches
  return renderFieldMenu(input, options)
  const { loading = false } = options
  removeInlineUi()
  renderInlineTrigger(input, () => openMenuFromTrigger(input))
  pageState.menuOpen = true

  const rect = input.getBoundingClientRect()
  const menu = document.createElement('section')
  menu.className = 'klarkey-inline-menu'
  menu.setAttribute('role', 'menu')
  const estimatedHeight = 300
  const prefersAbove = rect.bottom + estimatedHeight > window.innerHeight - 16 && rect.top > estimatedHeight
  const top = prefersAbove ? Math.max(12, rect.top - estimatedHeight - 8) : Math.min(window.innerHeight - 24, rect.bottom + 8)
  menu.style.top = `${top}px`
  menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 392))}px`

  const showGenerator = isPasswordInput(input)
  const inputMode = inputModeFor(input)
  menu.innerHTML = `
    <div class="klarkey-inline-header">
      <div class="klarkey-inline-brand">Klarkey</div>
      <div class="klarkey-inline-subtle">${inputMode === 'password' ? 'Password' : 'Username'}</div>
    </div>
    <div class="klarkey-inline-list"></div>
    <div class="klarkey-inline-actions"></div>
  `

  const list = menu.querySelector('.klarkey-inline-list')
  const actions = menu.querySelector('.klarkey-inline-actions')

  if (loading) {
    const loadingEl = document.createElement('div')
    loadingEl.className = 'klarkey-inline-loading'
    loadingEl.textContent = 'Loading vault matches…'
    list.appendChild(loadingEl)
  } else if (!matches.length) {
    const empty = document.createElement('div')
    empty.className = 'klarkey-inline-empty'
    empty.textContent = 'No matching items for this site.'
    list.appendChild(empty)
  } else {
    for (const match of matches.slice(0, 4)) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'klarkey-inline-item'
      const titleEl = document.createElement('div')
      titleEl.className = 'klarkey-inline-title'
      titleEl.textContent = match.itemName
      const subtitleEl = document.createElement('div')
      subtitleEl.className = 'klarkey-inline-subtle'
      subtitleEl.textContent = match.username || 'No username'
      const meta = document.createElement('div')
      meta.className = 'klarkey-inline-meta'
      item.appendChild(titleEl)
      item.appendChild(subtitleEl)
      item.appendChild(meta)
      if (match.hasOtp) {
        const token = document.createElement('span')
        token.className = 'klarkey-inline-token'
        token.textContent = 'OTP'
        meta.appendChild(token)
      }
      if (match.hasPasskey) {
        const token = document.createElement('span')
        token.className = 'klarkey-inline-token'
        token.textContent = 'Passkey'
        meta.appendChild(token)
      }

      item.addEventListener('click', async () => {
        const response = await sendMessage({ type: 'fetch-login', itemId: match.itemId }).catch((error) => ({
          ok: false,
          message: error instanceof Error ? error.message : 'Klarkey could not load this login.',
        }))

        if (!response.ok || !response.login) {
          return
        }

        const inputs = getInputs(input)
        if (inputMode === 'username') {
          writeValue(inputs.username, response.login.username)
          setPendingUsername(response.login.username || '')
        } else {
          writeValue(inputs.username, response.login.username)
          writeValue(inputs.password, response.login.password)
          writeValue(inputs.otp, response.login.otp)
          setPendingUsername(response.login.username || '')
        }
        removeInlineUi()
      })

      list.appendChild(item)
      pageState.activeMenuButtons.push(item)
    }
  }

  const saveAction = document.createElement('button')
  saveAction.type = 'button'
  saveAction.className = 'klarkey-inline-action'
  saveAction.textContent = inputMode === 'password' ? 'Save current login' : 'Save account for this site'
  saveAction.disabled = loading
  saveAction.addEventListener('click', async () => {
    const snapshot = collectFormSnapshot(input)
    if (!snapshot.password && inputMode === 'password') {
      return
    }

    const response = await sendMessage({
      type: 'save-login-payload',
      payload: {
        url: window.location.href,
        title: document.title,
        username: snapshot.username,
        password: snapshot.password,
      },
    }).catch(() => ({ ok: false, message: 'Could not save.' }))

    if (response?.ok) {
      pageState.matches = []
      pageState.lastSavePromptKey = `${window.location.hostname}|${snapshot.username}|${snapshot.password}`
      setPendingUsername(snapshot.username || '')
    }

    removeInlineUi()
  })
  actions.appendChild(saveAction)
  pageState.activeMenuButtons.push(saveAction)

  if (showGenerator) {
    const generator = document.createElement('button')
    generator.type = 'button'
    generator.className = 'klarkey-inline-action'
    generator.textContent = 'Generate password'
    generator.disabled = loading
    generator.addEventListener('click', () => {
      const generated = randomPassword()
      const inputs = getInputs(input)
      writeValue(inputs.password, generated)
      showSaveBanner({
        username: inputs.username?.value?.trim() || '',
        password: generated,
        reason: 'create',
      })
    })
    actions.appendChild(generator)
    pageState.activeMenuButtons.push(generator)
  }

  if (inputMode === 'username') {
    const carryForward = document.createElement('button')
    carryForward.type = 'button'
    carryForward.className = 'klarkey-inline-action'
    carryForward.textContent = 'Use this account on the next step'
    carryForward.disabled = loading
    carryForward.addEventListener('click', () => {
      const snapshot = collectFormSnapshot(input)
      if (snapshot.username) {
        setPendingUsername(snapshot.username)
      }
      removeInlineUi()
    })
    actions.appendChild(carryForward)
    pageState.activeMenuButtons.push(carryForward)
  }

  overlayRoot.appendChild(menu)
  setActiveMenuIndex(pageState.activeMenuButtons.length ? 0 : -1)
}

const renderInlineTriggerOnly = (input) => {
  removeInlineUi()
  renderInlineTrigger(input, () => openMenuFromTrigger(input))
  startInlineLayoutTracking()
}

const positionInlineMenu = (menu, input) => {
  const rect = input.getBoundingClientRect()
  const menuRect = menu.getBoundingClientRect()
  const menuHeight = menuRect.height || menu.offsetHeight || 0
  const menuWidth = menuRect.width || menu.offsetWidth || 0
  const spaceBelow = window.innerHeight - rect.bottom - 16
  const spaceAbove = rect.top - 16
  const prefersAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow
  const top = prefersAbove
    ? Math.max(12, rect.top - menuHeight - 8)
    : Math.min(window.innerHeight - menuHeight - 12, rect.bottom + 8)
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12))

  menu.style.top = `${top}px`
  menu.style.left = `${left}px`
  menu.style.visibility = 'visible'
}

const positionInlineTrigger = (trigger, input) => {
  const rect = input.getBoundingClientRect()
  trigger.style.top = `${Math.max(8, rect.top + (rect.height - 24) / 2)}px`
  trigger.style.left = `${Math.max(8, Math.min(rect.right - 28, window.innerWidth - 32))}px`
}

const syncInlineUiPosition = () => {
  if (!isFieldElement(pageState.overlayInput) || !visible(pageState.overlayInput)) {
    removeInlineUi()
    return
  }

  if (pageState.triggerElement?.isConnected) {
    positionInlineTrigger(pageState.triggerElement, pageState.overlayInput)
  }

  if (pageState.menuElement?.isConnected && pageState.menuOpen) {
    positionInlineMenu(pageState.menuElement, pageState.overlayInput)
  }
}

const startInlineLayoutTracking = () => {
  stopInlineLayoutTracking()

  const tick = () => {
    syncInlineUiPosition()
    if (!pageState.triggerElement?.isConnected && !pageState.menuElement?.isConnected) {
      stopInlineLayoutTracking()
      return
    }

    pageState.layoutFrame = window.requestAnimationFrame(tick)
  }

  pageState.layoutFrame = window.requestAnimationFrame(tick)
}

const appendFieldMenuButton = ({ container, title, secondary, onClick }) => {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'klarkey-inline-item'

  const copy = document.createElement('div')
  copy.className = 'klarkey-inline-copy'

  const titleEl = document.createElement('div')
  titleEl.className = 'klarkey-inline-title'
  titleEl.textContent = title
  copy.appendChild(titleEl)

  if (secondary) {
    const secondaryEl = document.createElement('div')
    secondaryEl.className = 'klarkey-inline-secondary'
    secondaryEl.textContent = secondary
    copy.appendChild(secondaryEl)
  }

  item.appendChild(copy)

  item.addEventListener('click', onClick)
  container.appendChild(item)
  pageState.activeMenuButtons.push(item)
}

const applyLoginFill = (input, login) => {
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
const findFieldByKind = (preferredInput, kind) =>
  getFillableFields(preferredInput).find((field) => fieldKindFor(field) === kind)

const applyIdentityFill = (input, identity) => {
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

const applyCardFill = (input, card) => {
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

const renderFieldMenu = (input, options = {}) => {
  const { loading = false } = options
  removeInlineUi()
  renderInlineTrigger(input, () => openMenuFromTrigger(input))
  pageState.menuOpen = true

  const menu = document.createElement('section')
  menu.className = 'klarkey-inline-menu'
  menu.setAttribute('role', 'menu')
  menu.style.visibility = 'hidden'

  const fieldKind = fieldKindFor(input)
  const authFlow = suggestionFlowFor(input, fieldKind)
  menu.innerHTML = `
    <div class="klarkey-inline-header">
      <div class="klarkey-inline-brand">Klarkey</div>
      <div class="klarkey-inline-subtle">${fieldLabelFor(fieldKind)}</div>
    </div>
    <div class="klarkey-inline-list"></div>
    <div class="klarkey-inline-actions"></div>
  `

  const list = menu.querySelector('.klarkey-inline-list')

  if (loading) {
    const loadingEl = document.createElement('div')
    loadingEl.className = 'klarkey-inline-loading'
    loadingEl.textContent = 'Loading suggestions...'
    list.appendChild(loadingEl)
  } else if (fieldKind === 'password') {
    const showedGenerator = shouldOfferSuggestedPassword(input)
    if (showedGenerator) {
      const generated = randomPassword()
      appendFieldMenuButton({
        container: list,
        title: 'Use Suggested Password',
        secondary: generated,
        accent: 'New',
        onClick: () => {
          const inputs = getInputs(input)
          suppressInlineMenu(input)
          writePasswordGroup(input, generated)
          setPendingOtp('')
          setPendingSavePrompt({
            username: inputs.username?.value?.trim() || getPendingUsername(),
            password: generated,
            reason: 'create',
          })
          showSaveBanner({
            username: inputs.username?.value?.trim() || getPendingUsername(),
            password: generated,
            reason: 'create',
          })
        },
      })
    }

    if (!showedGenerator && authFlow !== 'register') {
      for (const match of pageState.matches.filter((candidate) => candidate.hasPassword).slice(0, 4)) {
        appendFieldMenuButton({
          container: list,
          title: match.username || match.itemName,
          secondary: match.username && match.username !== match.itemName ? match.itemName : undefined,
          accent: match.hasOtp ? 'OTP' : undefined,
          onClick: async () => {
            const response = await sendMessage({ type: 'fetch-login', itemId: match.itemId }).catch((error) => ({
              ok: false,
              message: error instanceof Error ? error.message : 'Klarkey could not load this login.',
            }))

            if (!response.ok || !response.login) {
              return
            }

            applyLoginFill(input, response.login)
          },
        })
      }
    }

    if (authFlow === 'register' && !showedGenerator) {
      const empty = document.createElement('div')
      empty.className = 'klarkey-inline-empty'
      empty.textContent = 'Password already set.'
      list.appendChild(empty)
    } else if (!showedGenerator && !pageState.matches.some((match) => match.hasPassword)) {
      const empty = document.createElement('div')
      empty.className = 'klarkey-inline-empty'
      empty.textContent = 'No items found.'
      list.appendChild(empty)
    }
  } else if (fieldKind === 'otp') {
    const pendingOtp = getPendingOtp()
    if (pendingOtp) {
      appendFieldMenuButton({
        container: list,
        title: 'Use one-time code',
        secondary: pendingOtp,
        accent: 'OTP',
        onClick: () => {
          suppressInlineMenu(input)
          const { splitOtpTargets } = getInputs(input)
          if (splitOtpTargets?.length) {
            writeSplitOtp(splitOtpTargets, pendingOtp)
          } else {
            writeValue(input, pendingOtp)
          }
          setPendingOtp('')
          removeInlineUi()
        },
      })
    } else {
      const empty = document.createElement('div')
      empty.className = 'klarkey-inline-empty'
      empty.textContent = 'No one-time code ready.'
      list.appendChild(empty)
    }
  } else if (!pageState.fieldSuggestions.length) {
    const empty = document.createElement('div')
    empty.className = 'klarkey-inline-empty'
    empty.textContent =
      authFlow === 'payment'
        ? 'No cards found.'
        : authFlow === 'login'
          ? 'No items found.'
          : fieldKind === 'email'
            ? 'No identity email found.'
            : 'No identity details found.'
    list.appendChild(empty)
  } else {
    for (const suggestion of pageState.fieldSuggestions.slice(0, 6)) {
      appendFieldMenuButton({
        container: list,
        title: suggestion.value,
        secondary: suggestion.itemName,
        accent: suggestion.fromSiteMatch ? 'Site' : undefined,
        onClick: async () => {
          if (authFlow === 'login' && suggestion.source === 'login-username') {
            const response = await sendMessage({ type: 'fetch-login', itemId: suggestion.itemId }).catch((error) => ({
              ok: false,
              message: error instanceof Error ? error.message : 'Klarkey could not load this login.',
            }))

            if (!response.ok || !response.login) {
              return
            }

            applyLoginFill(input, response.login)
            return
          }

          if (suggestion.source === 'identity') {
            const response = await sendMessage({ type: 'fetch-identity', itemId: suggestion.itemId }).catch((error) => ({
              ok: false,
              message: error instanceof Error ? error.message : 'Klarkey could not load this identity.',
            }))

            if (!response.ok || !response.identity) {
              return
            }

            applyIdentityFill(input, response.identity)
            return
          }

          if (suggestion.source === 'card') {
            const response = await sendMessage({ type: 'fetch-card', itemId: suggestion.itemId }).catch((error) => ({
              ok: false,
              message: error instanceof Error ? error.message : 'Klarkey could not load this card.',
            }))

            if (!response.ok || !response.card) {
              return
            }

            applyCardFill(input, response.card)
            return
          }

          suppressInlineMenu(input)
          writeValue(input, suggestion.value)
          if (fieldKind === 'username' || fieldKind === 'email') {
            setPendingUsername(suggestion.value)
          }
          removeInlineUi()
        },
      })
    }
  }

  overlayRoot.appendChild(menu)
  pageState.menuElement = menu
  positionInlineMenu(menu, input)
  startInlineLayoutTracking()
  setActiveMenuIndex(pageState.activeMenuButtons.length ? 0 : -1)
}

const refreshMatches = async () => {
  const href = window.location.href
  if (pageState.lastListUrl !== href) {
    pageState.lastListUrl = href
    pageState.matches = []
    pageState.fieldSuggestions = []
  }

  const response = await sendMessage({
    type: 'list-logins-for-url',
    url: href,
    title: document.title,
  }).catch((error) => ({
    ok: false,
    matches: [],
    message: error instanceof Error ? error.message : 'Klarkey could not load matching items.',
  }))

  pageState.matches = response.ok ? response.matches || [] : []
  return pageState.matches
}

const refreshFieldSuggestions = async (field, flow) => {
  const response = await sendMessage({
    type: 'list-field-suggestions',
    field,
    flow,
    url: window.location.href,
    title: document.title,
  }).catch((error) => ({
    ok: false,
    suggestions: [],
    message: error instanceof Error ? error.message : 'Klarkey could not load suggestions.',
  }))

  pageState.fieldSuggestions = response.ok ? response.suggestions || [] : []
  return pageState.fieldSuggestions
}

const maybePromptToSave = async (preferredInput, force = false) => {
  if (!browserSettings.browserSavePrompts) {
    return
  }

  const snapshot = collectFormSnapshot(preferredInput)
  if (!snapshot.password) {
    return
  }

  const promptKey = savePromptKeyFor(snapshot)
  if (pageState.lastSavePromptKey === promptKey || pageState.activeSaveBannerKey === promptKey) {
    return
  }

  const matches = pageState.matches.length ? pageState.matches : await refreshMatches()
  const exact = matches.find((match) => (match.username || '') === snapshot.username)
  if (!exact && !force) {
    setPendingSavePrompt({
      username: snapshot.username,
      password: snapshot.password,
      reason: 'create',
    })
    showSaveBanner({
      username: snapshot.username,
      password: snapshot.password,
      reason: 'create',
    })
    pageState.lastSavePromptKey = promptKey
    return
  }

  if (!exact) {
    setPendingSavePrompt({
      username: snapshot.username,
      password: snapshot.password,
      reason: 'create',
    })
    showSaveBanner({
      username: snapshot.username,
      password: snapshot.password,
      reason: 'create',
    })
    pageState.lastSavePromptKey = promptKey
    return
  }

  const stored = await sendMessage({ type: 'fetch-login', itemId: exact.itemId }).catch(() => undefined)
  const storedPassword = stored?.ok ? stored.login?.password || '' : ''

  if (storedPassword === snapshot.password) {
    pageState.lastSavePromptKey = promptKey
    clearPendingSavePrompt()
    return
  }

  setPendingSavePrompt({
    username: snapshot.username,
    password: snapshot.password,
    reason: exact ? 'update' : 'create',
  })
  showSaveBanner({
    username: snapshot.username,
    password: snapshot.password,
    reason: exact ? 'update' : 'create',
  })
  pageState.lastSavePromptKey = promptKey
}

const restorePendingSavePrompt = () => {
  if (!browserSettings.browserSavePrompts) {
    return
  }

  const pending = getPendingSavePrompt()
  if (!pending) {
    return
  }

  window.setTimeout(() => {
    if (!getPendingSavePrompt()) {
      return
    }

    showSaveBanner({
      username: pending.username,
      password: pending.password,
      reason: pending.reason,
    })
  }, 240)
}

const handlePagePasskeyCreate = async (requestDetailsJson) => {
  const plan = await sendMessage({
    type: 'plan-passkey-create',
    payload: {
      url: window.location.href,
      title: document.title,
      requestDetailsJson,
    },
  }).catch(() => undefined)

  if (!plan?.ok || !plan.plan) {
    return { fallbackToBrowser: true }
  }

  const result = await sendMessage({
    type: 'create-passkey-credential',
    payload: {
      origin: window.location.origin,
      url: window.location.href,
      title: document.title,
      requestDetailsJson,
    },
  })
    .catch((error) => ({
      ok: false,
      error: {
        name: 'NotAllowedError',
        message: error instanceof Error ? error.message : 'Klarkey could not create this passkey.',
      },
    }))

  if (!result?.ok) {
    return {
      ok: false,
      error: {
        name: 'NotAllowedError',
        message: result?.message || result?.error?.message || 'Klarkey could not create this passkey.',
      },
    }
  }

  finalizePreparedPasskeySave({
    pendingPasskeyId: result.pendingPasskeyId,
    requestDetailsJson,
    plan: plan.plan,
  })

  return result
}

const handlePagePasskeyGet = async (requestDetailsJson) => {
  const plan = await sendMessage({
    type: 'plan-passkey-get',
    payload: {
      url: window.location.href,
      title: document.title,
      requestDetailsJson,
    },
  }).catch(() => undefined)

  if (!plan?.ok) {
    return { fallbackToBrowser: true }
  }

  if (!plan.choices?.length) {
    return { fallbackToBrowser: true }
  }

  const selectedCredentialId = await promptPasskeyGetChoice(plan.choices)
  if (!selectedCredentialId) {
    return {
      ok: false,
      error: {
        name: 'NotAllowedError',
        message: 'The passkey request was canceled.',
      },
    }
  }

  return sendMessage({
    type: 'get-passkey-credential',
    payload: {
      origin: window.location.origin,
      url: window.location.href,
      title: document.title,
      requestDetailsJson,
      credentialId: selectedCredentialId,
    },
  })
    .then((result) =>
      result?.ok
        ? result
        : {
            ok: false,
            error: {
              name: 'NotAllowedError',
              message: result?.message || 'Klarkey could not use this passkey.',
            },
          },
    )
    .catch((error) => ({
      ok: false,
      error: {
        name: 'NotAllowedError',
        message: error instanceof Error ? error.message : 'Klarkey could not use this passkey.',
      },
    }))
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'klarkey-page-authenticator-request') {
    return
  }

  void (async () => {
    await ensurePageBridgeReady()
    const payload =
      event.data.payload?.operation === 'create'
        ? await handlePagePasskeyCreate(event.data.payload.requestDetailsJson)
        : event.data.payload?.operation === 'get'
          ? await handlePagePasskeyGet(event.data.payload.requestDetailsJson)
          : {
              ok: false,
              error: {
                name: 'NotSupportedError',
                message: 'Unsupported passkey operation.',
              },
            }

    window.postMessage(
      {
        source: 'klarkey-page-authenticator-response',
        id: event.data.id,
        payload,
      },
      window.location.origin,
    )
  })()
})

const handleFieldFocus = async (target) => {
  if (!isFieldElement(target) || !visible(target)) {
    return
  }

  const fieldKind = fieldKindFor(target)
  if (!fieldKind) {
    return
  }

  if (fieldKind === 'otp') {
    const pendingOtp = getPendingOtp()
    if (pendingOtp) {
      suppressInlineMenu()
      const { splitOtpTargets } = getInputs(target)
      if (splitOtpTargets?.length) {
        writeSplitOtp(splitOtpTargets, pendingOtp)
      } else {
        writeValue(target, pendingOtp)
      }
      setPendingOtp('')
      removeInlineUi()
      return
    }
  }

  if (pageState.lastListUrl !== window.location.href) {
    pageState.lastListUrl = window.location.href
    pageState.matches = []
  }

  const generation = ++matchFetchGeneration
  pageState.overlayInput = target
  suppressBrowserAutofill(target)

  renderInlineTriggerOnly(target)

  if (Date.now() < suppressInlineMenuUntil && target === suppressedInlineInput) {
    return
  }

  const autoOpen = browserSettings.browserAutoOpenMenu && target.dataset.klarkeyAutoOpen !== 'false'
  await Promise.all([
    refreshMatches(),
    fieldKind === 'password' || fieldKind === 'otp' ? Promise.resolve([]) : refreshFieldSuggestions(fieldKind, suggestionFlowFor(target, fieldKind)),
  ])

  if (generation !== matchFetchGeneration || pageState.overlayInput !== target) {
    return
  }

  if (autoOpen && shouldAutoOpenFieldMenu(target)) {
    renderInlineMenu(target, pageState.matches, { loading: false })
  }
}

document.addEventListener('focusin', async (event) => {
  await handleFieldFocus(event.composedPath?.()[0] || event.target)
})

document.addEventListener('click', (event) => {
  const target = event.composedPath?.()[0] || event.target
  if (target instanceof Element && target.closest('.klarkey-inline-menu, .klarkey-save-banner')) {
    return
  }

  if (pageState.activeSaveBannerKey && overlayRoot.querySelector('.klarkey-save-banner')) {
    return
  }

  if (pageState.overlayInput && target === pageState.overlayInput) {
    return
  }

  removeInlineUi()
})

document.addEventListener('scroll', () => {
  if (isFieldElement(pageState.overlayInput) && visible(pageState.overlayInput)) {
    if (pageState.menuOpen) {
      renderInlineMenu(pageState.overlayInput, pageState.matches)
    } else {
      renderInlineTriggerOnly(pageState.overlayInput)
    }
  } else {
    removeInlineUi()
  }
}, true)

window.addEventListener('resize', () => {
  if (isFieldElement(pageState.overlayInput) && visible(pageState.overlayInput)) {
    if (pageState.menuOpen) {
      renderInlineMenu(pageState.overlayInput, pageState.matches)
    } else {
      renderInlineTriggerOnly(pageState.overlayInput)
    }
  } else {
    removeInlineUi()
  }
})

document.addEventListener('submit', () => {
  const inputs = getInputs()
  pageState.formSnapshot = {
    username: inputs.username?.value?.trim() || getPendingUsername(),
    password: inputs.password?.value?.trim() || '',
  }

  if (pageState.formSnapshot.username) {
    setPendingUsername(pageState.formSnapshot.username)
  }

  window.setTimeout(() => {
    void maybePromptToSave(inputs.password || inputs.username, true)
  }, 180)
}, true)

document.addEventListener(
  'blur',
  (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || !isPasswordInput(target)) {
      return
    }

    const password = target.value?.trim()
    if (!password) {
      return
    }

    window.clearTimeout(savePromptTimer)
    savePromptTimer = window.setTimeout(() => {
      void maybePromptToSave(target, false)
    }, 450)
  },
  true,
)

window.addEventListener('popstate', () => {
  pageState.lastListUrl = ''
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const dismissButton = overlayRoot.querySelector('.klarkey-save-banner [data-action="dismiss"]')
    if (dismissButton instanceof HTMLButtonElement) {
      dismissButton.click()
      return
    }

    removeInlineUi()
    return
  }

  if (!pageState.overlayInput || !overlayRoot.querySelector('.klarkey-inline-menu')) {
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActiveMenuIndex(1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActiveMenuIndex(-1)
    return
  }

  if (event.key === 'Enter' && pageState.activeMenuIndex >= 0) {
    const activeButton = pageState.activeMenuButtons[pageState.activeMenuIndex]
    if (activeButton) {
      event.preventDefault()
      activeButton.click()
    }
  }
})

if (runtime) {
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'collect-page-context') {
      const snapshot = collectFormSnapshot()
      sendResponse({
        url: window.location.href,
        title: document.title,
        form: snapshot,
      })
      return
    }

    if (message?.type === 'fill-login') {
      const inputs = getInputs()
      const preferredInput = inputs.password || inputs.username
      suppressInlineMenu(preferredInput)
      writeValue(inputs.username, message.login?.username)
      writeValue(inputs.password, message.login?.password)
      if (inputs.splitOtpTargets?.length && message.login?.otp) {
        writeSplitOtp(inputs.splitOtpTargets, message.login.otp)
      } else {
        writeValue(inputs.otp, message.login?.otp)
      }
      setPendingUsername(message.login?.username || '')
      setPendingOtp(message.login?.otp || '')
      removeInlineUi()
      scheduleLoginAutoSubmit(preferredInput)

      sendResponse({
        ok: true,
        message: 'Klarkey filled the detected fields on this page.',
      })
      return
    }

  })

  injectPageBridge()
  void loadBrowserSettings().finally(() => {
    void refreshMatches()
    restorePendingSavePrompt()
    window.setTimeout(() => {
      void handleFieldFocus(getDeepActiveElement())
    }, 0)
  })
}
