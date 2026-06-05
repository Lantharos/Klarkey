import { overlayRoot } from '../overlay.js'
import { pageState, timers, browserSettings } from '../state.js'
import { sendMessage } from '../runtime.js'
import { removeInlineUi } from './inline-ui.js'
import { savePromptKeyFor, clearPendingSavePrompt, passkeyPromptKeyFor } from '../pending-save.js'
import { setPendingUsername } from '../forms/forms.js'
import { runTrustedUserAction } from './trusted-events.js'

const appendTextElement = (parent, tagName, className, text) => {
  const element = document.createElement(tagName)
  element.className = className
  element.textContent = text
  parent.appendChild(element)
  return element
}

const appendButton = (parent, className, text, action) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.dataset.action = action
  button.textContent = text
  parent.appendChild(button)
  return button
}

const showSaveBanner = ({ username, password, ssoProvider, reason }) => {
  if (!browserSettings.browserSavePrompts) {
    return
  }

  const promptKey = savePromptKeyFor({ username, password, ssoProvider })
  if (pageState.activeSaveBannerKey === promptKey) {
    return
  }

  removeInlineUi()
  pageState.activeSaveBannerKey = promptKey
  const banner = document.createElement('section')
  banner.className = 'klarkey-save-banner'
  appendTextElement(banner, 'div', 'klarkey-save-title', reason === 'update' ? 'Update login in Klarkey?' : 'Save login in Klarkey?')
  const copy = appendTextElement(
    banner,
    'p',
    'klarkey-save-copy',
    reason === 'update'
      ? `${username || ssoProvider || 'This account'} looks updated on ${window.location.hostname}.`
      : `${username || ssoProvider || 'This account'} was used on ${window.location.hostname}.`,
  )
  const actions = document.createElement('div')
  actions.className = 'klarkey-save-actions'
  const saveButton = appendButton(actions, 'klarkey-save-button primary', reason === 'update' ? 'Update' : 'Save', 'save')
  const dismissButton = appendButton(actions, 'klarkey-save-button', 'Dismiss', 'dismiss')
  banner.appendChild(actions)

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

  saveButton.addEventListener('click', (event) => {
    runTrustedUserAction(event, async () => {
      const response = await sendMessage({
        type: 'save-login-payload',
        payload: {
          url: window.location.href,
          title: document.title,
          username,
          password,
          ssoProvider,
        },
      }).catch((error) => ({
        ok: false,
        message: error instanceof Error ? error.message : 'Klarkey could not save this login.',
      }))

      copy.textContent = response.message || 'Saved.'
      if (response.ok) {
        pageState.matches = []
        pageState.lastSavePromptKey = promptKey
        setPendingUsername(username || '')
        clearPendingSavePrompt()
      }
      dismiss()
    })
  })

  dismissButton.addEventListener('click', (event) => {
    runTrustedUserAction(event, () => {
      clearPendingSavePrompt()
      dismiss()
    })
  })
  overlayRoot.appendChild(banner)
}

const presentPasskeyBanner = ({ promptKey, title, copy, choices, dismissLabel = 'Cancel', primaryLabel }) =>
  new Promise((resolve) => {
    removeInlineUi()
    pageState.activeSaveBannerKey = promptKey
    const banner = document.createElement('section')
    banner.className = 'klarkey-save-banner'
    appendTextElement(banner, 'div', 'klarkey-save-title', title)
    appendTextElement(banner, 'p', 'klarkey-save-copy', copy)
    const showPrimaryAction = primaryLabel && choices.length === 1
    const choiceList = showPrimaryAction ? undefined : document.createElement('div')
    if (choiceList) {
      choiceList.className = 'klarkey-save-choice-list'
      banner.appendChild(choiceList)
    }
    const actions = document.createElement('div')
    actions.className = 'klarkey-save-actions'
    const primaryButton = showPrimaryAction ? appendButton(actions, 'klarkey-save-button primary', primaryLabel, 'confirm') : undefined
    const dismissButton = appendButton(actions, 'klarkey-save-button', dismissLabel, 'dismiss')
    banner.appendChild(actions)

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

    if (primaryButton) {
      primaryButton.addEventListener('click', (event) => {
        runTrustedUserAction(event, () => dismiss(choices[0].value))
      })
    } else {
      for (const choice of choices) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'klarkey-save-choice'
        appendTextElement(button, 'div', 'klarkey-save-choice-title', choice.title)
        appendTextElement(button, 'div', 'klarkey-save-choice-copy', choice.copy)
        button.addEventListener('click', (event) => {
          runTrustedUserAction(event, () => dismiss(choice.value))
        })
        choiceList.appendChild(button)
      }
    }

    dismissButton.addEventListener('click', (event) => {
      runTrustedUserAction(event, () => dismiss(undefined))
    })

    overlayRoot.appendChild(banner)
  })

