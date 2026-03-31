(function () {
  const decodeBase64Url = (value) => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
    const binary = atob(padded)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
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

  const respond = (id, payload) => {
    window.postMessage(
      {
        source: 'klarkey-page-bridge-response',
        id,
        payload,
      },
      window.location.origin,
    )
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.source !== 'klarkey-page-bridge-request') {
      return
    }

    const { id, payload } = event.data
    try {
      if (payload.operation === 'create') {
        const credential = await navigator.credentials.create({
          publicKey: parseCreateOptions(payload.requestDetailsJson),
        })
        respond(id, {
          ok: true,
          responseJson: JSON.stringify(credential.toJSON()),
          credentialId: credential.id,
        })
        return
      }

      if (payload.operation === 'get') {
        const credential = await navigator.credentials.get({
          publicKey: parseGetOptions(payload.requestDetailsJson),
        })
        respond(id, {
          ok: true,
          responseJson: JSON.stringify(credential.toJSON()),
          credentialId: credential.id,
        })
        return
      }

      respond(id, {
        ok: false,
        error: {
          name: 'NotSupportedError',
          message: 'Unsupported passkey operation.',
        },
      })
    } catch (error) {
      respond(id, {
        ok: false,
        error: formatError(error),
      })
    }
  })
})()
