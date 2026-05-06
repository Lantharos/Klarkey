import type { ActionExecutionResult } from '@/shared/types'
import { toBrowserSiteUrl } from '@/shared/browser-extension'

export type PasskeyProviderBridgeRequest =
  | {
      id: string
      type: 'ping'
    }
  | {
      id: string
      type: 'find-credentials'
      url: string
      requestDetailsJson: string
    }
  | {
      id: string
      type: 'store-credential'
      url: string
      requestDetailsJson: string
      responseJson: string
    }
  | {
      id: string
      type: 'touch-credential'
      credentialId: string
    }

export type PasskeyProviderBridgeResponse =
  | {
      id: string
      ok: true
      result:
        | {
            ready: boolean
            bridge: 'klarkey-passkey-provider'
            vaultUnlocked: boolean
            reason?: string
          }
        | {
            requestDetailsJson: string
            selectedCredentialIds: string[]
          }
        | ActionExecutionResult
    }
  | {
      id: string
      ok: false
      error: {
        code: string
        message: string
      }
    }

type PasskeyProviderBridgeValidationResult =
  | {
      ok: true
      request: PasskeyProviderBridgeRequest
    }
  | {
      ok: false
      id: string
      error: {
        code: string
        message: string
      }
    }

const maxProviderRequestIdLength = 128
const maxProviderUrlLength = 4096
const maxProviderRequestJsonLength = 262_144
const maxProviderResponseJsonLength = 1_048_576
const maxProviderCredentialIdLength = 8192
const localHttpProviderHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

const invalidProviderRequest = (
  id: string,
  code: string,
  message: string,
): PasskeyProviderBridgeValidationResult => ({
  ok: false,
  id,
  error: {
    code,
    message,
  },
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isBoundedString = (value: unknown, maxLength: number, allowEmpty = false): value is string =>
  typeof value === 'string' &&
  value.length <= maxLength &&
  (allowEmpty || value.trim().length > 0)

const readRequestId = (value: unknown) =>
  isRecord(value) && isBoundedString(value.id, maxProviderRequestIdLength)
    ? value.id
    : 'unknown'

const readProviderPageUrl = (value: unknown): string | undefined => {
  if (!isBoundedString(value, maxProviderUrlLength)) {
    return undefined
  }

  try {
    const parsed = new URL(value)
    const allowed = parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && (localHttpProviderHosts.has(parsed.hostname) || parsed.hostname.endsWith('.localhost')))
    return allowed ? toBrowserSiteUrl(parsed.href) : undefined
  } catch {
    return undefined
  }
}

export const validatePasskeyProviderBridgeRequest = (
  input: unknown,
): PasskeyProviderBridgeValidationResult => {
  const id = readRequestId(input)
  if (!isRecord(input) || !isBoundedString(input.id, maxProviderRequestIdLength)) {
    return invalidProviderRequest(id, 'invalid_request', 'The passkey provider request is malformed.')
  }

  if (!isBoundedString(input.type, 80)) {
    return invalidProviderRequest(id, 'invalid_request_type', 'The passkey provider request type is invalid.')
  }

  switch (input.type) {
    case 'ping':
      return {
        ok: true,
        request: {
          id,
          type: 'ping',
        },
      }

    case 'find-credentials': {
      const url = readProviderPageUrl(input.url)
      return url && isBoundedString(input.requestDetailsJson, maxProviderRequestJsonLength)
        ? {
            ok: true,
            request: {
              id,
              type: 'find-credentials',
              url,
              requestDetailsJson: input.requestDetailsJson,
            },
          }
        : invalidProviderRequest(id, 'invalid_passkey_request', 'The passkey provider credential request is invalid.')
    }

    case 'store-credential': {
      const url = readProviderPageUrl(input.url)
      return url &&
        isBoundedString(input.requestDetailsJson, maxProviderRequestJsonLength) &&
        isBoundedString(input.responseJson, maxProviderResponseJsonLength)
        ? {
            ok: true,
            request: {
              id,
              type: 'store-credential',
              url,
              requestDetailsJson: input.requestDetailsJson,
              responseJson: input.responseJson,
            },
          }
        : invalidProviderRequest(id, 'invalid_passkey_request', 'The passkey provider storage request is invalid.')
    }

    case 'touch-credential':
      return isBoundedString(input.credentialId, maxProviderCredentialIdLength)
        ? {
            ok: true,
            request: {
              id,
              type: 'touch-credential',
              credentialId: input.credentialId,
            },
          }
        : invalidProviderRequest(id, 'invalid_credential', 'The passkey provider credential id is invalid.')

    default:
      return invalidProviderRequest(
        id,
        'unsupported_request',
        'The requested passkey provider action is not supported.',
      )
  }
}
