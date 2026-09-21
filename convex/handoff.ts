import { reserve } from "./budget";
import { v, ConvexError } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { user } from "./rooms";
export const claim = internalMutation({
  args: {
    ownerId: v.id("users"),
    requestId: v.string(),
    configurationId: v.id("savedConfigurations"),
    recipient: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  returns: v.object({
    id: v.id("handoffEmails"),
    claimed: v.boolean(),
    status: v.string(),
    screenshotId: v.id("_storage"),
  }),
  handler: async (ctx, a) => {
    const room = await ctx.db.get(a.configurationId);
    if (!room || room.ownerId !== a.ownerId)
      throw new ConvexError("Room not found.");
    const old = await ctx.db
      .query("handoffEmails")
      .withIndex("by_ownerId_and_requestId", (q) =>
        q.eq("ownerId", a.ownerId).eq("requestId", a.requestId),
      )
      .unique();
    if (old)
      return {
        id: old._id,
        claimed: false,
        status: old.status,
        screenshotId: old.screenshotId,
      };
    const sent = await ctx.db
      .query("handoffEmails")
      .withIndex("by_configurationId", (q) =>
        q.eq("configurationId", a.configurationId),
      )
      .take(5);
    if (sent.length >= 5)
      throw new ConvexError("This room has reached its handoff limit.");
    await reserve(ctx, "email", 5);
    const id = await ctx.db.insert("handoffEmails", {
      ...a,
      screenshotId: room.screenshotId,
      status: "sending",
      createdAt: Date.now(),
    });
    return {
      id,
      claimed: true,
      status: "sending",
      screenshotId: room.screenshotId,
    };
  },
});
export const complete = internalMutation({
  args: {
    id: v.id("handoffEmails"),
    status: v.union(v.literal("sent"), v.literal("uncertain")),
    providerId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...a }) => {
    await ctx.db.patch(id, a);
    return null;
  },
});
export const send = action({
  args: {
    requestId: v.string(),
    configurationId: v.id("savedConfigurations"),
    recipient: v.string(),
    subject: v.string(),
    text: v.string(),
    approved: v.literal(true),
  },
  returns: v.object({ status: v.string() }),
  handler: async (ctx, a): Promise<{ status: string }> => {
    const ownerId = await user(ctx);
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.recipient) ||
      a.recipient.length > 254 ||
      a.subject.length > 180 ||
      a.text.length > 6000 ||
      a.requestId.length > 100
    )
      throw new ConvexError("Check the email details.");
    if (!process.env.AGENTMAIL_API_KEY || !process.env.AGENTMAIL_INBOX_ID)
      return { status: "preview" };
    const { approved: _, ...details } = a;
    const claim = await ctx.runMutation(internal.handoff.claim, {
      ...details,
      ownerId,
    });
    if (!claim.claimed) return { status: claim.status };
    try {
      const screenshot = await ctx.runQuery(internal.providers.ownedUrl, {
        ownerId,
        id: claim.screenshotId,
      });
      const response = await fetch(
        `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(process.env.AGENTMAIL_INBOX_ID)}/messages/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.AGENTMAIL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: [a.recipient],
            subject: a.subject,
            text: a.text,
            attachments: [
              {
                filename: "roomie-room.jpg",
                content_type: "image/jpeg",
                url: screenshot,
              },
            ],
            track_opens: false,
            track_clicks: false,
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok)
        throw new Error("Email delivery could not be confirmed.");
      const result = (await response.json()) as { message_id: string };
      await ctx.runMutation(internal.handoff.complete, {
        id: claim.id,
        status: "sent",
        providerId: String(result.message_id),
      });
      return { status: "sent" };
    } catch {
      await ctx.runMutation(internal.handoff.complete, {
        id: claim.id,
        status: "uncertain",
      });
      return { status: "uncertain" };
    }
  },
});
