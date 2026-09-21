import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { evaluatePlacement, initialPlacement } from "../lib/room";
const modules = import.meta.glob("../convex/**/*.ts");
async function setup() {
  const t = convexTest(schema, modules);
  const [a, b] = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.insert("users", { isAnonymous: true }),
      ctx.db.insert("users", { isAnonymous: true }),
    ]),
  );
  const alice = t.withIdentity({ subject: `${a}|test-session` }),
    bob = t.withIdentity({ subject: `${b}|other-session` });
  return { t, alice, bob, a, b };
}
async function room() {
  const setupResult = await setup();
  const { t, a, alice } = setupResult;
  const ids = await t.run(async (ctx) => {
    const result = [];
    for (let i = 0; i < 3; i++) {
      const id = await ctx.storage.store(
        new Blob(["test"], { type: "image/png" }),
      );
      await ctx.db.insert("assets", {
        ownerId: a,
        storageId: id,
        saved: false,
        expiresAt: Date.now() + 86400000,
      });
      result.push(id);
    }
    return result;
  });
  const args = {
    requestId: "save-test",
    name: "Test room",
    prompt: "Chair",
    placement: initialPlacement,
    source: "demo" as const,
    revision: 1,
    evaluation: evaluatePlacement(initialPlacement, "demo", 1),
    referenceId: ids[0],
    roomImageId: ids[1],
    screenshotId: ids[2],
  };
  const id = await alice.mutation(api.rooms.save, args);
  return { ...setupResult, id, args, ids };
}
describe("private room storage", () => {
  it("rejects unauthenticated access", async () => {
    const { t } = await setup();
    await expect(t.query(api.rooms.list, {})).rejects.toThrow(
      "private session",
    );
  });
  it("persists full transforms, makes save retries idempotent, and isolates users", async () => {
    const { alice, bob, id, args } = await room();
    expect(await alice.mutation(api.rooms.save, args)).toBe(id);
    expect(await bob.query(api.rooms.list, {})).toEqual([]);
    const rooms = await alice.query(api.rooms.list, {});
    expect(rooms).toHaveLength(1);
    expect(rooms[0].placement).toEqual(initialPlacement);
    await expect(bob.mutation(api.rooms.remove, { id })).rejects.toThrow(
      "Room not found",
    );
  });
  it("rejects another session's storage ID and invalid transforms", async () => {
    const { bob, args } = await room();
    await expect(
      bob.mutation(api.rooms.save, { ...args, requestId: "stolen" }),
    ).rejects.toThrow("does not belong");
    await expect(
      bob.mutation(api.rooms.save, {
        ...args,
        placement: { ...initialPlacement, scale: 999 },
      }),
    ).rejects.toThrow("Invalid placement");
  });
  it("deletes owned room assets and expires only unsaved captures", async () => {
    const { alice, t, id, ids, a } = await room();
    const transient = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["temporary"]));
      await ctx.db.insert("assets", {
        ownerId: a,
        storageId,
        saved: false,
        expiresAt: Date.now() - 1,
      });
      return storageId;
    });
    await t.mutation(internal.rooms.expire, {});
    expect(
      await t.run(async (ctx) => (await ctx.storage.get(transient)) !== null),
    ).toBe(false);
    expect(
      await t.run(async (ctx) => (await ctx.storage.get(ids[0])) !== null),
    ).toBe(true);
    await alice.mutation(api.rooms.remove, { id });
    expect(await alice.query(api.rooms.list, {})).toEqual([]);
    expect(
      await t.run(async (ctx) => (await ctx.storage.get(ids[0])) !== null),
    ).toBe(false);
  });
  it("keeps room scans owner-scoped and deletes source video after analysis", async () => {
    const { t, alice, bob } = await setup();
    const videoId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob(["video"], { type: "video/webm;codecs=vp9" }),
      ),
    );
    const id = await alice.mutation(api.scans.registerVideo, {
      storageId: videoId,
      sceneKey: "living-room",
      requestId: "scan-1",
    });
    await expect(bob.mutation(api.scans.remove, { id })).rejects.toThrow(
      "Room scan not found",
    );
    const snapshot = JSON.stringify({
      model: "spatial-test",
      geometry: { walls: [{}], doors: [], windows: [], bboxes: [] },
    });
    await t.mutation(internal.scans.complete, { id, snapshot });
    expect(
      await alice.query(api.scans.current, { sceneKey: "living-room" }),
    ).toMatchObject({ status: "ready", snapshot });
    expect(
      await t.run(async (ctx) => (await ctx.storage.get(videoId)) !== null),
    ).toBe(false);
  });
  it("rejects a handoff of someone else's saved room", async () => {
    const { t, id, b } = await room();
    await expect(
      t.mutation(internal.handoff.claim, {
        ownerId: b,
        requestId: "email",
        configurationId: id,
        recipient: "test@example.com",
        subject: "Preview",
        text: "Test",
      }),
    ).rejects.toThrow("Room not found");
  });
  it("claims an email once and never sends on duplicate approval", async () => {
    const { t, id, a } = await room();
    const args = {
      ownerId: a,
      requestId: "email",
      configurationId: id,
      recipient: "test@example.com",
      subject: "Preview",
      text: "Test",
    };
    const first = await t.mutation(internal.handoff.claim, args);
    const retry = await t.mutation(internal.handoff.claim, args);
    expect(first.claimed).toBe(true);
    expect(retry.claimed).toBe(false);
    expect(retry.id).toBe(first.id);
  });
  it("a cancelled job cannot be overwritten by a late result", async () => {
    vi.useFakeTimers();
    try {
      const { t, alice, bob } = await setup();
      const id = await alice.mutation(api.jobs.start, {
        kind: "jev",
        revision: 4,
        input: JSON.stringify({
          placement: initialPlacement,
          source: "demo",
          prompt: "chair",
        }),
        requestId: "job-test",
      });
      await expect(bob.mutation(api.jobs.cancel, { id })).rejects.toThrow(
        "Job not found",
      );
      await alice.mutation(api.jobs.cancel, { id });
      expect(
        await t.mutation(internal.jobs.patch, {
          id,
          status: "succeeded",
          result: "{}",
        }),
      ).toBe(false);
      expect((await alice.query(api.jobs.get, { id }))?.status).toBe(
        "cancelled",
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
  });
});
