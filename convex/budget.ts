import { ConvexError, v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
export async function reserve(ctx: MutationCtx, kind: string, limit: number) {
  const key = `${kind}:${Math.floor(Date.now() / 3600000)}`;
  const row = await ctx.db
    .query("usageBuckets")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if ((row?.count || 0) >= limit)
    throw new ConvexError(
      "The studio’s hourly service limit has been reached. Try again later.",
    );
  if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
  else await ctx.db.insert("usageBuckets", { key, count: 1 });
}
export const claim = internalMutation({
  args: { kind: v.union(v.literal("upload"), v.literal("lucy")) },
  returns: v.null(),
  handler: async (ctx, { kind }) => {
    await reserve(ctx, kind, kind === "upload" ? 200 : 20);
    return null;
  },
});
