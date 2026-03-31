const runtimeApi = globalThis.browser ?? globalThis.chrome
const runtime = runtimeApi?.runtime
const pendingPageRequests = new Map()
let pageState = {
  url: window.location.href,
  title: document.title,
  matches: [],
  overlayInput: undefined,
  formSnapshot: undefined,
  activeMenuButtons: [],
  activeMenuIndex: -1,
  lastSavePromptKey: '',
  triggerInput: undefined,
  menuOpen: false,
}

const pendingUsernameStorageKey = `klarkey:pending-username:${window.location.hostname}`

const overlayRoot = document.createElement('div')
const overlayStyle = document.createElement('style')

overlayStyle.textContent = `
  .klarkey-inline-root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483646;
    font: 13px/1.4 "Segoe UI", sans-serif;
    color: #fff;
  }

  .klarkey-inline-menu {
    position: fixed;
    min-width: 280px;
    max-width: 360px;
    background: #1a1a1b;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    box-shadow: 0 18px 44px rgba(0,0,0,0.38);
    overflow: hidden;
    pointer-events: auto;
  }

  .klarkey-inline-trigger {
    position: fixed;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    background: #202123;
    box-shadow: 0 10px 24px rgba(0,0,0,0.28);
    cursor: pointer;
    pointer-events: auto;
  }

  .klarkey-inline-trigger:hover {
    background: #26282b;
  }

  .klarkey-inline-trigger img {
    width: 16px;
    height: 16px;
    display: block;
  }

  .klarkey-inline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 11px 13px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.68);
  }

  .klarkey-inline-brand {
    font-size: 13px;
    font-weight: 500;
  }

  .klarkey-inline-subtle {
    color: rgba(255,255,255,0.46);
  }

  .klarkey-inline-list {
    display: grid;
    gap: 1px;
    background: rgba(255,255,255,0.06);
  }

  .klarkey-inline-item {
    display: grid;
    gap: 4px;
    width: 100%;
    padding: 11px 13px;
    border: 0;
    background: #202123;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .klarkey-inline-item:hover {
    background: #26282b;
  }

  .klarkey-inline-item.active,
  .klarkey-inline-action.active {
    background: #2a2c30;
  }

  .klarkey-inline-title {
    font-size: 14px;
    font-weight: 500;
    color: rgba(255,255,255,0.92);
  }

  .klarkey-inline-meta {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    color: rgba(255,255,255,0.48);
  }

  .klarkey-inline-token {
    font-size: 12px;
  }

  .klarkey-inline-empty,
  .klarkey-inline-footer {
    padding: 12px 13px;
    background: #202123;
    color: rgba(255,255,255,0.56);
  }

  .klarkey-inline-actions {
    display: grid;
    gap: 1px;
    background: rgba(255,255,255,0.06);
    border-top: 1px solid rgba(255,255,255,0.08);
  }

  .klarkey-inline-action {
    padding: 11px 13px;
    border: 0;
    background: #202123;
    color: rgba(255,255,255,0.82);
    text-align: left;
    cursor: pointer;
  }

  .klarkey-inline-action:hover {
    background: #26282b;
  }

  .klarkey-save-banner {
    position: fixed;
    top: 16px;
    right: 16px;
    width: min(360px, calc(100vw - 32px));
    background: #1a1a1b;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.42);
    padding: 14px;
    pointer-events: auto;
    transform: translateX(0);
    transition: transform 180ms ease, opacity 180ms ease;
    animation: klarkey-slide-in 180ms ease;
  }

  .klarkey-save-banner.hidden {
    opacity: 0;
    transform: translateX(20px);
  }

  .klarkey-save-title {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 6px;
  }

  .klarkey-save-copy {
    margin: 0;
    color: rgba(255,255,255,0.58);
  }

  .klarkey-save-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .klarkey-save-button {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 8px 12px;
    background: rgba(255,255,255,0.04);
    color: rgba(255,255,255,0.88);
    cursor: pointer;
  }

  .klarkey-save-button:hover {
    background: rgba(255,255,255,0.08);
  }

  .klarkey-save-button.primary {
    background: rgba(255,255,255,0.92);
    color: #111315;
  }

  .klarkey-save-button.primary:hover {
    background: #ffffff;
  }

  @keyframes klarkey-slide-in {
    from {
      opacity: 0;
      transform: translateX(16px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
`

