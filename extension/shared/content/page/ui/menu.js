import { overlayRoot } from '../overlay.js'
import { pageState, matchFetch } from '../state.js'
import { runtime, sendMessage } from '../runtime.js'
import { visible, isFieldElement } from '../dom.js'
import {
  fieldKindFor,
  fieldLabelFor,
  suggestionFlowFor,
  shouldOfferSuggestedPassword,
} from '../field-meta.js'
import { refreshMatches, refreshFieldSuggestions } from '../vault.js'
import { removeInlineUi, setActiveMenuIndex } from './inline-ui.js'
import {
  getInputs,
  randomPassword,
  getPendingUsername,
  setPendingUsername,
  setPendingOtp,
  getPendingOtp,
  getFillableFields,
} from '../forms/forms.js'
import { writePasswordGroup, writeValue, writeSplitOtp, scheduleLoginAutoSubmit } from '../autofill/write-submit.js'
import { setPendingSavePrompt } from '../pending-save.js'
import { showSaveBanner } from './banners.js'
import { suppressInlineMenu, stopInlineLayoutTracking } from '../menu-suppress.js'

const openMenuFromTrigger = (input) => {
  const generation = ++matchFetch.generation
  pageState.overlayInput = input
  const fieldKind = fieldKindFor(input)
  const authFlow = suggestionFlowFor(input, fieldKind)
  renderInlineMenu(input, pageState.matches, { loading: true })
  void Promise.all([
    refreshMatches(),
    fieldKind === 'password' || fieldKind === 'otp' || !fieldKind ? Promise.resolve([]) : refreshFieldSuggestions(fieldKind, authFlow),
  ]).then(() => {
    if (generation !== matchFetch.generation || pageState.overlayInput !== input) {
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
  pageState.triggerElement = trigger
}


const renderInlineMenu = (input, matches, options = {}) => {
  void matches
  return renderFieldMenu(input, options)
}

const renderInlineTriggerOnly = (input) => {
  removeInlineUi()
  renderInlineTrigger(input, () => openMenuFromTrigger(input))
  startInlineLayoutTracking()
}

const positionInlineMenu = (menu, input) => {
  const rect = input.getBoundingClientRect()
  const menuRect = menu.getBoundingClientRect()
  const menuHeight = menuRect.height || menu.offsetHeight || 0
  const menuWidth = menuRect.width || menu.offsetWidth || 0
  const spaceBelow = window.innerHeight - rect.bottom - 16
  const spaceAbove = rect.top - 16
  const prefersAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow
  const top = prefersAbove
    ? Math.max(12, rect.top - menuHeight - 8)
    : Math.min(window.innerHeight - menuHeight - 12, rect.bottom + 8)
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12))

  menu.style.top = `${top}px`
  menu.style.left = `${left}px`
  menu.style.visibility = 'visible'
}

const positionInlineTrigger = (trigger, input) => {
  const rect = input.getBoundingClientRect()
  trigger.style.top = `${Math.max(8, rect.top + (rect.height - 24) / 2)}px`
  trigger.style.left = `${Math.max(8, Math.min(rect.right - 28, window.innerWidth - 32))}px`
}

const syncInlineUiPosition = () => {
  if (!isFieldElement(pageState.overlayInput) || !visible(pageState.overlayInput)) {
    removeInlineUi()
    return
  }

  if (pageState.triggerElement?.isConnected) {
    positionInlineTrigger(pageState.triggerElement, pageState.overlayInput)
  }

  if (pageState.menuElement?.isConnected && pageState.menuOpen) {
    positionInlineMenu(pageState.menuElement, pageState.overlayInput)
  }
}

const startInlineLayoutTracking = () => {
  stopInlineLayoutTracking()

  const tick = () => {
    syncInlineUiPosition()
    if (!pageState.triggerElement?.isConnected && !pageState.menuElement?.isConnected) {
      stopInlineLayoutTracking()
      return
    }

    pageState.layoutFrame = window.requestAnimationFrame(tick)
  }

  pageState.layoutFrame = window.requestAnimationFrame(tick)
}

const appendFieldMenuButton = ({ container, title, secondary, onClick }) => {
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

  item.addEventListener('click', onClick)
  container.appendChild(item)
  pageState.activeMenuButtons.push(item)
}

const applyLoginFill = (input, login) => {
  // SSO login: no credentials to fill, just navigate to the site's login
  if (login.ssoProvider) {
    suppressInlineMenu(input)
    removeInlineUi()
    // Look for any link/button mentioning the provider
    const allButtons = document.querySelectorAll('a, button, [role="button"]')
    for (const el of allButtons) {
      const text = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase()
      if (text.includes('sign in with') && text.includes(login.ssoProvider.toLowerCase())) {
        el.click()
        return
      }
    }
    return
  }

  const inputs = getInputs(input)
  suppressInlineMenu(input)
  writeValue(inputs.username, login.username)
  writePasswordGroup(input, login.password)
  if (inputs.splitOtpTargets?.length && login.otp) {
    writeSplitOtp(inputs.splitOtpTargets, login.otp)
  } else {
    writeValue(inputs.otp, login.otp)
  }
  setPendingUsername(login.username || '')
  setPendingOtp(login.otp || '')
  removeInlineUi()
  scheduleLoginAutoSubmit(input)
}
const findFieldByKind = (preferredInput, kind) =>
  getFillableFields(preferredInput).find((field) => fieldKindFor(field) === kind)

const applyIdentityFill = (input, identity) => {
  suppressInlineMenu(input)

  const fieldMap = {
    username: identity.username,
    email: identity.email,
    fullName: identity.fullName,
    firstName: identity.firstName,
    middleName: identity.middleName,
    lastName: identity.lastName,
    company: identity.company,
    jobTitle: identity.jobTitle,
    birthDate: identity.birthDate,
    phone: identity.phone,
    address: identity.address,
    addressLine1: identity.addressLine1 || identity.address,
    addressLine2: identity.addressLine2,
    city: identity.city,
    state: identity.state,
    postalCode: identity.postalCode,
    country: identity.country,
  }

  for (const [kind, value] of Object.entries(fieldMap)) {
    if (!value) {
      continue
    }

    const target = findFieldByKind(input, kind)
    if (target) {
      writeValue(target, value)
    }
  }

  if (!identity.firstName && identity.fullName) {
    const firstNameField = findFieldByKind(input, 'firstName')
    if (firstNameField && !(firstNameField.value || '').trim()) {
      writeValue(firstNameField, identity.fullName.split(/\s+/)[0] || identity.fullName)
    }
  }

  if (!identity.lastName && identity.fullName) {
    const parts = identity.fullName.split(/\s+/).filter(Boolean)
    const lastNameField = findFieldByKind(input, 'lastName')
    if (lastNameField && !(lastNameField.value || '').trim() && parts.length > 1) {
      writeValue(lastNameField, parts.slice(1).join(' '))
    }
  }

  if (identity.username || identity.email) {
    setPendingUsername(identity.username || identity.email || '')
  }

  removeInlineUi()
}

const applyCardFill = (input, card) => {
  suppressInlineMenu(input)

  const fieldMap = {
    cardholderName: card.cardholderName,
    fullName: card.cardholderName,
    cardNumber: card.cardNumber,
    cardExpiry: card.cardExpiry,
    cardExpiryMonth: card.cardExpiryMonth,
    cardExpiryYear: card.cardExpiryYear,
    cardCvc: card.cardCvc,
    cardBrand: card.cardBrand,
    postalCode: card.billingPostalCode,
  }

  for (const [kind, value] of Object.entries(fieldMap)) {
    if (!value) {
      continue
    }

    const target = findFieldByKind(input, kind)
    if (target) {
      writeValue(target, value)
    }
  }

  removeInlineUi()
}

const renderFieldMenu = (input, options = {}) => {
  const { loading = false } = options
  removeInlineUi()
  renderInlineTrigger(input, () => openMenuFromTrigger(input))
  pageState.menuOpen = true

  const menu = document.createElement('section')
  menu.className = 'klarkey-inline-menu'
  menu.setAttribute('role', 'menu')
  menu.style.visibility = 'hidden'

  const fieldKind = fieldKindFor(input)
  const authFlow = suggestionFlowFor(input, fieldKind)
  menu.innerHTML = `
    <div class="klarkey-inline-header">
      <div class="klarkey-inline-brand">Klarkey</div>
      <div class="klarkey-inline-subtle">${fieldLabelFor(fieldKind)}</div>
    </div>
    <div class="klarkey-inline-list"></div>
    <div class="klarkey-inline-actions"></div>
  `

  const list = menu.querySelector('.klarkey-inline-list')

  if (loading) {
    const loadingEl = document.createElement('div')
    loadingEl.className = 'klarkey-inline-loading'
    loadingEl.textContent = 'Loading suggestions...'
    list.appendChild(loadingEl)
  } else if (fieldKind === 'password') {
    const showedGenerator = shouldOfferSuggestedPassword(input)
    if (showedGenerator) {
      const generated = randomPassword()
      appendFieldMenuButton({
        container: list,
        title: 'Use Suggested Password',
        secondary: generated,
        accent: 'New',
        onClick: () => {
          const inputs = getInputs(input)
          suppressInlineMenu(input)
          writePasswordGroup(input, generated)
          setPendingOtp('')
          setPendingSavePrompt({
            username: inputs.username?.value?.trim() || getPendingUsername(),
            password: generated,
            reason: 'create',
          })
          showSaveBanner({
            username: inputs.username?.value?.trim() || getPendingUsername(),
            password: generated,
            reason: 'create',
          })
        },
      })
    }

    if (!showedGenerator && authFlow !== 'register') {
      const passwordMatches = pageState.matches.filter((candidate) => candidate.hasPassword).slice(0, 4)
      const ssoMatches = pageState.matches.filter((candidate) => candidate.ssoProvider && !candidate.hasPassword).slice(0, 2)

      for (const match of passwordMatches) {
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

            applyLoginFill(input, response.login)
          },
        })
      }

      for (const match of ssoMatches) {
        appendFieldMenuButton({
          container: list,
          title: `Sign in with ${match.ssoProvider}`,
          secondary: match.itemName,
          onClick: () => {
            suppressInlineMenu(input)
            removeInlineUi()
            const allButtons = document.querySelectorAll('a, button, [role="button"]')
            for (const el of allButtons) {
              const text = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase()
              if (text.includes('sign in with') && text.includes(match.ssoProvider.toLowerCase())) {
                el.click()
                return
              }
            }
          },
        })
      }
    }

    if (authFlow === 'register' && !showedGenerator) {
      const empty = document.createElement('div')
      empty.className = 'klarkey-inline-empty'
      empty.textContent = 'Password already set.'
      list.appendChild(empty)
    } else if (!showedGenerator && !pageState.matches.some((match) => match.hasPassword || match.ssoProvider)) {
      const empty = document.createElement('div')
      empty.className = 'klarkey-inline-empty'
      empty.textContent = 'No items found.'
      list.appendChild(empty)
    }
  } else if (fieldKind === 'otp') {
    const pendingOtp = getPendingOtp()
    if (pendingOtp) {
      appendFieldMenuButton({
        container: list,
        title: 'Use one-time code',
        secondary: pendingOtp,
        accent: 'OTP',
        onClick: () => {
          suppressInlineMenu(input)
          const { splitOtpTargets } = getInputs(input)
          if (splitOtpTargets?.length) {
            writeSplitOtp(splitOtpTargets, pendingOtp)
          } else {
            writeValue(input, pendingOtp)
          }
          setPendingOtp('')
          removeInlineUi()
        },
      })
    } else {
      const empty = document.createElement('div')
      empty.className = 'klarkey-inline-empty'
      empty.textContent = 'No one-time code ready.'
      list.appendChild(empty)
    }
  } else if (!pageState.fieldSuggestions.length) {
    const empty = document.createElement('div')
    empty.className = 'klarkey-inline-empty'
    empty.textContent =
      authFlow === 'payment'
        ? 'No cards found.'
        : authFlow === 'login'
          ? 'No items found.'
          : fieldKind === 'email'
            ? 'No identity email found.'
            : 'No identity details found.'
    list.appendChild(empty)
  } else {
    for (const suggestion of pageState.fieldSuggestions.slice(0, 6)) {
      appendFieldMenuButton({
        container: list,
        title: suggestion.value,
        secondary: suggestion.itemName,
        accent: suggestion.fromSiteMatch ? 'Site' : undefined,
        onClick: async () => {
          if (authFlow === 'login' && suggestion.source === 'login-username') {
            const response = await sendMessage({ type: 'fetch-login', itemId: suggestion.itemId }).catch((error) => ({
              ok: false,
              message: error instanceof Error ? error.message : 'Klarkey could not load this login.',
            }))

            if (!response.ok || !response.login) {
              return
            }

            applyLoginFill(input, response.login)
            return
          }

          if (suggestion.source === 'identity') {
            const response = await sendMessage({ type: 'fetch-identity', itemId: suggestion.itemId }).catch((error) => ({
              ok: false,
              message: error instanceof Error ? error.message : 'Klarkey could not load this identity.',
            }))

            if (!response.ok || !response.identity) {
              return
            }

            applyIdentityFill(input, response.identity)
            return
          }

          if (suggestion.source === 'card') {
            const response = await sendMessage({ type: 'fetch-card', itemId: suggestion.itemId }).catch((error) => ({
              ok: false,
              message: error instanceof Error ? error.message : 'Klarkey could not load this card.',
            }))

            if (!response.ok || !response.card) {
              return
            }

            applyCardFill(input, response.card)
            return
          }

          suppressInlineMenu(input)
          writeValue(input, suggestion.value)
          if (fieldKind === 'username' || fieldKind === 'email') {
            setPendingUsername(suggestion.value)
          }
          removeInlineUi()
        },
      })
    }
  }

  overlayRoot.appendChild(menu)
  pageState.menuElement = menu
  positionInlineMenu(menu, input)
  startInlineLayoutTracking()
  setActiveMenuIndex(pageState.activeMenuButtons.length ? 0 : -1)
}

export { openMenuFromTrigger, renderInlineTrigger, renderInlineMenu, renderInlineTriggerOnly, positionInlineMenu, positionInlineTrigger, syncInlineUiPosition, startInlineLayoutTracking, appendFieldMenuButton, applyLoginFill, findFieldByKind, applyIdentityFill, applyCardFill, renderFieldMenu }
