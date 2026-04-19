import { readSync, writeSync } from 'node:fs'
import { BrowserExtensionController } from '@/electron/extension-controller'
import type { BrowserExtensionRequest, BrowserExtensionResponse } from '@/shared/browser-extension'

const MAX_MESSAGE_LENGTH = 10 * 1024 * 1024

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

  return JSON.parse(messageBuffer.toString('utf8')) as BrowserExtensionRequest
}

const writeNativeMessage = (response: BrowserExtensionResponse) => {
  const message = Buffer.from(JSON.stringify(response), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(message.byteLength, 0)
  writeSync(1, Buffer.concat([header, message]))
}

const sanitizeMessage = (error: unknown): string => {
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
  return 'The operation failed.'
}

export async function runNativeMessagingHost(request = readNativeMessageSync()) {
  const controller = new BrowserExtensionController()

  try {
    let nextRequest = request

    while (nextRequest) {
      try {
        const response = await controller.handle(nextRequest)
        writeNativeMessage(response)
      } catch (error) {
        writeNativeMessage({
          id: nextRequest.id ?? 'unknown',
          ok: false,
          error: {
            code: 'native_host_failure',
            message: sanitizeMessage(error),
          },
        })
      }

      nextRequest = readNativeMessageSync()
    }
  } catch (error) {
    writeNativeMessage({
      id: request?.id ?? 'unknown',
      ok: false,
      error: {
        code: 'native_host_failure',
        message: sanitizeMessage(error),
      },
    })
  } finally {
    controller.dispose()
  }
}
