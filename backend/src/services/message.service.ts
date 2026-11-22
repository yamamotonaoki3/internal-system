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
// リアクション（#138。EP-1-12・EP-1-13）：requireReactable の判定の順（この順を変えない）
//   ① メッセージがあり部屋が見えるか（DM は perm.dm.message.view、チャンネルは canViewChannel。見えなければ 404）→ ② 参加していない公開チャンネルは 403
//   → ③ perm.reaction.manage.own（拒否は authorize が監査に記録する）→ ④ 削除済みは 409 → ⑤ 部署が無効・DM の相手が無効は 409 → ⑥ 条件付きの書き込み。
//   親の投稿にも返信にも同じ判定を使う（返信は、親が削除済みでも付けられる）。お知らせ専用の投稿権限は問わない。
//   ⑥が 0 行のときは、①〜⑤をやり直して拒否の理由があればその応答にする。理由がなければ、今の状態で分ける（writeReaction）。
// 添付（#140）：投稿・返信と同じ batch で attachmentIds を結び付ける。既存の判定の後、結び付けが合わなければ読み直して分ける：
//   他人の・別の部屋の・別の文脈の・存在しない添付 → 404 → 使用済み → 409 → 合計の超過 → 422（それ以外は状態が変わった 409）。
//   アップロードの入口（services/attachment.service.ts）は、requirePostable・requireReplyable をそのまま使う。
// 案件専用チャンネル（案件の部屋。#148）：既存の資格の判定（非参加者は 404）の後に、読みは perm.case.view、書き込み（リアクション・添付のアップロードを含む）は
//   perm.case.post を判定し（拒否は 403）、書き込みは案件が終了中なら 409（部署の判定の前。拒否は logger.audit に reason case_closed で残し、本文は入れない）。
//   書き込みの SQL にも「案件が進行中」の条件（db/case-room.sql.ts の caseRoomOpen）があり、確認の後に終了した場合は 0 行の読み直しでこの 409 になる。
// 書き込みは条件付きの INSERT 1文。挿入できなかった（0 行）ときは、原因を読み直して分ける：
//   状態が崩れた → 404／403、IDが部屋の最大以下 → 最大より大きいIDで作り直して再試行（上限あり。超えたら 503）。
import { AttachmentBindError } from "../db/attachment.repository";
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
import { MAX_ATTACHMENT_TOTAL_BYTES } from "../../../shared/attachment-rules";
import {
  MAX_REACTION_TYPES,
  type ReactionKind,
} from "../../../shared/reaction-rules";
import type { Reaction } from "../db/message-reactions.sql";
import { createAppAuthorizer } from "./authorizer";
import { purgeAttachmentsOfMessage } from "./attachment-purge";
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

const REACTION_LIMIT_MESSAGE = `リアクションは${MAX_REACTION_TYPES}種類までです`;
const REACTION_CONFLICT_MESSAGE = "状態が変わりました。もう一度お試しください";

export type ReactionsResult = { messageId: string; reactions: Reaction[] };

type Dependencies = {
  authorizer: Pick<ReturnType<typeof createAppAuthorizer>, "authorize">;
  now?: () => Date;
  /** メッセージの削除が成功した後に、その添付の実体の削除を1回試す（#270。省略時は何もしない） */
  purgeAttachmentsOf?: (messageId: string) => Promise<void>;
};

export type MessageEdited = {
  id: string;
  body: string;
  editedAt: string;
  mentions: Mention[];
};

type ModifyOperation = "edit" | "delete";

/** 終了した案件の部屋への書き込みの 409 の文言（操作ごと。#148） */
const CASE_CLOSED_MESSAGES = {
  post: "終了した案件には投稿できません",
  modify: "終了した案件のメッセージは変更できません",
  reaction: "終了した案件にはリアクションできません",
  upload: "終了した案件には添付できません",
} as const;

/** 部屋への書き込みの種類（終了した案件の 409 の文言を選ぶ） */
export type RoomWriteKind = "post" | "upload";

const MODIFY_PERMISSION = {
  edit: "perm.message.edit.own",
  delete: "perm.message.delete.own",
} as const;

