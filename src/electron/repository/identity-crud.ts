import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { encryptValue } from '@/electron/crypto'
import { normalizeSshItemInput, replaceSshPublicKeyComment } from '@/electron/ssh'
import type { CreatableItemType } from '@/shared/item-types'
import {
  type ActionExecutionResult,
  type CreateItemInput,
  type UpdateItemInput,
} from '@/shared/types'
import {
  type ItemDataPayload,
  encryptJsonPayload,
  getOtpFallback,
  id,
  now,
  parseJson,
  readEncryptedJsonPayload,
  sanitizeItemData,
  slug,
  tryDecrypt,
} from '@/electron/repository/helpers'
import { parseStoredTotp, parseTotpInput } from '@/shared/totp'

export function insertIdentity(db: Database.Database, key: Buffer, input: CreateItemInput): ActionExecutionResult {
  const itemType = input.itemType
  const itemName = input.itemName.trim()
  const isSso = Boolean(input.ssoProvider?.trim())
  const username =
    itemType === 'login'
      ? input.username?.trim() || (isSso ? '' : `${slug(itemName)}_${randomBytes(2).toString('hex')}`)
      : itemType === 'identity'
        ? input.username?.trim() || ''
        : ''
  const password =
    itemType === 'login'
      ? input.password?.trim() || (input.preserveEmptyPassword ? undefined : randomBytes(12).toString('base64url'))
      : undefined
  const otp =
    itemType === 'login'
      ? parseTotpInput(input.otp, {
          issuer: itemName,
          accountName: username || itemName,
        })
      : undefined
  const timestamp = now()
  const itemId = input.itemId ?? id('item')
  const itemData: ItemDataPayload = sanitizeItemData(itemType, input)

  let sshKey
  try {
    sshKey = normalizeSshItemInput(input, itemName)
  } catch (error) {
    return {
      status: 'error',
      title: 'SSH key import failed',
      message: error instanceof Error ? error.message : 'Klarkey could not read that SSH private key.',
    } satisfies ActionExecutionResult
  }

  if (itemType === 'ssh-key' && sshKey) {
    itemData.sshAlgorithm = sshKey.algorithm
    itemData.sshFingerprint = sshKey.fingerprint
    itemData.sshPublicKey = sshKey.publicKey
    itemData.sshComment = sshKey.comment
    itemData.sshPrivateKeyPayload = JSON.stringify(encryptValue(key, sshKey.privateKey))
  }

  db.prepare(
    `
        INSERT INTO identities (
          id, itemType, itemName, username, email, websites, notes, customFields, itemData, passwordPayload, otpPayload, hasPasskey, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
  ).run(
    itemId,
    itemType,
    itemName,
    username,
    itemType === 'login'
      ? input.email?.trim() || (!isSso ? `${username}@klarkey.local` : null)
      : null,
    JSON.stringify(input.websites ?? []),
    null,
    null,
    encryptJsonPayload(key, itemData),
    password ? JSON.stringify(encryptValue(key, password)) : null,
    otp ? JSON.stringify(encryptValue(key, JSON.stringify(otp))) : null,
    0,
    timestamp,
    timestamp,
  )

  return {
    status: 'success',
    title: 'Item created',
    message: `${itemName} is ready.`,
    itemId,
  } satisfies ActionExecutionResult
}

export function updateIdentity(db: Database.Database, key: Buffer, input: UpdateItemInput): ActionExecutionResult {
  const current = db
    .prepare('SELECT * FROM identities WHERE id = ?')
    .get(input.itemId) as
    | {
        id: string
        itemType?: string
        itemName: string
        username: string
        email?: string
        websites?: string
        notes?: string
        customFields?: string
        itemData?: string
        passwordPayload?: string
        otpPayload?: string
      }
    | undefined

  if (!current) {
    return {
      status: 'error',
      title: 'Item missing',
      message: 'This item could not be found.',
    } satisfies ActionExecutionResult
  }

  const itemType = (input.itemType ?? current.itemType ?? 'login') as CreatableItemType
  const itemName = input.itemName?.trim() || current.itemName
  const username =
    itemType === 'login'
      ? input.username?.trim() || current.username
      : itemType === 'identity'
        ? input.username?.trim() || current.username
        : ''
  const password =
    input.password === undefined
      ? current.passwordPayload
      : input.password.trim()
        ? JSON.stringify(encryptValue(key, input.password.trim()))
        : null
  const currentOtp = parseStoredTotp(tryDecrypt(key, current.otpPayload), {
    issuer: itemName,
    accountName: username || itemName,
  })
  const otp =
    input.otp === undefined
      ? current.otpPayload
      : input.otp.trim()
        ? JSON.stringify(
            encryptValue(
              key,
              JSON.stringify(
                parseTotpInput(
                  input.otp,
                  getOtpFallback({
                    itemName,
                    username,
                    existing: currentOtp,
                  }),
                ),
              ),
            ),
          )
        : null
  const currentItemData = {
    ...readEncryptedJsonPayload<ItemDataPayload>(key, current.itemData, {}),
    ...(current.notes ? { notes: current.notes } : {}),
    ...(current.customFields ? { customFields: parseJson(current.customFields, []) } : {}),
  }
  const mergedItemData = {
    ...currentItemData,
    ...sanitizeItemData(itemType, input),
  } satisfies ItemDataPayload

  let sshKey
  try {
    sshKey = normalizeSshItemInput({ ...input, itemType }, itemName)
  } catch (error) {
    return {
      status: 'error',
      title: 'SSH key import failed',
      message: error instanceof Error ? error.message : 'Klarkey could not read that SSH private key.',
    } satisfies ActionExecutionResult
  }

  if (itemType === 'ssh-key' && sshKey) {
    mergedItemData.sshAlgorithm = sshKey.algorithm
    mergedItemData.sshFingerprint = sshKey.fingerprint
    mergedItemData.sshPublicKey = sshKey.publicKey
    mergedItemData.sshComment = sshKey.comment
    mergedItemData.sshPrivateKeyPayload = JSON.stringify(encryptValue(key, sshKey.privateKey))
  } else if (itemType === 'ssh-key' && input.sshComment !== undefined) {
    const nextComment = input.sshComment.trim()
    mergedItemData.sshComment = nextComment || undefined
    if (mergedItemData.sshPublicKey) {
      mergedItemData.sshPublicKey = replaceSshPublicKeyComment(mergedItemData.sshPublicKey, nextComment)
    }
  }

  db.prepare(
    `
        UPDATE identities
        SET itemType = ?, itemName = ?, username = ?, email = ?, websites = ?, notes = ?, customFields = ?, itemData = ?, passwordPayload = ?, otpPayload = ?, updatedAt = ?
        WHERE id = ?
      `,
  ).run(
    itemType,
    itemName,
    username,
    itemType === 'login'
      ? input.email?.trim() || current.email || (username ? `${username}@klarkey.local` : null)
      : null,
    JSON.stringify(input.websites ?? parseJson<string[]>(current.websites, [])),
    null,
    null,
    encryptJsonPayload(key, mergedItemData),
    password ?? null,
    otp,
    now(),
    input.itemId,
  )

  return {
    status: 'success',
    title: 'Item updated',
    message: `${itemName} was updated.`,
    itemId: input.itemId,
  } satisfies ActionExecutionResult
}
