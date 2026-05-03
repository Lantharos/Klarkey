import type { SyncStatus } from '@/shared/sync'

const baseRows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const signedInSyncRows = [11, 12, 13]
const dataRows = [14, 15]

export function getVisibleSettingsRowIndexes(syncStatus?: SyncStatus) {
  return syncStatus?.signedIn ? [...baseRows, ...signedInSyncRows, ...dataRows] : [...baseRows, ...dataRows]
}

export function isSettingsRowVisible(index: number, syncStatus?: SyncStatus) {
  return getVisibleSettingsRowIndexes(syncStatus).includes(index)
}

export function moveVisibleSettingsRow(current: number, delta: number, syncStatus?: SyncStatus) {
  const rows = getVisibleSettingsRowIndexes(syncStatus)
  const position = rows.includes(current) ? rows.indexOf(current) : rows.findIndex((index) => index > current)
  const currentPosition = position >= 0 ? position : 0
  return rows[(currentPosition + delta + rows.length) % rows.length]
}

export function nearestVisibleSettingsRow(current: number, syncStatus?: SyncStatus) {
  const rows = getVisibleSettingsRowIndexes(syncStatus)
  return rows.find((index) => index >= current) ?? rows[rows.length - 1]
}
