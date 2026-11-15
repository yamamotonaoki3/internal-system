// Service：チャンネルのメッセージの一覧・投稿の業務ルール（#201）。HTTP も DB のライブラリも知らない。
// 判定の順（この順を変えない）：
//   ① 見えるか（見えなければ 404。非公開・アーカイブ済み・存在しない・当事者でない DM を区別しない）
//   → ② 参加者か（未参加は 403。公開チャンネルは未参加でも読める）
//   → ③ お知らせ専用なら権限（perm.announcement.post を部署の範囲で。拒否は authorize が監査に記録する）
//   DM の部屋（#136）：当事者か（違えば 404。文言はチャンネルと同じ）
//   → 権限（一覧は perm.dm.message.view、投稿は perm.dm.message.send。拒否は 403）→（投稿だけ）相手が無効なら 409。一覧は相手が無効でも読める。
//   ※ 本文の形の検証（422）は Controller が先に行う。
// 返信（#137。EP-1-07・EP-1-08）：親を ID で引き、部屋の判定は親の部屋で行う。
//   postReply の判定の順（この順を変えない）：① 親が存在して見えるか（404）→ ② 親が返信でないか（404）→ ③ チャンネルで参加しているか（403）
//   → ④ perm.message.reply（R-30。拒否は authorize が監査に記録する）→ ⑤ 親が削除済みか（409。C-59）→ ⑥ 部屋の状態（部署が無効・DM の相手が無効は 409）→ ⑦ 条件付きの INSERT。
//   お知らせ専用の投稿権限は問わない（U-6）。listReplies は ①② まで（未参加の公開チャンネルも読める）で、返信できない理由 replyBlockedReason を添える。
// 書き込みは条件付きの INSERT 1文。挿入できなかった（0 行）ときは、原因を読み直して分ける：
//   状態が崩れた → 404／403、IDが部屋の最大以下 → 最大より大きいIDで作り直して再試行（上限あり。超えたら 503）。
import { withMessages, type MessageRepository } from "../db/message.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { canViewChannel } from "../lib/channel-rules";
import { createLogger } from "../lib/logger/logger";
import { newUlid, ulidAfter } from "../lib/ulid";
import {
  messageContentSchema,
  REPLY_BLOCKED_REASONS,
  type Mention,
} from "../../../shared/message-rules";
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

export type ReplyCreated = MessageCreated & { parentMessageId: string };

/** IDの作り直しの上限（最初の1回に加えて） */
const MAX_ID_RETRIES = 3;

const NOT_FOUND_MESSAGE = "チャンネルが見つかりません";

type Dependencies = {
  authorizer: Pick<ReturnType<typeof createAppAuthorizer>, "authorize">;
  now?: () => Date;
};

export type MessageEdited = {
  id: string;
  body: string;
  editedAt: string;
  mentions: Mention[];
};

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

