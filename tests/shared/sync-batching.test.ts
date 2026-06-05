// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { LocalSyncRecord } from '@/shared/sync'
import { buildPushBatches } from '@/desktop/sync'

function record(index: number, ciphertext = 'sealed'): LocalSyncRecord {
  return {
    recordId: `item:item_${index}`,
    revision: 1,
    deviceId: 'device_test',
    ciphertext,
    iv: 'AAAAAAAAAAAAAAAA',
    authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
    contentHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    schemaVersion: 1,
  }
}

describe('sync push batching', () => {
  it('splits large imports by record count and payload size', () => {
    const records = Array.from({ length: 130 }, (_, index) => record(index, 'x'.repeat(16_000)))
    const batches = buildPushBatches(records)

    expect(batches.length).toBeGreaterThan(1)
    expect(batches.every((batch) => batch.length <= 100)).toBe(true)
    expect(batches.flat().map((entry) => entry.recordId)).toEqual(records.map((entry) => entry.recordId))
    expect(batches.every((batch) => new TextEncoder().encode(JSON.stringify(batch)).byteLength <= 512 * 1024)).toBe(true)
  })
})
