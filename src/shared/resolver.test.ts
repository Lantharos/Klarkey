import { parseCommand } from '@/shared/command'
import { resolveActions } from '@/shared/resolver'
import type { VaultSnapshot } from '@/shared/types'

const snapshot: VaultSnapshot = {
  records: [
    {
      service: {
        id: 'service_github',
        name: 'GitHub',
        aliases: ['github', 'gh'],
        pinned: true,
      },
      identities: [
        {
          id: 'identity_work',
          serviceId: 'service_github',
          label: 'Work',
          username: 'work_user',
          hasPassword: true,
          hasOtp: true,
          hasPasskey: false,
        },
        {
          id: 'identity_personal',
          serviceId: 'service_github',
          label: 'Personal',
          username: 'personal_user',
          hasPassword: true,
          hasOtp: false,
          hasPasskey: false,
        },
      ],
    },
  ],
  recents: [
    {
      id: 'recent_1',
      actionId: 'login:identity_work',
      serviceId: 'service_github',
      identityId: 'identity_work',
      label: 'Use Work',
      usedAt: new Date().toISOString(),
    },
  ],
}

describe('resolveActions', () => {
  it('boosts recent service matches', () => {
    const actions = resolveActions(snapshot, parseCommand('github'))

    expect(actions[0]?.id).toBe('login:identity_work')
  })

  it('returns OTP actions when specifically requested', () => {
    const actions = resolveActions(snapshot, parseCommand('show 2fa github'))

    expect(actions.some((action) => action.kind === 'show-otp')).toBe(true)
  })

  it('offers create actions for new services', () => {
    const actions = resolveActions(snapshot, parseCommand('new login figma'))

    expect(actions[0]?.kind).toBe('create-login')
  })
})
