// API 層：メッセージの一覧・投稿・編集・削除と、スレッドの返信の通信はここに書く。共通の apiClient（services/）を使う。
import { z } from "zod";
import {
  REPLY_BLOCKED_REASONS,
  mentionSchema,
  type Mention,
} from "../../../../../shared/message-rules";
import {
  ATTACHMENT_KINDS,
  PUBLICATION_VISIBILITIES,
  type PublicationVisibility,
} from "../../../../../shared/attachment-rules";
import { REACTION_KINDS } from "../../../../../shared/reaction-rules";
import { apiClient } from "../../../services/api-client";

/** リアクション1種類の集計。users は付けた時刻の順で最大50人、count は全数 */
export const reactionSchema = z.object({
  kind: z.enum(REACTION_KINDS),
  value: z.string().min(1),
  count: z.number().int().min(0),
  reactedByMe: z.boolean(),
  users: z.array(
    z.object({
      id: z.string().min(1),
      displayName: z.string(),
      isActive: z.boolean(),
    }),
  ),
});
export type Reaction = z.infer<typeof reactionSchema>;

/** 添付1件。URL はサーバーの応答から受け取らず、ID から attachmentUrl で組み立てる */
export const attachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(ATTACHMENT_KINDS),
  contentType: z.string().min(1),
  size: z.number().int().min(0),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** アップロードの応答。公開範囲は案件の部屋なら値、ほかの部屋は null（メッセージの表示の添付は公開範囲を持たない） */
const uploadedAttachmentSchema = attachmentSchema.extend({
  publicationVisibility: z.enum(PUBLICATION_VISIBILITIES).nullable(),
});
export type UploadedAttachment = z.infer<typeof uploadedAttachmentSchema>;

const reactionsResultSchema = z.object({
  messageId: z.string().min(1),
  reactions: z.array(reactionSchema),
});

const messageShape = {
  id: z.string().min(1),
  roomId: z.string().min(1),
  author: z.object({
    id: z.string().min(1),
    displayName: z.string(),
    isActive: z.boolean(),
  }),
  /** 削除済みは null */
  body: z.string().nullable(),
  createdAt: z.string(),
  mentions: z.array(mentionSchema),
  /** 編集した日時。編集していなければ null */
  editedAt: z.string().nullable(),
  deleted: z.boolean(),
  /** この投稿への返信の件数（削除済みの返信も数える）。返信自身は 0 */
  replyCount: z.number().int().min(0),
  /** リアクションの集計。削除済みは空配列 */
  reactions: z.array(reactionSchema),
  /** 添付（ID の昇順）。削除済みは空配列 */
  attachments: z.array(attachmentSchema),
};

// 削除済みと本文がないことの食い違いは、サーバーの不具合として失敗にする
function withConsistentBody<
  T extends z.ZodType<{ deleted: boolean; body: string | null }>,
>(schema: T) {
  return schema.refine(
    (message) => message.deleted === (message.body === null),
    { message: "削除済みの印と本文の有無が食い違っています" },
  );
}

