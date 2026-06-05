import type { ActionExecutionResult } from '@/shared/types'

type NativeCall = <Result>(command: string, args?: Record<string, unknown>) => Promise<Result>

export function copySecret(nativeCall: NativeCall, value: string, timeoutSeconds?: number): Promise<ActionExecutionResult> {
  return nativeCall('clipboard_copy_secret', { value, timeoutSeconds })
}
