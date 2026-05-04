import { overlayRoot } from './overlay.js'
import { pageState, matchFetch, timers, menuSuppress, browserSettings } from './state.js'
import { runtime, sendMessage } from './runtime.js'
import { getDeepActiveElement, isFieldElement, visible } from './dom.js'
import { suppressInlineMenu } from './menu-suppress.js'
import { loadBrowserSettings } from './settings.js'
import {
  getInputs,
  setPendingUsername,
  setPendingOtp,
  getPendingOtp,
  getPendingUsername,
  injectPageBridge,
  ensurePageBridgeReady,
  isPasswordInput,
} from './forms/forms.js'
import { writeValue, writeSplitOtp, collectFormSnapshot, scheduleLoginAutoSubmit } from './autofill/write-submit.js'
import { removeInlineUi, moveActiveMenuIndex } from './ui/inline-ui.js'
import {
  refreshMatches,
  refreshFieldSuggestions,
  restorePendingSavePrompt,
  maybePromptToSave,
} from './vault.js'
import { scanForSsoButtons, maybePromptSsoSave, highlightSavedSsoButtons } from './sso/index.js'
import { fieldKindFor, suggestionFlowFor, shouldAutoOpenFieldMenu } from './field-meta.js'
import { renderInlineMenu, renderInlineTriggerOnly } from './ui/menu.js'
import { handlePagePasskeyCreate, handlePagePasskeyGet } from './passkey/handlers.js'
import { buildPagePasskeyResponse, readPagePasskeyRequest } from './passkey/page-message.js'
import { suppressBrowserAutofill } from './autofill/autofill.js'

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) {
    return
  }

  const request = readPagePasskeyRequest(event.data)
  if (!request) {
    return
  }

  void (async () => {
    const payload = await (async () => {
      if ('error' in request) {
        return {
          ok: false,
          error: request.error,
        }
      }

      await ensurePageBridgeReady()
      return request.operation === 'create'
        ? handlePagePasskeyCreate(request.requestDetailsJson)
        : handlePagePasskeyGet(request.requestDetailsJson)
    })().catch((error) => ({
      ok: false,
      error: {
        name: 'NotAllowedError',
        message: error instanceof Error ? error.message : 'The passkey request could not be completed.',
      },
    }))

    window.postMessage(buildPagePasskeyResponse(request.id, payload), window.location.origin)
  })()
})

const handleFieldFocus = async (target) => {
  if (!isFieldElement(target) || !visible(target)) {
    return
  }

  const fieldKind = fieldKindFor(target)
  if (!fieldKind) {
    return
  }

  if (fieldKind === 'otp') {
    const pendingOtp = getPendingOtp()
    if (pendingOtp) {
      suppressInlineMenu()
      const { splitOtpTargets } = getInputs(target)
      if (splitOtpTargets?.length) {
        writeSplitOtp(splitOtpTargets, pendingOtp)
      } else {
        writeValue(target, pendingOtp)
      }
      setPendingOtp('')
      removeInlineUi()
      return
    }
  }

  if (pageState.lastListUrl !== window.location.href) {
    pageState.lastListUrl = window.location.href
    pageState.matches = []
  }

  const generation = ++matchFetch.generation
  pageState.overlayInput = target
  suppressBrowserAutofill(target)

  renderInlineTriggerOnly(target)

  if (Date.now() < menuSuppress.until && target === menuSuppress.input) {
    return
  }

  const autoOpen = browserSettings.browserAutoOpenMenu && target.dataset.klarkeyAutoOpen !== 'false'
  await Promise.all([
    refreshMatches(),
    fieldKind === 'password' || fieldKind === 'otp' ? Promise.resolve([]) : refreshFieldSuggestions(fieldKind, suggestionFlowFor(target, fieldKind)),
  ])

  if (generation !== matchFetch.generation || pageState.overlayInput !== target) {
    return
  }

  if (autoOpen && shouldAutoOpenFieldMenu(target)) {
    renderInlineMenu(target, pageState.matches, { loading: false })
  }
}

document.addEventListener('focusin', async (event) => {
  await handleFieldFocus(event.composedPath?.()[0] || event.target)
})

