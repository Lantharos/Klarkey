import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildPagePasskeyResponse,
  readPagePasskeyRequest,
  safePagePasskeyErrorMessage,
  sanitizePagePasskeyResponsePayload,
} from '../../extension/shared/content/page/passkey/page-message.js'

describe('extension page passkey message parsing', () => {
  it('accepts bounded create and get requests', () => {
    expect(
      readPagePasskeyRequest({
        source: 'klarkey-page-authenticator-request',
        id: 'request-1',
        payload: {
          operation: 'create',
          requestDetailsJson: '{"challenge":"abc"}',
        },
      }),
    ).toEqual({
      id: 'request-1',
      operation: 'create',
      requestDetailsJson: '{"challenge":"abc"}',
    })

    expect(
      readPagePasskeyRequest({
        source: 'klarkey-page-authenticator-request',
        id: 'request-2',
        payload: {
          operation: 'get',
          requestDetailsJson: '{"challenge":"abc"}',
        },
      }),
    ).toEqual({
      id: 'request-2',
      operation: 'get',
      requestDetailsJson: '{"challenge":"abc"}',
    })
  })

  it('drops messages with invalid ids', () => {
    expect(
      readPagePasskeyRequest({
        source: 'klarkey-page-authenticator-request',
        id: '',
        payload: {
          operation: 'get',
          requestDetailsJson: '{}',
        },
      }),
    ).toBeUndefined()

    expect(
      readPagePasskeyRequest({
        source: 'klarkey-page-authenticator-request',
        id: 'x'.repeat(129),
        payload: {
          operation: 'get',
          requestDetailsJson: '{}',
        },
      }),
    ).toBeUndefined()
  })

  it('rejects unsupported operations without native work', () => {
    expect(
      readPagePasskeyRequest({
        source: 'klarkey-page-authenticator-request',
        id: 'request-1',
        payload: {
          operation: 'delete',
          requestDetailsJson: '{}',
        },
      }),
    ).toEqual({
      id: 'request-1',
      error: {
        name: 'NotSupportedError',
        message: 'Unsupported passkey operation.',
      },
    })
  })

  it('rejects missing or oversized request json', () => {
    expect(
      readPagePasskeyRequest({
        source: 'klarkey-page-authenticator-request',
        id: 'request-1',
        payload: {
          operation: 'get',
        },
      }),
    ).toEqual({
      id: 'request-1',
      error: {
        name: 'NotAllowedError',
        message: 'The passkey request is invalid.',
      },
    })

    expect(
      readPagePasskeyRequest({
        source: 'klarkey-page-authenticator-request',
        id: 'request-1',
        payload: {
          operation: 'get',
          requestDetailsJson: 'x'.repeat(262_145),
        },
      }),
    ).toEqual({
      id: 'request-1',
      error: {
        name: 'NotAllowedError',
        message: 'The passkey request is invalid.',
      },
    })

    expect(
      readPagePasskeyRequest({
        source: 'klarkey-page-authenticator-request',
        id: 'request-1',
        payload: {
          operation: 'get',
          requestDetailsJson: 'not json',
        },
      }),
    ).toEqual({
      id: 'request-1',
      error: {
        name: 'NotAllowedError',
        message: 'The passkey request is invalid.',
      },
    })

    expect(
      readPagePasskeyRequest({
        source: 'klarkey-page-authenticator-request',
        id: 'request-1',
        payload: {
          operation: 'get',
          requestDetailsJson: '[]',
        },
      }),
    ).toEqual({
      id: 'request-1',
      error: {
        name: 'NotAllowedError',
        message: 'The passkey request is invalid.',
      },
    })
  })

  it('builds the page response envelope', () => {
    expect(buildPagePasskeyResponse('request-1', { ok: true, responseJson: '{"id":"credential-1"}' })).toEqual({
      source: 'klarkey-page-authenticator-response',
      id: 'request-1',
      payload: { ok: true, responseJson: '{"id":"credential-1"}' },
    })
  })

  it('does not expose internal passkey fields in page-bound success payloads', () => {
    expect(sanitizePagePasskeyResponsePayload({
      ok: true,
      responseJson: '{"id":"credential-1"}',
      pendingPasskeyId: 'pending-secret',
      itemId: 'item-secret',
      message: 'Saved to Klarkey.',
    })).toEqual({
      ok: true,
      responseJson: '{"id":"credential-1"}',
    })
  })

  it('sanitizes passkey errors before they are posted to the page', () => {
    expect(safePagePasskeyErrorMessage('The passkey request was canceled.')).toBe('The passkey request was canceled.')
    expect(safePagePasskeyErrorMessage('pendingPasskeyId=pending-secret')).toBe('The passkey request could not be completed.')
    expect(safePagePasskeyErrorMessage('credentialId=credential-secret')).toBe('The passkey request could not be completed.')
    expect(safePagePasskeyErrorMessage('privateKey=private-secret')).toBe('The passkey request could not be completed.')
    expect(safePagePasskeyErrorMessage('failed at https://id.example.test/callback?code=secret')).toBe(
      'The passkey request could not be completed.',
    )
    expect(sanitizePagePasskeyResponsePayload({
      ok: false,
      error: {
        name: 'InternalError',
        message: 'refresh_token=secret',
      },
    })).toEqual({
      ok: false,
      error: {
        name: 'InternalError',
        message: 'The passkey request could not be completed.',
      },
    })
  })

  it('sanitizes page-bridge response payloads before hydrating page credentials', () => {
    const source = readFileSync(resolve(process.cwd(), 'extension/shared/page-bridge.js'), 'utf8')

    expect(source).toContain('sanitizeAuthenticatorResponsePayload(event.data.payload)')
    expect(source).toContain('maxAuthenticatorResponseJsonLength')
    expect(source).toContain('isBoundedString(event.data.id, maxAuthenticatorMessageIdLength)')
    expect(source).not.toContain('pending.resolve(event.data.payload)')
  })
})