overlayRoot.className = 'klarkey-inline-root'
document.documentElement.appendChild(overlayStyle)
document.documentElement.appendChild(overlayRoot)

const sendMessage = (message) =>
  !runtime
    ? Promise.reject(new Error('Klarkey extension runtime is unavailable in this context.'))
    : runtime.sendMessage.length === 1
      ? runtime.sendMessage(message)
      : new Promise((resolve, reject) => {
          runtime.sendMessage(message, (result) => {
            const error = globalThis.chrome?.runtime?.lastError
            if (error) {
              reject(new Error(error.message))
              return
            }

            resolve(result)
          })
        })

const visible = (element) => {
  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
}

const isTextLikeInput = (input) => ['text', 'email', 'search', 'tel', 'url'].includes(input.type)

const getInputSignals = (input) => {
  const autocomplete = (input.autocomplete || '').toLowerCase()
  const labels = []
  if (Array.isArray(input.labels)) {
    labels.push(...input.labels.map((label) => label.textContent || ''))
  }

  const describedBy = (input.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent || '')

  const marker = [
    input.name || '',
    input.id || '',
    input.placeholder || '',
    input.getAttribute('aria-label') || '',
    input.getAttribute('data-testid') || '',
    ...labels,
    ...describedBy,
  ]
    .join(' ')
    .toLowerCase()

  return {
    autocomplete,
    marker,
  }
}

const isUsernameInput = (input) => {
  const { autocomplete, marker } = getInputSignals(input)
  return isTextLikeInput(input) && (autocomplete.includes('username') || autocomplete.includes('email') || /(user|email|login)/.test(marker))
}

const isOtpInput = (input) => {
  const { autocomplete, marker } = getInputSignals(input)
  return autocomplete.includes('one-time-code') || /(otp|2fa|code|totp|auth)/.test(marker)
}

const isPasswordInput = (input) => {
  const { autocomplete, marker } = getInputSignals(input)
  return input.type === 'password' || autocomplete.includes('current-password') || /(pass|secret)/.test(marker)
}

const randomPassword = (length = 20) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

const getPendingUsername = () => {
  try {
    return window.sessionStorage.getItem(pendingUsernameStorageKey) || ''
  } catch {
    return ''
  }
}

const setPendingUsername = (username) => {
  try {
    if (username) {
      window.sessionStorage.setItem(pendingUsernameStorageKey, username)
    } else {
      window.sessionStorage.removeItem(pendingUsernameStorageKey)
    }
  } catch {
    return
  }
}

const injectPageBridge = () => {
  if (document.documentElement.dataset.klarkeyPageBridge === 'ready') {
    return
  }

  const script = document.createElement('script')
  script.src = runtime.getURL('page-bridge.js')
  script.async = false
  script.dataset.klarkeyPageBridge = 'true'
  document.documentElement.dataset.klarkeyPageBridge = 'ready'
  ;(document.head || document.documentElement).appendChild(script)
  script.remove()
}

const pickForm = (preferredInput) => {
  if (preferredInput?.form) {
    return preferredInput.form
  }

  const activeElement = document.activeElement
  if (activeElement instanceof HTMLInputElement && activeElement.form) {
    return activeElement.form
  }

  return Array.from(document.forms).find((form) =>
    Array.from(form.elements).some((element) => element instanceof HTMLInputElement && isPasswordInput(element)),
  )
}

