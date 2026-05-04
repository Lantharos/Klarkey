import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportCsv } from '@/electron/export/export-csv'
import type { VaultRepository } from '@/electron/repository'

const createRepository = (details: Record<string, Record<string, unknown>>) =>
  ({
    getSnapshot: () => ({
      items: Object.keys(details).map((id) => ({ id })),
    }),
    getItemDetails: (id: string) => details[id],
  }) as unknown as VaultRepository

describe('CSV export', () => {
  it('quotes exported cells and neutralizes spreadsheet formulas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'klarkey-export-'))
    const filePath = join(dir, 'vault.csv')

    try {
      const repository = createRepository({
        login_1: {
          itemType: 'login',
          itemName: '=cmd|calc',
          username: '+user',
          password: '-secret',
          websites: ['https://example.com'],
          notes: '@notes',
          cardholderName: '\tName',
          cardNumber: '\r4111111111111111',
          cardExpiry: '12/30',
          cardCvc: '123',
          email: '＝fullwidth',
          phone: '555-0100',
          address: '1 Main St',
          sshPublicKey: 'ssh-ed25519 AAAA',
        },
      })

      await exportCsv(repository, filePath)

      const content = readFileSync(filePath, 'utf8')
      expect(content).toContain('"\t=cmd|calc"')
      expect(content).toContain('"\t+user"')
      expect(content).toContain('"\t-secret"')
      expect(content).toContain('"\t@notes"')
      expect(content).toContain('"\'\tName"')
      expect(content).toContain('"\'\r4111111111111111"')
      expect(content).toContain('"\t＝fullwidth"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
