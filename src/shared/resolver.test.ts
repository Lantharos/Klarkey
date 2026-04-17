import { parseCommand } from '@/shared/command'
import { resolveActions } from '@/shared/resolver'
import type { VaultSnapshot } from '@/shared/types'

const snapshot: VaultSnapshot = {
  items: [
    {
      id: 'item_work',
      itemType: 'login',
      itemName: 'GitHub Work',
      username: 'work_user',
      hasPassword: true,
      hasOtp: true,
      hasPasskey: false,
    },
    {
      id: 'item_personal',
      itemType: 'login',
      itemName: 'GitHub Personal',
      username: 'personal_user',
      hasPassword: true,
      hasOtp: false,
      hasPasskey: false,
    },
    {
      id: 'item_identity',
      itemType: 'identity',
      itemName: 'Personal Identity',
      fullName: 'Alex Morgan',
      email: 'alex@example.com',
      hasPassword: false,
      hasOtp: false,
      hasPasskey: false,
    },
  ],
  recents: [
    {
      id: 'recent_1',
      actionId: 'open:item_work',
      itemId: 'item_work',
      label: 'GitHub Work',
      usedAt: new Date().toISOString(),
    },
  ],
}

describe('resolveActions', () => {
  it('boosts recent item matches', () => {
    const actions = resolveActions(snapshot, parseCommand('github'))

    expect(actions[0]?.id).toBe('open:item_work')
  })

  it('returns OTP actions when specifically requested', () => {
    const actions = resolveActions(snapshot, parseCommand('show 2fa github'))

    expect(actions.some((action) => action.kind === 'show-otp')).toBe(true)
  })

  it('creates from literal user input', () => {
    const actions = resolveActions(snapshot, parseCommand('new login figma'))

    expect(actions[0]?.title).toBe('Create figma')
    expect(actions[0]?.itemType).toBe('login')
  })

  it('offers explicit item types when create has no type yet', () => {
    const actions = resolveActions(snapshot, parseCommand('new'))

    expect(actions.slice(0, 4).map((action) => action.itemType)).toEqual(['login', 'identity', 'card', 'note'])
  })

  it('matches identity items by person fields', () => {
    const actions = resolveActions(snapshot, parseCommand('alex'))

    expect(actions.some((action) => action.itemType === 'identity')).toBe(true)
  })

  it('keeps settings available for passkey queries', () => {
    const actions = resolveActions(snapshot, parseCommand('generate passkey'))

    expect(actions.some((action) => action.kind === 'open-settings')).toBe(true)
  })
})
