import { overlayRoot } from '../overlay.js'
import { pageState } from '../state.js'
import { stopInlineLayoutTracking } from '../menu-suppress.js'
import { clearBrowserAutofillSuppression } from '../autofill/autofill.js'

const removeInlineUi = () => {
  stopInlineLayoutTracking()
  clearBrowserAutofillSuppression()
  overlayRoot
    .querySelectorAll('.klarkey-inline-trigger, .klarkey-inline-menu, .klarkey-save-banner')
    .forEach((element) => element.remove())
  pageState.activeMenuButtons = []
  pageState.activeMenuIndex = -1
  pageState.activeSaveBannerKey = ''
  pageState.triggerElement = undefined
  pageState.menuElement = undefined
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


export { removeInlineUi, setActiveMenuIndex, moveActiveMenuIndex }
