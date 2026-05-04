const pageAuthenticatorRequestSource = 'klarkey-page-authenticator-request'
const pageAuthenticatorResponseSource = 'klarkey-page-authenticator-response'
const maxPagePasskeyMessageIdLength = 128
const maxPagePasskeyRequestJsonLength = 262_144
const maxPagePasskeyResponseJsonLength = 262_144
const sensitiveErrorPattern = /(access_token|app_key|authorization|bearer|ciphertext|client_secret|cookie|credentialId|id_token|jwt|passcode|password|pendingPasskeyId|private|privateKey|recovery|refresh_token|secret|token|vault)/i
const urlErrorPattern = /(file:\/\/|[a-z]:\\|https?:\/\/\S+[?&][^ \t\r\n]+)/i

const isObject = (value) => typeof value === 'object' && value !== null
const isBoundedString = (value, maxLength) => typeof value === 'string' && value.length > 0 && value.length <= maxLength
const isValidPasskeyRequestJson = (value) => {
  if (!isBoundedString(value, maxPagePasskeyRequestJsonLength)) {
    return false
  }

  try {
    const parsed = JSON.parse(value)
    return isObject(parsed) && !Array.isArray(parsed)
  } catch {
    return false
  }
}

const pagePasskeyError = (name, message) => ({
  name,
  message,
})

const safePagePasskeyErrorName = (name) =>
  typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]*Error$/.test(name) && name.length <= 48 ? name : 'NotAllowedError'

const safePagePasskeyErrorMessage = (message, fallback = 'The passkey request could not be completed.') => {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text || text.length > 160 || sensitiveErrorPattern.test(text) || urlErrorPattern.test(text)) {
    return fallback
  }
  return text
}

const sanitizePagePasskeyResponsePayload = (payload) => {
  if (!isObject(payload)) {
    return {
      ok: false,
      error: pagePasskeyError('NotAllowedError', 'The passkey request could not be completed.'),
    }
  }

  if (payload.fallbackToBrowser === true) {
    return { fallbackToBrowser: true }
  }

  if (payload.ok === true && isBoundedString(payload.responseJson, maxPagePasskeyResponseJsonLength)) {
    return {
      ok: true,
      responseJson: payload.responseJson,
    }
  }

  return {
    ok: false,
    error: pagePasskeyError(
      safePagePasskeyErrorName(payload.error?.name),
      safePagePasskeyErrorMessage(payload.error?.message ?? payload.message),
    ),
  }
}

const readPagePasskeyRequest = (data) => {
  if (!isObject(data) || data.source !== pageAuthenticatorRequestSource) {
    return undefined
  }

  if (!isBoundedString(data.id, maxPagePasskeyMessageIdLength)) {
    return undefined
  }

  const payload = isObject(data.payload) ? data.payload : undefined
  const operation = payload?.operation
  if (operation !== 'create' && operation !== 'get') {
    return {
      id: data.id,
      error: pagePasskeyError('NotSupportedError', 'Unsupported passkey operation.'),
    }
  }

  if (!isValidPasskeyRequestJson(payload.requestDetailsJson)) {
    return {
      id: data.id,
      error: pagePasskeyError('NotAllowedError', 'The passkey request is invalid.'),
    }
  }

  return {
    id: data.id,
    operation,
    requestDetailsJson: payload.requestDetailsJson,
  }
}

const buildPagePasskeyResponse = (id, payload) => ({
  source: pageAuthenticatorResponseSource,
  id,
  payload: sanitizePagePasskeyResponsePayload(payload),
})

export { buildPagePasskeyResponse, readPagePasskeyRequest, safePagePasskeyErrorMessage, sanitizePagePasskeyResponsePayload }
