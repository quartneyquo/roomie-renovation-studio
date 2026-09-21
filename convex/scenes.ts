import { v, ConvexError } from "convex/values";
import { internalQuery } from "./_generated/server";
import { ownerMutation } from "./rooms";
import { placement, source } from "./schema";
import { parseSnapshot, placementSchema, type SceneState } from "../lib/scene";

export const sync = ownerMutation({
  args: {
    sceneKey: v.string(),
    revision: v.number(),
    source,
    prompt: v.string(),
    placement,
    snapshotJobId: v.optional(v.id("providerJobs")),
    snapshotImport: v.optional(v.string()),
    savedConfigurationId: v.optional(v.id("savedConfigurations")),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, a) => {
    if (
      !a.sceneKey ||
      a.sceneKey.length > 100 ||
      !Number.isSafeInteger(a.revision) ||
      a.revision < 0 ||
      a.revision > 1e9 ||
      a.prompt.length > 1000
    )
      throw new ConvexError("Invalid scene state.");
    const p = placementSchema.parse(a.placement);
    const previous = await ctx.db
      .query("sceneStates")
      .withIndex("by_ownerId_and_sceneKey", (q) =>
        q.eq("ownerId", ctx.ownerId).eq("sceneKey", a.sceneKey),
      )
      .unique();
    if (previous && previous.revision > a.revision) return null;
    if (previous && previous.revision === a.revision) {
      const old = JSON.parse(previous.state) as SceneState;
      if (
        old.source !== a.source ||
        old.lucyObject.description !== a.prompt ||
        JSON.stringify(old.lucyObject.placement) !== JSON.stringify(p)
      )
        throw new ConvexError(
          "Scene revision already used. Retry with a new revision.",
        );
      return previous.state;
    }
    if (
      [a.snapshotJobId, a.snapshotImport, a.savedConfigurationId].filter(
        Boolean,
      ).length > 1
    )
      throw new ConvexError("Choose one room snapshot source.");
    let room: SceneState["room"] = null;
    if (a.snapshotJobId) {
      const job = await ctx.db.get(a.snapshotJobId);
      if (
        !job ||
        job.ownerId !== ctx.ownerId ||
        job.kind !== "spatial" ||
        job.status !== "succeeded" ||
        !job.result
      )
        throw new ConvexError("Completed room scan not found.");
      const input = JSON.parse(job.input);
      if (input.sceneKey !== a.sceneKey)
        throw new ConvexError("This scan belongs to a different room view.");
      room = parseSnapshot(job.result, "modal", job.updatedAt);
    } else if (a.snapshotImport) {
      room = parseSnapshot(
        a.snapshotImport,
        "imported",
        previous
          ? ((JSON.parse(previous.state) as SceneState).room?.capturedAt ??
              Date.now())
          : Date.now(),
      );
    } else if (a.savedConfigurationId) {
      const saved = await ctx.db.get(a.savedConfigurationId);
      if (!saved || saved.ownerId !== ctx.ownerId)
        throw new ConvexError("Saved room not found.");
      room = saved.sceneState
        ? (JSON.parse(saved.sceneState) as SceneState).room
        : null;
    }
    const state: SceneState = {
      schemaVersion: 1,
      sceneKey: a.sceneKey,
      revision: a.revision,
      source: a.source,
      room,
      lucyObject: {
        description: a.prompt,
        placement: p,
        coordinateSystem: "screen-percent",
        dimensions: null,
        observedInOutput: false,
      },
    };
    const serialized = JSON.stringify(state);
    if (previous)
      await ctx.db.patch(previous._id, {
        state: serialized,
        revision: a.revision,
        expiresAt: Date.now() + 86400000,
      });
    else
      await ctx.db.insert("sceneStates", {
        ownerId: ctx.ownerId,
        sceneKey: a.sceneKey,
        revision: a.revision,
        state: serialized,
        expiresAt: Date.now() + 86400000,
      });
    return serialized;
  },
});

export const read = internalQuery({
  args: { ownerId: v.id("users"), sceneKey: v.string(), revision: v.number() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("sceneStates")
      .withIndex("by_ownerId_and_sceneKey", (q) =>
        q.eq("ownerId", a.ownerId).eq("sceneKey", a.sceneKey),
      )
      .unique();
    return row && row.revision === a.revision && row.expiresAt > Date.now()
      ? row.state
      : null;
  },
});
