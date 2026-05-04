import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { wrappedVaultKeyValidator } from "./schema";
import { canRegisterNewDevice, decideRecordWrite, isBase64ByteLengthInRange, isExpectedSyncRecordId, isSafeSyncText } from "./syncPolicy";

const encryptedRecordValidator = v.object({
  recordId: v.string(),
  revision: v.number(),
  deviceId: v.string(),
  deletedAt: v.optional(v.number()),
  ciphertext: v.string(),
  iv: v.string(),
  authTag: v.string(),
  contentHash: v.string(),
  schemaVersion: v.number(),
});

const syncRecordReturnValidator = v.object({
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
});

const pushAcceptedReturnValidator = v.object({
  recordId: v.string(),
  revision: v.number(),
  serverSequence: v.number(),
  contentHash: v.string(),
});

const bootstrapReturnValidator = v.object({
  vaultId: v.id("vaults"),
  wrappedVaultKey: v.optional(wrappedVaultKeyValidator),
  schemaVersion: v.number(),
  sequence: v.number(),
  needsSetup: v.boolean(),
});

const CURRENT_SCHEMA_VERSION = 1;
const MAX_PUSH_BATCH_RECORDS = 100;
const MAX_PULL_LIMIT = 500;
const MAX_ID_LENGTH = 160;
const MAX_DEVICE_ID_LENGTH = 120;
const MAX_DEVICE_NAME_LENGTH = 120;
const MAX_PLATFORM_LENGTH = 80;
const MAX_DEVICES_PER_IDENTITY = 50;
const MAX_CIPHERTEXT_LENGTH = 256 * 1024;
const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;
const SHA256_BYTES = 32;
const WRAPPED_VAULT_KEY_BYTES = 32;

async function identityId(ctx: Pick<QueryCtx | MutationCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }
  return identity.subject;
}

async function ensureSyncAllowed(ctx: Pick<QueryCtx | MutationCtx, "db">, aveIdentityId: string) {
  const entitlement = await ctx.db
    .query("entitlements")
    .withIndex("by_ave_identity", (q) => q.eq("aveIdentityId", aveIdentityId))
    .unique();
  if (entitlement?.syncAllowed === false) {
    throw new Error("Sync is not enabled for this account");
  }
}

