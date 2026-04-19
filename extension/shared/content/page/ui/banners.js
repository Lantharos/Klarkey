import { overlayRoot } from '../overlay.js'
import { pageState, timers, browserSettings } from '../state.js'
import { sendMessage } from '../runtime.js'
import { removeInlineUi } from './inline-ui.js'
import { savePromptKeyFor, clearPendingSavePrompt, passkeyPromptKeyFor } from '../pending-save.js'
import { setPendingUsername } from '../forms/forms.js'

const showSaveBanner = ({ username, password, reason }) => {
  if (!browserSettings.browserSavePrompts) {
    return
  }

  const promptKey = savePromptKeyFor({ username, password })
  if (pageState.activeSaveBannerKey === promptKey) {
    return
  }

  removeInlineUi()
  pageState.activeSaveBannerKey = promptKey
  const banner = document.createElement('section')
  banner.className = 'klarkey-save-banner'
  banner.innerHTML = `
    <div class="klarkey-save-title">${reason === 'update' ? 'Update login in Klarkey?' : 'Save login in Klarkey?'}</div>
    <p class="klarkey-save-copy">${
      reason === 'update'
        ? `${username || 'This account'} looks updated on ${window.location.hostname}.`
        : `${username || 'This account'} was used on ${window.location.hostname}.`
    }</p>
    <div class="klarkey-save-actions">
      <button class="klarkey-save-button primary" data-action="save">${reason === 'update' ? 'Update' : 'Save'}</button>
      <button class="klarkey-save-button" data-action="dismiss">Dismiss</button>
    </div>
  `

  const dismiss = () => {
    window.clearTimeout(timers.savePrompt)
    pageState.lastSavePromptKey = promptKey
    pageState.activeSaveBannerKey = ''
    banner.classList.add('hidden')
    window.setTimeout(() => {
      if (banner.isConnected) {
        banner.remove()
      }
    }, 160)
  }

  banner.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const response = await sendMessage({
      type: 'save-login-payload',
      payload: {
        url: window.location.href,
        title: document.title,
        username,
        password,
      },
    }).catch((error) => ({
      ok: false,
      message: error instanceof Error ? error.message : 'Klarkey could not save this login.',
    }))

    banner.querySelector('.klarkey-save-copy').textContent = response.message || 'Saved.'
    if (response.ok) {
      pageState.matches = []
      pageState.lastSavePromptKey = promptKey
      setPendingUsername(username || '')
      clearPendingSavePrompt()
    }
    dismiss()
  })

  banner.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
    clearPendingSavePrompt()
    dismiss()
  })
  overlayRoot.appendChild(banner)
}

const presentPasskeyBanner = ({ promptKey, title, copy, choices, dismissLabel = 'Cancel' }) =>
  new Promise((resolve) => {
    removeInlineUi()
    pageState.activeSaveBannerKey = promptKey
    const banner = document.createElement('section')
    banner.className = 'klarkey-save-banner'
    banner.innerHTML = `
      <div class="klarkey-save-title">${title}</div>
      <p class="klarkey-save-copy">${copy}</p>
      <div class="klarkey-save-choice-list"></div>
      <div class="klarkey-save-actions">
        <button class="klarkey-save-button" data-action="dismiss">${dismissLabel}</button>
      </div>
    `

    const choiceList = banner.querySelector('.klarkey-save-choice-list')
    const dismiss = (value) => {
      pageState.activeSaveBannerKey = ''
      banner.classList.add('hidden')
      window.setTimeout(() => {
        if (banner.isConnected) {
          banner.remove()
        }
        resolve(value)
      }, 160)
    }

    for (const choice of choices) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'klarkey-save-choice'
      button.innerHTML = `
        <div class="klarkey-save-choice-title">${choice.title}</div>
        <div class="klarkey-save-choice-copy">${choice.copy}</div>
      `
      button.addEventListener('click', () => dismiss(choice.value))
      choiceList.appendChild(button)
    }

    banner.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
      dismiss(undefined)
    })

    overlayRoot.appendChild(banner)
  })

const promptPasskeyCreateChoice = async ({ rpId, userName, itemName, suggestedMatch }) => {
  const existingItemId = suggestedMatch?.itemId
  const existingLabel = suggestedMatch?.itemName
  const promptKey = passkeyPromptKeyFor('passkey-create', rpId, userName, existingItemId)
  const choices = [
    existingItemId && existingLabel
      ? {
          value: { itemId: existingItemId, createNew: false },
          title: `Save to ${existingLabel}`,
          copy: `${userName || itemName || 'This passkey'} will be linked to that existing login.`,
        }
      : {
          value: { itemId: undefined, createNew: true },
          title: 'Save as new item',
          copy: `${userName || itemName || 'This passkey'} will create a fresh login in Klarkey.`,
        },
    existingItemId
      ? {
          value: { itemId: undefined, createNew: true },
          title: 'Save as new item',
          copy: `${userName || itemName || 'This passkey'} will stay separate from your existing login.`,
        }
      : undefined,
  ].filter(Boolean)

  if (choices.length <= 1) {
    return choices[0]?.value
  }

  return presentPasskeyBanner({
    promptKey,
    title: 'Save passkey in Klarkey?',
    copy:
      existingItemId && existingLabel
        ? `${userName || 'This account'} matches ${existingLabel} on ${window.location.hostname}.`
        : `${userName || itemName || 'This account'} can be saved in Klarkey for ${window.location.hostname}.`,
    choices,
  })
}

const promptPasskeyGetChoice = async (choices) => {
  if (choices.length <= 1) {
    return choices[0]?.credentialId
  }

  return presentPasskeyBanner({
    promptKey: passkeyPromptKeyFor('passkey-get', window.location.pathname, choices.map((choice) => choice.credentialId).join(',')),
    title: 'Choose a passkey',
    copy: `Klarkey found multiple passkeys for ${window.location.hostname}.`,
    choices: choices.map((choice) => ({
      value: choice.credentialId,
      title: choice.itemName,
      copy: choice.userName || 'Passkey ready',
    })),
  })
}

export { showSaveBanner, presentPasskeyBanner, promptPasskeyCreateChoice, promptPasskeyGetChoice }
