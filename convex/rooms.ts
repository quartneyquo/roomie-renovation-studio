import { v, ConvexError } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { evaluation, furnitureItem, placement, source } from "./schema";
import type { Id } from "./_generated/dataModel";
import type { SceneState } from "../lib/scene";
export async function user(ctx: Pick<QueryCtx, "auth">) {
  const id = await getAuthUserId(ctx);
  if (!id) throw new ConvexError("Please reconnect your private session.");
  return id;
}
const signedIn = {
  args: {},
  input: async (ctx: QueryCtx) => ({
    ctx: { ownerId: await user(ctx) },
    args: {},
  }),
};
export const ownerQuery = customQuery(query, signedIn);
export const ownerMutation = customMutation(mutation, signedIn);
async function asset(
  ctx: QueryCtx,
  ownerId: Id<"users">,
  storageId: Id<"_storage">,
) {
  const row = await ctx.db
    .query("assets")
    .withIndex("by_ownerId_and_storageId", (q) =>
      q.eq("ownerId", ownerId).eq("storageId", storageId),
    )
    .unique();
  if (!row) throw new ConvexError("Image does not belong to this session.");
  return row;
}
export const registerAsset = internalMutation({
  args: { ownerId: v.id("users"), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { ownerId, storageId }) => {
    await ctx.db.insert("assets", {
      ownerId,
      storageId,
      expiresAt: Date.now() + 86400000,
      saved: false,
    });
    return null;
  },
});
export const assetUrl = ownerQuery({
  args: { storageId: v.id("_storage") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { storageId }) => {
    await asset(ctx, ctx.ownerId, storageId);
    return ctx.storage.getUrl(storageId);
  },
});
export const save = ownerMutation({
  args: {
    requestId: v.string(),
    name: v.string(),
    prompt: v.string(),
    placement,
    source,
    revision: v.number(),
    evaluation,
    items: v.optional(v.array(furnitureItem)),
    referenceId: v.optional(v.id("_storage")),
    roomImageId: v.id("_storage"),
    screenshotId: v.id("_storage"),
    sceneKey: v.optional(v.string()),
  },
  returns: v.id("savedConfigurations"),
  handler: async (ctx, a) => {
    if (
      !a.name.trim() ||
      a.name.length > 80 ||
      a.prompt.length > 1000 ||
      a.requestId.length > 100
    )
      throw new ConvexError("Invalid room details.");
    for (const [k, low, high] of [
      ["x", 0, 100],
      ["y", 0, 100],
      ["scale", 0.1, 3],
      ["rotation", -180, 180],
    ] as const) {
      const n = a.placement[k];
      if (!Number.isFinite(n) || n < low || n > high)
        throw new ConvexError("Invalid placement.");
    }
    if (
      a.items &&
      (a.items.length < 1 ||
        a.items.length > 8 ||
        new Set(a.items.map((item) => item.id)).size !== a.items.length ||
        a.items.some(
          (item) =>
            !item.id ||
            item.id.length > 100 ||
            !item.prompt.trim() ||
            item.prompt.length > 1000,
        ))
    )
      throw new ConvexError("Invalid furniture layout.");
    for (const item of a.items || []) {
      for (const [key, low, high] of [
        ["x", 0, 100],
        ["y", 0, 100],
        ["scale", 0.1, 3],
        ["rotation", -180, 180],
      ] as const) {
        const value = item.placement[key];
        if (!Number.isFinite(value) || value < low || value > high)
          throw new ConvexError("Invalid furniture layout.");
      }
    }
    const old = await ctx.db
      .query("savedConfigurations")
      .withIndex("by_ownerId_and_requestId", (q) =>
        q.eq("ownerId", ctx.ownerId).eq("requestId", a.requestId),
      )
      .unique();
    if (old) return old._id;
    const rooms = await ctx.db
      .query("savedConfigurations")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ctx.ownerId))
      .take(50);
    if (rooms.length >= 50)
      throw new ConvexError(
        "Please delete a room before saving another (50 maximum).",
      );
    const assetIds = [
      ...(a.referenceId ? [a.referenceId] : []),
      a.roomImageId,
      a.screenshotId,
      ...(a.items?.flatMap((item) =>
        item.referenceId ? [item.referenceId] : [],
      ) || []),
    ].filter((id, index, all) => all.indexOf(id) === index);
    for (const id of assetIds) {
      const file = await asset(ctx, ctx.ownerId, id);
      if (file.saved)
        throw new ConvexError("Upload a fresh copy for this room.");
      await ctx.db.patch(file._id, { saved: true });
    }
    const { sceneKey, ...configuration } = a;
    let sceneState: string | undefined;
    if (sceneKey) {
      const scene = await ctx.db
        .query("sceneStates")
        .withIndex("by_ownerId_and_sceneKey", (q) =>
          q.eq("ownerId", ctx.ownerId).eq("sceneKey", sceneKey),
        )
        .unique();
      if (!scene || scene.revision !== a.revision)
        throw new ConvexError("Room understanding changed. Please save again.");
      const state = JSON.parse(scene.state) as SceneState;
      if (
        state.lucyObject.description !== a.prompt ||
        (["x", "y", "scale", "rotation"] as const).some(
          (key) => state.lucyObject.placement[key] !== a.placement[key],
        )
      )
        throw new ConvexError(
          "Saved placement does not match the current scene.",
        );
      sceneState = scene.state;
    }
    return ctx.db.insert("savedConfigurations", {
      ...configuration,
      ...(sceneState ? { sceneState } : {}),
      ownerId: ctx.ownerId,
    });
  },
});
const savedFurnitureItem = v.object({
  id: v.string(),
  prompt: v.string(),
  reference: v.optional(v.string()),
  placement,
});
const savedView = v.object({
  id: v.string(),
  name: v.string(),
  prompt: v.string(),
  placement,
  source,
  revision: v.number(),
  evaluation,
  items: v.optional(v.array(savedFurnitureItem)),
  reference: v.optional(v.string()),
  roomImage: v.string(),
  screenshot: v.string(),
  createdAt: v.number(),
  sceneState: v.optional(v.string()),
});
export const list = ownerQuery({
  args: {},
  returns: v.array(savedView),
  handler: async (ctx) => {
    const rooms = await ctx.db
      .query("savedConfigurations")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ctx.ownerId))
      .order("desc")
      .take(50);
    return Promise.all(
      rooms.map(async (r) => ({
        id: r._id,
        name: r.name,
        prompt: r.prompt,
        placement: r.placement,
        source: r.source,
        revision: r.revision,
        evaluation: r.evaluation,
        ...(r.items
          ? {
              items: await Promise.all(
                r.items.map(async (item) => ({
                  id: item.id,
                  prompt: item.prompt,
                  placement: item.placement,
                  ...(item.referenceId
                    ? {
                        reference: (await ctx.storage.getUrl(
                          item.referenceId,
                        ))!,
                      }
                    : {}),
                })),
              ),
            }
          : {}),
        ...(r.sceneState ? { sceneState: r.sceneState } : {}),
        createdAt: r._creationTime,
        ...(r.referenceId
          ? { reference: (await ctx.storage.getUrl(r.referenceId))! }
          : {}),
        roomImage: (await ctx.storage.getUrl(r.roomImageId))!,
        screenshot: (await ctx.storage.getUrl(r.screenshotId))!,
      })),
    );
  },
});
export const remove = ownerMutation({
  args: { id: v.id("savedConfigurations") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const room = await ctx.db.get(id);
    if (!room || room.ownerId !== ctx.ownerId)
      throw new ConvexError("Room not found.");
    const storageIds = [
      ...(room.referenceId ? [room.referenceId] : []),
      room.roomImageId,
      room.screenshotId,
      ...(room.items?.flatMap((item) =>
        item.referenceId ? [item.referenceId] : [],
      ) || []),
    ].filter((id, index, all) => all.indexOf(id) === index);
    for (const storageId of storageIds) {
      const row = await asset(ctx, ctx.ownerId, storageId);
      await ctx.storage.delete(storageId);
      await ctx.db.delete(row._id);
    }
    for (const email of await ctx.db
      .query("handoffEmails")
      .withIndex("by_configurationId", (q) => q.eq("configurationId", id))
      .take(100))
      await ctx.db.delete(email._id);
    await ctx.db.delete(id);
    return null;
  },
});
export const expire = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx: MutationCtx) => {
    const files = await ctx.db
      .query("assets")
      .withIndex("by_saved_and_expiresAt", (q) =>
        q.eq("saved", false).lt("expiresAt", Date.now()),
      )
      .take(100);
    for (const file of files) {
      await ctx.storage.delete(file.storageId);
      await ctx.db.delete(file._id);
    }
    for (const table of [
      "providerJobs",
      "researchSources",
      "sceneStates",
      "roomScans",
    ] as const) {
      for (const row of await ctx.db
        .query(table)
        .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
        .take(100))
        await ctx.db.delete(row._id);
    }
    return null;
  },
});
