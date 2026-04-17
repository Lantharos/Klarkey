const runtimeApi = globalThis.browser ?? globalThis.chrome
const runtime = runtimeApi?.runtime
const pendingPageRequests = new Map()
let pageState = {
  url: window.location.href,
  title: document.title,
  matches: [],
  fieldSuggestions: [],
  lastListUrl: '',
  overlayInput: undefined,
  formSnapshot: undefined,
  activeMenuButtons: [],
  activeMenuIndex: -1,
  lastSavePromptKey: '',
  triggerInput: undefined,
  menuOpen: false,
}

let matchFetchGeneration = 0
let savePromptTimer

const pendingUsernameStorageKey = `klarkey:pending-username:${window.location.hostname}`

const overlayRoot = document.createElement('div')
const overlayStyle = document.createElement('style')

overlayStyle.textContent = `
  .klarkey-inline-root {
    --klarkey-surface: rgba(17, 18, 20, 0.76);
    --klarkey-surface-strong: rgba(26, 28, 31, 0.9);
    --klarkey-border: rgba(255, 255, 255, 0.09);
    --klarkey-accent: #8ed0ff;
    --klarkey-text: rgba(255, 255, 255, 0.92);
    --klarkey-muted: rgba(255, 255, 255, 0.56);
    --klarkey-faint: rgba(255, 255, 255, 0.34);
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483646;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--klarkey-text);
    letter-spacing: 0.01em;
  }

  .klarkey-inline-menu {
    position: fixed;
    min-width: 296px;
    max-width: 380px;
    background: var(--klarkey-surface);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--klarkey-border);
    border-radius: 14px;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.2),
      0 28px 60px rgba(0, 0, 0, 0.46);
    overflow: hidden;
    pointer-events: auto;
  }

  .klarkey-inline-trigger {
    position: fixed;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    pointer-events: auto;
    transition: transform 120ms ease, opacity 120ms ease;
    opacity: 0.92;
  }

  .klarkey-inline-trigger:hover {
    opacity: 1;
    transform: scale(1.04);
  }

  .klarkey-inline-trigger:focus-visible {
    outline: 2px solid var(--klarkey-accent);
    outline-offset: 2px;
  }

  .klarkey-inline-trigger img {
    width: 20px;
    height: 20px;
    display: block;
    filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.28));
  }

  .klarkey-inline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--klarkey-border);
  }

  .klarkey-inline-brand {
    font-size: 12px;
    font-weight: 600;
    color: var(--klarkey-text);
  }

  .klarkey-inline-subtle {
    font-size: 12px;
    color: var(--klarkey-muted);
  }

  .klarkey-inline-list {
    display: flex;
    flex-direction: column;
  }

  .klarkey-inline-loading {
    padding: 14px;
    color: var(--klarkey-muted);
    font-size: 13px;
  }

  .klarkey-inline-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 52px;
    padding: 12px 14px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 100ms ease, color 100ms ease;
  }

  .klarkey-inline-item + .klarkey-inline-item {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .klarkey-inline-item.active,
  .klarkey-inline-action.active {
    background: rgba(255, 255, 255, 0.08);
  }

  .klarkey-inline-item:hover,
  .klarkey-inline-action:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .klarkey-inline-copy {
    min-width: 0;
  }

  .klarkey-inline-title {
    font-size: 14px;
    font-weight: 560;
    color: var(--klarkey-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .klarkey-inline-secondary {
    margin-top: 2px;
    color: var(--klarkey-muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .klarkey-inline-pill {
    color: var(--klarkey-faint);
    font-size: 12px;
    flex-shrink: 0;
  }

  .klarkey-inline-empty,
  .klarkey-inline-footer {
    padding: 14px;
    color: var(--klarkey-muted);
    font-size: 13px;
  }

  .klarkey-inline-actions {
    border-top: 1px solid var(--klarkey-border);
  }

  .klarkey-inline-action {
    width: 100%;
    padding: 12px 14px;
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.86);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    transition: background 100ms ease;
  }

  .klarkey-inline-action + .klarkey-inline-action {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .klarkey-save-banner {
    position: fixed;
    top: 16px;
    right: 16px;
    width: min(360px, calc(100vw - 32px));
    background: var(--klarkey-surface);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--klarkey-border);
    border-radius: 14px;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.24),
      0 28px 60px rgba(0, 0, 0, 0.48);
    padding: 14px 16px;
    pointer-events: auto;
    transform: translateX(0);
    transition: transform 180ms ease, opacity 180ms ease;
    animation: klarkey-slide-in 200ms ease;
  }

  .klarkey-save-banner.hidden {
    opacity: 0;
    transform: translateX(20px);
  }

  .klarkey-save-title {
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 6px;
    letter-spacing: -0.02em;
  }

  .klarkey-save-copy {
    margin: 0;
    color: var(--klarkey-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .klarkey-save-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .klarkey-save-button {
    border: 1px solid var(--klarkey-border);
    border-radius: 999px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.88);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 120ms ease, border-color 120ms ease;
  }

  .klarkey-save-button:hover {
    background: rgba(255, 255, 255, 0.09);
  }

  .klarkey-save-button.primary {
    background: var(--klarkey-accent);
    border-color: rgba(142, 208, 255, 0.5);
    color: #0a0a0b;
  }

  .klarkey-save-button.primary:hover {
    background: #b5e4ff;
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

const isEmailInput = (input) => {
  const { autocomplete, marker } = getInputSignals(input)
  return isTextLikeInput(input) && (autocomplete.includes('email') || /\bemail\b/.test(marker))
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

const ensurePageBridgeReady = async () => {
  injectPageBridge()
  const start = Date.now()
  while (Date.now() - start < 4000) {
    if (document.documentElement.getAttribute('data-klarkey-bridge') === 'ready') {
      return
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 8)
    })
  }
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
  const passwordInputs = inputs.filter((input) => isPasswordInput(input))
  const preferredPassword =
    preferredInput instanceof HTMLInputElement && passwordInputs.includes(preferredInput) ? preferredInput : undefined
  const password =
    preferredPassword ||
    passwordInputs.find((input) => (input.autocomplete || '').toLowerCase().includes('current-password')) ||
    passwordInputs[0]
  const username = inputs.find((input) => isUsernameInput(input)) || inputs.find((input) => isTextLikeInput(input))
  const otp = inputs.find((input) => isOtpInput(input))

  return {
    form,
    username,
    password,
    passwordInputs,
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

const writePasswordGroup = (preferredInput, value) => {
  const inputs = getInputs(preferredInput)
  const targets = inputs.passwordInputs.length ? inputs.passwordInputs : inputs.password ? [inputs.password] : []
  for (const target of targets) {
    writeValue(target, value)
  }
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

const openMenuFromTrigger = (input) => {
  const generation = ++matchFetchGeneration
  pageState.overlayInput = input
  const inputMode = inputModeFor(input)
  renderInlineMenu(input, pageState.matches, { loading: true })
  void Promise.all([
    refreshMatches(),
    inputMode === 'password' ? Promise.resolve([]) : refreshFieldSuggestions(inputMode),
  ]).then(() => {
    if (generation !== matchFetchGeneration || pageState.overlayInput !== input) {
      return
    }

    renderInlineMenu(input, pageState.matches, { loading: false })
  })
}

const renderInlineTrigger = (input, onOpen) => {
  const rect = input.getBoundingClientRect()
  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'klarkey-inline-trigger'
  trigger.setAttribute('aria-label', 'Open Klarkey')
  trigger.style.top = `${Math.max(8, rect.top + (rect.height - 24) / 2)}px`
  trigger.style.left = `${Math.max(8, Math.min(rect.right - 28, window.innerWidth - 32))}px`
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

const inputModeFor = (input) => {
  if (isPasswordInput(input)) {
    return 'password'
  }

  return isEmailInput(input) ? 'email' : 'username'
}

const renderInlineMenu = (input, matches, options = {}) => {
  void matches
  return renderFieldMenu(input, options)
  const { loading = false } = options
  removeInlineUi()
  renderInlineTrigger(input, () => openMenuFromTrigger(input))
  pageState.menuOpen = true

  const rect = input.getBoundingClientRect()
  const menu = document.createElement('section')
  menu.className = 'klarkey-inline-menu'
  menu.setAttribute('role', 'menu')
  const estimatedHeight = 300
  const prefersAbove = rect.bottom + estimatedHeight > window.innerHeight - 16 && rect.top > estimatedHeight
  const top = prefersAbove ? Math.max(12, rect.top - estimatedHeight - 8) : Math.min(window.innerHeight - 24, rect.bottom + 8)
  menu.style.top = `${top}px`
  menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 392))}px`

  const showGenerator = isPasswordInput(input)
  const inputMode = inputModeFor(input)
  menu.innerHTML = `
    <div class="klarkey-inline-header">
      <div class="klarkey-inline-brand">Klarkey</div>
      <div class="klarkey-inline-subtle">${inputMode === 'password' ? 'Password' : 'Username'}</div>
    </div>
    <div class="klarkey-inline-list"></div>
    <div class="klarkey-inline-actions"></div>
  `

  const list = menu.querySelector('.klarkey-inline-list')
  const actions = menu.querySelector('.klarkey-inline-actions')

  if (loading) {
    const loadingEl = document.createElement('div')
    loadingEl.className = 'klarkey-inline-loading'
    loadingEl.textContent = 'Loading vault matches…'
    list.appendChild(loadingEl)
  } else if (!matches.length) {
    const empty = document.createElement('div')
    empty.className = 'klarkey-inline-empty'
    empty.textContent = 'No matching items for this site.'
    list.appendChild(empty)
  } else {
    for (const match of matches.slice(0, 4)) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'klarkey-inline-item'
      const titleEl = document.createElement('div')
      titleEl.className = 'klarkey-inline-title'
      titleEl.textContent = match.itemName
      const subtitleEl = document.createElement('div')
      subtitleEl.className = 'klarkey-inline-subtle'
      subtitleEl.textContent = match.username || 'No username'
      const meta = document.createElement('div')
      meta.className = 'klarkey-inline-meta'
      item.appendChild(titleEl)
      item.appendChild(subtitleEl)
      item.appendChild(meta)
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
  saveAction.disabled = loading
  saveAction.addEventListener('click', async () => {
    const snapshot = collectFormSnapshot(input)
    if (!snapshot.password && inputMode === 'password') {
      return
    }

    const response = await sendMessage({
      type: 'save-login-payload',
      payload: {
        url: window.location.href,
        title: document.title,
        username: snapshot.username,
        password: snapshot.password,
      },
    }).catch(() => ({ ok: false, message: 'Could not save.' }))

    if (response?.ok) {
      pageState.matches = []
      pageState.lastSavePromptKey = `${window.location.hostname}|${snapshot.username}|${snapshot.password}`
      setPendingUsername(snapshot.username || '')
    }

    removeInlineUi()
  })
  actions.appendChild(saveAction)
  pageState.activeMenuButtons.push(saveAction)

  if (showGenerator) {
    const generator = document.createElement('button')
    generator.type = 'button'
    generator.className = 'klarkey-inline-action'
    generator.textContent = 'Generate password'
    generator.disabled = loading
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
    carryForward.disabled = loading
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
  renderInlineTrigger(input, () => openMenuFromTrigger(input))
}

const appendFieldMenuButton = ({ container, title, secondary, accent, onClick }) => {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'klarkey-inline-item'

  const copy = document.createElement('div')
  copy.className = 'klarkey-inline-copy'

  const titleEl = document.createElement('div')
  titleEl.className = 'klarkey-inline-title'
  titleEl.textContent = title
  copy.appendChild(titleEl)

  if (secondary) {
    const secondaryEl = document.createElement('div')
    secondaryEl.className = 'klarkey-inline-secondary'
    secondaryEl.textContent = secondary
    copy.appendChild(secondaryEl)
  }

  item.appendChild(copy)

  if (accent) {
    const pill = document.createElement('div')
    pill.className = 'klarkey-inline-pill'
    pill.textContent = accent
    item.appendChild(pill)
  }

  item.addEventListener('click', onClick)
  container.appendChild(item)
  pageState.activeMenuButtons.push(item)
}

const renderFieldMenu = (input, options = {}) => {
  const { loading = false } = options
  removeInlineUi()
  renderInlineTrigger(input, () => openMenuFromTrigger(input))
  pageState.menuOpen = true

  const rect = input.getBoundingClientRect()
  const menu = document.createElement('section')
  menu.className = 'klarkey-inline-menu'
  menu.setAttribute('role', 'menu')
  const estimatedHeight = 300
  const prefersAbove = rect.bottom + estimatedHeight > window.innerHeight - 16 && rect.top > estimatedHeight
  const top = prefersAbove ? Math.max(12, rect.top - estimatedHeight - 8) : Math.min(window.innerHeight - 24, rect.bottom + 8)
  menu.style.top = `${top}px`
  menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 392))}px`

  const inputMode = inputModeFor(input)
  menu.innerHTML = `
    <div class="klarkey-inline-header">
      <div class="klarkey-inline-brand">Klarkey</div>
      <div class="klarkey-inline-subtle">${inputMode === 'password' ? 'Password' : inputMode === 'email' ? 'Email' : 'Username'}</div>
    </div>
    <div class="klarkey-inline-list"></div>
    <div class="klarkey-inline-actions"></div>
  `

  const list = menu.querySelector('.klarkey-inline-list')
  const actions = menu.querySelector('.klarkey-inline-actions')

  if (loading) {
    const loadingEl = document.createElement('div')
    loadingEl.className = 'klarkey-inline-loading'
    loadingEl.textContent = 'Loading suggestions...'
    list.appendChild(loadingEl)
  } else if (inputMode === 'password') {
    const generated = randomPassword()
    appendFieldMenuButton({
      container: list,
      title: 'Use Suggested Password',
      secondary: generated,
      accent: 'New',
      onClick: () => {
        const inputs = getInputs(input)
        writePasswordGroup(input, generated)
        showSaveBanner({
          username: inputs.username?.value?.trim() || getPendingUsername(),
          password: generated,
          reason: 'create',
        })
      },
    })

    for (const match of pageState.matches.slice(0, 4)) {
      appendFieldMenuButton({
        container: list,
        title: match.username || match.itemName,
        secondary: match.username && match.username !== match.itemName ? match.itemName : undefined,
        accent: match.hasOtp ? 'OTP' : undefined,
        onClick: async () => {
          const response = await sendMessage({ type: 'fetch-login', itemId: match.itemId }).catch((error) => ({
            ok: false,
            message: error instanceof Error ? error.message : 'Klarkey could not load this login.',
          }))

          if (!response.ok || !response.login) {
            return
          }

          const inputs = getInputs(input)
          writeValue(inputs.username, response.login.username)
          writePasswordGroup(input, response.login.password)
          writeValue(inputs.otp, response.login.otp)
          setPendingUsername(response.login.username || '')
          removeInlineUi()
        },
      })
    }
  } else if (!pageState.fieldSuggestions.length) {
    const empty = document.createElement('div')
    empty.className = 'klarkey-inline-empty'
    empty.textContent = inputMode === 'email' ? 'No email suggestions yet.' : 'No username suggestions yet.'
    list.appendChild(empty)
  } else {
    for (const suggestion of pageState.fieldSuggestions.slice(0, 6)) {
      appendFieldMenuButton({
        container: list,
        title: suggestion.value,
        secondary: suggestion.itemName,
        accent: suggestion.fromSiteMatch ? 'Site' : undefined,
        onClick: () => {
          writeValue(input, suggestion.value)
          setPendingUsername(suggestion.value)
          removeInlineUi()
        },
      })
    }
  }

  if (!loading && inputMode !== 'password' && pageState.matches.length) {
    const note = document.createElement('div')
    note.className = 'klarkey-inline-footer'
    note.textContent = 'Password matches appear when you focus a password field.'
    actions.appendChild(note)
  }

  overlayRoot.appendChild(menu)
  setActiveMenuIndex(pageState.activeMenuButtons.length ? 0 : -1)
}

const refreshMatches = async () => {
  const href = window.location.href
  if (pageState.lastListUrl !== href) {
    pageState.lastListUrl = href
    pageState.matches = []
    pageState.fieldSuggestions = []
  }

  const response = await sendMessage({
    type: 'list-logins-for-url',
    url: href,
    title: document.title,
  }).catch((error) => ({
    ok: false,
    matches: [],
    message: error instanceof Error ? error.message : 'Klarkey could not load matching items.',
  }))

  pageState.matches = response.ok ? response.matches || [] : []
  return pageState.matches
}

const refreshFieldSuggestions = async (field) => {
  const response = await sendMessage({
    type: 'list-field-suggestions',
    field,
    url: window.location.href,
    title: document.title,
  }).catch((error) => ({
    ok: false,
    suggestions: [],
    message: error instanceof Error ? error.message : 'Klarkey could not load suggestions.',
  }))

  pageState.fieldSuggestions = response.ok ? response.suggestions || [] : []
  return pageState.fieldSuggestions
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
  pending.resolve(event.data.payload)
})

const runPagePasskeyOperation = async (operation, requestDetailsJson) => {
  await ensurePageBridgeReady()
  const id = `page_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pendingPageRequests.delete(id)
      resolve({
        ok: false,
        error: {
          name: 'NotAllowedError',
          message: 'The passkey request timed out.',
        },
      })
    }, 120000)

    pendingPageRequests.set(id, {
      resolve: (payload) => {
        window.clearTimeout(timer)
        resolve(payload)
      },
    })

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

  if (!isUsernameInput(target) && !isPasswordInput(target) && !isEmailInput(target)) {
    return
  }

  if (pageState.lastListUrl !== window.location.href) {
    pageState.lastListUrl = window.location.href
    pageState.matches = []
  }

  const generation = ++matchFetchGeneration
  pageState.overlayInput = target
  const inputMode = inputModeFor(target)

  renderInlineTriggerOnly(target)

  const autoOpen = target.dataset.klarkeyAutoOpen !== 'false'
  const shouldPrimeMenu = autoOpen && (inputMode === 'password' || pageState.fieldSuggestions.length > 0)

  if (shouldPrimeMenu) {
    renderInlineMenu(target, pageState.matches, { loading: true })
  }

  await Promise.all([
    refreshMatches(),
    inputMode === 'password' ? Promise.resolve([]) : refreshFieldSuggestions(inputMode),
  ])

  if (generation !== matchFetchGeneration || pageState.overlayInput !== target) {
    return
  }

  const showMenu = autoOpen && (inputMode === 'password' || pageState.fieldSuggestions.length > 0)

  if (showMenu) {
    renderInlineMenu(target, pageState.matches, { loading: false })
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

    window.clearTimeout(savePromptTimer)
    savePromptTimer = window.setTimeout(() => {
      void maybePromptToSave(target, false)
    }, 450)
  },
  true,
)

window.addEventListener('popstate', () => {
  pageState.lastListUrl = ''
})

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

  injectPageBridge()
  void refreshMatches()
}
