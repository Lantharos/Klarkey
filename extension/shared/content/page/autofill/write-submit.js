import { pageState, stateCodeToName, regionDisplayNames, timers, browserSettings } from '../state.js'
import { normalizeLookupToken, readFieldValue, isEditableHost, isFieldElement, visible } from '../dom.js'
import { fieldKindFor } from '../field-meta.js'
import {
  getInputs,
  isPasswordInput,
  getPendingUsername,
  detectAuthFlow,
  isPaymentContextInput,
} from '../forms/forms.js'
import {
  readAttributeSnapshot,
  restoreAttributeSnapshot,
  clearBrowserAutofillSuppression,
  suppressBrowserAutofill,
} from './autofill.js'
import { stopInlineLayoutTracking } from '../menu-suppress.js'

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
  window.clearTimeout(timers.autoSubmit)
  if (!canAutoSubmitLogin(preferredInput)) {
    return
  }

  timers.autoSubmit = window.setTimeout(() => {
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

export { setNativeFieldValue, dispatchFieldEvents, resolveSelectValue, writeValue, writePasswordGroup, writeSplitOtp, isSatisfiedField, hasVisibleCaptcha, findSubmitter, canAutoSubmitLogin, scheduleLoginAutoSubmit, collectFormSnapshot }
