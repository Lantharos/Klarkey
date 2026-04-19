import { readSync, writeSync } from 'node:fs'
import { PasskeyProviderBridgeController } from '@/electron/passkey-provider-controller'
import type { PasskeyProviderBridgeRequest, PasskeyProviderBridgeResponse } from '@/shared/passkey-provider-bridge'

const MAX_MESSAGE_LENGTH = 10 * 1024 * 1024

export const readPasskeyProviderMessageSync = () => {
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

  return JSON.parse(messageBuffer.toString('utf8')) as PasskeyProviderBridgeRequest
}

const writeMessage = (response: PasskeyProviderBridgeResponse) => {
  const message = Buffer.from(JSON.stringify(response), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(message.byteLength, 0)
  writeSync(1, Buffer.concat([header, message]))
}

const sanitizeProviderMessage = (error: unknown): string => {
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
    return message
  }
  return 'The passkey provider bridge failed.'
}

export async function runPasskeyProviderBridgeHost(request = readPasskeyProviderMessageSync()) {
  const controller = new PasskeyProviderBridgeController()

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

    const response = await controller.handle(request)
    writeMessage(response)
  } catch (error) {
    writeMessage({
      id: request?.id ?? 'unknown',
      ok: false,
      error: {
        code: 'provider_bridge_failure',
        message: sanitizeProviderMessage(error),
      },
    })
  } finally {
    controller.dispose()
  }
}
