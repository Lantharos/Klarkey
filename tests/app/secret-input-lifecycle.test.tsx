import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultLockScreen, PasscodeScreen } from '@/app/vault-lock-screen'
import { MasterPasswordSetupScreen, PasscodeConfirmScreen, PasscodeSetupScreen } from '@/app/security-setup-screen'
import type { VaultLockInfo } from '@/shared/types'

const lockInfo: VaultLockInfo = {
  state: 'locked',
  primaryMethods: ['masterPassword'],
  passcodeEnabled: true,
  passcodeSet: true,
  passcodeLength: 4,
  masterPasswordSet: true,
  autoLockMinutes: 15,
  safeStorageAvailable: true,
}

describe('secret input lifecycle', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('clears master password input state before unlock IPC settles', async () => {
    let resolveUnlock: (value: { success: boolean; message: string }) => void = () => undefined
    const onUnlockWithPassword = vi.fn(() => new Promise<{ success: boolean; message: string }>((resolve) => {
      resolveUnlock = resolve
    }))

    render(
      <VaultLockScreen
        lockInfo={lockInfo}
        onUnlockWithHello={vi.fn()}
        onUnlockWithPassword={onUnlockWithPassword}
      />,
    )

    const input = screen.getByPlaceholderText('Master password')
    await userEvent.type(input, 'correct-horse-battery-staple')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(onUnlockWithPassword).toHaveBeenCalledWith('correct-horse-battery-staple')
    expect(input).toHaveValue('')

    resolveUnlock({ success: true, message: 'Vault unlocked.' })
  })

  it('clears passcode entry before verification IPC settles', async () => {
    let resolveVerify: (value: { success: boolean; message: string }) => void = () => undefined
    const onVerifyPasscode = vi.fn(() => new Promise<{ success: boolean; message: string }>((resolve) => {
      resolveVerify = resolve
    }))

    const { container } = render(<PasscodeScreen passcodeLength={4} onVerifyPasscode={onVerifyPasscode} />)

    const inputs = Array.from(container.querySelectorAll('input'))
    await userEvent.type(inputs[0], '1234')

    await waitFor(() => expect(onVerifyPasscode).toHaveBeenCalledWith('1234'))
    expect(inputs.every((input) => (input as HTMLInputElement).value === '')).toBe(true)

    resolveVerify({ success: true, message: 'Passcode accepted.' })
  })

  it('clears setup and confirmation secrets after submit starts', async () => {
    let resolveMaster: (value: { success: boolean; message: string }) => void = () => undefined
    const onMasterSubmit = vi.fn(() => new Promise<{ success: boolean; message: string }>((resolve) => {
      resolveMaster = resolve
    }))
    const { unmount } = render(<MasterPasswordSetupScreen onSubmit={onMasterSubmit} onCancel={vi.fn()} />)

    const masterInput = screen.getByPlaceholderText('Enter master password')
    await userEvent.type(masterInput, 'correct-horse-battery-staple{Enter}')
    const confirmInput = screen.getByPlaceholderText('Confirm master password')
    await userEvent.type(confirmInput, 'correct-horse-battery-staple{Enter}')

    expect(onMasterSubmit).toHaveBeenCalledWith('correct-horse-battery-staple', 'correct-horse-battery-staple')
    expect(confirmInput).toHaveValue('')
    resolveMaster({ success: true, message: 'Master password set up.' })
    unmount()

    let resolvePasscodeSetup: (value: { success: boolean; message: string }) => void = () => undefined
    const onPasscodeSetupSubmit = vi.fn(() => new Promise<{ success: boolean; message: string }>((resolve) => {
      resolvePasscodeSetup = resolve
    }))
    const passcodeSetup = render(<PasscodeSetupScreen onSubmit={onPasscodeSetupSubmit} onCancel={vi.fn()} />)

    const passcodeInputs = Array.from(passcodeSetup.container.querySelectorAll('input'))
    await userEvent.type(passcodeInputs[0], '1234')
    await userEvent.type(passcodeSetup.container.querySelector('input')!, '1234')

    expect(onPasscodeSetupSubmit).toHaveBeenCalledWith('1234', '1234')
    expect(Array.from(passcodeSetup.container.querySelectorAll('input')).every((input) => input.value === '')).toBe(true)
    resolvePasscodeSetup({ success: true, message: 'Passcode set.' })
    cleanup()

    let resolvePasscodeConfirm: (value: { success: boolean; message: string }) => void = () => undefined
    const onPasscodeConfirmSubmit = vi.fn(() => new Promise<{ success: boolean; message: string }>((resolve) => {
      resolvePasscodeConfirm = resolve
    }))
    const passcodeConfirm = render(<PasscodeConfirmScreen title="Confirm passcode." onSubmit={onPasscodeConfirmSubmit} onCancel={vi.fn()} />)

    await userEvent.type(passcodeConfirm.container.querySelector('input')!, '1234')

    expect(onPasscodeConfirmSubmit).toHaveBeenCalledWith('1234')
    expect(Array.from(passcodeConfirm.container.querySelectorAll('input')).every((input) => input.value === '')).toBe(true)
    resolvePasscodeConfirm({ success: true, message: 'Passcode confirmed.' })
  })
})
