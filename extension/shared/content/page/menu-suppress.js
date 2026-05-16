import { menuSuppress, pageState } from './state.js'
import { clearTransientState, hydrateTransientState, setTransientState } from './transient-state.js'

const inlineSuppressionState = 'inline-menu-auto-open'
const inlineSuppressionTtlMs = 30_000

const suppressInlineMenu = (input, options = {}) => {
  menuSuppress.input = input
  menuSuppress.until = Date.now() + (options.durationMs ?? 900)
  menuSuppress.untilUserInteraction = options.untilUserInteraction === true
  if (menuSuppress.untilUserInteraction) {
    setTransientState(inlineSuppressionState, { createdAt: Date.now() }, inlineSuppressionTtlMs)
  }
}

const allowAutomaticInlineMenu = () => {
  menuSuppress.input = undefined
  menuSuppress.until = 0
  menuSuppress.untilUserInteraction = false
  clearTransientState(inlineSuppressionState)
}

const isAutomaticInlineMenuSuppressed = (input) =>
  menuSuppress.untilUserInteraction ||
  (Date.now() < menuSuppress.until && (!menuSuppress.input || input === menuSuppress.input))

const hydrateInlineMenuSuppression = async () => {
  const persisted = await hydrateTransientState(inlineSuppressionState)
  if (persisted?.createdAt && Date.now() - persisted.createdAt <= inlineSuppressionTtlMs) {
    menuSuppress.untilUserInteraction = true
    return true
  }

  clearTransientState(inlineSuppressionState)
  return false
}

const stopInlineLayoutTracking = () => {
  if (pageState.layoutFrame === undefined) {
    return
  }

  window.cancelAnimationFrame(pageState.layoutFrame)
  pageState.layoutFrame = undefined
}

export {
  suppressInlineMenu,
  allowAutomaticInlineMenu,
  isAutomaticInlineMenuSuppressed,
  hydrateInlineMenuSuppression,
  stopInlineLayoutTracking,
}
