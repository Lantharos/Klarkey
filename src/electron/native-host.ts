import { readSync, writeSync } from 'node:fs'
import { BrowserExtensionController } from '@/electron/extension-controller'
import { safeErrorMessage } from '@/electron/security'
import { validateBrowserExtensionRequest, type BrowserExtensionResponse } from '@/shared/browser-extension'

const MAX_MESSAGE_LENGTH = 10 * 1024 * 1024
export const MAX_NATIVE_HOST_RESPONSE_BYTES = 1024 * 1024

export const readNativeMessageSync = () => {
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

export const serializeNativeMessageResponse = (response: BrowserExtensionResponse): Buffer => {
  const message = Buffer.from(JSON.stringify(response), 'utf8')
  if (message.byteLength > MAX_NATIVE_HOST_RESPONSE_BYTES) {
    return serializeNativeMessageResponse({
      id: response.id,
      ok: false,
      error: {
        code: 'native_host_response_too_large',
        message: 'The browser response was too large to return safely.',
      },
    })
  }

  const header = Buffer.alloc(4)
  header.writeUInt32LE(message.byteLength, 0)
  return Buffer.concat([header, message])
}

const writeNativeMessage = (response: BrowserExtensionResponse) => {
  writeSync(1, serializeNativeMessageResponse(response))
}

export const sanitizeNativeHostErrorMessage = (error: unknown): string => {
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
  return 'The operation failed.'
}

export async function runNativeMessagingHost(request?: unknown) {
  const controller = new BrowserExtensionController()
  const singleRequestMode = request !== undefined

  try {
    let nextRequest = request ?? readNativeMessageSync()

    while (nextRequest) {
      const validation = validateBrowserExtensionRequest(nextRequest)
      if (!validation.ok) {
        writeNativeMessage({
          id: validation.id,
          ok: false,
          error: validation.error,
        })
        nextRequest = singleRequestMode ? undefined : readNativeMessageSync()
        continue
      }

      try {
        const response = await controller.handle(validation.request)
        writeNativeMessage(response)
      } catch (error) {
        writeNativeMessage({
          id: validation.request.id,
          ok: false,
          error: {
            code: 'native_host_failure',
            message: sanitizeNativeHostErrorMessage(error),
          },
        })
      }

      nextRequest = singleRequestMode ? undefined : readNativeMessageSync()
    }
  } catch (error) {
    writeNativeMessage({
      id: readBrowserExtensionRequestId(request),
      ok: false,
      error: {
        code: 'native_host_failure',
        message: sanitizeNativeHostErrorMessage(error),
      },
    })
  } finally {
    controller.dispose()
  }
}

const readBrowserExtensionRequestId = (request: unknown) =>
  request &&
  typeof request === 'object' &&
  'id' in request &&
  typeof request.id === 'string'
    ? request.id
    : 'unknown'
