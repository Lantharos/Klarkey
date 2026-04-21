export const runtimeApi: unknown
export const nativeHostName: string
export const isChromium: boolean
export const browserKind: 'chromium' | 'firefox' | 'other'
export const OPERATION_TIMEOUT_MS: number
export const HOST_TIMEOUT_MS: number
export const UNLOCK_RETRY_WAIT_MS: number
export const UNLOCK_POLL_INTERVAL_MS: number
export const UNLOCK_GRACE_MS: number
export function createRequestId(): string
export function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs?: number): Promise<T>
export function queryTabs(queryInfo: unknown): Promise<unknown>
export function sendTabMessage(tabId: number, message: unknown): Promise<unknown>
export function rejectPendingNativeRequests(message: string): void
export function ensureNativePort(): Promise<unknown>
export function getActiveTab(): Promise<unknown>
export function getPageContext(tab: unknown): Promise<unknown>
export type NativeHostResponse<T = unknown> =
  | {
      id?: string
      ok: true
      result?: T
    }
  | {
      id?: string
      ok: false
      error?: {
        code?: string
        message?: string
      }
    }

export function requestHost<T = unknown>(payload: Record<string, unknown>): Promise<NativeHostResponse<T> | undefined>
export function ensureDesktopConnected(): Promise<boolean>
export function readDesktopCapabilities(): Promise<unknown>
export function readDesktopConnectionState(): Promise<{ connected: true } | { connected: false; error: string }>
