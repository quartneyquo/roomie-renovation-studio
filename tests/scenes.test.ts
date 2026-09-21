import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { initialPlacement } from "../lib/room";
import {
  evaluateScene,
  lucyPrompt,
  parseSnapshot,
  type SceneState,
} from "../lib/scene";
const modules = import.meta.glob("../convex/**/*.ts");
const snapshot = JSON.stringify({
  model: "SpatialLM-test-fixture",
  cameraAligned: true,
  metricScaleVerified: true,
  geometry: {
    walls: [{ id: "wall_1", a: [0, 0, 0], b: [4, 0, 0] }],
    doors: [{ id: "door_1" }],
    windows: [],
    bboxes: [{ class: "sofa", center: [2, 1, 0.5] }],
  },
});
async function setup() {
  const t = convexTest(schema, modules);
  const [ownerId, otherId] = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.insert("users", { isAnonymous: true }),
      ctx.db.insert("users", { isAnonymous: true }),
    ]),
  );
  const alice = t.withIdentity({ subject: `${ownerId}|test` });
  const bob = t.withIdentity({ subject: `${otherId}|test` });
  const args = {
    sceneKey: "room-a",
    revision: 1,
    source: "upload" as const,
    prompt: "A reading chair",
    placement: initialPlacement,
    snapshotImport: snapshot,
  };
  return { t, alice, bob, ownerId, args };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("versioned room understanding", () => {
  it("normalizes unverified imports and never approves physical fit", () => {
    const room = parseSnapshot(snapshot, "imported", 1);
    expect(room.cameraAligned).toBe(false);
    expect(room.metricScaleVerified).toBe(false);
    const scene: SceneState = {
      schemaVersion: 1,
      sceneKey: "a",
      revision: 1,
      source: "upload",
      room,
      lucyObject: {
        description: "chair",
        placement: initialPlacement,
        coordinateSystem: "screen-percent",
        dimensions: null,
        observedInOutput: false,
      },
    };
    expect(evaluateScene(scene).verdict).toBe("uncertain");
    expect(evaluateScene(scene).explanation).toContain("1 doors");
    expect(() => parseSnapshot('{"geometry":{}}', "imported", 1)).toThrow();
    expect(() => parseSnapshot("x".repeat(120001), "imported", 1)).toThrow(
      "120 KB",
    );
  });
  it("isolates scenes by owner and rejects older or conflicting revisions", async () => {
    const { t, alice, bob, ownerId, args } = await setup();
    await alice.mutation(api.scenes.sync, { ...args, revision: 3 });
    expect(await alice.mutation(api.scenes.sync, args)).toBeNull();
    await expect(
      alice.mutation(api.scenes.sync, {
        ...args,
        revision: 3,
        prompt: "different",
      }),
    ).rejects.toThrow("revision already used");
    await bob.mutation(api.scenes.sync, {
      ...args,
      revision: 5,
      prompt: "Bob's room",
    });
    const own = JSON.parse(
      (await t.query(internal.scenes.read, {
        ownerId,
        sceneKey: "room-a",
        revision: 3,
      }))!,
    );
    expect(own.lucyObject.description).toBe("A reading chair");
    await expect(t.mutation(api.scenes.sync, args)).rejects.toThrow(
      "private session",
    );
  });
  it("attaches only completed owned spatial jobs for the same room view", async () => {
    const { t, alice, bob, ownerId, args } = await setup();
    const id = await t.run((ctx) =>
      ctx.db.insert("providerJobs", {
        ownerId,
        kind: "spatial",
        status: "succeeded",
        requestId: "scan",
        revision: 0,
        input: JSON.stringify({ sceneKey: "room-a" }),
        result: snapshot,
        createdAt: 1,
        updatedAt: 2,
        expiresAt: Date.now() + 86400000,
        attempts: 1,
      }),
    );
    const request = { ...args, snapshotImport: undefined, snapshotJobId: id };
    await expect(bob.mutation(api.scenes.sync, request)).rejects.toThrow(
      "scan not found",
    );
    await expect(
      alice.mutation(api.scenes.sync, { ...request, sceneKey: "room-b" }),
    ).rejects.toThrow("different room view");
    const scene = JSON.parse((await alice.mutation(api.scenes.sync, request))!);
    expect(scene.room.provenance).toBe("modal");
    expect(scene.room.geometry.bboxes).toHaveLength(1);
  });
  it("sends room structure and intended Lucy state to Jev, then applies only supplied adjustments", async () => {
    const { t, alice, ownerId, args } = await setup();
    vi.stubEnv("TYPESAFE_API_KEY", "test-key-never-sent");
    let seen: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        seen = JSON.parse(JSON.parse(options.body).state);
        return new Response(
          JSON.stringify({
            model: "jev-test",
            answers: {
              verdict: { choice: "adjust", confidence: 0.95 },
              adjustment: { choice: "open_area" },
              nextStep: { choice: "apply_visual_adjustment" },
            },
          }),
          { status: 200 },
        );
      }),
    );
    await alice.mutation(api.scenes.sync, {
      ...args,
      placement: { ...initialPlacement, x: 95 },
    });
    const id = await t.run((ctx) =>
      ctx.db.insert("providerJobs", {
        ownerId,
        kind: "jev",
        status: "queued",
        requestId: "jev",
        revision: 1,
        input: JSON.stringify({ sceneKey: "room-a" }),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 10000,
        attempts: 0,
      }),
    );
    await t.action(internal.providers.run, { id });
    const result = JSON.parse(
      (await alice.query(api.jobs.get, { id }))!.result!,
    );
    expect((seen!.scene as SceneState).room!.geometry.doors).toHaveLength(1);
    expect((seen!.scene as SceneState).lucyObject.observedInOutput).toBe(false);
    expect(result.evaluation.adjustment.x).toBe(38);
    await alice.mutation(api.scenes.sync, {
      ...args,
      revision: 2,
      placement: result.evaluation.adjustment,
    });
    expect(lucyPrompt(args.prompt, result.evaluation.adjustment)).toContain(
      "38 percent from the left",
    );
    expect(result.evaluation.explanation).toContain("visual framing only");
  });
  it("cancels delayed Jev results after the scene changes", async () => {
    const { t, alice, ownerId, args } = await setup();
    await alice.mutation(api.scenes.sync, args);
    const id = await t.run((ctx) =>
      ctx.db.insert("providerJobs", {
        ownerId,
        kind: "jev",
        status: "running",
        requestId: "late",
        revision: 1,
        input: JSON.stringify({ sceneKey: "room-a" }),
        createdAt: 1,
        updatedAt: 1,
        expiresAt: Date.now() + 10000,
        attempts: 1,
      }),
    );
    await alice.mutation(api.scenes.sync, { ...args, revision: 2 });
    expect(
      await t.mutation(internal.jobs.patch, {
        id,
        status: "succeeded",
        result: "{}",
      }),
    ).toBe(false);
    expect((await alice.query(api.jobs.get, { id }))!.status).toBe("cancelled");
  });
  it("preserves a snapshot in saved rooms after transient scene cleanup and restores it privately", async () => {
    const { t, alice, bob, ownerId, args } = await setup();
    const state = JSON.parse(
      (await alice.mutation(api.scenes.sync, args))!,
    ) as SceneState;
    const assets = await t.run(async (ctx) => {
      const result = [];
      for (let n = 0; n < 3; n++) {
        const storageId = await ctx.storage.store(new Blob(["image"]));
        await ctx.db.insert("assets", {
          ownerId,
          storageId,
          saved: false,
          expiresAt: Date.now() + 10000,
        });
        result.push(storageId);
      }
      return result;
    });
    const id = await alice.mutation(api.rooms.save, {
      requestId: "save",
      name: "Room with snapshot",
      prompt: args.prompt,
      source: args.source,
      revision: 1,
      placement: initialPlacement,
      evaluation: evaluateScene(state),
      sceneKey: args.sceneKey,
      referenceId: assets[0],
      roomImageId: assets[1],
      screenshotId: assets[2],
    });
    await t.run(async (ctx) => {
      const scene = await ctx.db
        .query("sceneStates")
        .withIndex("by_ownerId_and_sceneKey", (q) =>
          q.eq("ownerId", ownerId).eq("sceneKey", args.sceneKey),
        )
        .unique();
      await ctx.db.patch(scene!._id, { expiresAt: 0 });
    });
    await t.mutation(internal.rooms.expire, {});
    expect((await alice.query(api.rooms.list, {}))[0].sceneState).toContain(
      "SpatialLM-test-fixture",
    );
    const restore = {
      ...args,
      sceneKey: "restored",
      snapshotImport: undefined,
      savedConfigurationId: id,
    };
    await expect(bob.mutation(api.scenes.sync, restore)).rejects.toThrow(
      "Saved room not found",
    );
    const restored = JSON.parse(
      (await alice.mutation(api.scenes.sync, restore))!,
    );
    expect(restored.room.geometry).toEqual(state.room!.geometry);
    expect(restored.lucyObject.observedInOutput).toBe(false);
    const changed = JSON.parse(
      (await alice.mutation(api.scenes.sync, {
        ...args,
        sceneKey: "new-view",
        snapshotImport: undefined,
      }))!,
    );
    expect(changed.room).toBeNull();
  });
});
