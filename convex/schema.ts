import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
export const placement = v.object({
  x: v.number(),
  y: v.number(),
  scale: v.number(),
  rotation: v.number(),
});
export const furnitureItem = v.object({
  id: v.string(),
  prompt: v.string(),
  referenceId: v.optional(v.id("_storage")),
  placement,
});
export const sceneFurnitureItem = v.object({
  id: v.string(),
  prompt: v.string(),
  placement,
});
export const source = v.union(
  v.literal("demo"),
  v.literal("camera"),
  v.literal("upload"),
);
export const evaluation = v.object({
  verdict: v.union(
    v.literal("good"),
    v.literal("adjust"),
    v.literal("uncertain"),
  ),
  title: v.string(),
  explanation: v.string(),
  revision: v.number(),
  checks: v.array(
    v.object({
      label: v.string(),
      status: v.union(
        v.literal("pass"),
        v.literal("warn"),
        v.literal("unknown"),
      ),
    }),
  ),
  adjustment: v.union(placement, v.null()),
  provider: v.string(),
  fit: v.optional(
    v.union(v.literal("green"), v.literal("amber"), v.literal("red")),
  ),
  confidence: v.optional(v.number()),
  visualEstimate: v.optional(v.boolean()),
});
export const jobKind = v.union(
  v.literal("jev"),
  v.literal("h3"),
  v.literal("research"),
  v.literal("contacts"),
  v.literal("spatial"),
  v.literal("lucy"),
);
export const jobStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("cancelled"),
);
export const scanStatus = v.union(
  v.literal("uploading"),
  v.literal("reconstructing"),
  v.literal("analyzing"),
  v.literal("ready"),
  v.literal("failed"),
);
export default defineSchema({
  ...authTables,
  sceneStates: defineTable({
    ownerId: v.id("users"),
    sceneKey: v.string(),
    revision: v.number(),
    state: v.string(),
    expiresAt: v.number(),
  })
    .index("by_ownerId_and_sceneKey", ["ownerId", "sceneKey"])
    .index("by_expiresAt", ["expiresAt"]),
  usageBuckets: defineTable({ key: v.string(), count: v.number() }).index(
    "by_key",
    ["key"],
  ),
  savedConfigurations: defineTable({
    ownerId: v.id("users"),
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
    sceneState: v.optional(v.string()),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_and_requestId", ["ownerId", "requestId"]),
  assets: defineTable({
    ownerId: v.id("users"),
    storageId: v.id("_storage"),
    expiresAt: v.number(),
    saved: v.boolean(),
  })
    .index("by_ownerId_and_storageId", ["ownerId", "storageId"])
    .index("by_saved_and_expiresAt", ["saved", "expiresAt"]),
  providerJobs: defineTable({
    ownerId: v.id("users"),
    requestId: v.string(),
    kind: jobKind,
    status: jobStatus,
    revision: v.number(),
    input: v.string(),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    providerRequestId: v.optional(v.string()),
    phase: v.optional(scanStatus),
    createdAt: v.number(),
    updatedAt: v.number(),
    attempts: v.number(),
    expiresAt: v.number(),
  })
    .index("by_ownerId_and_requestId", ["ownerId", "requestId"])
    .index("by_ownerId_and_createdAt", ["ownerId", "createdAt"])
    .index("by_expiresAt", ["expiresAt"]),
  roomScans: defineTable({
    ownerId: v.id("users"),
    sceneKey: v.string(),
    requestId: v.string(),
    videoId: v.optional(v.id("_storage")),
    jobId: v.optional(v.id("providerJobs")),
    status: scanStatus,
    snapshot: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_ownerId_and_sceneKey", ["ownerId", "sceneKey"])
    .index("by_ownerId_and_requestId", ["ownerId", "requestId"])
    .index("by_expiresAt", ["expiresAt"]),
  researchSources: defineTable({
    cacheKey: v.string(),
    payload: v.string(),
    expiresAt: v.number(),
  })
    .index("by_cacheKey", ["cacheKey"])
    .index("by_expiresAt", ["expiresAt"]),
  handoffEmails: defineTable({
    ownerId: v.id("users"),
    requestId: v.string(),
    recipient: v.string(),
    subject: v.string(),
    text: v.string(),
    screenshotId: v.id("_storage"),
    configurationId: v.id("savedConfigurations"),
    status: v.union(
      v.literal("sending"),
      v.literal("sent"),
      v.literal("uncertain"),
    ),
    providerId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_ownerId_and_requestId", ["ownerId", "requestId"])
    .index("by_configurationId", ["configurationId"]),
});