const getInputs = (preferredInput) => {
  const form = pickForm(preferredInput)
  const root = form || document
  const inputs = Array.from(root.querySelectorAll('input')).filter(visible)
  const password = inputs.find((input) => isPasswordInput(input) && input.autocomplete !== 'new-password')
  const username = inputs.find((input) => isUsernameInput(input)) || inputs.find((input) => isTextLikeInput(input))
  const otp = inputs.find((input) => isOtpInput(input))

  return {
    form,
    username,
    password,
    otp,
  }
}

const writeValue = (input, value) => {
  if (!input || value === undefined || value === null) {
    return
  }

  input.focus()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const collectFormSnapshot = (preferredInput) => {
  const inputs = getInputs(preferredInput)
  const directUsername = inputs.username?.value?.trim() || ''
  return {
    username: directUsername || getPendingUsername(),
    password: inputs.password?.value?.trim() || '',
  }
}

const removeInlineUi = () => {
  overlayRoot.innerHTML = ''
  pageState.activeMenuButtons = []
  pageState.activeMenuIndex = -1
  pageState.menuOpen = false
}

const setActiveMenuIndex = (index) => {
  pageState.activeMenuIndex = index
  pageState.activeMenuButtons.forEach((button, buttonIndex) => {
    button.classList.toggle('active', buttonIndex === index)
  })
}

const moveActiveMenuIndex = (delta) => {
  if (!pageState.activeMenuButtons.length) {
    return
  }

  const nextIndex =
    pageState.activeMenuIndex === -1
      ? 0
      : (pageState.activeMenuIndex + delta + pageState.activeMenuButtons.length) % pageState.activeMenuButtons.length
  setActiveMenuIndex(nextIndex)
}

const showSaveBanner = ({ username, password, reason }) => {
  removeInlineUi()
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
      pageState.lastSavePromptKey = `${window.location.hostname}|${username}|${password}`
      setPendingUsername(username || '')
    }
    dismiss()
  })

  banner.querySelector('[data-action="dismiss"]').addEventListener('click', dismiss)
  overlayRoot.appendChild(banner)
}

const renderInlineTrigger = (input, onOpen) => {
  const rect = input.getBoundingClientRect()
  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'klarkey-inline-trigger'
  trigger.style.top = `${Math.max(8, rect.top + (rect.height - 28) / 2)}px`
  trigger.style.left = `${Math.max(8, Math.min(rect.right - 32, window.innerWidth - 36))}px`
  trigger.innerHTML = `<img alt="Klarkey" src="${runtime.getURL('icons/klarkey-128.png')}" />`
  trigger.addEventListener('mousedown', (event) => {
    event.preventDefault()
  })
  trigger.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    pageState.overlayInput = input
    onOpen()
  })
  overlayRoot.appendChild(trigger)
  pageState.triggerInput = input
}

const inputModeFor = (input) => (isPasswordInput(input) ? 'password' : 'username')

