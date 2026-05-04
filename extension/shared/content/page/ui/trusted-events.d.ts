export function isTrustedUserAction(event: { isTrusted?: boolean } | undefined): boolean

export function runTrustedUserAction(
  event: { isTrusted?: boolean } | undefined,
  action: (event: { isTrusted?: boolean }) => unknown,
): boolean
