type PasskeyHandlerResult =
  | { fallbackToBrowser: true }
  | {
      ok: true
      responseJson: string
      credentialId?: string
      pendingPasskeyId?: string
      itemId?: string
      message?: string
    }
  | {
      ok: false
      error: {
        name: string
        message: string
      }
    }

export function handlePagePasskeyCreate(requestDetailsJson: string): Promise<PasskeyHandlerResult>
export function handlePagePasskeyGet(requestDetailsJson: string): Promise<PasskeyHandlerResult>
