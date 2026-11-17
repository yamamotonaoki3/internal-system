// Repository：自分のスレッドの一覧（#137。EP-3-08）。DB へのアクセスはこの層に閉じ込める。
// 1回の取得は SQL 2本（スレッドの一覧 → スレッドごとの未読数）で、スレッドの数に比例しない。
// 2本の SQL の間に返信が付く・既読になると、その1回だけ古い未読数になる（次の取得で直る）。
import { toPage, type CursorPayload } from "../lib/cursor";
import { isUlid } from "../lib/ulid";
import { unreadLowerBound } from "../lib/unread-bound";
import { withDatabase, type Database } from "./database";
import { loadMessageAttachments } from "./attachment.repository";
import { toItem, type MessageItem } from "./message.repository";
import { listThreadRows } from "./thread-list.sql";
import { loadMessageMentions } from "./message-mentions.sql";
import { loadMessageReactions } from "./message-reactions.sql";
import { listThreadUnreadCounts } from "./thread-unread-counts.sql";

export type ThreadRoom =
  | { kind: "channel"; id: string; name: string }
  | {
      kind: "direct";
      id: string;
      partner: { id: string; displayName: string; isActive: boolean };
    };

export type ThreadItem = {
  parent: MessageItem;
  room: ThreadRoom;
  /** 最後の返信（削除済みを含む）の日時 */
  lastReplyAt: string;
  unreadCount: number;
};

function toRoom(row: {
  room_id: string;
  channel_name: string | null;
  partner_id: string | null;
  partner_display_name: string | null;
  partner_is_active: 0 | 1 | null;
}): ThreadRoom {
  if (row.channel_name !== null)
    return { kind: "channel", id: row.room_id, name: row.channel_name };
  if (
    row.partner_id !== null &&
    row.partner_display_name !== null &&
    row.partner_is_active !== null
  )
    return {
      kind: "direct",
      id: row.room_id,
      partner: {
        id: row.partner_id,
        displayName: row.partner_display_name,
        isActive: row.partner_is_active === 1,
      },
    };
  throw new Error("スレッドの部屋の種類を判別できませんでした");
}

export function createThreadRepository(db: Database) {
  return {
    /** 自分のスレッドを、最後の返信が新しい順に（見える範囲は参加中の部屋だけ。U-4） */
    async listThreads(
      userId: string,
      options: {
        limit: number;
        cursor?: CursorPayload;
        /** perm.dm.message.view を持つか。持たなければ DM のスレッドを含めない */
        includeDirect: boolean;
      },
    ): Promise<{ items: ThreadItem[]; nextCursor: string | null }> {
      const rows = await listThreadRows(db, userId, {
        limit: options.limit + 1,
        includeDirect: options.includeDirect,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      });
      const page = toPage(rows, options.limit, (row) => {
        if (!isUlid(row.id)) throw new Error("メッセージIDが不正です");
        return { v: row.last_reply_id, id: row.id };
      });
      const counts = await listThreadUnreadCounts(
        db,
        userId,
        page.items.map((row) => ({
          parentId: row.id,
          lower: unreadLowerBound({
            lastReadMessageId: row.last_read_message_id,
            joinedAt: row.joined_at,
          }),
        })),
      );
      const ids = page.items.map((row) => row.id);
      const mentions = await loadMessageMentions(db, ids);
      const reactions = await loadMessageReactions(db, ids, userId);
      const attachments = await loadMessageAttachments(db, ids);
      const items = page.items.map((row): ThreadItem => {
        const unreadCount = counts.get(row.id);
        if (unreadCount === undefined)
          throw new Error("スレッドの未読数を取得できませんでした");
        return {
          parent: toItem(
            {
              id: row.id,
              roomId: row.room_id,
              senderId: row.sender_id,
              senderDisplayName: row.sender_display_name,
              body: row.body,
              createdAt: row.created_at,
              editedAt: row.edited_at,
              deletedAt: row.deleted_at,
              parentMessageId: null,
              replyCount: row.reply_count,
              authorIsActive: row.author_is_active === 1,
            },
            mentions.get(row.id) ?? [],
            reactions.get(row.id) ?? [],
            attachments.get(row.id) ?? [],
          ),
          room: toRoom(row),
          lastReplyAt: row.last_reply_at,
          unreadCount,
        };
      });
      return { items, nextCursor: page.nextCursor };
    },
  };
}

export type ThreadRepository = ReturnType<typeof createThreadRepository>;

/** Repository を使う間だけ DB につなぐ */
export function withThreads<T>(
  env: Env,
  run: (repository: ThreadRepository) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) => run(createThreadRepository(db)));
}