export function withMessageService<T>(
  env: Env,
  actor: MessageActor,
  run: (service: ReturnType<typeof createMessageService>) => Promise<T>,
): Promise<T> {
  const logger = createLogger({ traceId: actor.traceId, userId: actor.userId });
  return withMessages(env, (repository) =>
    withRoleAssignments(env, (roles) =>
      run(
        createMessageService(repository, {
          authorizer: createAppAuthorizer(roles, { logger }),
          purgeAttachmentsOf: (messageId) =>
            purgeAttachmentsOfMessage(env, messageId, logger),
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
  { authorizer, now = () => new Date(), purgeAttachmentsOf }: Dependencies,
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

  type FoundRoom = NonNullable<Awaited<ReturnType<typeof findRoom>>>;

  // 案件の部屋なら、案件の権限を確かめる（案件でない部屋では何もしない）
  async function authorizeCase(
    actor: MessageActor,
    room: FoundRoom,
    permission: "perm.case.view" | "perm.case.post",
  ) {
    if (room.kind === "channel" && room.channel.caseId !== null)
      await authorizer.authorize({ userId: actor.userId }, permission, {
        type: "company",
      });
  }

  // 案件の部屋で案件が終了していれば 409。拒否は audit に残す（本文は入れない）
  function requireCaseOpen(
    actor: MessageActor,
    room: FoundRoom,
    audit: { action: string; target: string },
    message: string,
  ) {
    if (room.kind !== "channel" || room.channel.caseStatus !== "closed") return;
    createLogger({ traceId: actor.traceId, userId: actor.userId }).audit(
      audit.action,
      audit.target,
      "failure",
      { reason: "case_closed" },
    );
    throw new AppError("CONFLICT", message);
  }

  // 一覧で見てよい部屋の規則。添付の配信の条件（db/attachment-visibility.sql.ts）も同じ規則なので、変えるときは両方を直す
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
    await authorizeCase(actor, room, "perm.case.view");
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
  // 部屋が案件専用チャンネルかを返す（添付の公開範囲の確かめに使う。読み取りを増やさないため）
  async function requirePostable(
    roomId: string,
    actor: MessageActor,
    kind: RoomWriteKind,
  ): Promise<{ caseRoom: boolean }> {
    const room = await requireParticipatingRoom(roomId, actor);
    if (room.kind === "direct") return { caseRoom: false };
    await authorizeCase(actor, room, "perm.case.post");
    requireCaseOpen(
      actor,
      room,
      {
        action: kind === "post" ? "message.post" : "attachment.upload",
        target: roomId,
      },
      CASE_CLOSED_MESSAGES[kind],
    );
    const { channel } = room;
    // 全社連絡（部署なし）は、参加者なら誰でも投稿できる。権限で制限するのはお知らせ専用だけ（canPostToChannel と同じ規則）
    if (channel.purpose === "announcement" && channel.departmentId !== null)
      await authorizer.authorize(
        { userId: actor.userId },
        "perm.announcement.post",
        { type: "department", departmentId: channel.departmentId },
      );
    return { caseRoom: channel.caseId !== null };
  }

  // 返信の ①〜⑥（上の判定の順）。親と、部屋が案件専用チャンネルかを返す
  async function requireReplyable(
    actor: MessageActor,
    parentId: string,
    kind: RoomWriteKind,
  ) {
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
    await authorizeCase(actor, room, "perm.case.post");
    requireCaseOpen(
      actor,
      room,
      {
        action: kind === "post" ? "message.reply" : "attachment.upload",
        target: parentId,
      },
      CASE_CLOSED_MESSAGES[kind],
    );
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
    return {
      ...parent,
      caseRoom: room.kind === "channel" && room.channel.caseId !== null,
    };
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
    await authorizeCase(actor, room, "perm.case.view");
    return { parent, room };
  }

  // 部屋の側の状態（親の削除は含めない）。joined・roomWritable・部屋が原因の理由を、同じ材料から1か所で求める。
  // 理由の優先順は not_joined → case_closed → read_only → partner_inactive（親が削除済みなら、呼び出し側が deleted_parent を最優先にする）
  async function roomReplyState(room: FoundRoom) {
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
    if (room.channel.caseStatus === "closed")
      return {
        joined: true,
        roomWritable: false,
        reason: REPLY_BLOCKED_REASONS.caseClosed,
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
    const room = await findModifiableRoom(actor, message.roomId);
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
    await requireRoomModifiable(actor, room, {
      action: `message.${operation}`,
      target: messageId,
    });
    return message;
  }

  // 編集・削除（メッセージ・添付）の部屋が見えるか（DM は perm.dm.message.view、チャンネルは canViewChannel。見えなければ 404）
  async function findModifiableRoom(actor: MessageActor, roomId: string) {
    const room = await findRoom(roomId, actor);
    if (room === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (room.kind === "direct")
      await authorizeDm(actor, "perm.dm.message.view");
    else if (!canViewChannel(room.channel, room.channel.joinedAt !== null))
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    return room;
  }

  // 編集・削除（メッセージ・添付）の部屋の状態（DM の相手が無効 409・未参加 403・案件の権限と終了 409・部署が無効 409）。拒否は audit の名前で残す
  async function requireRoomModifiable(
    actor: MessageActor,
    room: FoundRoom,
    audit: { action: string; target: string },
  ) {
    if (room.kind === "direct") {
      if (!room.partnerIsActive)
        throw new AppError(
          "CONFLICT",
          "相手のアカウントが無効になっているため、操作できません",
        );
      return;
    }
    const { channel } = room;
    if (channel.joinedAt === null) {
      createLogger({ traceId: actor.traceId, userId: actor.userId }).audit(
        audit.action,
        audit.target,
        "failure",
        { reason: "not_member" },
      );
      throw new AppError("FORBIDDEN", "このチャンネルには参加していません");
    }
    await authorizeCase(actor, room, "perm.case.post");
    requireCaseOpen(actor, room, audit, CASE_CLOSED_MESSAGES.modify);
    if (
      channel.departmentId !== null &&
      !(await repository.isDepartmentActive(channel.departmentId))
    )
      throw new AppError(
        "CONFLICT",
        "部署が無効になっているため、操作できません",
      );
  }

  // リアクションを付け外ししてよいかを、①〜⑤の順に確かめる（⑥書き込みは呼び出し側）。
  async function requireReactable(actor: MessageActor, messageId: string) {
    const message = await repository.findForModification(messageId);
    if (message === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    const room = await findRoom(message.roomId, actor);
    if (room === null) throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (room.kind === "direct")
      await authorizeDm(actor, "perm.dm.message.view");
    else if (!canViewChannel(room.channel, room.channel.joinedAt !== null))
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (room.kind === "channel" && room.channel.joinedAt === null)
      throw new AppError("FORBIDDEN", "このチャンネルには参加していません");
    await authorizer.authorize(
      { userId: actor.userId },
      "perm.reaction.manage.own",
      { type: "company" },
    );
    if (message.deletedAt !== null)
      throw new AppError(
        "CONFLICT",
        "削除された投稿にはリアクションを付け外しできません",
      );
    await authorizeCase(actor, room, "perm.case.post");
    requireCaseOpen(
      actor,
      room,
      { action: "message.reaction", target: messageId },
      CASE_CLOSED_MESSAGES.reaction,
    );
    if (room.kind === "direct") {
      if (!room.partnerIsActive)
        throw new AppError(
          "CONFLICT",
          "相手のアカウントが無効になっているため、操作できません",
        );
    } else if (
      room.channel.departmentId !== null &&
      !(await repository.isDepartmentActive(room.channel.departmentId))
    )
      throw new AppError(
        "CONFLICT",
        "部署が無効になっているため、操作できません",
      );
  }

  // 付ける・取り消すの共通の流れ。書き込みが 0 行のときは、判定をやり直し、今の状態で次のどれかにする。
  //   拒否の理由がある → その応答／すでに要求された状態（付けている・外れている）→ 成功（冪等）／20種類に達していて新しい種類 → 409
  //   どれでもない（別の操作で状態が変わった）→ 書き込みを1回だけやり直す。それでも決まらなければ 409（繰り返さない）
  async function writeReaction(
    operation: "add" | "remove",
    actor: MessageActor,
    messageId: string,
    kind: ReactionKind,
    value: string,
  ): Promise<ReactionsResult> {
    await requireReactable(actor, messageId);
    const input = { messageId, userId: actor.userId, kind, value };
    const write = () =>
      operation === "add"
        ? repository.addReactionIfReactable(input)
        : repository.removeReactionIfReactable(input);
    for (let attempt = 1; ; attempt += 1) {
      const result = await write();
      if (result.changes > 0) return { messageId, reactions: result.reactions };
      await requireReactable(actor, messageId);
      const reactions = await repository.loadReactions(messageId, actor.userId);
      if (reactions === null) {
        // 再判定の直後に条件が崩れた。集計は返さず、判定をやり直して拒否の理由があればその応答にする
        await requireReactable(actor, messageId);
        throw new AppError("CONFLICT", REACTION_CONFLICT_MESSAGE);
      }
      const current = reactions.find(
        (reaction) => reaction.kind === kind && reaction.value === value,
      );
      const mine = current?.reactedByMe ?? false;
      if (operation === "add") {
        if (mine) return { messageId, reactions };
        if (current === undefined && reactions.length >= MAX_REACTION_TYPES)
          throw new AppError("CONFLICT", REACTION_LIMIT_MESSAGE);
      } else if (!mine) return { messageId, reactions };
      if (attempt >= 2)
        throw new AppError("CONFLICT", REACTION_CONFLICT_MESSAGE);
    }
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

  // 結び付けが取り消されたときの原因を、今の添付の行で分ける（判定の順はファイルの先頭のコメント）
  async function failAttachmentBinding(
    actor: MessageActor,
    context: { roomId: string; threadParentId: string | null },
    attachmentIds: readonly string[],
  ): Promise<never> {
    const rows = await repository.findAttachmentsForBinding(attachmentIds);
    const usable = rows.filter(
      (row) =>
        row.uploaderId === actor.userId &&
        row.roomId === context.roomId &&
        row.threadParentId === context.threadParentId,
    );
    if (usable.length !== attachmentIds.length)
      throw new AppError("NOT_FOUND", "添付が見つかりません");
    if (usable.some((row) => row.messageId !== null))
      throw new AppError("CONFLICT", "添付はすでに使われています");
    const total = usable.reduce((sum, row) => sum + row.sizeBytes, 0);
    if (total > MAX_ATTACHMENT_TOTAL_BYTES)
      throw new AppError("VALIDATION_ERROR", "添付の合計が上限を超えています", {
        fields: ["attachmentIds"],
      });
    // どの理由にも当たらない＝読み直すまでに別の操作で状態が変わった
    throw new AppError(
      "CONFLICT",
      "添付の状態が変わりました。もう一度お試しください",
    );
  }

  /** 書き込みを行い、添付の結び付けが合わなければ原因に合う応答にする */
  async function insertWithAttachments(
    insert: () => Promise<number>,
    actor: MessageActor,
    context: { roomId: string; threadParentId: string | null },
    attachmentIds: readonly string[],
  ): Promise<number> {
    try {
      return await insert();
    } catch (error) {
      if (error instanceof AttachmentBindError)
        return failAttachmentBinding(actor, context, attachmentIds);
      throw error;
    }
  }

  return {
    /** 通常の投稿をしてよいか（添付のアップロードの入口も使う。#140） */
    requirePostable: (
      actor: MessageActor,
      roomId: string,
      kind: RoomWriteKind,
    ) => requirePostable(roomId, actor, kind),
    /** 返信してよいか（添付のアップロードの入口も使う。#140）。親を返す */
    requireReplyable: (
      actor: MessageActor,
      parentId: string,
      kind: RoomWriteKind,
    ) => requireReplyable(actor, parentId, kind),
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
      // 添付の実体の削除を1回試す（#270）。後始末の失敗は削除の結果を変えず、error ログに残す（次の定期の処理が消す）
      if (purgeAttachmentsOf === undefined) return;
      try {
        await purgeAttachmentsOf(messageId);
      } catch (error) {
        createLogger({ traceId: actor.traceId, userId: actor.userId }).error(
          "メッセージの添付の後始末に失敗した",
          { error },
        );
      }
    },
    /**
     * 添付の削除（#270）の③権限・④部屋の状態を確かめる（①見えるか・未投稿・②本人かは attachment.service が先に確かめる）。
     * お知らせ専用の投稿権限は問わない（メッセージの削除と同じ。C-171 U-3）
     */
    async requireAttachmentDeletable(
      actor: MessageActor,
      target: { attachmentId: string; roomId: string },
    ): Promise<void> {
      await authorizer.authorize(
        { userId: actor.userId },
        "perm.attachment.delete.own",
        { type: "company" },
      );
      const room = await findModifiableRoom(actor, target.roomId);
      await requireRoomModifiable(actor, room, {
        action: "attachment.delete",
        target: target.attachmentId,
      });
    },
    addReaction: (
      actor: MessageActor,
      messageId: string,
      kind: ReactionKind,
      value: string,
    ) => writeReaction("add", actor, messageId, kind, value),
    removeReaction: (
      actor: MessageActor,
      messageId: string,
      kind: ReactionKind,
      value: string,
    ) => writeReaction("remove", actor, messageId, kind, value),
    async mentionCandidates(
      actor: MessageActor,
      roomId: string,
      query: { keyword?: string; limit: number; cursor?: CursorPayload },
    ) {
      const room = await requireParticipatingRoom(roomId, actor);
      await authorizeCase(actor, room, "perm.case.view");
      return repository.listMentionCandidates({
        ...query,
        visibleTo: { roomId, viewerId: actor.userId },
      });
    },
    async list(actor: MessageActor, roomId: string, query: MessageListQuery) {
      await requireVisible(roomId, actor);
      if ("after" in query)
        return repository.listAfter(
          roomId,
          query.after,
          query.limit,
          actor.userId,
        );
      return repository.listLatest(
        roomId,
        query.limit,
        query.cursor,
        actor.userId,
      );
    },
    async listReplies(
      actor: MessageActor,
      parentId: string,
      query: MessageListQuery,
    ) {
      const { parent, room } = await requireReadableThread(actor, parentId);
      const parentItem = await repository.findItem(parentId, actor.userId);
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
              actor.userId,
            )
          : await repository.listRepliesLatest(
              parentId,
              query.limit,
              query.cursor,
              actor.userId,
            );
      // joined・roomWritable・caseRoom は表示の制御用（認可は postReply・アップロードが改めて行う）
      return {
        parent: parentItem,
        replyBlockedReason,
        joined: state.joined,
        roomWritable: state.roomWritable,
        caseRoom: room.kind === "channel" && room.channel.caseId !== null,
        ...page,
      };
    },
    async postReply(
      actor: MessageActor,
      parentId: string,
      body: string,
      mentions: readonly Mention[] = [],
      attachmentIds: readonly string[] = [],
    ): Promise<ReplyCreated> {
      const parent = await requireReplyable(actor, parentId, "post");
      await validateMentions(body, mentions);
      const displayName = await repository.findDisplayName(actor.userId);
      if (displayName === null)
        throw new AppError("UNAUTHENTICATED", "ログインしてください");
      const { roomId } = parent;
      let id = newUlid();
      for (let retry = 0; ; retry += 1) {
        // 作り直したIDの返信が、直前の投稿より過去の時刻にならないよう、試行のたびに取り直す
        const createdAt = new Date().toISOString();
        const inserted = await insertWithAttachments(
          () =>
            repository.insertReplyIfOrdered({
              id,
              roomId,
              parentMessageId: parentId,
              senderId: actor.userId,
              senderDisplayName: displayName,
              body,
              createdAt,
              mentions,
              attachmentIds,
            }),
          actor,
          { roomId, threadParentId: parentId },
          attachmentIds,
        );
        if (inserted > 0)
          return { id, roomId, parentMessageId: parentId, createdAt };
        // 状態が崩れていれば 404／403／409 になる（上限に達した最後の挿入の後も確かめ、503 に隠さない）。崩れていなければ、IDが部屋の最大以下だった
        await requireReplyable(actor, parentId, "post");
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
      attachmentIds: readonly string[] = [],
    ): Promise<MessageCreated> {
      await requirePostable(roomId, actor, "post");
      await validateMentions(body, mentions);
      const displayName = await repository.findDisplayName(actor.userId);
      if (displayName === null)
        throw new AppError("UNAUTHENTICATED", "ログインしてください");
      let id = newUlid();
      for (let retry = 0; ; retry += 1) {
        // 作り直したIDの投稿が、直前の投稿より過去の時刻にならないよう、試行のたびに取り直す
        const createdAt = new Date().toISOString();
        const inserted = await insertWithAttachments(
          () =>
            repository.insertIfOrdered({
              id,
              roomId,
              senderId: actor.userId,
              senderDisplayName: displayName,
              body,
              createdAt,
              mentions,
              attachmentIds,
            }),
          actor,
          { roomId, threadParentId: null },
          attachmentIds,
        );
        if (inserted > 0) return { id, roomId, createdAt };
        // 状態が崩れていれば 404／403／409 になる（上限に達した最後の挿入の後も確かめ、503 に隠さない）。崩れていなければ、IDが部屋の最大以下だった
        await requirePostable(roomId, actor, "post");
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
