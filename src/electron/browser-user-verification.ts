import { readCreateUserVerification, readGetUserVerification } from '@/electron/passkey-user-verification'
import {
  getSystemUserVerificationAvailability,
  getSystemUserVerificationLabel,
  verifyWithSystemUser,
} from '@/electron/os-user-verification'
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

const buildSystemVerificationMessage = (operation: 'create' | 'get', url: string) => {
  const hostname = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return 'this site'
    }
  })()

  const label = getSystemUserVerificationLabel()
  return operation === 'create'
    ? `Verify with ${label} to create a passkey for ${hostname} in Klarkey.`
    : `Verify with ${label} to sign in to ${hostname} with Klarkey.`
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

  const availability = await getSystemUserVerificationAvailability()
  if (!availability.available) {
    if (requestedVerification === 'required') {
      return {
        ok: false,
        result: {
          status: 'error',
          title: `${availability.label} required`,
          message: availability.message || `Klarkey could not reach ${availability.label} for this passkey request.`,
        },
      }
    }

    return {
      ok: true,
      userVerified: false,
    }
  }

  const verification = await verifyWithSystemUser(buildSystemVerificationMessage(operation, url))
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
        title: `${availability.label} canceled`,
        message: verification.message || `${availability.label} verification was canceled.`,
      },
    }
  }

  if (requestedVerification === 'required') {
    return {
      ok: false,
      result: {
        status: 'error',
        title: `${availability.label} required`,
        message: verification.message || `${availability.label} verification did not complete.`,
      },
    }
  }

  return {
    ok: true,
    userVerified: false,
  }
}
