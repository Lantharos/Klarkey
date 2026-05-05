export function loadPopupState(): Promise<{
  connected: boolean
  updating: boolean
  desktopRequired: boolean
  browser: string
  url?: string
  title?: string
  passkeys?: {
    supported?: boolean
    status?: 'locked'
    locked?: boolean
    availablePasskeyCount?: number
    exactMatchCount?: number
    linkedMatchCount?: number
    reason?: string
  }
  chromiumProxyReady: boolean
  error?: string
}>

export function savePasskeyCredential(payload: unknown): Promise<{
  ok: boolean
  message: string
  itemId?: string
}>
