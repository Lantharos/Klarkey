import inlineStyles from '../inline-styles.js'

export const overlayRoot = document.createElement('div')
const overlayStyle = document.createElement('style')
overlayStyle.textContent = inlineStyles
overlayRoot.className = 'klarkey-inline-root'
document.documentElement.appendChild(overlayStyle)
document.documentElement.appendChild(overlayRoot)
