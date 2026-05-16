import { sendMessage } from '../runtime.js'
import { promptPasskeyCreateChoice, promptPasskeyGetChoice, promptPasskeyUnlock } from '../ui/banners.js'

const deniedPasskeyRequest = (message) => ({
  ok: false,
  error: {
    name: 'NotAllowedError',
    message,
  },
})

const requestPasskeyGetPlan = (requestDetailsJson, { unlock = false } = {}) =>
  sendMessage({
    type: 'plan-passkey-get',
    payload: {
      url: window.location.href,
      title: document.title,
      requestDetailsJson,
      ...(unlock ? { unlock: true } : {}),
    },
  }).catch(() => undefined)

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

  const selection = await promptPasskeyCreateChoice(plan.plan)
  if (!selection) {
    return deniedPasskeyRequest('The passkey request was canceled.')
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
    return deniedPasskeyRequest(result?.message || result?.error?.message || 'Klarkey could not create this passkey.')
  }

  if (!result.pendingPasskeyId) {
    return deniedPasskeyRequest('Klarkey could not save this passkey.')
  }

  const save = await sendMessage({
    type: 'save-passkey-credential',
    payload: {
      url: window.location.href,
      title: document.title,
      requestDetailsJson,
      pendingPasskeyId: result.pendingPasskeyId,
      itemId: selection.itemId,
      createNew: selection.createNew,
    },
  }).catch((error) => ({
    ok: false,
    message: error instanceof Error ? error.message : 'Klarkey could not save this passkey.',
  }))

  if (!save?.ok) {
    await sendMessage({
      type: 'discard-passkey-credential',
      payload: {
        url: window.location.href,
        title: document.title,
        pendingPasskeyId: result.pendingPasskeyId,
      },
    }).catch(() => undefined)
    return deniedPasskeyRequest(save?.message || 'Klarkey could not save this passkey.')
  }

  return {
    ...result,
    itemId: save.itemId,
    message: save.message,
  }
}

const handlePagePasskeyGet = async (requestDetailsJson) => {
  let plan = await requestPasskeyGetPlan(requestDetailsJson)

  if (!plan?.ok) {
    return { fallbackToBrowser: true }
  }

  if (!plan.choices?.length && plan.locked === true && plan.needsUnlockForChoices === true) {
    const shouldUnlock = await promptPasskeyUnlock()
    if (!shouldUnlock) {
      return deniedPasskeyRequest('The passkey request was canceled.')
    }

    plan = await requestPasskeyGetPlan(requestDetailsJson, { unlock: true })
    if (!plan?.ok) {
      return deniedPasskeyRequest(plan?.message || 'Klarkey could not unlock passkeys for this site.')
    }
  }

  if (!plan.choices?.length) {
    return { fallbackToBrowser: true }
  }

  const selectedCredentialId = await promptPasskeyGetChoice(plan.choices, { locked: plan.locked === true })
  if (!selectedCredentialId) {
    return deniedPasskeyRequest('The passkey request was canceled.')
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
        : deniedPasskeyRequest(result?.message || 'Klarkey could not use this passkey.'),
    )
    .catch((error) => deniedPasskeyRequest(error instanceof Error ? error.message : 'Klarkey could not use this passkey.'))
}

export { handlePagePasskeyCreate, handlePagePasskeyGet }
