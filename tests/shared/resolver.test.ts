import { parseCommand } from '@/shared/command'
import { resolveActions } from '@/shared/resolver'
import type { ExternalWindowContext, VaultSnapshot } from '@/shared/types'

const chromeTab = (title: string): ExternalWindowContext => ({
  handle: '1',
  appName: 'chrome',
  windowTitle: title,
})

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

    expect(actions.slice(0, 5).map((action) => action.itemType)).toEqual(['login', 'identity', 'card', 'note', 'ssh-key'])
  })

  it('matches identity items by person fields', () => {
    const actions = resolveActions(snapshot, parseCommand('alex'))

    expect(actions.some((action) => action.itemType === 'identity')).toBe(true)
  })

  it('keeps settings available for passkey queries', () => {
    const actions = resolveActions(snapshot, parseCommand('generate passkey'))

    expect(actions.some((action) => action.kind === 'open-settings')).toBe(true)
  })

  it('ranks items matching the captured foreground window above recent-only items when the query is empty', () => {
    const foregroundSnapshot: VaultSnapshot = {
      items: [
        {
          id: 'recent_only',
          itemType: 'login',
          itemName: 'Recent Only',
          username: 'u',
          hasPassword: true,
          hasOtp: false,
          hasPasskey: false,
        },
        {
          id: 'matches_tab',
          itemType: 'login',
          itemName: 'News',
          username: 'u',
          websites: ['https://news.example.com/path'],
          hasPassword: true,
          hasOtp: false,
          hasPasskey: false,
        },
      ],
      recents: [
        {
          id: 'r1',
          actionId: 'open:recent_only',
          itemId: 'recent_only',
          label: 'Recent Only',
          usedAt: new Date().toISOString(),
        },
      ],
    }

    const actions = resolveActions(
      foregroundSnapshot,
      parseCommand(''),
      chromeTab('Home - news.example.com - Google Chrome'),
    )

    expect(actions[0]?.itemId).toBe('matches_tab')
  })
})
