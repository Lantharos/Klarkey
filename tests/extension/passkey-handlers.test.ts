import { afterEach, describe, expect, it, vi } from 'vitest'

type ExtensionMessage = {
  type: string
  payload?: {
    itemId?: string
    [key: string]: unknown
  }
}

type HandlerLoaderOptions = {
  createChoice?: { itemId?: string; createNew: boolean } | undefined
  getChoice?: string | undefined
  sendMessage: (message: ExtensionMessage) => Promise<unknown>
}

const loadHandlers = async (options: HandlerLoaderOptions) => {
  const createChoice =
    'createChoice' in options ? options.createChoice : { itemId: 'item-1', createNew: false }
  const getChoice = 'getChoice' in options ? options.getChoice : 'credential-1'
  const { sendMessage } = options

  vi.resetModules()
  vi.doMock('../../extension/shared/content/page/runtime.js', () => ({ sendMessage }))
  vi.doMock('../../extension/shared/content/page/ui/banners.js', () => ({
    promptPasskeyCreateChoice: vi.fn().mockResolvedValue(createChoice),
    promptPasskeyGetChoice: vi.fn().mockResolvedValue(getChoice),
  }))

  return import('../../extension/shared/content/page/passkey/handlers.js')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('extension page passkey handlers', () => {
  it('saves a created passkey before returning it to the page', async () => {
    const calls: string[] = []
    const sendMessage = vi.fn(async (message: ExtensionMessage) => {
      calls.push(message.type)

      switch (message.type) {
        case 'plan-passkey-create':
          return {
            ok: true,
            plan: {
              rpId: 'example.com',
              userName: 'person@example.com',
              suggestedMatch: {
                itemId: 'item-1',
                itemName: 'Example',
              },
            },
          }
        case 'create-passkey-credential':
          return {
            ok: true,
            responseJson: '{"id":"credential-1"}',
            credentialId: 'credential-1',
            pendingPasskeyId: 'pending-1',
          }
        case 'save-passkey-credential':
          return {
            ok: true,
            message: 'Passkey saved.',
            itemId: message.payload?.itemId,
          }
        default:
          throw new Error(`Unexpected message: ${message.type}`)
      }
    })
    const { handlePagePasskeyCreate } = await loadHandlers({ sendMessage })

    const result = await handlePagePasskeyCreate('{"challenge":"abc"}')

    expect(calls).toEqual(['plan-passkey-create', 'create-passkey-credential', 'save-passkey-credential'])
    expect(sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'save-passkey-credential',
        payload: expect.objectContaining({
          pendingPasskeyId: 'pending-1',
          itemId: 'item-1',
          createNew: false,
        }),
      }),
    )
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        responseJson: '{"id":"credential-1"}',
        itemId: 'item-1',
      }),
    )
  })

  it('discards a prepared passkey when saving fails', async () => {
    const calls: string[] = []
    const sendMessage = vi.fn(async (message: ExtensionMessage) => {
      calls.push(message.type)

      switch (message.type) {
        case 'plan-passkey-create':
          return {
            ok: true,
            plan: {
              rpId: 'example.com',
              userName: 'person@example.com',
            },
          }
        case 'create-passkey-credential':
          return {
            ok: true,
            responseJson: '{"id":"credential-1"}',
            credentialId: 'credential-1',
            pendingPasskeyId: 'pending-1',
          }
        case 'save-passkey-credential':
          return {
            ok: false,
            message: 'Save failed.',
          }
        case 'discard-passkey-credential':
          return { ok: true }
        default:
          throw new Error(`Unexpected message: ${message.type}`)
      }
    })
    const { handlePagePasskeyCreate } = await loadHandlers({
      createChoice: { createNew: true },
      sendMessage,
    })

    const result = await handlePagePasskeyCreate('{"challenge":"abc"}')

    expect(calls).toEqual([
      'plan-passkey-create',
      'create-passkey-credential',
      'save-passkey-credential',
      'discard-passkey-credential',
    ])
    expect(result).toEqual({
      ok: false,
      error: {
        name: 'NotAllowedError',
        message: 'Save failed.',
      },
    })
  })

  it('cancels passkey creation before creating a credential', async () => {
    const sendMessage = vi.fn(async (message: ExtensionMessage) => {
      if (message.type === 'plan-passkey-create') {
        return {
          ok: true,
          plan: {
            rpId: 'example.com',
            userName: 'person@example.com',
          },
        }
      }

      throw new Error(`Unexpected message: ${message.type}`)
    })
    const { handlePagePasskeyCreate } = await loadHandlers({
      createChoice: undefined,
      sendMessage,
    })

    const result = await handlePagePasskeyCreate('{"challenge":"abc"}')

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      ok: false,
      error: {
        name: 'NotAllowedError',
        message: 'The passkey request was canceled.',
      },
    })
  })

  it('lets locked passkey choices unlock only after the user selects one', async () => {
    const calls: string[] = []
    const sendMessage = vi.fn(async (message: ExtensionMessage) => {
      calls.push(message.type)

      switch (message.type) {
        case 'plan-passkey-get':
          return {
            ok: true,
            locked: true,
            choices: [
              {
                credentialId: 'credential-1',
                itemId: 'item-1',
                itemName: 'Example',
                userName: 'person@example.com',
                rpId: 'example.com',
              },
            ],
          }
        case 'get-passkey-credential':
          return {
            ok: true,
            responseJson: '{"id":"credential-1"}',
            credentialId: 'credential-1',
          }
        default:
          throw new Error(`Unexpected message: ${message.type}`)
      }
    })
    const { handlePagePasskeyGet } = await loadHandlers({ sendMessage })

    const result = await handlePagePasskeyGet('{"challenge":"abc"}')

    expect(calls).toEqual(['plan-passkey-get', 'get-passkey-credential'])
    expect(sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'get-passkey-credential',
        payload: expect.objectContaining({
          credentialId: 'credential-1',
        }),
      }),
    )
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        responseJson: '{"id":"credential-1"}',
      }),
    )
  })
})
