import { browserSettings } from '../state.js'
import { sendMessage } from '../runtime.js'
import { promptPasskeyCreateChoice } from '../ui/banners.js'

const finalizePreparedPasskeySave = ({ pendingPasskeyId, requestDetailsJson, plan }) => {
  if (!pendingPasskeyId) {
    return
  }

  window.setTimeout(async () => {
    const selection = browserSettings.browserSavePrompts
      ? await promptPasskeyCreateChoice(plan)
      : { itemId: plan.suggestedMatch?.itemId, createNew: !plan.suggestedMatch?.itemId }

    if (!selection) {
      await sendMessage({
        type: 'discard-passkey-credential',
        payload: {
          pendingPasskeyId,
        },
      }).catch(() => undefined)
      return
    }

    await sendMessage({
      type: 'save-passkey-credential',
      payload: {
        url: window.location.href,
        title: document.title,
        requestDetailsJson,
        pendingPasskeyId,
        itemId: selection.itemId,
        createNew: selection.createNew,
      },
    }).catch(() => undefined)
  }, 0)
}

export { finalizePreparedPasskeySave }
