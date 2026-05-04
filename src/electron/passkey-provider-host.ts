import { readSync, writeSync } from 'node:fs'
import { PasskeyProviderBridgeController } from '@/electron/passkey-provider-controller'
import { safeErrorMessage } from '@/electron/security'
import {
  validatePasskeyProviderBridgeRequest,
  type PasskeyProviderBridgeResponse,
} from '@/shared/passkey-provider-bridge'

const MAX_MESSAGE_LENGTH = 10 * 1024 * 1024
export const MAX_PASSKEY_PROVIDER_RESPONSE_BYTES = 1024 * 1024

export const readPasskeyProviderMessageSync = (): unknown => {
  const header = Buffer.alloc(4)
  const headerBytes = readSync(0, header, 0, header.byteLength, null)
  if (headerBytes < 4) {
    return undefined
  }

  const messageLength = header.readUInt32LE(0)
  if (messageLength <= 0 || messageLength > MAX_MESSAGE_LENGTH) {
    return undefined
  }

  const messageBuffer = Buffer.alloc(messageLength)
  let offset = 0

  while (offset < messageLength) {
    const bytesRead = readSync(0, messageBuffer, offset, messageLength - offset, null)
    if (bytesRead === 0) {
      return undefined
    }

    offset += bytesRead
  }

  try {
    return JSON.parse(messageBuffer.toString('utf8')) as unknown
  } catch {
    return {
      id: 'unknown',
      type: '__invalid_json',
    }
  }
}

export const serializePasskeyProviderResponse = (response: PasskeyProviderBridgeResponse): Buffer => {
  const message = Buffer.from(JSON.stringify(response), 'utf8')
  if (message.byteLength > MAX_PASSKEY_PROVIDER_RESPONSE_BYTES) {
    return serializePasskeyProviderResponse({
      id: response.id,
      ok: false,
      error: {
        code: 'provider_bridge_response_too_large',
        message: 'The passkey provider response was too large to return safely.',
      },
    })
  }

  const header = Buffer.alloc(4)
  header.writeUInt32LE(message.byteLength, 0)
  return Buffer.concat([header, message])
}

const writeMessage = (response: PasskeyProviderBridgeResponse) => {
  writeSync(1, serializePasskeyProviderResponse(response))
}

export const sanitizePasskeyProviderErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const message = error.message
    if (message.includes('ENOENT') || message.includes('EACCES') || message.includes('EPERM')) {
      return 'A file system error occurred.'
    }
    if (message.includes('SQLITE')) {
      return 'A database error occurred.'
    }
    if (message.includes('BUFFERS_TOO_LARGE') || message.includes('ERR_OSSL')) {
      return 'A cryptographic error occurred.'
    }
    if (/[A-Z]:\\[\\\w\s]/i.test(message)) {
      return 'An internal error occurred.'
    }
    if (message.length > 200) {
      return 'An internal error occurred.'
    }
    return safeErrorMessage(error)
  }
  return 'The passkey provider bridge failed.'
}

export async function runPasskeyProviderBridgeHost(request: unknown = readPasskeyProviderMessageSync()) {
  let controller: PasskeyProviderBridgeController | undefined

  try {
    if (!request) {
      writeMessage({
        id: 'unknown',
        ok: false,
        error: {
          code: 'invalid_message',
          message: 'No passkey provider request was received.',
        },
      })
      return
    }

    const validation = validatePasskeyProviderBridgeRequest(request)
    if (!validation.ok) {
      writeMessage({
        id: validation.id,
        ok: false,
        error: validation.error,
      })
      return
    }

    controller = new PasskeyProviderBridgeController()
    const response = await controller.handle(validation.request)
    writeMessage(response)
  } catch (error) {
    writeMessage({
      id: request && typeof request === 'object' && 'id' in request && typeof request.id === 'string'
        ? request.id
        : 'unknown',
      ok: false,
      error: {
        code: 'provider_bridge_failure',
        message: sanitizePasskeyProviderErrorMessage(error),
      },
    })
  } finally {
    controller?.dispose()
  }
}
