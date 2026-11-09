// Service：チャンネルのメッセージの一覧・投稿の業務ルール（#201）。HTTP も DB のライブラリも知らない。
// 判定の順（この順を変えない）：
//   ① 見えるか（見えなければ 404。非公開・アーカイブ済み・存在しない・DMの部屋を区別しない）
//   → ② 参加者か（未参加は 403。公開チャンネルは未参加でも読める）
//   → ③ お知らせ専用なら権限（perm.announcement.post を部署の範囲で。拒否は authorize が監査に記録する）
//   ※ 本文の形の検証（422）は Controller が先に行う。
// 書き込みは条件付きの INSERT 1文。挿入できなかった（0 行）ときは、原因を読み直して分ける：
//   状態が崩れた → 404／403、IDが部屋の最大以下 → 最大より大きいIDで作り直して再試行（上限あり。超えたら 503）。
import { withMessages, type MessageRepository } from "../db/message.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { canViewChannel } from "../lib/channel-rules";
import { createLogger } from "../lib/logger/logger";
import { newUlid, ulidAfter } from "../lib/ulid";
import { createAppAuthorizer } from "./authorizer";
import type { CursorPayload } from "../lib/cursor";

export type MessageActor = { userId: string; traceId: string };

export type MessageListQuery =
  { after: string; limit: number } | { cursor?: CursorPayload; limit: number };

export type MessageCreated = { id: string; roomId: string; createdAt: string };

/** IDの作り直しの上限（最初の1回に加えて） */
const MAX_ID_RETRIES = 3;

const NOT_FOUND_MESSAGE = "チャンネルが見つかりません";

type Dependencies = {
  authorizer: Pick<ReturnType<typeof createAppAuthorizer>, "authorize">;
};

export function withMessageService<T>(
  env: Env,
  actor: MessageActor,
  run: (service: ReturnType<typeof createMessageService>) => Promise<T>,
): Promise<T> {
  return withMessages(env, (repository) =>
    withRoleAssignments(env, (roles) =>
      run(
        createMessageService(repository, {
          authorizer: createAppAuthorizer(roles, {
            logger: createLogger({
              traceId: actor.traceId,
              userId: actor.userId,
            }),
          }),
        }),
      ),
    ),
  );
}

export function createMessageService(
  repository: MessageRepository,
  { authorizer }: Dependencies,
) {
  async function requireVisible(roomId: string, actor: MessageActor) {
    const channel = await repository.findRoomForViewer(roomId, actor.userId);
    if (channel === null || !canViewChannel(channel, channel.joinedAt !== null))
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    return channel;
  }

  // ①②③の順で、投稿してよいかを確かめる
  async function requirePostable(roomId: string, actor: MessageActor) {
    const channel = await requireVisible(roomId, actor);
    if (channel.joinedAt === null)
      throw new AppError("FORBIDDEN", "このチャンネルには参加していません");
    // 全社連絡（部署なし）は、参加者なら誰でも投稿できる。権限で制限するのはお知らせ専用だけ（canPostToChannel と同じ規則）
    if (channel.purpose === "announcement" && channel.departmentId !== null)
      await authorizer.authorize(
        { userId: actor.userId },
        "perm.announcement.post",
        { type: "department", departmentId: channel.departmentId },
      );
  }

  return {
    async list(actor: MessageActor, roomId: string, query: MessageListQuery) {
      await requireVisible(roomId, actor);
      if ("after" in query)
        return repository.listAfter(roomId, query.after, query.limit);
      return repository.listLatest(roomId, query.limit, query.cursor);
    },
    async post(
      actor: MessageActor,
      roomId: string,
      body: string,
    ): Promise<MessageCreated> {
      await requirePostable(roomId, actor);
      const displayName = await repository.findDisplayName(actor.userId);
      if (displayName === null)
        throw new AppError("UNAUTHENTICATED", "ログインしてください");
      let id = newUlid();
      for (let retry = 0; ; retry += 1) {
        // 作り直したIDの投稿が、直前の投稿より過去の時刻にならないよう、試行のたびに取り直す
        const createdAt = new Date().toISOString();
        const inserted = await repository.insertIfOrdered({
          id,
          roomId,
          senderId: actor.userId,
          senderDisplayName: displayName,
          body,
          createdAt,
        });
        if (inserted > 0) return { id, roomId, createdAt };
        // 状態が崩れていれば 404／403 になる（上限に達した最後の挿入の後も確かめ、503 に隠さない）。崩れていなければ、IDが部屋の最大以下だった
        await requirePostable(roomId, actor);
        if (retry >= MAX_ID_RETRIES) break;
        const max = await repository.maxId(roomId);
        id = max === null ? newUlid() : ulidAfter(max);
      }
      createLogger({ traceId: actor.traceId, userId: actor.userId }).warn(
        "メッセージのIDの作り直しが上限を超えた",
        { roomId },
      );
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "混み合っています。しばらくしてからもう一度お試しください",
      );
    },
  };
}
