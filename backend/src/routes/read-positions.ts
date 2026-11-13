// Controller（ルート）：部屋の既読位置の更新（PUT /api/rooms/:roomId/read-position。EP-3-02。#237）。
// 入力の形の確認（422）と応答だけを行い、既読にしてよいかの判定は Service が行う。利用者は常にセッションの本人。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する（PUT も対象）。
import { Hono } from "hono";
import { z } from "zod";
import { actorOf } from "../lib/actor";
import { noStore } from "../lib/security";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import { withUnreadService } from "../services/unread.service";

const paramSchema = z.object({ roomId: z.string().refine(isUlid) });
const bodySchema = z
  .object({ lastReadMessageId: z.string().refine(isUlid) })
  .strict();

export function readPositionRoutes() {
  return new Hono<{ Bindings: Env }>().put(
    "/:roomId/read-position",
    noStore,
    validate("param", paramSchema),
    validate("json", bodySchema),
    async (c) => {
      const actor = actorOf(c);
      const { roomId } = c.req.valid("param");
      const { lastReadMessageId } = c.req.valid("json");
      await withUnreadService(c.env, actor, (service) =>
        service.markRead(actor, roomId, lastReadMessageId),
      );
      return c.body(null, 204);
    },
  );
}