function ensureInteger(value: number, name: string, min: number, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} is out of range`);
  }
}

function ensureText(value: string, name: string, maxLength: number) {
  if (!isSafeSyncText(value, maxLength)) {
    throw new Error(`${name} is out of range`);
  }
}

function ensureBase64Bytes(value: string, name: string, minBytes: number, maxBytes: number) {
  ensureText(value, name, Math.ceil(maxBytes / 3) * 4 + 4);
  if (!isBase64ByteLengthInRange(value, minBytes, maxBytes)) {
    throw new Error(`${name} is not valid base64`);
  }
}

function validateWrappedVaultKey(wrappedVaultKey: NonNullable<unknown>) {
  const wrapped = wrappedVaultKey as {
    iv: string;
    ciphertext: string;
    authTag: string;
    wrappedAt: number;
  };
  ensureBase64Bytes(wrapped.iv, "wrappedVaultKey.iv", GCM_IV_BYTES, GCM_IV_BYTES);
  ensureBase64Bytes(wrapped.ciphertext, "wrappedVaultKey.ciphertext", WRAPPED_VAULT_KEY_BYTES, WRAPPED_VAULT_KEY_BYTES);
  ensureBase64Bytes(wrapped.authTag, "wrappedVaultKey.authTag", GCM_AUTH_TAG_BYTES, GCM_AUTH_TAG_BYTES);
  ensureInteger(wrapped.wrappedAt, "wrappedVaultKey.wrappedAt", 0);
}

function validateEncryptedRecord(record: {
  recordId: string;
  revision: number;
  deviceId: string;
  deletedAt?: number;
  ciphertext: string;
  iv: string;
  authTag: string;
  contentHash: string;
  schemaVersion: number;
}) {
  ensureText(record.recordId, "recordId", MAX_ID_LENGTH);
  if (!isExpectedSyncRecordId(record.recordId)) {
    throw new Error("recordId is out of range");
  }
  ensureText(record.deviceId, "deviceId", MAX_DEVICE_ID_LENGTH);
  ensureInteger(record.revision, "revision", 1);
  ensureInteger(record.schemaVersion, "schemaVersion", CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
  if (record.deletedAt !== undefined) {
    ensureInteger(record.deletedAt, "deletedAt", 1);
  }
  ensureBase64Bytes(record.ciphertext, "ciphertext", 1, MAX_CIPHERTEXT_LENGTH);
  ensureBase64Bytes(record.iv, "iv", GCM_IV_BYTES, GCM_IV_BYTES);
  ensureBase64Bytes(record.authTag, "authTag", GCM_AUTH_TAG_BYTES, GCM_AUTH_TAG_BYTES);
  ensureBase64Bytes(record.contentHash, "contentHash", SHA256_BYTES, SHA256_BYTES);
}

function validateDistinctRecordIds(records: { recordId: string }[]) {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.recordId)) {
      throw new Error("Sync batch contains duplicate records");
    }
    seen.add(record.recordId);
  }
}

function validateSingleBatchDeviceId(records: { deviceId: string }[]) {
  const deviceId = records[0]?.deviceId;
  ensureText(deviceId, "deviceId", MAX_DEVICE_ID_LENGTH);

  for (const record of records) {
    if (record.deviceId !== deviceId) {
      throw new Error("Sync batch contains multiple device ids");
    }
  }

  return deviceId;
}

async function ensureRegisteredSyncDevice(ctx: Pick<MutationCtx, "db">, aveIdentityId: string, deviceId: string) {
  const device = await ctx.db
    .query("devices")
    .withIndex("by_identity_device", (q) => q.eq("aveIdentityId", aveIdentityId).eq("deviceId", deviceId))
    .unique();
  if (!device) {
    throw new Error("Sync device is not registered");
  }

  return device;
}

export const bootstrapVault = mutation({
  args: {
    wrappedVaultKey: v.optional(wrappedVaultKeyValidator),
    schemaVersion: v.number(),
  },
  returns: bootstrapReturnValidator,
  handler: async (ctx, args) => {
    ensureInteger(args.schemaVersion, "schemaVersion", CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
    if (args.wrappedVaultKey) {
      validateWrappedVaultKey(args.wrappedVaultKey);
    }

    const aveIdentityId = await identityId(ctx);
    await ensureSyncAllowed(ctx, aveIdentityId);
    const now = Date.now();
    const existing = await ctx.db
      .query("vaults")
      .withIndex("by_ave_identity", (q) => q.eq("aveIdentityId", aveIdentityId))
      .unique();

    if (existing) {
      if (!existing.wrappedVaultKey && args.wrappedVaultKey) {
        const wrappedVaultKey = args.wrappedVaultKey;
        await ctx.db.patch(existing._id, {
          wrappedVaultKey,
          schemaVersion: Math.max(existing.schemaVersion, args.schemaVersion),
          updatedAt: now,
        });
        return {
          vaultId: existing._id,
          wrappedVaultKey,
          schemaVersion: Math.max(existing.schemaVersion, args.schemaVersion),
          sequence: existing.sequence,
          needsSetup: false,
        };
      }

      return {
        vaultId: existing._id,
        ...(existing.wrappedVaultKey ? { wrappedVaultKey: existing.wrappedVaultKey } : {}),
        schemaVersion: existing.schemaVersion,
        sequence: existing.sequence,
        needsSetup: !existing.wrappedVaultKey,
      };
    }

    const vaultId = await ctx.db.insert("vaults", {
      aveIdentityId,
      wrappedVaultKey: args.wrappedVaultKey,
      schemaVersion: args.schemaVersion,
      sequence: 0,
      createdAt: now,
      updatedAt: now,
    });

    return {
      vaultId,
      ...(args.wrappedVaultKey ? { wrappedVaultKey: args.wrappedVaultKey } : {}),
      schemaVersion: args.schemaVersion,
      sequence: 0,
      needsSetup: !args.wrappedVaultKey,
    };
  },
});

export const registerDevice = mutation({
  args: {
    deviceId: v.string(),
    name: v.string(),
    platform: v.string(),
  },
  returns: v.id("devices"),
  handler: async (ctx, args) => {
    ensureText(args.deviceId, "deviceId", MAX_DEVICE_ID_LENGTH);
    ensureText(args.name, "name", MAX_DEVICE_NAME_LENGTH);
    ensureText(args.platform, "platform", MAX_PLATFORM_LENGTH);

    const aveIdentityId = await identityId(ctx);
    await ensureSyncAllowed(ctx, aveIdentityId);
    const now = Date.now();
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_identity_device", (q) => q.eq("aveIdentityId", aveIdentityId).eq("deviceId", args.deviceId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        platform: args.platform,
        lastSeen: now,
      });
      return existing._id;
    }

    const existingDevices = await ctx.db
      .query("devices")
      .withIndex("by_identity", (q) => q.eq("aveIdentityId", aveIdentityId))
      .take(MAX_DEVICES_PER_IDENTITY);
    if (!canRegisterNewDevice(existingDevices.length, MAX_DEVICES_PER_IDENTITY)) {
      throw new Error("Device limit reached for this account");
    }

    return await ctx.db.insert("devices", {
      aveIdentityId,
      deviceId: args.deviceId,
      name: args.name,
      platform: args.platform,
      lastSeen: now,
    });
  },
});

export const getSyncStatus = query({
  args: {},
  returns: v.object({
    syncAllowed: v.boolean(),
    sequence: v.number(),
    schemaVersion: v.number(),
    hasVaultKey: v.boolean(),
  }),
  handler: async (ctx) => {
    const aveIdentityId = await identityId(ctx);
    const vault = await ctx.db
      .query("vaults")
      .withIndex("by_ave_identity", (q) => q.eq("aveIdentityId", aveIdentityId))
      .unique();
    const entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_ave_identity", (q) => q.eq("aveIdentityId", aveIdentityId))
      .unique();

    return {
      syncAllowed: entitlement?.syncAllowed ?? true,
      sequence: vault?.sequence ?? 0,
      schemaVersion: vault?.schemaVersion ?? 1,
      hasVaultKey: Boolean(vault?.wrappedVaultKey),
    };
  },
});

export const pullSince = query({
  args: {
    since: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    wrappedVaultKey: v.optional(wrappedVaultKeyValidator),
    schemaVersion: v.number(),
    sequence: v.number(),
    records: v.array(syncRecordReturnValidator),
  }),
  handler: async (ctx, args) => {
    ensureInteger(args.since, "since", 0);
    if (args.limit !== undefined) {
      ensureInteger(args.limit, "limit", 1, MAX_PULL_LIMIT);
    }

    const aveIdentityId = await identityId(ctx);
    await ensureSyncAllowed(ctx, aveIdentityId);
    const vault = await ctx.db
      .query("vaults")
      .withIndex("by_ave_identity", (q) => q.eq("aveIdentityId", aveIdentityId))
      .unique();
    const limit = Math.min(Math.max(args.limit ?? 250, 1), MAX_PULL_LIMIT);
    const records = await ctx.db
      .query("records")
      .withIndex("by_identity_sequence", (q) => q.eq("aveIdentityId", aveIdentityId).gt("serverSequence", args.since))
      .order("asc")
      .take(limit);

    return {
      ...(vault?.wrappedVaultKey ? { wrappedVaultKey: vault.wrappedVaultKey } : {}),
      schemaVersion: vault?.schemaVersion ?? 1,
      sequence: vault?.sequence ?? 0,
      records: records.map((record) => ({
        recordId: record.recordId,
        revision: record.revision,
        serverSequence: record.serverSequence,
        deviceId: record.deviceId,
        deletedAt: record.deletedAt,
        ciphertext: record.ciphertext,
        iv: record.iv,
        authTag: record.authTag,
        contentHash: record.contentHash,
        schemaVersion: record.schemaVersion,
      })),
    };
  },
});

export const pushBatch = mutation({
  args: {
    records: v.array(encryptedRecordValidator),
  },
  returns: v.object({
    sequence: v.number(),
    accepted: v.array(pushAcceptedReturnValidator),
    conflicts: v.array(syncRecordReturnValidator),
  }),
  handler: async (ctx, args) => {
    if (args.records.length < 1 || args.records.length > MAX_PUSH_BATCH_RECORDS) {
      throw new Error("Sync batch is out of range");
    }
    for (const record of args.records) {
      validateEncryptedRecord(record);
    }
    validateDistinctRecordIds(args.records);
    const deviceId = validateSingleBatchDeviceId(args.records);

    const aveIdentityId = await identityId(ctx);
    await ensureSyncAllowed(ctx, aveIdentityId);
    const device = await ensureRegisteredSyncDevice(ctx, aveIdentityId, deviceId);

    const vault = await ctx.db
      .query("vaults")
      .withIndex("by_ave_identity", (q) => q.eq("aveIdentityId", aveIdentityId))
      .unique();
    if (!vault) {
      throw new Error("Vault has not been bootstrapped");
    }

    const now = Date.now();
    let sequence = vault.sequence;
    const accepted = [];
    const conflicts = [];

    for (const incoming of args.records) {
      const existing = await ctx.db
        .query("records")
        .withIndex("by_identity_record", (q) => q.eq("aveIdentityId", aveIdentityId).eq("recordId", incoming.recordId))
        .unique();

      const decision = decideRecordWrite(existing ?? undefined, incoming);
      if (decision === "reject-new-revision") {
        throw new Error("New sync records must start at revision 1");
      }

      if (existing && decision === "accept-existing") {
        accepted.push({
          recordId: existing.recordId,
          revision: existing.revision,
          serverSequence: existing.serverSequence,
          contentHash: existing.contentHash,
        });
        continue;
      }

      if (existing && decision === "conflict-existing") {
        conflicts.push({
          recordId: existing.recordId,
          revision: existing.revision,
          serverSequence: existing.serverSequence,
          deviceId: existing.deviceId,
          deletedAt: existing.deletedAt,
          ciphertext: existing.ciphertext,
          iv: existing.iv,
          authTag: existing.authTag,
          contentHash: existing.contentHash,
          schemaVersion: existing.schemaVersion,
        });
        continue;
      }

      sequence += 1;
      const nextRecord = {
        ...incoming,
        aveIdentityId,
        serverSequence: sequence,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, nextRecord);
      } else {
        await ctx.db.insert("records", nextRecord);
      }

      accepted.push({
        recordId: incoming.recordId,
        revision: incoming.revision,
        serverSequence: sequence,
        contentHash: incoming.contentHash,
      });
    }

    if (sequence !== vault.sequence) {
      await ctx.db.patch(vault._id, {
        sequence,
        updatedAt: now,
      });
    }
    await ctx.db.patch(device._id, { lastSeen: now });

    return {
      sequence,
      accepted,
      conflicts,
    };
  },
});