document.addEventListener('click', (event) => {
  const target = event.composedPath?.()[0] || event.target
  if (target instanceof Element && target.closest('.klarkey-inline-menu, .klarkey-save-banner')) {
    return
  }

  if (pageState.activeSaveBannerKey && overlayRoot.querySelector('.klarkey-save-banner')) {
    return
  }

  if (pageState.overlayInput && target === pageState.overlayInput) {
    return
  }

  removeInlineUi()
})

document.addEventListener('scroll', () => {
  if (isFieldElement(pageState.overlayInput) && visible(pageState.overlayInput)) {
    if (pageState.menuOpen) {
      renderInlineMenu(pageState.overlayInput, pageState.matches)
    } else {
      renderInlineTriggerOnly(pageState.overlayInput)
    }
  } else {
    removeInlineUi()
  }
}, true)

window.addEventListener('resize', () => {
  if (isFieldElement(pageState.overlayInput) && visible(pageState.overlayInput)) {
    if (pageState.menuOpen) {
      renderInlineMenu(pageState.overlayInput, pageState.matches)
    } else {
      renderInlineTriggerOnly(pageState.overlayInput)
    }
  } else {
    removeInlineUi()
  }
})

document.addEventListener('submit', () => {
  const inputs = getInputs()
  pageState.formSnapshot = {
    username: inputs.username?.value?.trim() || getPendingUsername(),
    password: inputs.password?.value?.trim() || '',
  }

  if (pageState.formSnapshot.username) {
    setPendingUsername(pageState.formSnapshot.username)
  }

  window.setTimeout(() => {
    void maybePromptToSave(inputs.password || inputs.username, true)
  }, 180)
}, true)

// Scan for SSO buttons periodically and on interactions
window.setInterval(() => {
  scanForSsoButtons()
  highlightSavedSsoButtons(pageState.matches)
  void maybePromptSsoSave()
}, 2000)

// Check for returning from OAuth redirect
window.setTimeout(() => {
  void maybePromptSsoSave()
}, 800)

document.addEventListener(
  'blur',
  (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || !isPasswordInput(target)) {
      return
    }

    const password = target.value?.trim()
    if (!password) {
      return
    }

    window.clearTimeout(timers.savePrompt)
    timers.savePrompt = window.setTimeout(() => {
      void maybePromptToSave(target, false)
    }, 450)
  },
  true,
)

window.addEventListener('popstate', () => {
  pageState.lastListUrl = ''
})

document.addEventListener('keydown', (event) => {
  if (!event.isTrusted) {
    return
  }

  if (event.key === 'Escape') {
    const dismissButton = overlayRoot.querySelector('.klarkey-save-banner [data-action="dismiss"]')
    if (dismissButton instanceof HTMLButtonElement) {
      dismissButton.click()
      return
    }

    removeInlineUi()
    return
  }

  if (!pageState.overlayInput || !overlayRoot.querySelector('.klarkey-inline-menu')) {
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActiveMenuIndex(1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActiveMenuIndex(-1)
    return
  }

  if (event.key === 'Enter' && pageState.activeMenuIndex >= 0) {
    const activeAction = pageState.activeMenuActions[pageState.activeMenuIndex]
    if (activeAction) {
      event.preventDefault()
      void activeAction(event)
    }
  }
})

if (runtime) {
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'collect-page-context') {
      const snapshot = collectFormSnapshot()
      sendResponse({
        url: window.location.href,
        title: document.title,
        form: snapshot,
      })
      return
    }

    if (message?.type === 'fill-login') {
      const inputs = getInputs()
      const preferredInput = inputs.password || inputs.username
      suppressInlineMenu(preferredInput)
      writeValue(inputs.username, message.login?.username)
      writeValue(inputs.password, message.login?.password)
      if (inputs.splitOtpTargets?.length && message.login?.otp) {
        writeSplitOtp(inputs.splitOtpTargets, message.login.otp)
      } else {
        writeValue(inputs.otp, message.login?.otp)
      }
      setPendingUsername(message.login?.username || '')
      setPendingOtp(message.login?.otp || '')
      removeInlineUi()
      scheduleLoginAutoSubmit(preferredInput)

      sendResponse({
        ok: true,
        message: 'Klarkey filled the detected fields on this page.',
      })
      return
    }

  })

  injectPageBridge()
  void loadBrowserSettings().finally(() => {
    void refreshMatches()
    restorePendingSavePrompt()
    window.setTimeout(() => {
      void handleFieldFocus(getDeepActiveElement())
    }, 0)
  })
}


export { handleFieldFocus }
