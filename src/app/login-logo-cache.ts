const cacheName = 'klarkey-login-logos-v1'

const resolvedLogoCache = new Map<string, string | null>()
const inflightLogoCache = new Map<string, Promise<string | null>>()

function isLocalLogoUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'data:' || parsed.protocol === 'blob:'
  } catch {
    return false
  }
}

function isLogoDevUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'img.logo.dev' && parsed.searchParams.has('token')
  } catch {
    return false
  }
}

async function readCachedResponse(url: string) {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return undefined
  }

  const cache = await window.caches.open(cacheName)
  return cache.match(url)
}

async function writeCachedResponse(url: string, response: Response) {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return
  }

  const cache = await window.caches.open(cacheName)
  await cache.put(url, response)
}

async function fetchLogoResponse(url: string) {
  if (!isLocalLogoUrl(url) && !isLogoDevUrl(url)) {
    return null
  }

  const cached = await readCachedResponse(url)
  if (cached) {
    return cached
  }

  const response = await fetch(url, {
    mode: 'cors',
    cache: 'force-cache',
    referrerPolicy: 'origin',
  })

  if (!response.ok) {
    return null
  }

  await writeCachedResponse(url, response.clone())
  return response
}

async function resolveLoginLogo(url: string) {
  if (resolvedLogoCache.has(url)) {
    return resolvedLogoCache.get(url) ?? null
  }

  const pending = inflightLogoCache.get(url)
  if (pending) {
    return pending
  }

  const request = fetchLogoResponse(url)
    .then(async (response) => {
      if (!response) {
        resolvedLogoCache.set(url, null)
        return null
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      resolvedLogoCache.set(url, objectUrl)
      return objectUrl
    })
    .catch(() => {
      resolvedLogoCache.set(url, null)
      return null
    })
    .finally(() => {
      inflightLogoCache.delete(url)
    })

  inflightLogoCache.set(url, request)
  return request
}

export function getCachedLoginLogo(url: string) {
  return resolveLoginLogo(url)
}
