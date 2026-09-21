import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { ownerMutation, ownerQuery } from "./rooms";
import { scanStatus } from "./schema";

const DAY = 24 * 60 * 60 * 1000;

export const createUploadUrl = ownerMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

export const registerVideo = ownerMutation({
  args: {
    storageId: v.id("_storage"),
    sceneKey: v.string(),
    requestId: v.string(),
  },
  returns: v.id("roomScans"),
  handler: async (ctx, a) => {
    if (!a.sceneKey || a.sceneKey.length > 100 || a.requestId.length > 100)
      throw new ConvexError("Invalid room scan request.");
    const metadata = await ctx.db.system.get(a.storageId);
    if (!metadata || metadata.size <= 0 || metadata.size > 60_000_000)
      throw new ConvexError("Choose a room video smaller than 60 MB.");
    if (
      metadata.contentType &&
      ![
        "video/webm",
        "video/mp4",
        "video/quicktime",
        "video/x-matroska",
      ].includes(metadata.contentType)
    )
      throw new ConvexError(
        "Room scans must be WebM, MP4, or QuickTime video.",
      );
    const existingAsset = await ctx.db
      .query("assets")
      .withIndex("by_ownerId_and_storageId", (q) =>
        q.eq("ownerId", ctx.ownerId).eq("storageId", a.storageId),
      )
      .unique();
    if (existingAsset)
      throw new ConvexError("This upload has already been used.");

    const previous = await ctx.db
      .query("roomScans")
      .withIndex("by_ownerId_and_sceneKey", (q) =>
        q.eq("ownerId", ctx.ownerId).eq("sceneKey", a.sceneKey),
      )
      .unique();
    if (previous) {
      if (previous.jobId) {
        const job = await ctx.db.get(previous.jobId);
        if (job && ["queued", "running"].includes(job.status))
          await ctx.db.patch(job._id, {
            status: "cancelled",
            updatedAt: Date.now(),
          });
      }
      if (previous.videoId) {
        const asset = await ctx.db
          .query("assets")
          .withIndex("by_ownerId_and_storageId", (q) =>
            q.eq("ownerId", ctx.ownerId).eq("storageId", previous.videoId!),
          )
          .unique();
        await ctx.storage.delete(previous.videoId).catch(() => null);
        if (asset) await ctx.db.delete(asset._id);
      }
      await ctx.db.delete(previous._id);
    }

    const now = Date.now();
    await ctx.db.insert("assets", {
      ownerId: ctx.ownerId,
      storageId: a.storageId,
      expiresAt: now + DAY,
      saved: false,
    });
    return ctx.db.insert("roomScans", {
      ownerId: ctx.ownerId,
      sceneKey: a.sceneKey,
      requestId: a.requestId,
      videoId: a.storageId,
      status: "uploading",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + DAY,
    });
  },
});

export const attachJob = ownerMutation({
  args: { id: v.id("roomScans"), jobId: v.id("providerJobs") },
  returns: v.null(),
  handler: async (ctx, { id, jobId }) => {
    const [scan, job] = await Promise.all([ctx.db.get(id), ctx.db.get(jobId)]);
    if (
      !scan ||
      scan.ownerId !== ctx.ownerId ||
      !job ||
      job.ownerId !== ctx.ownerId ||
      job.kind !== "spatial"
    )
      throw new ConvexError("Room scan job not found.");
    await ctx.db.patch(id, {
      jobId,
      status: "reconstructing",
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const retrySource = ownerMutation({
  args: { id: v.id("roomScans") },
  returns: v.id("_storage"),
  handler: async (ctx, { id }) => {
    const scan = await ctx.db.get(id);
    if (!scan || scan.ownerId !== ctx.ownerId || !scan.videoId)
      throw new ConvexError(
        "The room video is no longer available. Record a replacement scan.",
      );
    const asset = await ctx.db
      .query("assets")
      .withIndex("by_ownerId_and_storageId", (q) =>
        q.eq("ownerId", ctx.ownerId).eq("storageId", scan.videoId!),
      )
      .unique();
    if (!asset)
      throw new ConvexError(
        "The room video has expired. Record a replacement scan.",
      );
    await ctx.db.patch(id, {
      status: "reconstructing",
      error: undefined,
      updatedAt: Date.now(),
    });
    return scan.videoId;
  },
});

export const remove = ownerMutation({
  args: { id: v.id("roomScans") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const scan = await ctx.db.get(id);
    if (!scan || scan.ownerId !== ctx.ownerId)
      throw new ConvexError("Room scan not found.");
    if (scan.jobId) {
      const job = await ctx.db.get(scan.jobId);
      if (job && ["queued", "running"].includes(job.status))
        await ctx.db.patch(job._id, {
          status: "cancelled",
          updatedAt: Date.now(),
        });
    }
    if (scan.videoId) {
      const asset = await ctx.db
        .query("assets")
        .withIndex("by_ownerId_and_storageId", (q) =>
          q.eq("ownerId", ctx.ownerId).eq("storageId", scan.videoId!),
        )
        .unique();
      await ctx.storage.delete(scan.videoId).catch(() => null);
      if (asset) await ctx.db.delete(asset._id);
    }
    await ctx.db.delete(id);
    return null;
  },
});

const scanView = v.object({
  id: v.id("roomScans"),
  status: scanStatus,
  jobId: v.optional(v.id("providerJobs")),
  snapshot: v.optional(v.string()),
  error: v.optional(v.string()),
});

export const current = ownerQuery({
  args: { sceneKey: v.string() },
  returns: v.union(scanView, v.null()),
  handler: async (ctx, { sceneKey }) => {
    const scan = await ctx.db
      .query("roomScans")
      .withIndex("by_ownerId_and_sceneKey", (q) =>
        q.eq("ownerId", ctx.ownerId).eq("sceneKey", sceneKey),
      )
      .unique();
    if (!scan) return null;
    return {
      id: scan._id,
      status: scan.status,
      ...(scan.jobId ? { jobId: scan.jobId } : {}),
      ...(scan.snapshot ? { snapshot: scan.snapshot } : {}),
      ...(scan.error ? { error: scan.error } : {}),
    };
  },
});

export const setStatus = internalMutation({
  args: {
    id: v.id("roomScans"),
    status: scanStatus,
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...update }) => {
    const scan = await ctx.db.get(id);
    if (!scan) return null;
    await ctx.db.patch(id, { ...update, updatedAt: Date.now() });
    return null;
  },
});

export const complete = internalMutation({
  args: { id: v.id("roomScans"), snapshot: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, snapshot }) => {
    if (snapshot.length > 120_000)
      throw new ConvexError("Room snapshot is too large.");
    const scan = await ctx.db.get(id);
    if (!scan) return null;
    if (scan.videoId) {
      const asset = await ctx.db
        .query("assets")
        .withIndex("by_ownerId_and_storageId", (q) =>
          q.eq("ownerId", scan.ownerId).eq("storageId", scan.videoId!),
        )
        .unique();
      await ctx.storage.delete(scan.videoId).catch(() => null);
      if (asset) await ctx.db.delete(asset._id);
    }
    await ctx.db.patch(id, {
      status: "ready",
      snapshot,
      videoId: undefined,
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});
