// @vitest-environment node
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseVaultArchive, parseVaultImport } from '@/desktop/import-vault'

describe('vault import formats', () => {
  it('maps Bitwarden CSV login fields and secure notes', () => {
    const csv = [
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp',
      'Social,1,login,Example,"main login","PIN: 2468",0,https://example.com,user@example.com,secret-value,TOTPSEED',
      ',0,note,Recovery note,"keep this",,,,',
    ].join('\n')

    const items = parseVaultImport({ format: 'auto', filePath: 'bitwarden.csv' }, csv)

    expect(items[0]).toMatchObject({
      itemType: 'login',
      itemName: 'Example',
      username: 'user@example.com',
      password: 'secret-value',
      otp: 'TOTPSEED',
      websites: ['https://example.com'],
      customFields: [{ label: 'PIN', value: '2468' }],
    })
    expect(items[1]).toMatchObject({
      itemType: 'note',
      itemName: 'Recovery note',
      content: 'keep this',
    })
  })

  it('maps Keeper CSV website address, OTP, and custom field pairs', () => {
    const csv = [
      'Folder,Title,Login,Password,Website Address,Notes,Shared Folder,CustomField1Name,CustomField1Value,$oneTimeCode',
      'Personal,Example,user@example.com,secret-value,https://example.com,main note,,API Key,key-value,otpauth://totp/Example?secret=ABC',
    ].join('\n')

    const [item] = parseVaultImport({ format: 'keeper-csv', filePath: 'keeper.csv' }, csv)

    expect(item).toMatchObject({
      itemType: 'login',
      itemName: 'Example',
      username: 'user@example.com',
      password: 'secret-value',
      websites: ['https://example.com'],
      otp: 'otpauth://totp/Example?secret=ABC',
      customFields: [{ label: 'API Key', value: 'key-value' }],
    })
  })

  it('keeps KeePass Account as the item name instead of the username', () => {
    const csv = [
      '"Account","Login Name","Password","Web Site","Comments"',
      '"GitHub","octocat","secret-value","https://github.com","developer account"',
    ].join('\n')

    const [item] = parseVaultImport({ format: 'auto', filePath: 'keepass.csv' }, csv)

    expect(item).toMatchObject({
      itemType: 'login',
      itemName: 'GitHub',
      username: 'octocat',
      password: 'secret-value',
      websites: ['https://github.com'],
      notes: 'developer account',
    })
  })

  it('imports 1Password CSV password-only rows without inventing a username', () => {
    const csv = [
      'Title,Website,Username,Password,One-time password,Notes',
      'Server token,,,secret-value,,personal access token',
    ].join('\n')

    const [item] = parseVaultImport({ format: '1password-csv', filePath: '1password.csv' }, csv)

    expect(item).toMatchObject({
      itemType: 'login',
      itemName: 'Server token',
      password: 'secret-value',
      notes: 'personal access token',
    })
    expect(item?.username).toBeUndefined()
  })

  it('auto-detects Firefox CSV and names entries from the URL host', () => {
    const csv = [
      'url,username,password,httpRealm,formActionOrigin,guid,timeCreated',
      'https://accounts.example.com/login,user@example.com,secret-value,,https://accounts.example.com,{guid},1710000000000',
    ].join('\n')

    const [item] = parseVaultImport({ format: 'auto', filePath: 'firefox.csv' }, csv)

    expect(item).toMatchObject({
      itemType: 'login',
      itemName: 'accounts.example.com',
      username: 'user@example.com',
      password: 'secret-value',
      websites: ['https://accounts.example.com/login'],
    })
  })

  it('imports supported CSV files from a Dashlane-style ZIP archive', () => {
    const archive = zipSync({
      'credentials.csv': strToU8([
        'name,website,login,password,note,otp',
        'Example,https://example.com,user@example.com,secret-value,main note,TOTPSEED',
      ].join('\n')),
      'secureNotes.csv': strToU8([
        'title,note',
        'Recovery note,keep this',
      ].join('\n')),
    })

    const items = parseVaultArchive({ format: 'dashlane-csv', filePath: 'dashlane.zip' }, archive)

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      itemType: 'login',
      itemName: 'Example',
      username: 'user@example.com',
      password: 'secret-value',
      websites: ['https://example.com'],
    })
    expect(items[1]).toMatchObject({
      itemType: 'note',
      itemName: 'Recovery note',
      content: 'keep this',
    })
  })

  it('imports Proton Pass JSON login, note, card, identity, and alias items', () => {
    const protonExport = {
      version: '5.0.0',
      userId: 'user',
      encrypted: false,
      vaults: {
        vault: {
          name: 'Personal',
          items: [
            {
              state: 1,
              aliasEmail: null,
              data: {
                metadata: { name: 'Example login', note: 'login note' },
                type: 'login',
                extraFields: [
                  { fieldName: 'API key', type: 'hidden', data: { content: 'api-value' } },
                  { fieldName: 'Backup TOTP', type: 'totp', data: { totpUri: 'otpauth://totp/Backup?secret=BACKUP' } },
                ],
                content: {
                  itemEmail: 'email@example.com',
                  itemUsername: 'handle',
                  password: 'secret-value',
                  urls: ['https://example.com'],
                  totpUri: 'otpauth://totp/Example?secret=PRIMARY',
                  passkeys: [{ credentialId: 'not-imported' }],
                },
              },
            },
            {
              state: 1,
              aliasEmail: null,
              data: {
                metadata: { name: 'Secure note', note: 'note body' },
                type: 'note',
                extraFields: [],
                content: {},
              },
            },
            {
              state: 1,
              aliasEmail: null,
              data: {
                metadata: { name: 'Card', note: 'card note' },
                type: 'creditCard',
                extraFields: [],
                content: {
                  cardholderName: 'Test User',
                  number: '4111111111111111',
                  verificationNumber: '123',
                  expirationDate: '2027-09',
                  pin: '9999',
                },
              },
            },
            {
              state: 1,
              aliasEmail: null,
              data: {
                metadata: { name: 'Identity', note: '' },
                type: 'identity',
                extraFields: [{ fieldName: 'Extra', type: 'text', data: { content: 'extra-value' } }],
                content: {
                  fullName: 'Test Person',
                  firstName: 'Test',
                  lastName: 'Person',
                  email: 'person@example.com',
                  phoneNumber: '555-0100',
                  organization: 'Example Co',
                  streetAddress: '1 Main St',
                  city: 'Paris',
                  stateOrProvince: 'IDF',
                  zipOrPostalCode: '75000',
                  countryOrRegion: 'FR',
                  passportNumber: 'passport-value',
                },
              },
            },
            {
              state: 1,
              aliasEmail: 'alias@example.com',
              data: {
                metadata: { name: 'Alias', note: 'alias note' },
                type: 'alias',
                extraFields: [],
                content: {},
              },
            },
            {
              state: 2,
              aliasEmail: null,
              data: {
                metadata: { name: 'Deleted', note: 'deleted note' },
                type: 'note',
                extraFields: [],
                content: {},
              },
            },
          ],
        },
      },
    }

    const items = parseVaultImport({ format: 'auto', filePath: 'data.json' }, JSON.stringify(protonExport))

    expect(items).toHaveLength(5)
    expect(items[0]).toMatchObject({
      itemType: 'login',
      itemName: 'Example login',
      username: 'handle',
      password: 'secret-value',
      websites: ['https://example.com'],
      otp: 'otpauth://totp/Example?secret=PRIMARY',
    })
    expect(items[0]?.customFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Email', value: 'email@example.com' }),
      expect.objectContaining({ label: 'API key', value: 'api-value' }),
      expect.objectContaining({ label: 'Proton Pass passkeys' }),
    ]))
    expect(items[1]).toMatchObject({ itemType: 'note', itemName: 'Secure note', content: 'note body' })
    expect(items[2]).toMatchObject({
      itemType: 'card',
      itemName: 'Card',
      cardholderName: 'Test User',
      cardNumber: '4111111111111111',
      cardExpiryMonth: '9',
      cardExpiryYear: '2027',
      cardCvc: '123',
    })
    expect(items[3]).toMatchObject({
      itemType: 'identity',
      itemName: 'Identity',
      fullName: 'Test Person',
      email: 'person@example.com',
      company: 'Example Co',
      postalCode: '75000',
    })
    expect(items[3]?.customFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Passport number', value: 'passport-value' }),
      expect.objectContaining({ label: 'Extra', value: 'extra-value' }),
    ]))
    expect(items[4]).toMatchObject({
      itemType: 'login',
      itemName: 'Alias',
      username: 'alias@example.com',
      notes: 'alias note',
    })
  })

  it('imports Proton Pass data.json from ZIP and rejects encrypted Proton Pass ZIP exports', () => {
    const archive = zipSync({
      'Proton Pass/data.json': strToU8(JSON.stringify({
        version: '5.0.0',
        userId: 'user',
        encrypted: false,
        vaults: {
          vault: {
            name: 'Personal',
            items: [{
              state: 1,
              aliasEmail: null,
              data: {
                metadata: { name: 'Example login', note: '' },
                type: 'login',
                extraFields: [],
                content: {
                  itemEmail: 'email@example.com',
                  itemUsername: '',
                  password: 'secret-value',
                  urls: ['https://example.com'],
                  totpUri: '',
                  passkeys: [],
                },
              },
            }],
          },
        },
      })),
    })

    const [item] = parseVaultArchive({ format: 'proton-pass', filePath: 'Proton Pass_export.zip' }, archive)

    expect(item).toMatchObject({
      itemType: 'login',
      itemName: 'Example login',
      username: 'email@example.com',
      password: 'secret-value',
    })

    const encryptedArchive = zipSync({ 'Proton Pass/data.pgp': strToU8('encrypted payload') })
    expect(() => parseVaultArchive({ format: 'proton-pass', filePath: 'Proton Pass_export.zip' }, encryptedArchive))
      .toThrow('Encrypted Proton Pass exports must be decrypted before Klarkey can import them.')
  })

  it('imports Proton Pass CSV and keeps email as a custom field when username is present', () => {
    const csv = [
      'name,url,email,username,password,note,totp',
      'Example,https://example.com,email@example.com,handle,secret-value,login note,TOTPSEED',
    ].join('\n')

    const [item] = parseVaultImport({ format: 'proton-pass', filePath: 'proton-pass.csv' }, csv)

    expect(item).toMatchObject({
      itemType: 'login',
      itemName: 'Example',
      username: 'handle',
      password: 'secret-value',
      websites: ['https://example.com'],
      notes: 'login note',
      otp: 'TOTPSEED',
      customFields: [{ id: 'proton_email', label: 'Email', value: 'email@example.com' }],
    })
  })
})
