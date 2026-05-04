import { readCreateUserVerification, readGetUserVerification } from '@/electron/passkey-user-verification'
import { getWindowsHelloAvailability, verifyWithWindowsHello } from '@/electron/windows-hello-verifier'
import type { ActionExecutionResult } from '@/shared/types'

type BrowserUserVerificationResult =
  | {
      ok: true
      userVerified: boolean
    }
  | {
      ok: false
      result: ActionExecutionResult
    }

const buildWindowsHelloMessage = (operation: 'create' | 'get', url: string) => {
  const hostname = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return 'this site'
    }
  })()

  return operation === 'create'
    ? `Verify with Windows Hello to create a passkey for ${hostname} in Klarkey.`
    : `Verify with Windows Hello to sign in to ${hostname} with Klarkey.`
}

export async function resolveBrowserUserVerification(
  operation: 'create' | 'get',
  requestDetailsJson: string,
  url: string,
): Promise<BrowserUserVerificationResult> {
  const requestedVerification =
    operation === 'create' ? readCreateUserVerification(requestDetailsJson) : readGetUserVerification(requestDetailsJson)

  if (requestedVerification === 'discouraged') {
    return {
      ok: true,
      userVerified: false,
    }
  }

  const availability = await getWindowsHelloAvailability()
  if (!availability.available) {
    if (requestedVerification === 'required') {
      return {
        ok: false,
        result: {
          status: 'error',
          title: 'Windows Hello required',
          message: availability.message || 'Klarkey could not reach Windows Hello for this passkey request.',
        },
      }
    }

    return {
      ok: true,
      userVerified: false,
    }
  }

  const verification = await verifyWithWindowsHello(buildWindowsHelloMessage(operation, url))
  if (verification.verified) {
    return {
      ok: true,
      userVerified: true,
    }
  }

  if (verification.canceled) {
    return {
      ok: false,
      result: {
        status: 'error',
        title: 'Windows Hello canceled',
        message: verification.message || 'Windows Hello verification was canceled.',
      },
    }
  }

  if (requestedVerification === 'required') {
    return {
      ok: false,
      result: {
        status: 'error',
        title: 'Windows Hello required',
        message: verification.message || 'Windows Hello verification did not complete.',
      },
    }
  }

  return {
    ok: true,
    userVerified: false,
  }
}
