import type { ActionExecutionResult } from '@/shared/types'

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
            ready: true
            bridge: 'klarkey-passkey-provider'
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
