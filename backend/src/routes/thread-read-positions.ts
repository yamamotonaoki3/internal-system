// Controller（ルート）：スレッドの既読位置の更新（PUT /api/messages/:messageId/thread-read-position。EP-3-09。#137）。
// 入力の形の確認（422）と応答だけを行い、既読にしてよいかの判定は Service が行う。利用者は常にセッションの本人。
// :messageId は親の投稿の ID。認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する（PUT も対象）。
import { Hono } from "hono";
import { z } from "zod";
import { actorOf } from "../lib/actor";
import { noStore } from "../lib/security";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import { withUnreadService } from "../services/unread.service";

const paramSchema = z.object({ messageId: z.string().refine(isUlid) });
const bodySchema = z
  .object({ lastReadMessageId: z.string().refine(isUlid) })
  .strict();

export function threadReadPositionRoutes() {
  return new Hono<{ Bindings: Env }>().put(
    "/:messageId/thread-read-position",
    noStore,
    validate("param", paramSchema),
    validate("json", bodySchema),
    async (c) => {
      const actor = actorOf(c);
      const { messageId } = c.req.valid("param");
      const { lastReadMessageId } = c.req.valid("json");
      await withUnreadService(c.env, actor, (service) =>
        service.markThreadRead(actor, messageId, lastReadMessageId),
      );
      return c.body(null, 204);
    },
  );
}
