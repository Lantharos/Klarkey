export type RuntimeModeInput = {
  isPackaged: boolean
  argv: string[]
  env: NodeJS.ProcessEnv
}

export type RuntimeMode = {
  isDevMode: boolean
  devServerUrl?: string
}

const defaultDevServerUrl = 'http://127.0.0.1:5173'
const localDevHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

function normalizeLocalDevServerUrl(value: string | undefined) {
  const raw = (value || defaultDevServerUrl).trim()
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' || !localDevHosts.has(url.hostname)) {
      return undefined
    }
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1'
    }
    return url.origin
  } catch {
    return undefined
  }
}

export function resolveRuntimeMode(input: RuntimeModeInput): RuntimeMode {
  if (input.isPackaged) {
    return { isDevMode: false }
  }

  const devServerUrl = input.env.VITE_DEV_SERVER_URL
  const wantsDevMode = input.argv.includes('--dev') || Boolean(devServerUrl)
  if (!wantsDevMode) {
    return { isDevMode: false }
  }

  const safeDevServerUrl = normalizeLocalDevServerUrl(devServerUrl)
  if (!safeDevServerUrl) {
    return { isDevMode: false }
  }

  return {
    isDevMode: true,
    devServerUrl: safeDevServerUrl,
  }
}
