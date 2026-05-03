import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { wrappedVaultKeyValidator } from "./schema";

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

async function identityId(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }
  return identity.subject;
}

export const bootstrapVault = mutation({
  args: {
    wrappedVaultKey: v.optional(wrappedVaultKeyValidator),
    schemaVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const aveIdentityId = await identityId(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("vaults")
      .withIndex("by_ave_identity", (q) => q.eq("aveIdentityId", aveIdentityId))
      .unique();

    if (existing) {
      if (!existing.wrappedVaultKey && args.wrappedVaultKey) {
        await ctx.db.patch(existing._id, {
          wrappedVaultKey: args.wrappedVaultKey,
          schemaVersion: Math.max(existing.schemaVersion, args.schemaVersion),
          updatedAt: now,
        });
        return {
          vaultId: existing._id,
          wrappedVaultKey: args.wrappedVaultKey,
          schemaVersion: Math.max(existing.schemaVersion, args.schemaVersion),
          sequence: existing.sequence,
          needsSetup: false,
        };
      }

      return {
        vaultId: existing._id,
        wrappedVaultKey: existing.wrappedVaultKey,
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
      wrappedVaultKey: args.wrappedVaultKey,
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
  handler: async (ctx, args) => {
    const aveIdentityId = await identityId(ctx);
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
  handler: async (ctx, args) => {
    const aveIdentityId = await identityId(ctx);
    const vault = await ctx.db
      .query("vaults")
      .withIndex("by_ave_identity", (q) => q.eq("aveIdentityId", aveIdentityId))
      .unique();
    const limit = Math.min(Math.max(args.limit ?? 250, 1), 500);
    const records = await ctx.db
      .query("records")
      .withIndex("by_identity_sequence", (q) => q.eq("aveIdentityId", aveIdentityId).gt("serverSequence", args.since))
      .order("asc")
      .take(limit);

    return {
      wrappedVaultKey: vault?.wrappedVaultKey,
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
  handler: async (ctx, args) => {
    const aveIdentityId = await identityId(ctx);
    const entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_ave_identity", (q) => q.eq("aveIdentityId", aveIdentityId))
      .unique();
    if (entitlement?.syncAllowed === false) {
      throw new Error("Sync is not enabled for this account");
    }

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

      if (existing && existing.contentHash === incoming.contentHash && incoming.revision <= existing.revision) {
        accepted.push({
          recordId: existing.recordId,
          revision: existing.revision,
          serverSequence: existing.serverSequence,
          contentHash: existing.contentHash,
        });
        continue;
      }

      if (existing && existing.revision >= incoming.revision && existing.contentHash !== incoming.contentHash) {
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

    return {
      sequence,
      accepted,
      conflicts,
    };
  },
});
