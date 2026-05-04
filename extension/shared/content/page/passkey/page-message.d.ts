type PagePasskeyOperation = 'create' | 'get'

type PagePasskeyError = {
  name: string
  message: string
}

type PagePasskeyRequest =
  | {
      id: string
      operation: PagePasskeyOperation
      requestDetailsJson: string
    }
  | {
      id: string
      error: PagePasskeyError
    }

export function readPagePasskeyRequest(data: unknown): PagePasskeyRequest | undefined
export function buildPagePasskeyResponse(id: string, payload: unknown): {
  source: 'klarkey-page-authenticator-response'
  id: string
  payload: unknown
}
export function safePagePasskeyErrorMessage(message: unknown, fallback?: string): string
export function sanitizePagePasskeyResponsePayload(payload: unknown): unknown