// 部屋の一覧とスレッドの親は、返信ではない（parentMessageId は常に null）。返信が混ざったら契約違反として失敗にする
/** 部屋の一覧の1件・スレッドの親（返信ではない投稿）。スレッド一覧の親も同じ形 */
export const roomMessageSchema = withConsistentBody(
  z.object({ ...messageShape, parentMessageId: z.null() }),
);
// スレッドの返信は、親の ID を持つ
const replySchema = withConsistentBody(
  z.object({ ...messageShape, parentMessageId: z.string().min(1) }),
);
const latestPageSchema = z.object({
  items: z.array(roomMessageSchema),
  nextCursor: z.string().nullable(),
});
const afterPageSchema = z.object({
  items: z.array(roomMessageSchema),
  hasMore: z.boolean(),
});
const replyBlockedReasonSchema = z.enum(REPLY_BLOCKED_REASONS).nullable();
const repliesLatestSchema = z.object({
  items: z.array(replySchema),
  nextCursor: z.string().nullable(),
  parent: roomMessageSchema,
  replyBlockedReason: replyBlockedReasonSchema,
  /** 今、参加者か（チャンネルは参加中、DM は当事者）。既読・自分の返信の編集・削除の可否に使う */
  joined: z.boolean(),
  /** 部屋に今書き込めるか（読み取り専用・アーカイブ・DM の相手が無効でないか）。自分の返信の編集・削除の可否に使う */
  roomWritable: z.boolean(),
  /** スレッドの部屋が案件専用チャンネルか。添付の公開範囲の選択を出すかに使う（表示の制御だけ） */
  caseRoom: z.boolean(),
  /** スレッドの部屋の案件の ID（通常のチャンネル・DM は null）。資格の確かめの対象を決めるだけで、認可には使わない（#339） */
  caseId: z.string().min(1).nullable(),
});
const repliesAfterSchema = z.object({
  items: z.array(replySchema),
  hasMore: z.boolean(),
  parent: roomMessageSchema,
  replyBlockedReason: replyBlockedReasonSchema,
  /** 今、参加者か（チャンネルは参加中、DM は当事者）。既読・自分の返信の編集・削除の可否に使う */
  joined: z.boolean(),
  /** 部屋に今書き込めるか（読み取り専用・アーカイブ・DM の相手が無効でないか）。自分の返信の編集・削除の可否に使う */
  roomWritable: z.boolean(),
  /** スレッドの部屋が案件専用チャンネルか。添付の公開範囲の選択を出すかに使う（表示の制御だけ） */
  caseRoom: z.boolean(),
  /** スレッドの部屋の案件の ID（通常のチャンネル・DM は null）。資格の確かめの対象を決めるだけで、認可には使わない（#339） */
  caseId: z.string().min(1).nullable(),
});
const createdSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  createdAt: z.string(),
});
const replyCreatedSchema = z.object({
  id: z.string().min(1),
  parentMessageId: z.string().min(1),
  createdAt: z.string(),
});

const editedSchema = z.object({
  id: z.string().min(1),
  body: z.string(),
  editedAt: z.string(),
  mentions: z.array(mentionSchema),
});

/** 部屋の一覧・スレッドの1件。返信ならスレッドの親の ID（parentMessageId）を持つ */
export type RoomMessage = Omit<
  z.infer<typeof roomMessageSchema>,
  "parentMessageId"
> & { parentMessageId: string | null };
export type MessagesAfterPage = z.infer<typeof afterPageSchema>;
/** スレッドの返信の取得結果（親と、返信できない理由つき） */
export type ThreadRepliesPage = {
  parent: RoomMessage;
  items: RoomMessage[];
  replyBlockedReason: z.infer<typeof replyBlockedReasonSchema>;
  joined: boolean;
  roomWritable: boolean;
  caseRoom: boolean;
  caseId: string | null;
};
export type ThreadRepliesAfterPage = ThreadRepliesPage & { hasMore: boolean };

const messagesPath = (roomId: string) =>
  `/rooms/${encodeURIComponent(roomId)}/messages`;

/** 最新の一覧。応答は新しい順のため、ID昇順（古い順）に直して返す */
export async function fetchLatestMessages(
  roomId: string,
): Promise<RoomMessage[]> {
  const response = await apiClient.get(messagesPath(roomId));
  return latestPageSchema.parse(response.data).items.toReversed();
}

/** 指定したID以降（含まない）の新着。ID昇順 */
export async function fetchMessagesAfter(
  roomId: string,
  after: string,
): Promise<MessagesAfterPage> {
  const response = await apiClient.get(messagesPath(roomId), {
    params: { after },
  });
  return afterPageSchema.parse(response.data);
}

export async function postMessage(
  roomId: string,
  body: string,
  mentions: readonly Mention[] = [],
  attachmentIds: readonly string[] = [],
) {
  const response = await apiClient.post(messagesPath(roomId), {
    body,
    mentions,
    ...(attachmentIds.length > 0 && { attachmentIds }),
  });
  return createdSchema.parse(response.data);
}

const messagePath = (messageId: string) =>
  `/messages/${encodeURIComponent(messageId)}`;

export async function editMessage(
  messageId: string,
  body: string,
  mentions: readonly Mention[] = [],
) {
  const response = await apiClient.patch(messagePath(messageId), {
    body,
    mentions,
  });
  return editedSchema.parse(response.data);
}

export async function deleteMessage(messageId: string): Promise<void> {
  await apiClient.delete(messagePath(messageId));
}

const reactionsPath = (messageId: string) =>
  `${messagePath(messageId)}/reactions`;

/** リアクションを付ける。すでに付いていても成功（冪等）で、その投稿の最新の集計を返す */
export async function addReaction(
  messageId: string,
  reaction: { kind: Reaction["kind"]; value: string },
) {
  const response = await apiClient.post(reactionsPath(messageId), {
    kind: reaction.kind,
    value: reaction.value,
  });
  return reactionsResultSchema.parse(response.data);
}

