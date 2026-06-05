import type { SyncStatus } from '@/shared/sync'

export const fallbackSyncStatus: SyncStatus = {
  configured: false,
  signedIn: false,
  syncing: false,
  deviceId: 'desktop-local',
  deviceName: 'Klarkey Desktop',
  conflictCount: 0,
  serverSequence: 0,
}
