import { parseCommand } from '@/shared/command'
import { resolveActions } from '@/shared/resolver'
import type { VaultSnapshot } from '@/shared/types'

const snapshot: VaultSnapshot = {
  items: [
    {
      id: 'identity_work',
      itemName: 'GitHub Work',
      username: 'work_user',
      hasPassword: true,
      hasOtp: true,
      hasPasskey: false,
    },
    {
      id: 'identity_personal',
      itemName: 'GitHub Personal',
      username: 'personal_user',
      hasPassword: true,
      hasOtp: false,
      hasPasskey: false,
    },
  ],
  recents: [
    {
      id: 'recent_1',
      actionId: 'login:identity_work',
      identityId: 'identity_work',
      label: 'GitHub Work',
      usedAt: new Date().toISOString(),
    },
  ],
}

describe('resolveActions', () => {
  it('boosts recent item matches', () => {
    const actions = resolveActions(snapshot, parseCommand('github'))

    expect(actions[0]?.id).toBe('login:identity_work')
  })

  it('returns OTP actions when specifically requested', () => {
    const actions = resolveActions(snapshot, parseCommand('show 2fa github'))

    expect(actions.some((action) => action.kind === 'show-otp')).toBe(true)
  })

  it('creates from literal user input', () => {
    const actions = resolveActions(snapshot, parseCommand('new login figma'))

    expect(actions[0]?.title).toBe('Create figma')
  })
})
