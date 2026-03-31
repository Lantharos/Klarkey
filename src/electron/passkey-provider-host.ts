import { stdin, stdout } from 'node:process'
import { PasskeyProviderBridgeController } from '@/electron/passkey-provider-controller'
import type { PasskeyProviderBridgeRequest, PasskeyProviderBridgeResponse } from '@/shared/passkey-provider-bridge'

const readMessage = async () => {
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
  return JSON.parse(messageBuffer.toString('utf8')) as PasskeyProviderBridgeRequest
}

const writeMessage = (response: PasskeyProviderBridgeResponse) => {
  const message = Buffer.from(JSON.stringify(response), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(message.byteLength, 0)
  stdout.write(Buffer.concat([header, message]))
}

export async function runPasskeyProviderBridgeHost() {
  const request = await readMessage()
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
        message: error instanceof Error ? error.message : 'The passkey provider bridge failed.',
      },
    })
  } finally {
    controller.dispose()
  }
}