/** Markdownのコード範囲内の@を指名にしない。バッククォートの同じ長さで開閉する。 */
function insideCode(body: string, position: number): boolean {
  let open = 0;
  for (let index = 0; index <= position && index < body.length;) {
    if (body[index] === "\\") {
      index += 2;
      continue;
    }
    if (body[index] !== "`") {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (body[end] === "`") end += 1;
    const length = end - index;
    if (open === 0) open = length;
    else if (open === length) open = 0;
    index = end;
  }
  return open !== 0;
}

export function createMessageService(
  repository: MessageRepository,
  { authorizer, now = () => new Date() }: Dependencies,
) {
  /** 本文に選ばれた表示名が存在し、現在有効な社員IDを指すことを確かめる。 */
  async function validateMentions(
    body: string,
    mentions: readonly Mention[],
  ): Promise<void> {
    const parsed = messageContentSchema.safeParse({ body, mentions });
    if (!parsed.success)
      throw new AppError("VALIDATION_ERROR", "指名の範囲を確かめてください", {
        fields: ["mentions"],
      });
    if (mentions.length === 0) return;
    const names = await repository.activeMentionNames(
      mentions.map((mention) => mention.userId),
    );
    for (const mention of mentions) {
      const name = names.get(mention.userId);
      if (
        name === undefined ||
        body.slice(mention.start, mention.end) !== `@${name}` ||
        insideCode(body, mention.start)
      ) {
        throw new AppError(
          "VALIDATION_ERROR",
          "指名先と表示を確かめてください",
          { fields: ["mentions"] },
        );
      }
    }
  }

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

  // 指名候補と新規投稿で共通の、閲覧・参加の資格（DM は送信権限・相手の有効状態も）を確かめる
  async function requireParticipatingRoom(roomId: string, actor: MessageActor) {
    const room = await findRoom(roomId, actor);
    if (room === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (room.kind === "direct") {
      await authorizeDm(actor, "perm.dm.message.send");
      if (!room.partnerIsActive)
        throw new AppError(
          "CONFLICT",
          "相手のアカウントが無効になっているため、送信できません",
        );
      return room;
    }
    const { channel } = room;
    if (!canViewChannel(channel, channel.joinedAt !== null))
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (channel.joinedAt === null)
      throw new AppError("FORBIDDEN", "このチャンネルには参加していません");
    return room;
  }

  // 新規投稿だけが、お知らせ専用の投稿権限を追加で要求する。
  async function requirePostable(roomId: string, actor: MessageActor) {
    const room = await requireParticipatingRoom(roomId, actor);
    if (room.kind === "direct") return;
    const { channel } = room;
    // 全社連絡（部署なし）は、参加者なら誰でも投稿できる。権限で制限するのはお知らせ専用だけ（canPostToChannel と同じ規則）
    if (channel.purpose === "announcement" && channel.departmentId !== null)
      await authorizer.authorize(
        { userId: actor.userId },
        "perm.announcement.post",
        { type: "department", departmentId: channel.departmentId },
      );
  }

  // 返信の ①〜⑥（上の判定の順）。親（と部屋）を返す
  async function requireReplyable(actor: MessageActor, parentId: string) {
    const parent = await repository.findThreadParent(parentId);
    if (parent === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    const room = await findRoom(parent.roomId, actor);
    if (room === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (room.kind === "channel") {
      const { channel } = room;
      if (!canViewChannel(channel, channel.joinedAt !== null))
        throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    }
    if (parent.parentMessageId !== null)
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (room.kind === "channel" && room.channel.joinedAt === null)
      throw new AppError("FORBIDDEN", "このチャンネルには参加していません");
    await authorizer.authorize({ userId: actor.userId }, "perm.message.reply", {
      type: "company",
    });
    if (parent.deletedAt !== null)
      throw new AppError("CONFLICT", "削除された投稿には返信できません");
    if (room.kind === "direct") {
      if (!room.partnerIsActive)
        throw new AppError(
          "CONFLICT",
          "相手のアカウントが無効になっているため、送信できません",
        );
    } else if (
      room.channel.departmentId !== null &&
      !(await repository.isDepartmentActive(room.channel.departmentId))
    )
      throw new AppError(
        "CONFLICT",
        "部署が無効になっているため、返信できません",
      );
    return parent;
  }

  // 返信の取得の ①②（親が見えるか・返信でないか）と、返信できない理由。理由は表示の制御だけで、認可は postReply が改めて行う
  async function requireReadableThread(actor: MessageActor, parentId: string) {
    const parent = await repository.findThreadParent(parentId);
    if (parent === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    const room = await findRoom(parent.roomId, actor);
    if (room === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (room.kind === "direct")
      await authorizeDm(actor, "perm.dm.message.view");
    else if (!canViewChannel(room.channel, room.channel.joinedAt !== null))
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (parent.parentMessageId !== null)
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    return { parent, room };
  }

  // 部屋の側の状態（親の削除は含めない）。joined・roomWritable・部屋が原因の理由を、同じ材料から1か所で求める。
  // 理由の優先順は not_joined → read_only → partner_inactive（親が削除済みなら、呼び出し側が deleted_parent を最優先にする）
  async function roomReplyState(
    room: NonNullable<Awaited<ReturnType<typeof findRoom>>>,
  ) {
    if (room.kind === "direct") {
      const reason = room.partnerIsActive
        ? null
        : REPLY_BLOCKED_REASONS.partnerInactive;
      return { joined: true, roomWritable: reason === null, reason };
    }
    if (room.channel.joinedAt === null)
      return {
        joined: false,
        roomWritable: false,
        reason: REPLY_BLOCKED_REASONS.notJoined,
      };
    const inactive =
      room.channel.departmentId !== null &&
      !(await repository.isDepartmentActive(room.channel.departmentId));
    return {
      joined: true,
      roomWritable: !inactive,
      reason: inactive ? REPLY_BLOCKED_REASONS.readOnly : null,
    };
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
      mentions: readonly Mention[] = [],
    ): Promise<MessageEdited> {
      const message = await requireModifiable(actor, messageId, "edit");
      await validateMentions(body, mentions);
      const editedAt = now().toISOString();
      const updated = await repository.updateBodyIfModifiable({
        messageId,
        userId: actor.userId,
        body,
        editedAt,
        roomId: message.roomId,
        parentMessageId: message.parentMessageId ?? messageId,
        mentions,
      });
      if (updated === 0) return failWrite(actor, messageId, "edit");
      return { id: messageId, body, editedAt, mentions: [...mentions] };
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
    async mentionCandidates(
      actor: MessageActor,
      roomId: string,
      query: { keyword?: string; limit: number; cursor?: CursorPayload },
    ) {
      await requireParticipatingRoom(roomId, actor);
      return repository.listMentionCandidates(query);
    },
    async list(actor: MessageActor, roomId: string, query: MessageListQuery) {
      await requireVisible(roomId, actor);
      if ("after" in query)
        return repository.listAfter(roomId, query.after, query.limit);
      return repository.listLatest(roomId, query.limit, query.cursor);
    },
    async listReplies(
      actor: MessageActor,
      parentId: string,
      query: MessageListQuery,
    ) {
      const { parent, room } = await requireReadableThread(actor, parentId);
      const parentItem = await repository.findItem(parentId);
      if (parentItem === null)
        throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
      const state = await roomReplyState(room);
      const replyBlockedReason =
        parent.deletedAt !== null
          ? REPLY_BLOCKED_REASONS.deletedParent
          : state.reason;
      const page =
        "after" in query
          ? await repository.listRepliesAfter(
              parentId,
              query.after,
              query.limit,
            )
          : await repository.listRepliesLatest(
              parentId,
              query.limit,
              query.cursor,
            );
      // joined・roomWritable は表示の制御用（認可は postReply が改めて行う）
      return {
        parent: parentItem,
        replyBlockedReason,
        joined: state.joined,
        roomWritable: state.roomWritable,
        ...page,
      };
    },
    async postReply(
      actor: MessageActor,
      parentId: string,
      body: string,
      mentions: readonly Mention[] = [],
    ): Promise<ReplyCreated> {
      const parent = await requireReplyable(actor, parentId);
      await validateMentions(body, mentions);
      const displayName = await repository.findDisplayName(actor.userId);
      if (displayName === null)
        throw new AppError("UNAUTHENTICATED", "ログインしてください");
      const { roomId } = parent;
      let id = newUlid();
      for (let retry = 0; ; retry += 1) {
        // 作り直したIDの返信が、直前の投稿より過去の時刻にならないよう、試行のたびに取り直す
        const createdAt = new Date().toISOString();
        const inserted = await repository.insertReplyIfOrdered({
          id,
          roomId,
          parentMessageId: parentId,
          senderId: actor.userId,
          senderDisplayName: displayName,
          body,
          createdAt,
          mentions,
        });
        if (inserted > 0)
          return { id, roomId, parentMessageId: parentId, createdAt };
        // 状態が崩れていれば 404／403／409 になる（上限に達した最後の挿入の後も確かめ、503 に隠さない）。崩れていなければ、IDが部屋の最大以下だった
        await requireReplyable(actor, parentId);
        if (retry >= MAX_ID_RETRIES) break;
        const max = await repository.maxId(roomId);
        id = max === null ? newUlid() : ulidAfter(max);
      }
      createLogger({ traceId: actor.traceId, userId: actor.userId }).warn(
        "返信のIDの作り直しが上限を超えた",
        { roomId },
      );
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "混み合っています。しばらくしてからもう一度お試しください",
      );
    },
    async post(
      actor: MessageActor,
      roomId: string,
      body: string,
      mentions: readonly Mention[] = [],
    ): Promise<MessageCreated> {
      await requirePostable(roomId, actor);
      await validateMentions(body, mentions);
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
          mentions,
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
