import { menuSuppress, pageState } from './state.js'

const suppressInlineMenu = (input) => {
  menuSuppress.input = input
  menuSuppress.until = Date.now() + 900
}

const stopInlineLayoutTracking = () => {
  if (pageState.layoutFrame === undefined) {
    return
  }

  window.cancelAnimationFrame(pageState.layoutFrame)
  pageState.layoutFrame = undefined
}

export { suppressInlineMenu, stopInlineLayoutTracking }
