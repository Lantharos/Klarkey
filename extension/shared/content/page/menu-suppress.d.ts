export function suppressInlineMenu(input?: unknown, options?: { durationMs?: number; untilUserInteraction?: boolean }): void
export function allowAutomaticInlineMenu(): void
export function isAutomaticInlineMenuSuppressed(input?: unknown): boolean
export function hydrateInlineMenuSuppression(): Promise<boolean>
export function stopInlineLayoutTracking(): void
