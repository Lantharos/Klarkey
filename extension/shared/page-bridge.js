(function () {
  let bypassInterception = 0
  const pendingAuthenticatorRequests = new Map()

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

  const defineReadonly = (target, key, value) => {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: false,
    })
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
      const id = `klarkey_auth_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`
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
    if (event.source !== window || event.data?.source !== 'klarkey-page-authenticator-response') {
      return
    }

    const pending = pendingAuthenticatorRequests.get(event.data.id)
    if (!pending) {
      return
    }

    pendingAuthenticatorRequests.delete(event.data.id)
    pending.resolve(event.data.payload)
  })

  document.documentElement.setAttribute('data-klarkey-bridge', 'ready')
  document.documentElement.dispatchEvent(new CustomEvent('klarkey-page-bridge-ready', { bubbles: true }))
})()