const promptPasskeyCreateChoice = async ({ rpId, userName, itemName, suggestedMatch }) => {
  const existingItemId = suggestedMatch?.itemId
  const existingLabel = suggestedMatch?.itemName
  const promptKey = passkeyPromptKeyFor('passkey-create', rpId, userName, existingItemId)
  const accountLabel = userName || itemName || 'This account'
  const choices = [
    existingItemId && existingLabel
      ? {
          value: { itemId: existingItemId, createNew: false },
          title: `Save to ${existingLabel}`,
          copy: `${accountLabel} will be linked to that existing login.`,
        }
      : {
          value: { itemId: undefined, createNew: true },
          title: 'Save as new item',
          copy: `${accountLabel} will create a fresh login in Klarkey.`,
        },
    existingItemId
      ? {
          value: { itemId: undefined, createNew: true },
          title: 'Save as new item',
          copy: `${accountLabel} will stay separate from your existing login.`,
        }
      : undefined,
  ].filter(Boolean)

  return presentPasskeyBanner({
    promptKey,
    title: 'Save passkey in Klarkey?',
    copy:
      existingItemId && existingLabel
        ? `${accountLabel} matches ${existingLabel} on ${window.location.hostname}.`
        : `${accountLabel} can be saved in Klarkey for ${window.location.hostname}.`,
    choices,
  })
}

const promptPasskeyGetChoice = async (choices, options = {}) => {
  if (!choices.length) {
    return undefined
  }

  const passkeyChoices = choices.map((choice) => {
    const label = choice.itemName || choice.userName || 'Passkey'
    return {
      value: choice.credentialId,
      title: label,
      copy: choice.userName || 'Passkey ready',
    }
  })

  return presentPasskeyBanner({
    promptKey: passkeyPromptKeyFor('passkey-get', window.location.pathname, choices.map((choice) => choice.credentialId).join(',')),
    title: passkeyChoices.length === 1 ? 'Sign in with passkey?' : 'Choose a passkey',
    copy:
      passkeyChoices.length === 1
        ? options.locked
          ? `Use ${passkeyChoices[0].title} for ${window.location.hostname}.`
          : `Klarkey will use ${passkeyChoices[0].title} for ${window.location.hostname}.`
        : options.locked
          ? 'Unlock Klarkey after you choose a passkey.'
          : `Klarkey found multiple passkeys for ${window.location.hostname}.`,
    choices: passkeyChoices,
    primaryLabel: passkeyChoices.length === 1 ? 'Sign in' : undefined,
  })
}

const promptPasskeyUnlock = async () =>
  presentPasskeyBanner({
    promptKey: passkeyPromptKeyFor('passkey-unlock', window.location.pathname),
    title: 'Unlock to use passkey?',
    copy: `Klarkey needs to unlock before checking passkeys for ${window.location.hostname}.`,
    choices: [
      {
        value: true,
        title: 'Unlock',
        copy: 'Continue with your system unlock method.',
      },
    ],
    primaryLabel: 'Unlock',
  })

export { showSaveBanner, presentPasskeyBanner, promptPasskeyCreateChoice, promptPasskeyGetChoice, promptPasskeyUnlock }
