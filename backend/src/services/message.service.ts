// Service：チャンネルのメッセージの一覧・投稿の業務ルール（#201）。HTTP も DB のライブラリも知らない。
// 判定の順（この順を変えない）：
//   ① 見えるか（見えなければ 404。非公開・アーカイブ済み・存在しない・当事者でない DM を区別しない）
//   → ② 参加者か（未参加は 403。公開チャンネルは未参加でも読める）
//   → ③ お知らせ専用なら権限（perm.announcement.post を部署の範囲で。拒否は authorize が監査に記録する）
//   DM の部屋（#136）：当事者か（違えば 404。文言はチャンネルと同じ）
//   → 権限（一覧は perm.dm.message.view、投稿は perm.dm.message.send。拒否は 403）→（投稿だけ）相手が無効なら 409。一覧は相手が無効でも読める。
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
import { assertRecentReauth } from "./credentials.service";
import type { CursorPayload } from "../lib/cursor";

export type MessageActor = {
  userId: string;
  traceId: string;
  /** 削除だけが使う（編集は再認証を求めない） */
  reauthenticatedAt?: string | null;
};

export type MessageListQuery =
  { after: string; limit: number } | { cursor?: CursorPayload; limit: number };

export type MessageCreated = { id: string; roomId: string; createdAt: string };

/** IDの作り直しの上限（最初の1回に加えて） */
const MAX_ID_RETRIES = 3;

const NOT_FOUND_MESSAGE = "チャンネルが見つかりません";

type Dependencies = {
  authorizer: Pick<ReturnType<typeof createAppAuthorizer>, "authorize">;
  now?: () => Date;
};

export type MessageEdited = { id: string; body: string; editedAt: string };

type ModifyOperation = "edit" | "delete";

const MODIFY_PERMISSION = {
  edit: "perm.message.edit.own",
  delete: "perm.message.delete.own",
} as const;

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
  { authorizer, now = () => new Date() }: Dependencies,
) {
  // チャンネルでなければ DM として探す（チャンネルの経路の問い合わせは増やさない）
  async function findRoom(roomId: string, actor: MessageActor) {
    const channel = await repository.findRoomForViewer(roomId, actor.userId);
    if (channel !== null) return { kind: "channel", channel } as const;
    const direct = await repository.findDirectForParticipant(
      roomId,
      actor.userId,
    );
    return direct === null
      ? null
      : ({ kind: "direct", partnerIsActive: direct.partnerIsActive } as const);
  }

  function authorizeDm(
    actor: MessageActor,
    permission: "perm.dm.message.view" | "perm.dm.message.send",
  ) {
    return authorizer.authorize({ userId: actor.userId }, permission, {
      type: "company",
    });
  }

  async function requireVisible(roomId: string, actor: MessageActor) {
    const room = await findRoom(roomId, actor);
    if (room === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (room.kind === "direct") {
      await authorizeDm(actor, "perm.dm.message.view");
      return;
    }
    const { channel } = room;
    if (!canViewChannel(channel, channel.joinedAt !== null))
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
  }

  // ①②③の順（DM は当事者か → 権限 → 相手が有効か）で、投稿してよいかを確かめる
  async function requirePostable(roomId: string, actor: MessageActor) {
    const room = await findRoom(roomId, actor);
    if (room === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (room.kind === "direct") {
      await authorizeDm(actor, "perm.dm.message.send");
      if (!room.partnerIsActive)
        throw new AppError(
          "CONFLICT",
          "相手のアカウントが無効になっているため、送信できません",
        );
      return;
    }
    const { channel } = room;
    if (!canViewChannel(channel, channel.joinedAt !== null))
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
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

  // 編集・削除してよいかを、①〜⑤の順に確かめる（⑥再認証・⑦書き込みは呼び出し側）。
  // ①見えるか（404。アーカイブ済みも見えない扱い）②本人か（403・audit）③権限④削除済み（409）⑤部屋の状態（未参加403・部署が無効409・DM の相手が無効409）
  // お知らせ専用の投稿権限は問わない（本人の投稿なら、今参加していれば編集・削除できる）。
  async function requireModifiable(
    actor: MessageActor,
    messageId: string,
    operation: ModifyOperation,
  ) {
    const message = await repository.findForModification(messageId);
    if (message === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    const room = await findRoom(message.roomId, actor);
    if (room === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (room.kind === "direct")
      await authorizeDm(actor, "perm.dm.message.view");
    else if (!canViewChannel(room.channel, room.channel.joinedAt !== null))
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (message.senderId !== actor.userId) {
      createLogger({ traceId: actor.traceId, userId: actor.userId }).audit(
        `message.${operation}`,
        messageId,
        "failure",
        { reason: "not_author" },
      );
      throw new AppError("FORBIDDEN", "他の人の投稿は編集・削除できません");
    }
    await authorizer.authorize(
      { userId: actor.userId },
      MODIFY_PERMISSION[operation],
      { type: "company" },
    );
    if (message.deletedAt !== null)
      throw new AppError("CONFLICT", "このメッセージはすでに削除されています");
    if (room.kind === "direct") {
      if (!room.partnerIsActive)
        throw new AppError(
          "CONFLICT",
          "相手のアカウントが無効になっているため、操作できません",
        );
    } else {
      const { channel } = room;
      if (channel.joinedAt === null) {
        createLogger({ traceId: actor.traceId, userId: actor.userId }).audit(
          `message.${operation}`,
          messageId,
          "failure",
          { reason: "not_member" },
        );
        throw new AppError("FORBIDDEN", "このチャンネルには参加していません");
      }
      if (
        channel.departmentId !== null &&
        !(await repository.isDepartmentActive(channel.departmentId))
      )
        throw new AppError(
          "CONFLICT",
          "部署が無効になっているため、操作できません",
        );
    }
    return message;
  }

  // 書き込みが 0 行のとき、状態を読み直して原因に合う応答にする。原因が分からなくても成功にしない（書き込みはやり直さない）
  async function failWrite(
    actor: MessageActor,
    messageId: string,
    operation: ModifyOperation,
  ): Promise<never> {
    await requireModifiable(actor, messageId, operation);
    throw new AppError(
      "CONFLICT",
      "状態が変わったため、操作できませんでした。読み込み直してからお試しください",
    );
  }

  return {
    async edit(
      actor: MessageActor,
      messageId: string,
      body: string,
    ): Promise<MessageEdited> {
      await requireModifiable(actor, messageId, "edit");
      const editedAt = now().toISOString();
      const updated = await repository.updateBodyIfModifiable({
        messageId,
        userId: actor.userId,
        body,
        editedAt,
      });
      if (updated === 0) return failWrite(actor, messageId, "edit");
      return { id: messageId, body, editedAt };
    },
    async remove(actor: MessageActor, messageId: string): Promise<void> {
      const message = await requireModifiable(actor, messageId, "delete");
      assertRecentReauth(actor.reauthenticatedAt ?? null, now());
      const deleted = await repository.deleteIfModifiable({
        messageId,
        userId: actor.userId,
        roomId: message.roomId,
        deletedAt: now().toISOString(),
        traceId: actor.traceId,
      });
      if (deleted === 0) return failWrite(actor, messageId, "delete");
    },
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
