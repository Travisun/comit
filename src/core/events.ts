import Emittery from "emittery";

/**
 * Domain event map — the single source of truth for everything that can be
 * observed on the platform. Plugins/listeners subscribe via `bus.on(name, fn)`.
 * The webhook plugin exposes (a subset of) these as user-subscribable events.
 */
export interface AppEventPayloads {
  "user:registered": {
    userId: string;
    email: string;
    username: string;
    invitedByUserId?: string | null;
  };
  "user:login": { userId: string; ip?: string };
  "user:followed": { followerId: string; followeeId: string };
  "user:unfollowed": { followerId: string; followeeId: string };

  "post:submitted": {
    postId: string;
    authorId: string;
    title: string;
    needReview: boolean;
  };
  "post:published": {
    postId: string;
    authorId: string;
    slug: string;
    title: string;
    type: "article" | "short";
  };
  "post:approved": { postId: string; authorId: string; moderatorId?: string };
  "post:rejected": {
    postId: string;
    authorId: string;
    reason: string;
    moderatorId?: string;
  };
  "post:liked": { postId: string; actorId: string; authorId: string };
  "post:reposted": { postId: string; actorId: string; authorId: string };
  "comment:created": {
    commentId: string;
    postId: string;
    postAuthorId: string;
    commenterId: string;
    replyToUserId?: string | null;
    excerpt: string;
  };
  "comment:liked": {
    commentId: string;
    actorId: string;
    commentAuthorId: string;
  };
  "message:created": {
    messageId: string;
    senderId: string;
    receiverId: string;
    excerpt: string;
  };
  "user:mentioned": {
    userIds: string[];
    actorId: string;
    targetType: "post" | "comment";
    targetId: string;
    excerpt: string;
  };

  // internal / system
  "moderation:review.completed": {
    postId: string;
    approved: boolean;
    by: "keyword" | "llm" | "manual";
    reason?: string;
  };
  "media:uploaded": { mediaId: string; userId: string };
  "webhook:delivery.failed": { webhookId: string; event: string; error: string };

  // operations (admin/editor actions — notifications & webhooks hang off these)
  "user:warned": { userId: string; message: string; byAdminId: string };
  "user:banned": {
    userId: string;
    /** ISO timestamp for timed bans, null = permanent */
    bannedUntil: string | null;
    reason: string;
    byAdminId: string;
  };
  "user:unbanned": { userId: string; byAdminId: string };
  "verification:approved": { userId: string; type: string; label: string };
  "verification:rejected": { userId: string; reason: string };
}

export type AppEvents = Emittery<AppEventPayloads>;

// One bus per process, shared across module instances (instrumentation chunk
// vs route chunks) — otherwise listeners registered at boot never receive
// events emitted from route handlers.
const g = globalThis as unknown as { __mbBus?: AppEvents };
export const bus: AppEvents = (g.__mbBus ??= new Emittery());

/** Emit a domain event. All side effects (notifications, webhooks…) hang off this. */
export function emit<K extends keyof AppEventPayloads>(
  name: K,
  payload: AppEventPayloads[K],
): Promise<void> {
  return bus.emit(name, payload).then(() => undefined);
}
