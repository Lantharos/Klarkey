import type { ActionExecutionResult } from '@/shared/types'

export function lockedResult(): ActionExecutionResult {
  return {
    status: 'locked',
    title: 'Vault locked',
    message: 'Unlock the vault to continue.',
  }
}
