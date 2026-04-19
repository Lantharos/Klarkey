import type { BrowserWindow } from 'electron'
import { ClipboardManager } from '@/electron/clipboard'
import type { VaultRepository } from '@/electron/repository'
import { pasteIntoWindow } from '@/electron/windows'
import { parseCommand } from '@/shared/command'
import { resolveActions } from '@/shared/resolver'
import type { ActionExecutionResult, ItemDetails, ModifierKey, ResolvedAction } from '@/shared/types'

const INSERT_CLIPBOARD_CLEAR_SECONDS = 5

export type PaletteActionExecutionContext = {
  repository: VaultRepository
  clipboard: ClipboardManager
  window: BrowserWindow
  getLastExternalWindow: () => string | undefined
  getActionCache: () => Map<string, ResolvedAction>
  isLocked: () => boolean
  extendUnlockWindow: () => void
}

export function executePaletteAction(
  ctx: PaletteActionExecutionContext,
  actionId: string,
  modifier: ModifierKey,
): ActionExecutionResult {
  const settings = ctx.repository.getSettings()
  const parseAction = () => {
    const [kind, itemId, field] = actionId.split(':')
    return { kind, itemId, field }
  }
  const getItemField = (item: ItemDetails | undefined, field: string) => {
    if (!item) {
      return undefined
    }

    if (field === 'username') {
      return item.username || undefined
    }

    if (field === 'password') {
      return item.password
    }

    if (field === 'fullName') {
      return item.fullName
    }

    if (field === 'email') {
      return item.email
    }

    if (field === 'phone') {
      return item.phone
    }

    if (field === 'address') {
      return item.address
    }

    if (field === 'cardholderName') {
      return item.cardholderName
    }

    if (field === 'cardNumber') {
      return item.cardNumber
    }

    if (field === 'cardExpiry') {
      return item.cardExpiry
    }

    if (field === 'cardCvc') {
      return item.cardCvc
    }

    if (field === 'billingPostalCode') {
      return item.billingPostalCode
    }

    if (field === 'content') {
      return item.content || item.notes
    }

    return undefined
  }

  if (actionId.startsWith('paste:')) {
    const { itemId, field } = parseAction()
    const item = itemId ? ctx.repository.getItemDetails(itemId) : undefined
    const value =
      !itemId || !field
        ? undefined
        : field === 'password'
          ? ctx.repository.getPassword(itemId)
          : field === 'otp'
            ? ctx.repository.getOtp(itemId)
            : field === 'username'
              ? ctx.repository.getUsername(itemId)
              : getItemField(item, field)

    if (!value) {
      return {
        status: 'error',
        title: 'Value missing',
        message: 'This item does not have a value to insert.',
      }
    }

    if (!ctx.getLastExternalWindow()) {
      return {
        status: 'error',
        title: 'No previous field',
        message: 'Open Klarkey from the field you want to fill.',
      }
    }

    ctx.clipboard.copy(value, INSERT_CLIPBOARD_CLEAR_SECONDS)
    ctx.window.hide()
    const pasted = pasteIntoWindow(ctx.getLastExternalWindow()!)
    return pasted
      ? {
          status: 'success',
          title: 'Value inserted',
          message: 'Pasted into the last selected field.',
        }
      : {
          status: 'error',
          title: 'Insert failed',
          message: 'Could not focus the previous window.',
        }
  }

  if (actionId.startsWith('copy:')) {
    const { itemId, field } = parseAction()
    const item = itemId ? ctx.repository.getItemDetails(itemId) : undefined
    const value =
      !itemId || !field
        ? undefined
        : field === 'password'
          ? ctx.repository.getPassword(itemId)
          : field === 'otp'
            ? ctx.repository.getOtp(itemId)
            : getItemField(item, field)

    if (!itemId || !field || !value) {
      return {
        status: 'error',
        title: 'Value missing',
        message: 'The requested value could not be copied.',
      }
    }

    ctx.clipboard.copy(value, settings.clearClipboardSeconds)
    ctx.repository.remember(actionId, item?.itemName ?? 'Item', itemId)
    return {
      status: 'success',
      title: 'Value copied',
      message: 'Clipboard will clear automatically.',
    }
  }

  if (actionId.startsWith('show:')) {
    const { itemId, field } = parseAction()
    const item = itemId ? ctx.repository.getItemDetails(itemId) : undefined
    const value =
      !itemId || !field
        ? undefined
        : field === 'password'
          ? ctx.repository.getPassword(itemId)
          : field === 'otp'
            ? ctx.repository.getOtp(itemId)
            : getItemField(item, field)

    if (!itemId || !field || !value) {
      return {
        status: 'error',
        title: 'Value missing',
        message: 'The requested value could not be revealed.',
      }
    }

    if (modifier === 'control') {
      ctx.clipboard.copy(value, settings.clearClipboardSeconds)
      ctx.repository.remember(actionId, item?.itemName ?? 'Item', itemId)
      return {
        status: 'success',
        title: 'Value copied',
        message: 'Clipboard will clear automatically.',
      }
    }

    ctx.repository.remember(actionId, item?.itemName ?? 'Item', itemId)
    return {
      status: 'info',
      title: field === 'otp' ? 'Current OTP' : 'Value revealed',
      message: field === 'otp' ? 'Code refreshes every 30 seconds.' : 'Use this only when needed.',
      secret: value,
    }
  }

  const snapshot = ctx.repository.getSnapshot()
  const action =
    ctx.getActionCache().get(actionId) ?? resolveActions(snapshot, parseCommand('settings')).find((candidate) => candidate.id === actionId)

  if (!action) {
    return {
      status: 'error',
      title: 'Action missing',
      message: 'The selected action could not be resolved.',
    }
  }

  if (action.requiresUnlock && ctx.isLocked()) {
    return {
      status: 'locked',
      title: 'Unlock required',
      message: 'Use the unlock button to continue with sensitive data.',
    }
  }

  switch (action.kind) {
    case 'open-item': {
      if (!action.itemId) {
        break
      }

      if (modifier === 'control') {
        const password = ctx.repository.getPassword(action.itemId)
        if (password) {
          ctx.clipboard.copy(password, settings.clearClipboardSeconds)
          ctx.repository.remember(action.id, action.title, action.itemId)
          return {
            status: 'success',
            title: 'Password copied',
            message: 'Clipboard will clear automatically.',
          }
        }
      }

      if (modifier === 'alt') {
        const password = ctx.repository.getPassword(action.itemId)
        if (password) {
          ctx.repository.remember(action.id, action.title, action.itemId)
          return {
            status: 'info',
            title: 'Password revealed',
            message: 'Use this only when autofill is not available.',
            secret: password,
          }
        }
      }

      const item = ctx.repository.getItemDetails(action.itemId)
      const identityName = [item?.firstName, item?.middleName, item?.lastName]
        .map((value) => value?.trim())
        .filter(Boolean)
        .join(' ')
      const defaultValue =
        item?.itemType === 'login'
          ? item.username
          : item?.itemType === 'identity'
            ? item.fullName || identityName || item.email || item.username
            : item?.content || item?.notes

      if (defaultValue) {
        ctx.clipboard.copy(defaultValue, settings.clearClipboardSeconds)
        ctx.repository.remember(action.id, action.title, action.itemId)
        return {
          status: 'success',
          title: 'Value copied',
          message: defaultValue,
        }
      }
      break
    }

    case 'copy-password': {
      if (!action.itemId) {
        break
      }

      const password = ctx.repository.getPassword(action.itemId)
      if (password) {
        ctx.clipboard.copy(password, settings.clearClipboardSeconds)
        ctx.repository.remember(action.id, action.title, action.itemId)
        return {
          status: 'success',
          title: 'Password copied',
          message: 'Clipboard will clear automatically.',
        }
      }
      break
    }

    case 'copy-value': {
      if (!action.itemId) {
        break
      }
      const suffix = action.id.endsWith(':username') ? 'username' : 'content'
      return executePaletteAction(ctx, `copy:${action.itemId}:${suffix}`, modifier)
    }

    case 'show-password': {
      if (!action.itemId) {
        break
      }

      const password = ctx.repository.getPassword(action.itemId)
      if (password) {
        if (modifier === 'control') {
          ctx.clipboard.copy(password, settings.clearClipboardSeconds)
          ctx.repository.remember(action.id, action.title, action.itemId)
          return {
            status: 'success',
            title: 'Password copied',
            message: 'Clipboard will clear automatically.',
          }
        }

        ctx.repository.remember(action.id, action.title, action.itemId)
        return {
          status: 'info',
          title: 'Password revealed',
          message: 'Use this only when you need to inspect the secret.',
          secret: password,
        }
      }
      break
    }

    case 'show-otp':
    case 'copy-otp': {
      if (!action.itemId) {
        break
      }

      const otp = ctx.repository.getOtp(action.itemId)
      if (otp) {
        if (action.kind === 'copy-otp' || modifier === 'control') {
          ctx.clipboard.copy(otp, settings.clearClipboardSeconds)
          ctx.repository.remember(action.id, action.title, action.itemId)
          return {
            status: 'success',
            title: 'Code copied',
            message: 'The current OTP is now on your clipboard.',
          }
        }

        ctx.repository.remember(action.id, action.title, action.itemId)
        return {
          status: 'info',
          title: 'Current OTP',
          message: 'Code refreshes every 30 seconds.',
          secret: otp,
        }
      }
      break
    }

    case 'create-item': {
      const itemType = action.itemType

      if (!itemType || itemType === 'ssh-key') {
        return {
          status: 'info',
          title: 'Coming soon',
          message: 'That item type is not available yet.',
        }
      }

      const itemName = action.subtitle.trim() || action.title.replace(/^Create\s+/i, '').trim()
      const result = ctx.repository.createItem({ itemType, itemName })
      ctx.extendUnlockWindow()
      return result
    }

    case 'generate-passkey': {
      return {
        status: 'info',
        title: 'Manage passkeys in Settings',
        message: 'Klarkey passkeys are configured in Settings because website passkeys need the site origin itself.',
      }
    }

    case 'switch-item': {
      ctx.repository.remember(action.id, action.title, action.itemId)
      return {
        status: 'success',
        title: 'Item switched',
        message: 'This item is now the most recent one used.',
      }
    }

    case 'coming-soon': {
      return {
        status: 'info',
        title: 'Coming soon',
        message: 'That item type is reserved for a future adapter.',
      }
    }

    case 'open-settings': {
      return {
        status: 'info',
        title: 'Settings',
        message: 'The preferences panel is open.',
      }
    }
  }

  return {
    status: 'error',
    title: 'Action incomplete',
    message: 'The requested action could not be completed.',
  }
}
