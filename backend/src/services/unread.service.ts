// Service：未読の件数と既読（#237。3-1）の業務ルール。HTTP も DB のライブラリも知らない。
// markRead の判定の順（この順を変えない）：
//   ① 部屋を探す（チャンネル → 見えなければ 404、見えるが未参加は 403。チャンネルでなければ当事者の DM → 違えば 404）
//   → ② perm.notification.own（R-55）を会社の範囲で authorize（拒否は authorize が監査に記録する）
//   → ③ 既読位置を進める（条件付きの upsert 1文）。1行なら完了。
//   → ④ 0行のとき：部屋の判定をもう一度行い（崩れていれば 404／403）、メッセージがその部屋になければ 404、あれば「すでに同じかより新しい位置まで既読」なので成功。
// 部屋の判定を権限の確認より先に行うのは、403 で他人の DM の存在を教えないため。
// 既読は本人の閲覧の記録で、監査ログに残さない（既定の方針 4）。
import { withMessages, type MessageRepository } from "../db/message.repository";
import {
  withReadPositions,
  type ReadPositionRepository,
} from "../db/read-position.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { canViewChannel } from "../lib/channel-rules";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";

export type UnreadActor = { userId: string; traceId: string };

type Dependencies = {
  authorizer: Pick<ReturnType<typeof createAppAuthorizer>, "authorize">;
  now?: () => Date;
};

const ROOM_NOT_FOUND_MESSAGE = "チャンネルが見つかりません";

export function withUnreadService<T>(
  env: Env,
  actor: UnreadActor,
  run: (service: ReturnType<typeof createUnreadService>) => Promise<T>,
): Promise<T> {
  return withReadPositions(env, (readPositions) =>
    withMessages(env, (rooms) =>
      withRoleAssignments(env, (roles) =>
        run(
          createUnreadService(readPositions, rooms, {
            authorizer: createAppAuthorizer(roles, {
              logger: createLogger({
                traceId: actor.traceId,
                userId: actor.userId,
              }),
            }),
          }),
        ),
      ),
    ),
  );
}

export function createUnreadService(
  readPositions: Pick<
    ReadPositionRepository,
    "listUnread" | "advance" | "messageExistsInRoom"
  >,
  rooms: Pick<
    MessageRepository,
    "findRoomForViewer" | "findDirectForParticipant"
  >,
  { authorizer, now = () => new Date() }: Dependencies,
) {
  function authorizeOwn(actor: UnreadActor) {
    return authorizer.authorize(
      { userId: actor.userId },
      "perm.notification.own",
      { type: "company" },
    );
  }

  // 既読にしてよい部屋か（見えない・当事者でない 404、見えるが未参加 403）。チャンネルでなければ DM として探す
  async function requireReadableRoom(roomId: string, actor: UnreadActor) {
    const channel = await rooms.findRoomForViewer(roomId, actor.userId);
    if (channel !== null) {
      if (!canViewChannel(channel, channel.joinedAt !== null))
        throw new AppError("NOT_FOUND", ROOM_NOT_FOUND_MESSAGE);
      if (channel.joinedAt === null)
        throw new AppError("FORBIDDEN", "このチャンネルには参加していません");
      return;
    }
    const direct = await rooms.findDirectForParticipant(roomId, actor.userId);
    if (direct === null)
      throw new AppError("NOT_FOUND", ROOM_NOT_FOUND_MESSAGE);
  }

  return {
    async list(
      actor: UnreadActor,
      options: { limit: number; cursor?: CursorPayload },
    ) {
      await authorizeOwn(actor);
      return readPositions.listUnread(actor.userId, options);
    },

    async markRead(
      actor: UnreadActor,
      roomId: string,
      lastReadMessageId: string,
    ): Promise<void> {
      await requireReadableRoom(roomId, actor);
      await authorizeOwn(actor);
      const changed = await readPositions.advance({
        userId: actor.userId,
        roomId,
        messageId: lastReadMessageId,
        now: now().toISOString(),
      });
      if (changed > 0) return;
      // 0 行：状態が崩れた（404／403）、メッセージがその部屋にない（404）、すでに同じかより新しい位置まで既読（成功。後戻りしないことが意図した結果）を読み分ける
      await requireReadableRoom(roomId, actor);
      if (!(await readPositions.messageExistsInRoom(roomId, lastReadMessageId)))
        throw new AppError("NOT_FOUND", "メッセージが見つかりません");
    },
  };
}
