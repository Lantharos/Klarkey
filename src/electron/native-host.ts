import { stdin, stdout } from 'node:process'
import { BrowserExtensionController } from '@/electron/extension-controller'
import type { BrowserExtensionRequest, BrowserExtensionResponse } from '@/shared/browser-extension'

const readNativeMessage = async () => {
  const chunks: Buffer[] = []

  for await (const chunk of stdin) {
    chunks.push(chunk as Buffer)
  }

  const payload = Buffer.concat(chunks)
  if (payload.byteLength < 4) {
    return undefined
  }

  const messageLength = payload.readUInt32LE(0)
  const messageBuffer = payload.subarray(4, 4 + messageLength)
  return JSON.parse(messageBuffer.toString('utf8')) as BrowserExtensionRequest
}

const writeNativeMessage = (response: BrowserExtensionResponse) => {
  const message = Buffer.from(JSON.stringify(response), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(message.byteLength, 0)
  stdout.write(Buffer.concat([header, message]))
}

export async function runNativeMessagingHost() {
  const request = await readNativeMessage()
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
