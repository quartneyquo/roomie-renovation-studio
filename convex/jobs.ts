import { reserve } from "./budget";
import { v, ConvexError } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { ownerMutation, ownerQuery } from "./rooms";
import { jobKind, jobStatus } from "./schema";
export const start = ownerMutation({
  args: {
    kind: jobKind,
    revision: v.number(),
    input: v.string(),
    requestId: v.string(),
  },
  returns: v.id("providerJobs"),
  handler: async (ctx, a) => {
    if (
      a.input.length > 30000 ||
      a.requestId.length > 100 ||
      !Number.isInteger(a.revision) ||
      a.revision < 0
    )
      throw new ConvexError("Invalid request.");
    const old = await ctx.db
      .query("providerJobs")
      .withIndex("by_ownerId_and_requestId", (q) =>
        q.eq("ownerId", ctx.ownerId).eq("requestId", a.requestId),
      )
      .unique();
    if (old) return old._id;
    const recent = await ctx.db
      .query("providerJobs")
      .withIndex("by_ownerId_and_createdAt", (q) =>
        q.eq("ownerId", ctx.ownerId).gt("createdAt", Date.now() - 3600000),
      )
      .take(120);
    if (recent.length >= 120)
      throw new ConvexError("Hourly preview limit reached. Try again later.");
    const expensive = recent.filter((j) => ["h3", "spatial"].includes(j.kind));
    if (["h3", "spatial"].includes(a.kind) && expensive.length >= 10)
      throw new ConvexError(
        "Hourly generation limit reached (10). Try again later.",
      );
    await reserve(
      ctx,
      ["h3", "spatial"].includes(a.kind) ? "generation" : "research-decision",
      ["h3", "spatial"].includes(a.kind) ? 10 : 180,
    );
    const now = Date.now();
    const id = await ctx.db.insert("providerJobs", {
      ...a,
      ownerId: ctx.ownerId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      expiresAt: now + 86400000,
    });
    await ctx.scheduler.runAfter(0, internal.providers.run, { id });
    return id;
  },
});
const jobView = v.object({
  id: v.id("providerJobs"),
  kind: jobKind,
  revision: v.number(),
  status: jobStatus,
  result: v.optional(v.string()),
  error: v.optional(v.string()),
});
export const get = ownerQuery({
  args: { id: v.id("providerJobs") },
  returns: v.union(jobView, v.null()),
  handler: async (ctx, { id }) => {
    const j = await ctx.db.get(id);
    if (!j || j.ownerId !== ctx.ownerId) return null;
    return {
      id: j._id,
      kind: j.kind,
      revision: j.revision,
      status: j.status,
      ...(j.result ? { result: j.result } : {}),
      ...(j.error ? { error: j.error } : {}),
    };
  },
});
export const cancel = ownerMutation({
  args: { id: v.id("providerJobs") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const job = await ctx.db.get(id);
    if (!job || job.ownerId !== ctx.ownerId)
      throw new ConvexError("Job not found.");
    if (["queued", "running"].includes(job.status)) {
      await ctx.db.patch(id, { status: "cancelled", updatedAt: Date.now() });
      if (job.kind === "h3" && job.providerRequestId)
        await ctx.scheduler.runAfter(0, internal.providers.cancelVideo, {
          requestId: job.providerRequestId,
        });
    }
    return null;
  },
});
export const load = internalQuery({
  args: { id: v.id("providerJobs") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("providerJobs"),
      _creationTime: v.number(),
      ownerId: v.id("users"),
      requestId: v.string(),
      kind: jobKind,
      status: jobStatus,
      revision: v.number(),
      input: v.string(),
      result: v.optional(v.string()),
      error: v.optional(v.string()),
      providerRequestId: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      attempts: v.number(),
      expiresAt: v.number(),
    }),
  ),
  handler: (ctx, { id }) => ctx.db.get(id),
});
export const patch = internalMutation({
  args: {
    id: v.id("providerJobs"),
    status: jobStatus,
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    providerRequestId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { id, ...a }) => {
    const job = await ctx.db.get(id);
    if (!job || ["cancelled", "succeeded", "failed"].includes(job.status))
      return false;
    await ctx.db.patch(id, {
      ...a,
      updatedAt: Date.now(),
      attempts: job.attempts + (a.status === "running" ? 1 : 0),
    });
    return true;
  },
});
export const cached = internalQuery({
  args: { cacheKey: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { cacheKey }) => {
    const r = await ctx.db
      .query("researchSources")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", cacheKey))
      .unique();
    return r && r.expiresAt > Date.now() ? r.payload : null;
  },
});
export const cache = internalMutation({
  args: { cacheKey: v.string(), payload: v.string() },
  returns: v.null(),
  handler: async (ctx, a) => {
    const old = await ctx.db
      .query("researchSources")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", a.cacheKey))
      .unique();
    if (old)
      await ctx.db.patch(old._id, {
        payload: a.payload,
        expiresAt: Date.now() + 86400000,
      });
    else
      await ctx.db.insert("researchSources", {
        ...a,
        expiresAt: Date.now() + 86400000,
      });
    return null;
  },
});
