import { readSync, writeSync } from 'node:fs'
import { PasskeyProviderBridgeController } from '@/electron/passkey-provider-controller'
import type { PasskeyProviderBridgeRequest, PasskeyProviderBridgeResponse } from '@/shared/passkey-provider-bridge'

export const readPasskeyProviderMessageSync = () => {
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

  return JSON.parse(messageBuffer.toString('utf8')) as PasskeyProviderBridgeRequest
}

const writeMessage = (response: PasskeyProviderBridgeResponse) => {
  const message = Buffer.from(JSON.stringify(response), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(message.byteLength, 0)
  writeSync(1, Buffer.concat([header, message]))
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
        message: error instanceof Error ? error.message : 'The passkey provider bridge failed.',
      },
    })
  } finally {
    controller.dispose()
  }
}
