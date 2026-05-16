// @vitest-environment node
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseOnePux } from '@/tauri/import-1pux'

function onePux(items: unknown[]) {
  const archive = zipSync({
    'export.data': new TextEncoder().encode(JSON.stringify({
      accounts: [
        {
          vaults: [
            { items },
          ],
        },
      ],
    })),
  })
  return new Uint8Array(archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength))
}

describe('1PUX import', () => {
  it('imports password-only items from the top-level password field', () => {
    const archive = onePux([
      {
        categoryUuid: '005',
        overview: { title: 'API password', subtitle: '2025-07-21 05:37 AM' },
        details: {
          password: 'top-level-password',
          sections: [
            {
              fields: [
                { id: 'api_key', title: 'API key', value: { concealed: 'section-secret' } },
              ],
            },
          ],
        },
      },
    ])
    const [item] = parseOnePux(archive)

    expect(item).toMatchObject({
      itemType: 'login',
      itemName: 'API password',
      username: '',
      password: 'top-level-password',
      customFields: [
        { id: 'api_key', label: 'API key', value: 'section-secret' },
      ],
    })
  })

  it('keeps real login subtitles as usernames', () => {
    const archive = onePux([
      {
        categoryUuid: '001',
        overview: { title: 'Example', subtitle: 'alex@example.com' },
        details: {
          loginFields: [{ fieldType: 'P', value: 'login-password' }],
        },
      },
    ])
    const [item] = parseOnePux(archive)

    expect(item).toMatchObject({
      itemType: 'login',
      itemName: 'Example',
      username: 'alex@example.com',
      password: 'login-password',
    })
  })

  it('maps secure notes and identities to the right Klarkey item types', () => {
    const items = parseOnePux(onePux([
      {
        categoryUuid: '003',
        overview: { title: 'Secure note' },
        details: { notesPlain: 'note body' },
      },
      {
        categoryUuid: '004',
        overview: { title: 'Identity' },
        details: {
          sections: [
            {
              fields: [
                { id: 'firstname', title: 'first name', value: { string: 'Ada' } },
                { id: 'lastname', title: 'last name', value: { string: 'Lovelace' } },
                { id: 'address', title: 'address', value: { address: { street: '1 Example St', city: 'London', zip: '12345', country: 'UK' } } },
              ],
            },
          ],
        },
      },
    ]))

    expect(items[0]).toMatchObject({ itemType: 'note', content: 'note body' })
    expect(items[1]).toMatchObject({
      itemType: 'identity',
      firstName: 'Ada',
      lastName: 'Lovelace',
      addressLine1: '1 Example St',
      city: 'London',
      postalCode: '12345',
      country: 'UK',
    })
  })

  it('imports SSH keys and concealed recovery codes', () => {
    const items = parseOnePux(onePux([
      {
        categoryUuid: '114',
        overview: { title: 'Deploy key' },
        details: {
          sections: [
            {
              fields: [
                {
                  id: 'private_key',
                  title: 'private key',
                  value: {
                    sshKey: {
                      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
                      metadata: {
                        publicKey: 'ssh-ed25519 public-key',
                        fingerprint: 'SHA256:fingerprint',
                        keyType: 'ed25519',
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
      {
        categoryUuid: '001',
        overview: { title: 'Login' },
        details: {
          loginFields: [{ fieldType: 'P', value: 'login-password' }],
          sections: [
            {
              fields: [
                { id: 'codes', title: 'backup codes', value: { concealed: 'one\ntwo' } },
              ],
            },
          ],
        },
      },
    ]))

    expect(items[0]).toMatchObject({
      itemType: 'ssh-key',
      sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
      sshPublicKey: 'ssh-ed25519 public-key',
      sshFingerprint: 'SHA256:fingerprint',
      sshAlgorithm: 'ed25519',
    })
    expect(items[1]).toMatchObject({
      itemType: 'login',
      password: 'login-password',
      recoveryCodes: ['one', 'two'],
    })
  })
})