const renderInlineMenu = (input, matches) => {
  removeInlineUi()
  renderInlineTrigger(input, () => renderInlineMenu(input, pageState.matches))
  pageState.menuOpen = true

  const rect = input.getBoundingClientRect()
  const menu = document.createElement('section')
  menu.className = 'klarkey-inline-menu'
  const estimatedHeight = 280
  const prefersAbove = rect.bottom + estimatedHeight > window.innerHeight - 16 && rect.top > estimatedHeight
  const top = prefersAbove ? Math.max(12, rect.top - estimatedHeight - 8) : Math.min(window.innerHeight - 24, rect.bottom + 8)
  menu.style.top = `${top}px`
  menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 372))}px`

  const showGenerator = isPasswordInput(input)
  const inputMode = inputModeFor(input)
  menu.innerHTML = `
    <div class="klarkey-inline-header">
      <div class="klarkey-inline-brand">Klarkey</div>
      <div class="klarkey-inline-subtle">${inputMode === 'password' ? 'Password field' : 'Username field'}</div>
    </div>
    <div class="klarkey-inline-list"></div>
    <div class="klarkey-inline-actions"></div>
  `

  const list = menu.querySelector('.klarkey-inline-list')
  const actions = menu.querySelector('.klarkey-inline-actions')

  if (!matches.length) {
    const empty = document.createElement('div')
    empty.className = 'klarkey-inline-empty'
    empty.textContent = 'No matching items yet.'
    list.appendChild(empty)
  } else {
    for (const match of matches.slice(0, 4)) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'klarkey-inline-item'
      item.innerHTML = `
        <div class="klarkey-inline-title">${match.itemName}</div>
        <div class="klarkey-inline-subtle">${match.username || 'No username'}</div>
        <div class="klarkey-inline-meta"></div>
      `

      const meta = item.querySelector('.klarkey-inline-meta')
      if (match.hasOtp) {
        const token = document.createElement('span')
        token.className = 'klarkey-inline-token'
        token.textContent = 'OTP'
        meta.appendChild(token)
      }
      if (match.hasPasskey) {
        const token = document.createElement('span')
        token.className = 'klarkey-inline-token'
        token.textContent = 'Passkey'
        meta.appendChild(token)
      }

      item.addEventListener('click', async () => {
        const response = await sendMessage({ type: 'fetch-login', itemId: match.itemId }).catch((error) => ({
          ok: false,
          message: error instanceof Error ? error.message : 'Klarkey could not load this login.',
        }))

        if (!response.ok || !response.login) {
          return
        }

        const inputs = getInputs(input)
        if (inputMode === 'username') {
          writeValue(inputs.username, response.login.username)
          setPendingUsername(response.login.username || '')
        } else {
          writeValue(inputs.username, response.login.username)
          writeValue(inputs.password, response.login.password)
          writeValue(inputs.otp, response.login.otp)
          setPendingUsername(response.login.username || '')
        }
        removeInlineUi()
      })

      list.appendChild(item)
      pageState.activeMenuButtons.push(item)
    }
  }

  const saveAction = document.createElement('button')
  saveAction.type = 'button'
  saveAction.className = 'klarkey-inline-action'
  saveAction.textContent = inputMode === 'password' ? 'Save current login' : 'Save account for this site'
  saveAction.addEventListener('click', async () => {
    const snapshot = collectFormSnapshot(input)
    if (!snapshot.password && inputMode === 'password') {
      return
    }

    await sendMessage({
      type: 'save-login-payload',
      payload: {
        url: window.location.href,
        title: document.title,
        username: snapshot.username,
        password: snapshot.password,
      },
    }).catch(() => undefined)
    removeInlineUi()
  })
  actions.appendChild(saveAction)
  pageState.activeMenuButtons.push(saveAction)

  if (showGenerator) {
    const generator = document.createElement('button')
    generator.type = 'button'
    generator.className = 'klarkey-inline-action'
    generator.textContent = 'Generate password'
    generator.addEventListener('click', () => {
      const generated = randomPassword()
      const inputs = getInputs(input)
      writeValue(inputs.password, generated)
      showSaveBanner({
        username: inputs.username?.value?.trim() || '',
        password: generated,
        reason: 'create',
      })
    })
    actions.appendChild(generator)
    pageState.activeMenuButtons.push(generator)
  }

  if (inputMode === 'username') {
    const carryForward = document.createElement('button')
    carryForward.type = 'button'
    carryForward.className = 'klarkey-inline-action'
    carryForward.textContent = 'Use this account on the next step'
    carryForward.addEventListener('click', () => {
      const snapshot = collectFormSnapshot(input)
      if (snapshot.username) {
        setPendingUsername(snapshot.username)
      }
      removeInlineUi()
    })
    actions.appendChild(carryForward)
    pageState.activeMenuButtons.push(carryForward)
  }

  overlayRoot.appendChild(menu)
  setActiveMenuIndex(pageState.activeMenuButtons.length ? 0 : -1)
}

const renderInlineTriggerOnly = (input) => {
  removeInlineUi()
  renderInlineTrigger(input, () => renderInlineMenu(input, pageState.matches))
}

const refreshMatches = async () => {
  const response = await sendMessage({
    type: 'list-logins-for-url',
    url: window.location.href,
    title: document.title,
  }).catch((error) => ({
    ok: false,
    matches: [],
    message: error instanceof Error ? error.message : 'Klarkey could not load matching items.',
  }))

  pageState.matches = response.ok ? response.matches || [] : []
  return pageState.matches
}

const maybePromptToSave = async (preferredInput, force = false) => {
  const snapshot = collectFormSnapshot(preferredInput)
  if (!snapshot.password) {
    return
  }

  const promptKey = `${window.location.hostname}|${snapshot.username}|${snapshot.password}`
  if (pageState.lastSavePromptKey === promptKey && !force) {
    return
  }

  const matches = pageState.matches.length ? pageState.matches : await refreshMatches()
  const exact = matches.find((match) => (match.username || '') === snapshot.username)
  if (!exact && !force) {
    showSaveBanner({
      username: snapshot.username,
      password: snapshot.password,
      reason: 'create',
    })
    pageState.lastSavePromptKey = promptKey
    return
  }

  if (!exact) {
    showSaveBanner({
      username: snapshot.username,
      password: snapshot.password,
      reason: 'create',
    })
    pageState.lastSavePromptKey = promptKey
    return
  }

  const stored = await sendMessage({ type: 'fetch-login', itemId: exact.itemId }).catch(() => undefined)
  const storedPassword = stored?.ok ? stored.login?.password || '' : ''

  if (storedPassword === snapshot.password && !force) {
    return
  }

  showSaveBanner({
    username: snapshot.username,
    password: snapshot.password,
    reason: exact ? 'update' : 'create',
  })
  pageState.lastSavePromptKey = promptKey
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'klarkey-page-bridge-response') {
    return
  }

  const pending = pendingPageRequests.get(event.data.id)
  if (!pending) {
    return
  }

  pendingPageRequests.delete(event.data.id)
  pending(event.data.payload)
})

const runPagePasskeyOperation = (operation, requestDetailsJson) => {
  injectPageBridge()
  const id = `page_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`

  return new Promise((resolve) => {
    pendingPageRequests.set(id, resolve)
    window.postMessage(
      {
        source: 'klarkey-page-bridge-request',
        id,
        payload: {
          operation,
          requestDetailsJson,
        },
      },
      window.location.origin,
    )
  })
}

document.addEventListener('focusin', async (event) => {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !visible(target)) {
    return
  }

  if (!isUsernameInput(target) && !isPasswordInput(target)) {
    return
  }

  pageState.overlayInput = target
  const matches = await refreshMatches()
  renderInlineTriggerOnly(target)
  if ((matches.length || isPasswordInput(target)) && target.dataset.klarkeyAutoOpen !== 'false') {
    renderInlineMenu(target, matches)
  }
})

document.addEventListener('click', (event) => {
  const target = event.target
  if (target instanceof Element && target.closest('.klarkey-inline-menu, .klarkey-save-banner')) {
    return
  }

  if (pageState.overlayInput && target === pageState.overlayInput) {
    return
  }

  removeInlineUi()
})

document.addEventListener('scroll', () => {
  if (pageState.overlayInput instanceof HTMLInputElement && visible(pageState.overlayInput)) {
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
  if (pageState.overlayInput instanceof HTMLInputElement && visible(pageState.overlayInput)) {
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

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
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
    const activeButton = pageState.activeMenuButtons[pageState.activeMenuIndex]
    if (activeButton) {
      event.preventDefault()
      activeButton.click()
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
      writeValue(inputs.username, message.login?.username)
      writeValue(inputs.password, message.login?.password)
      writeValue(inputs.otp, message.login?.otp)

      sendResponse({
        ok: true,
        message: 'Klarkey filled the detected fields on this page.',
      })
      return
    }

    if (message?.type === 'run-passkey-operation') {
      void runPagePasskeyOperation(message.operation, message.requestDetailsJson).then((result) => {
        sendResponse(result)
      })
      return true
    }
  })
}
