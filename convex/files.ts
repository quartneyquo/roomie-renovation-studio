import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { user } from "./rooms";
export const upload = action({
  args: { data: v.string() },
  returns: v.id("_storage"),
  handler: async (ctx, { data }) => {
    const ownerId = await user(ctx);
    if (
      data.length > 5_000_000 ||
      !/^data:(image\/(png|jpeg|webp)|application\/octet-stream);base64,/.test(
        data,
      )
    )
      throw new ConvexError(
        "Choose an image or point cloud smaller than 3 MB.",
      );
    await ctx.runMutation(internal.budget.claim, { kind: "upload" });
    const [header, body] = data.split(",");
    const binary = atob(body);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: header.slice(5, -7) }),
    );
    await ctx.runMutation(internal.rooms.registerAsset, { ownerId, storageId });
    return storageId;
  },
});
