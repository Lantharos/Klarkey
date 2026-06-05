import inlineStyles from '../inline-styles.js'

const overlayHost = document.createElement('div')
const overlayShadow = overlayHost.attachShadow({ mode: 'open' })
const overlayStyle = document.createElement('style')
export const overlayRoot = document.createElement('div')

overlayStyle.textContent = inlineStyles
overlayHost.dataset.klarkeyInlineHost = 'true'
overlayRoot.className = 'klarkey-inline-root'

overlayHost.style.setProperty('all', 'initial', 'important')
overlayHost.style.setProperty('position', 'fixed', 'important')
overlayHost.style.setProperty('inset', '0', 'important')
overlayHost.style.setProperty('display', 'block', 'important')
overlayHost.style.setProperty('width', '100vw', 'important')
overlayHost.style.setProperty('height', '100vh', 'important')
overlayHost.style.setProperty('pointer-events', 'none', 'important')
overlayHost.style.setProperty('z-index', '2147483646', 'important')

overlayShadow.appendChild(overlayStyle)
overlayShadow.appendChild(overlayRoot)
document.documentElement.appendChild(overlayHost)
