export function getPendingSavePrompt(): unknown
export function setPendingSavePrompt(payload: unknown): void
export function clearPendingSavePrompt(): void
export function savePromptKeyFor(input: { username?: string; password?: string; ssoProvider?: string }): string
export function passkeyPromptKeyFor(...parts: unknown[]): string
