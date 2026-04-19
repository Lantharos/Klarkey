import { sendMessage } from '../runtime.js'
import { promptPasskeyGetChoice } from '../ui/banners.js'
import { finalizePreparedPasskeySave } from './finalize.js'

const handlePagePasskeyCreate = async (requestDetailsJson) => {
  const plan = await sendMessage({
    type: 'plan-passkey-create',
    payload: {
      url: window.location.href,
      title: document.title,
      requestDetailsJson,
    },
  }).catch(() => undefined)

  if (!plan?.ok || !plan.plan) {
    return { fallbackToBrowser: true }
  }

  const result = await sendMessage({
    type: 'create-passkey-credential',
    payload: {
      origin: window.location.origin,
      url: window.location.href,
      title: document.title,
      requestDetailsJson,
    },
  })
    .catch((error) => ({
      ok: false,
      error: {
        name: 'NotAllowedError',
        message: error instanceof Error ? error.message : 'Klarkey could not create this passkey.',
      },
    }))

  if (!result?.ok) {
    return {
      ok: false,
      error: {
        name: 'NotAllowedError',
        message: result?.message || result?.error?.message || 'Klarkey could not create this passkey.',
      },
    }
  }

  finalizePreparedPasskeySave({
    pendingPasskeyId: result.pendingPasskeyId,
    requestDetailsJson,
    plan: plan.plan,
  })

  return result
}

const handlePagePasskeyGet = async (requestDetailsJson) => {
  const plan = await sendMessage({
    type: 'plan-passkey-get',
    payload: {
      url: window.location.href,
      title: document.title,
      requestDetailsJson,
    },
  }).catch(() => undefined)

  if (!plan?.ok) {
    return { fallbackToBrowser: true }
  }

  if (!plan.choices?.length) {
    return { fallbackToBrowser: true }
  }

  const selectedCredentialId = await promptPasskeyGetChoice(plan.choices)
  if (!selectedCredentialId) {
    return {
      ok: false,
      error: {
        name: 'NotAllowedError',
        message: 'The passkey request was canceled.',
      },
    }
  }

  return sendMessage({
    type: 'get-passkey-credential',
    payload: {
      origin: window.location.origin,
      url: window.location.href,
      title: document.title,
      requestDetailsJson,
      credentialId: selectedCredentialId,
    },
  })
    .then((result) =>
      result?.ok
        ? result
        : {
            ok: false,
            error: {
              name: 'NotAllowedError',
              message: result?.message || 'Klarkey could not use this passkey.',
            },
          },
    )
    .catch((error) => ({
      ok: false,
      error: {
        name: 'NotAllowedError',
        message: error instanceof Error ? error.message : 'Klarkey could not use this passkey.',
      },
    }))
}

export { handlePagePasskeyCreate, handlePagePasskeyGet }
