import { readSync, writeSync } from 'node:fs'
import { BrowserExtensionController } from '@/electron/extension-controller'
import type { BrowserExtensionRequest, BrowserExtensionResponse } from '@/shared/browser-extension'

export const readNativeMessageSync = () => {
  const header = Buffer.alloc(4)
  const headerBytes = readSync(0, header, 0, header.byteLength, null)
  if (headerBytes < 4) {
    return undefined
  }

  const messageLength = header.readUInt32LE(0)
  if (messageLength <= 0) {
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

export async function runNativeMessagingHost(request = readNativeMessageSync()) {
  const controller = new BrowserExtensionController()

  try {
    if (!request) {
      writeNativeMessage({
        id: 'unknown',
        ok: false,
        error: {
          code: 'invalid_message',
          message: 'No native messaging request was received.',
        },
      })
      return
    }

    const response = await controller.handle(request)
    writeNativeMessage(response)
  } catch (error) {
    writeNativeMessage({
      id: request?.id ?? 'unknown',
      ok: false,
      error: {
        code: 'native_host_failure',
        message: error instanceof Error ? error.message : 'The native messaging host failed.',
      },
    })
  } finally {
    controller.dispose()
  }
}
