import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const wrappedVaultKeyValidator = v.object({
  iv: v.string(),
  ciphertext: v.string(),
  authTag: v.string(),
  algorithm: v.literal("AES-256-GCM"),
  derivation: v.literal("HKDF-SHA256-klarkey-sync-v1"),
  wrappedAt: v.number(),
});

export default defineSchema({
  vaults: defineTable({
    aveIdentityId: v.string(),
    wrappedVaultKey: v.optional(wrappedVaultKeyValidator),
    schemaVersion: v.number(),
    sequence: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_ave_identity", ["aveIdentityId"]),

  records: defineTable({
    aveIdentityId: v.string(),
    recordId: v.string(),
    revision: v.number(),
    serverSequence: v.number(),
    deviceId: v.string(),
    deletedAt: v.optional(v.number()),
    ciphertext: v.string(),
    iv: v.string(),
    authTag: v.string(),
    contentHash: v.string(),
    schemaVersion: v.number(),
    updatedAt: v.number(),
  })
    .index("by_identity_sequence", ["aveIdentityId", "serverSequence"])
    .index("by_identity_record", ["aveIdentityId", "recordId"]),

  devices: defineTable({
    aveIdentityId: v.string(),
    deviceId: v.string(),
    name: v.string(),
    platform: v.string(),
    lastSeen: v.number(),
  })
    .index("by_identity_device", ["aveIdentityId", "deviceId"])
    .index("by_identity", ["aveIdentityId"]),

  entitlements: defineTable({
    aveIdentityId: v.string(),
    syncAllowed: v.boolean(),
    source: v.string(),
    updatedAt: v.number(),
  }).index("by_ave_identity", ["aveIdentityId"]),
});