/** 自分のリアクションを取り消す。すでに外れていても成功（冪等） */
export async function removeReaction(
  messageId: string,
  kind: Reaction["kind"],
  value: string,
) {
  const response = await apiClient.delete(
    `${reactionsPath(messageId)}/${encodeURIComponent(kind)}/${encodeURIComponent(value)}`,
  );
  return reactionsResultSchema.parse(response.data);
}

const repliesPath = (parentMessageId: string) =>
  `${messagePath(parentMessageId)}/replies`;

/** スレッドの最新の返信。応答は新しい順のため、ID昇順（古い順）に直して返す */
export async function fetchLatestReplies(
  parentMessageId: string,
): Promise<ThreadRepliesPage> {
  const response = await apiClient.get(repliesPath(parentMessageId));
  const page = repliesLatestSchema.parse(response.data);
  return {
    parent: page.parent,
    items: page.items.toReversed(),
    replyBlockedReason: page.replyBlockedReason,
    joined: page.joined,
    roomWritable: page.roomWritable,
    caseRoom: page.caseRoom,
    caseId: page.caseId,
  };
}

/** スレッドの、指定したID以降（含まない）の返信。ID昇順 */
export async function fetchRepliesAfter(
  parentMessageId: string,
  after: string,
): Promise<ThreadRepliesAfterPage> {
  const response = await apiClient.get(repliesPath(parentMessageId), {
    params: { after },
  });
  return repliesAfterSchema.parse(response.data);
}

export async function postReply(
  parentMessageId: string,
  body: string,
  mentions: readonly Mention[] = [],
  attachmentIds: readonly string[] = [],
) {
  const response = await apiClient.post(repliesPath(parentMessageId), {
    body,
    mentions,
    ...(attachmentIds.length > 0 && { attachmentIds }),
  });
  return replyCreatedSchema.parse(response.data);
}

const mentionCandidatesSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      displayName: z.string(),
      departmentName: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export async function fetchMentionCandidates(
  roomId: string,
  q: string,
): Promise<z.infer<typeof mentionCandidatesSchema>> {
  const response = await apiClient.get(
    `/rooms/${encodeURIComponent(roomId)}/mention-candidates`,
    { params: { q } },
  );
  return mentionCandidatesSchema.parse(response.data);
}

/** 添付の送り先。通常の投稿用は部屋、返信用はスレッドの親 */
export type AttachmentTarget =
  { kind: "room"; roomId: string } | { kind: "reply"; parentMessageId: string };

// 共通の10秒では、大きな添付（動画は最大100MB）の送信が途中で切れる。
// 100MB を約1.4Mbps の上りでも送り切れる長さとして10分にする（取り消しは AbortController で利用者が行える）
export const ATTACHMENT_UPLOAD_TIMEOUT_MS = 600_000;

const attachmentsPath = (target: AttachmentTarget) =>
  target.kind === "room"
    ? `/rooms/${encodeURIComponent(target.roomId)}/attachments`
    : `${repliesPath(target.parentMessageId)}/attachments`;

/**
 * 添付を1件アップロードする。本文はファイルのバイト列、元の名前は X-File-Name（パーセントエンコード）で送る。
 * 公開範囲は値があるときだけクエリで送る（案件の部屋だけで指定できる）
 */
export async function uploadAttachment(
  target: AttachmentTarget,
  file: File,
  options: {
    signal?: AbortSignal;
    publicationVisibility?: PublicationVisibility;
  } = {},
): Promise<UploadedAttachment> {
  const { publicationVisibility } = options;
  const response = await apiClient.post(attachmentsPath(target), file, {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    ...(publicationVisibility !== undefined && {
      params: { publicationVisibility },
    }),
    timeout: ATTACHMENT_UPLOAD_TIMEOUT_MS,
    signal: options.signal,
  });
  return uploadedAttachmentSchema.parse(response.data);
}

/** 添付の配信の URL。ID から組み立てる（応答の任意の URL を使わない） */
export function attachmentUrl(attachmentId: string): string {
  return `${apiClient.defaults.baseURL ?? "/api"}/attachments/${encodeURIComponent(attachmentId)}`;
}

/** 自分の添付を削除する（#270。EP-1-11。成功は 204）。再認証は呼び出し側（useDeleteAttachment）が挟む */
export async function deleteAttachment(attachmentId: string): Promise<void> {
  await apiClient.delete(`/attachments/${encodeURIComponent(attachmentId)}`);
}
