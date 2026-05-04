export function normalizeSecureSyncUrl(value: string | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    const url = new URL(trimmed)
    if (
      url.protocol !== 'https:' ||
      Boolean(url.username) ||
      Boolean(url.password) ||
      Boolean(url.search) ||
      Boolean(url.hash) ||
      (url.pathname !== '' && url.pathname !== '/')
    ) {
      return undefined
    }
    return url.origin
  } catch {
    return undefined
  }
}

export const secureSyncUrlError = (name: string) =>
  `${name} must be an HTTPS origin without credentials, path, query, or fragment.`
