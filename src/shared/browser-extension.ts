import type { ActionExecutionResult, BrowserFillLogin, BrowserSaveLoginInput, BrowserSiteMatch } from '@/shared/types'

export const KLARKEY_NATIVE_HOST_NAME = 'app.klarkey.desktop'
export const KLARKEY_EXTENSION_PROTOCOL_VERSION = 1

export type BrowserExtensionRequest =
  | {
      id: string
      type: 'ping'
    }
  | {
      id: string
      type: 'list-logins'
      url: string
      title?: string
    }
  | {
      id: string
      type: 'get-login'
      itemId: string
    }
  | {
      id: string
      type: 'save-login'
      payload: BrowserSaveLoginInput
    }
  | {
      id: string
      type: 'passkeys-status'
      url: string
    }
  | {
      id: string
      type: 'passkey-get-request'
      url: string
      title?: string
      requestDetailsJson: string
    }
  | {
      id: string
      type: 'passkey-create-finish'
      url: string
      title?: string
      requestDetailsJson: string
      responseJson: string
    }
  | {
      id: string
      type: 'passkey-get-finish'
      credentialId: string
    }

export type BrowserExtensionResponse =
  | {
      id: string
      ok: true
      result:
        | {
            protocolVersion: number
            desktopRequired: true
          }
        | {
            matches: BrowserSiteMatch[]
          }
        | {
            login?: BrowserFillLogin
          }
        | ActionExecutionResult
        | {
            supported: false
            reason: string
          }
        | {
            supported: true
            browser: 'chromium'
            mode: 'desktop-proxy'
          }
        | {
            requestDetailsJson: string
            selectedCredentialIds: string[]
          }
    }
  | {
      id: string
      ok: false
      error: {
        code: string
        message: string
      }
    }

export const normalizeBrowserHostname = (value: string) => {
  if (!value.trim()) {
    return undefined
  }

  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`)
    return parsed.hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return undefined
  }
}

export const isHostnameMatch = (candidate: string, target: string) =>
  candidate === target || candidate.endsWith(`.${target}`) || target.endsWith(`.${candidate}`)

export const scoreWebsiteMatch = (websites: string[], url: string) => {
  const targetHostname = normalizeBrowserHostname(url)
  if (!targetHostname) {
    return 0
  }

  let score = 0
  for (const website of websites) {
    const candidateHostname = normalizeBrowserHostname(website)
    if (!candidateHostname || !isHostnameMatch(candidateHostname, targetHostname)) {
      continue
    }

    score = Math.max(score, candidateHostname === targetHostname ? 100 : 80)
  }

  return score
}

export const toDomExceptionDetails = (name: string, message: string) => ({
  name,
  message,
})
