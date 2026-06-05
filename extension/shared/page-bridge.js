(function () {
  let bypassInterception = 0
  let fallbackRequestCounter = 0
  const pendingAuthenticatorRequests = new Map()
  const maxAuthenticatorMessageIdLength = 128
  const maxAuthenticatorResponseJsonLength = 262_144
  const sensitiveErrorPattern = /(access_token|app_key|authorization|bearer|ciphertext|client_secret|cookie|credentialId|id_token|jwt|passcode|password|pendingPasskeyId|private|privateKey|recovery|refresh_token|secret|token|vault)/i
  const urlErrorPattern = /(file:\/\/|[a-z]:\\|https?:\/\/\S+[?&][^ \t\r\n]+)/i
  const isObject = (value) => typeof value === 'object' && value !== null
  const isBoundedString = (value, maxLength) => typeof value === 'string' && value.length > 0 && value.length <= maxLength

  const decodeBase64Url = (value) => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
    const binary = atob(padded)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  }

  const encodeBase64Url = (value) => {
    const bytes =
      value instanceof Uint8Array
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            : undefined

    if (!bytes) {
      return value
    }

    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  const toArrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const requestIdSuffix = () => {
    const bytes = new Uint8Array(8)
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes)
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    }
    fallbackRequestCounter = (fallbackRequestCounter + 1) % Number.MAX_SAFE_INTEGER
    return `${Date.now().toString(36)}_${fallbackRequestCounter.toString(36)}`
  }

  const decodeBase64UrlBuffer = (value) => {
    if (!value) {
      return undefined
    }

    return toArrayBuffer(decodeBase64Url(value))
  }

  const fallbackParsePublicKey = (requestDetailsJson) => {
    const input = JSON.parse(requestDetailsJson)

    if (input.challenge) {
      input.challenge = decodeBase64Url(input.challenge)
    }

    if (input.user?.id) {
      input.user.id = decodeBase64Url(input.user.id)
    }

    if (Array.isArray(input.excludeCredentials)) {
      input.excludeCredentials = input.excludeCredentials.map((credential) => ({
        ...credential,
        id: decodeBase64Url(credential.id),
      }))
    }

    if (Array.isArray(input.allowCredentials)) {
      input.allowCredentials = input.allowCredentials.map((credential) => ({
        ...credential,
        id: decodeBase64Url(credential.id),
      }))
    }

    return input
  }

  const parseCreateOptions = (requestDetailsJson) =>
    typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function'
      ? PublicKeyCredential.parseCreationOptionsFromJSON(JSON.parse(requestDetailsJson))
      : fallbackParsePublicKey(requestDetailsJson)

  const parseGetOptions = (requestDetailsJson) =>
    typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function'
      ? PublicKeyCredential.parseRequestOptionsFromJSON(JSON.parse(requestDetailsJson))
      : fallbackParsePublicKey(requestDetailsJson)

  const formatError = (error) => ({
    name: error?.name || 'NotAllowedError',
    message: error?.message || 'The passkey request could not be completed.',
  })

  const sanitizeErrorName = (name) =>
    typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]*Error$/.test(name) && name.length <= 48 ? name : 'NotAllowedError'

  const sanitizeErrorMessage = (message) => {
    const text = typeof message === 'string' ? message.trim() : ''
    if (!text || text.length > 160 || sensitiveErrorPattern.test(text) || urlErrorPattern.test(text)) {
      return 'The passkey request could not be completed.'
    }
    return text
  }

  const sanitizeAuthenticatorResponsePayload = (payload) => {
    if (!isObject(payload)) {
      return {
        ok: false,
        error: {
          name: 'NotAllowedError',
          message: 'The passkey request could not be completed.',
        },
      }
    }

    if (payload.fallbackToBrowser === true) {
      return { fallbackToBrowser: true }
    }

    if (payload.ok === true && isBoundedString(payload.responseJson, maxAuthenticatorResponseJsonLength)) {
      return {
        ok: true,
        responseJson: payload.responseJson,
      }
    }

    return {
      ok: false,
      error: {
        name: sanitizeErrorName(payload.error?.name),
        message: sanitizeErrorMessage(payload.error?.message ?? payload.message),
      },
    }
  }

  const createDomException = ({ name, message }) => {
    if (typeof DOMException === 'function') {
      return new DOMException(message, name)
    }

    const error = new Error(message)
    error.name = name
    return error
  }

  const serializeCredentialDescriptor = (credential) => ({
    ...credential,
    id: encodeBase64Url(credential.id),
  })

  const serializePublicKeyOptions = (publicKey, operation) => {
    if (!publicKey) {
      return '{}'
    }

    const serialized = {
      ...publicKey,
      challenge: encodeBase64Url(publicKey.challenge),
    }

    if (publicKey.user?.id) {
      serialized.user = {
        ...publicKey.user,
        id: encodeBase64Url(publicKey.user.id),
      }
    }

    if (operation === 'create' && Array.isArray(publicKey.excludeCredentials)) {
      serialized.excludeCredentials = publicKey.excludeCredentials.map(serializeCredentialDescriptor)
    }

    if (operation === 'get' && Array.isArray(publicKey.allowCredentials)) {
      serialized.allowCredentials = publicKey.allowCredentials.map(serializeCredentialDescriptor)
    }

    return JSON.stringify(serialized)
  }

  const overrideCredentialMethod = (name, implementation) => {
    try {
      navigator.credentials[name] = implementation
    } catch {
      Object.defineProperty(navigator.credentials, name, {
        configurable: true,
        writable: true,
        value: implementation,
      })
    }
  }

  const defineGlobal = (key, value) => {
    Object.defineProperty(window, key, {
      configurable: true,
      writable: true,
      value,
    })
  }

  const defineReadonly = (target, key, value) => {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: false,
    })
  }

  const defineStaticMethod = (target, key, value) => {
    Object.defineProperty(target, key, {
      configurable: true,
      writable: true,
      value,
    })
  }

  const ensurePublicKeyCredentialConstructor = () => {
    if (typeof PublicKeyCredential === 'function') {
      return PublicKeyCredential
    }

    if (!navigator.credentials?.create || !navigator.credentials?.get) {
      return undefined
    }

    const KlarkeyPublicKeyCredential = function PublicKeyCredential() {}
    defineGlobal('PublicKeyCredential', KlarkeyPublicKeyCredential)
    return KlarkeyPublicKeyCredential
  }

  const installPasskeyCapabilityOverrides = () => {
    const CredentialConstructor = ensurePublicKeyCredentialConstructor()
    if (!CredentialConstructor) {
      return false
    }

    const originalCapabilities =
      typeof CredentialConstructor.getClientCapabilities === 'function'
        ? CredentialConstructor.getClientCapabilities.bind(CredentialConstructor)
        : undefined
    const originalConditional =
      typeof CredentialConstructor.isConditionalMediationAvailable === 'function'
        ? CredentialConstructor.isConditionalMediationAvailable.bind(CredentialConstructor)
        : undefined

    defineStaticMethod(CredentialConstructor, 'isUserVerifyingPlatformAuthenticatorAvailable', () => Promise.resolve(true))
    defineStaticMethod(CredentialConstructor, 'isConditionalMediationAvailable', () => Promise.resolve(true))
    defineStaticMethod(CredentialConstructor, 'getClientCapabilities', async () => {
      const capabilities = originalCapabilities ? await originalCapabilities().catch(() => ({})) : {}
      const baseCapabilities = isObject(capabilities) ? capabilities : {}
      return {
        ...baseCapabilities,
        passkeyPlatformAuthenticator: true,
        userVerifyingPlatformAuthenticator: true,
        conditionalGet: true,
      }
    })

    return true
  }

  const buildAuthenticatorAttestationResponse = (serialized) => {
    const payload = serialized?.response || {}
    const response = Object.create(
      typeof AuthenticatorAttestationResponse === 'function' ? AuthenticatorAttestationResponse.prototype : Object.prototype,
    )

    defineReadonly(response, 'clientDataJSON', decodeBase64UrlBuffer(payload.clientDataJSON))
    defineReadonly(response, 'attestationObject', decodeBase64UrlBuffer(payload.attestationObject))
    defineReadonly(response, 'authenticatorData', decodeBase64UrlBuffer(payload.authenticatorData))
    response.getTransports = () => (Array.isArray(payload.transports) ? [...payload.transports] : [])
    response.getAuthenticatorData = () => decodeBase64UrlBuffer(payload.authenticatorData)
    response.getPublicKey = () => decodeBase64UrlBuffer(payload.publicKey)
    response.getPublicKeyAlgorithm = () => payload.publicKeyAlgorithm ?? -7
    response.toJSON = () => JSON.parse(JSON.stringify(payload))

    return response
  }

  const buildAuthenticatorAssertionResponse = (serialized) => {
    const payload = serialized?.response || {}
    const response = Object.create(
      typeof AuthenticatorAssertionResponse === 'function' ? AuthenticatorAssertionResponse.prototype : Object.prototype,
    )

    defineReadonly(response, 'clientDataJSON', decodeBase64UrlBuffer(payload.clientDataJSON))
    defineReadonly(response, 'authenticatorData', decodeBase64UrlBuffer(payload.authenticatorData))
    defineReadonly(response, 'signature', decodeBase64UrlBuffer(payload.signature))
    defineReadonly(response, 'userHandle', decodeBase64UrlBuffer(payload.userHandle) ?? null)
    response.toJSON = () => JSON.parse(JSON.stringify(payload))

    return response
  }

  const hydrateCredential = (responseJson) => {
    const serialized = JSON.parse(responseJson)
    const credential = Object.create(typeof PublicKeyCredential === 'function' ? PublicKeyCredential.prototype : Object.prototype)
    const response =
      serialized?.response?.attestationObject || serialized?.response?.publicKey
        ? buildAuthenticatorAttestationResponse(serialized)
        : buildAuthenticatorAssertionResponse(serialized)

    defineReadonly(credential, 'id', serialized.id)
    defineReadonly(credential, 'rawId', decodeBase64UrlBuffer(serialized.rawId))
    defineReadonly(credential, 'type', serialized.type || 'public-key')
    defineReadonly(credential, 'authenticatorAttachment', serialized.authenticatorAttachment || 'platform')
    defineReadonly(credential, 'response', response)
    credential.getClientExtensionResults = () => serialized.clientExtensionResults || {}
    defineReadonly(credential, 'clientExtensionResults', serialized.clientExtensionResults || {})
    credential.toJSON = () => JSON.parse(JSON.stringify(serialized))

    return credential
  }

  const requestKlarkeyAuthenticator = (operation, requestDetailsJson) =>
    new Promise((resolve) => {
      const id = `klarkey_auth_${requestIdSuffix()}`
      const timeoutId = window.setTimeout(() => {
        pendingAuthenticatorRequests.delete(id)
        resolve({
          ok: false,
          error: {
            name: 'NotAllowedError',
            message: 'The passkey request timed out.',
          },
        })
      }, 120000)

      pendingAuthenticatorRequests.set(id, {
        resolve: (payload) => {
          window.clearTimeout(timeoutId)
          resolve(payload)
        },
      })

      window.postMessage(
        {
          source: 'klarkey-page-authenticator-request',
          id,
          payload: {
            operation,
            requestDetailsJson,
          },
        },
        window.location.origin,
      )
    })

  if (!navigator.credentials?.create || !navigator.credentials?.get || !installPasskeyCapabilityOverrides()) {
    return
  }

  const originalCreate = navigator.credentials.create.bind(navigator.credentials)
  const originalGet = navigator.credentials.get.bind(navigator.credentials)

  const createWithKlarkey = async function createWithKlarkey(options) {
    if (!options?.publicKey || bypassInterception > 0) {
      return originalCreate(options)
    }

    const requestDetailsJson = serializePublicKeyOptions(options.publicKey, 'create')
    const result = await requestKlarkeyAuthenticator('create', requestDetailsJson)
    if (result?.fallbackToBrowser) {
      bypassInterception += 1
      try {
        return await originalCreate(options)
      } finally {
        bypassInterception = Math.max(0, bypassInterception - 1)
      }
    }

    if (!result?.ok || !result.responseJson) {
      throw createDomException(result?.error || formatError())
    }

    return hydrateCredential(result.responseJson)
  }

  const getWithKlarkey = async function getWithKlarkey(options) {
    if (!options?.publicKey || bypassInterception > 0) {
      return originalGet(options)
    }

    const requestDetailsJson = serializePublicKeyOptions(options.publicKey, 'get')
    const result = await requestKlarkeyAuthenticator('get', requestDetailsJson)
    if (result?.fallbackToBrowser) {
      bypassInterception += 1
      try {
        return await originalGet(options)
      } finally {
        bypassInterception = Math.max(0, bypassInterception - 1)
      }
    }

    if (!result?.ok || !result.responseJson) {
      throw createDomException(result?.error || formatError())
    }

    return hydrateCredential(result.responseJson)
  }

  overrideCredentialMethod('create', createWithKlarkey)
  overrideCredentialMethod('get', getWithKlarkey)

  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.source !== 'klarkey-page-authenticator-response'
    ) {
      return
    }

    if (!isBoundedString(event.data.id, maxAuthenticatorMessageIdLength)) {
      return
    }

    const pending = pendingAuthenticatorRequests.get(event.data.id)
    if (!pending) {
      return
    }

    pendingAuthenticatorRequests.delete(event.data.id)
    pending.resolve(sanitizeAuthenticatorResponsePayload(event.data.payload))
  })

  document.documentElement.setAttribute('data-klarkey-bridge', 'ready')
  document.documentElement.dispatchEvent(new CustomEvent('klarkey-page-bridge-ready', { bubbles: true }))
})()
