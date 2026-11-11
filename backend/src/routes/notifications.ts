// Controller（ルート）：自分宛ての通知の一覧・未読数・既読（/api/me/notifications。#124）。
// 入力の形の確認（422）と応答だけを行う。宛先は常にセッションの利用者で、他人の ID を受け取らない（R-57）。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する。
import { Hono } from "hono";
import { z } from "zod";
import { actorOf } from "../lib/actor";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { validate } from "../lib/validation";
import { withNotificationService } from "../services/notification.service";

const listQuerySchema = cursorQuerySchema({ defaultLimit: PAGE_LIMIT.default });
// ULID でない ID も、存在しない ID と同じく Service が 404 にする（形式の違いで応答を変えない）
const notificationParamSchema = z.object({
  notificationId: z.string().max(64),
});

export function notificationRoutes() {
  return new Hono<{ Bindings: Env }>()
    .get("/", noStore, validate("query", listQuerySchema), async (c) => {
      const actor = actorOf(c);
      const { limit, cursor } = c.req.valid("query");
      const page = await withNotificationService(c.env, (service) =>
        service.list(
          actor,
          cursor === undefined ? { limit } : { limit, cursor },
        ),
      );
      return c.json(page);
    })
    .get("/unread-count", noStore, async (c) => {
      const actor = actorOf(c);
      const count = await withNotificationService(c.env, (service) =>
        service.countUnread(actor),
      );
      return c.json({ count });
    })
    .post("/read-all", noStore, async (c) => {
      const actor = actorOf(c);
      await withNotificationService(c.env, (service) =>
        service.markAllRead(actor),
      );
      return c.body(null, 204);
    })
    .post(
      "/:notificationId/read",
      noStore,
      validate("param", notificationParamSchema),
      async (c) => {
        const actor = actorOf(c);
        await withNotificationService(c.env, (service) =>
          service.markRead(actor, c.req.valid("param").notificationId),
        );
        return c.body(null, 204);
      },
    );
}
