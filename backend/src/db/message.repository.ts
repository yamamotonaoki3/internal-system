// Repository：メッセージの一覧と投稿（#201）。DB へのアクセスはこの層に閉じ込める。
// 投稿は条件付きの INSERT 1文。「部屋の中では、コミットの順に ID が必ず増える」を DB で保証する（D1 は書き込みを直列に実行する）。
// ID が部屋の最大以下だと挿入されない（0 行）。取りこぼし防止の理由は docs/design/messages.md。
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  conversationMembers,
  departments,
  messages,
  users,
} from "../../db/schema";
import { afterCursor, afterId, toAfterIdPage, toPage } from "../lib/cursor";
import type { CursorPayload } from "../lib/cursor";
import { ROLE_IDS } from "../lib/permissions";
import type { Mention } from "../../../shared/message-rules";
import { createProfileRepository } from "./profile.repository";
import {
  activeMentionNames,
  guardInsertedMessage,
  insertMentionNotifications,
  insertMessageMentions,
  loadMessageMentions,
  translateMessageInsertError,
  MessageInsertGuardError,
} from "./message-mentions.sql";
import { isUlid } from "../lib/ulid";
import { createChannelRepository } from "./channel.repository";
import { withDatabase, type Database } from "./database";
import {
  deleteIfModifiable,
  updateBodyIfModifiable,
} from "./message-modify.sql";
import { insertReplyIfOrdered } from "./reply-insert.sql";

export type MessageItem = {
  id: string;
  roomId: string;
  /** displayName は投稿時点の表示名、isActive は投稿者の今の有効・無効 */
  author: { id: string; displayName: string; isActive: boolean };
  /** 削除済みは null（本文は DB に残すが、API では返さない） */
  body: string | null;
  createdAt: string;
  /** 編集済みなら最後の編集の日時。削除済みは null */
  editedAt: string | null;
  deleted: boolean;
  /** 返信なら親の ID、通常の投稿は null（#137。返信は1段だけ） */
  parentMessageId: string | null;
  /** 通常の投稿への返信の件数（削除済みの返信も数える）。返信自身は 0 */
  replyCount: number;
  mentions: Mention[];
};

export type MessageInsert = {
  id: string;
  roomId: string;
  senderId: string;
  senderDisplayName: string;
  body: string;
  /** 省略すると DB の現在時刻 */
  createdAt?: string;
  mentions?: readonly Mention[];
};

/** 通常の投稿への返信の件数（削除済みも数える）。messages_parent_message_id_id_idx で数える。1つの SELECT に入れるので、項目の数でクエリは増えない */
const replyCountColumn = sql<number>`(SELECT COUNT(*) FROM messages r WHERE r.parent_message_id = ${messages.id})`;

const messageColumns = {
  id: messages.id,
  roomId: messages.roomId,
  senderId: messages.senderId,
  senderDisplayName: messages.senderDisplayName,
  body: messages.body,
  createdAt: messages.createdAt,
  editedAt: messages.editedAt,
  deletedAt: messages.deletedAt,
  parentMessageId: messages.parentMessageId,
  replyCount: replyCountColumn,
  authorIsActive: users.isActive,
};

/** 返信の一覧の項目。返信への返信はないので、件数は数えずに 0 とする */
const replyColumns = { ...messageColumns, replyCount: sql<number>`0` };

/** DB の行から API の項目を作る（スレッド一覧の親の項目も同じ形） */
export function toItem(
  row: {
    id: string;
    roomId: string;
    senderId: string;
    senderDisplayName: string;
    body: string;
    createdAt: string;
    editedAt: string | null;
    deletedAt: string | null;
    parentMessageId: string | null;
    replyCount: number;
    authorIsActive: boolean;
  },
  mentions: Mention[] = [],
): MessageItem {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    roomId: row.roomId,
    author: {
      id: row.senderId,
      displayName: row.senderDisplayName,
      isActive: row.authorIsActive,
    },
    body: deleted ? null : row.body,
    createdAt: row.createdAt,
    editedAt: deleted ? null : row.editedAt,
    deleted,
    parentMessageId: row.parentMessageId,
    replyCount: row.replyCount,
    mentions: deleted ? [] : mentions,
  };
}

function cursorFor(row: { id: string }): CursorPayload {
  if (!isUlid(row.id)) throw new Error("メッセージIDが不正です");
  return { v: row.id, id: row.id };
}

export function createMessageRepository(db: Database) {
  const channels = createChannelRepository(db);
  const profiles = createProfileRepository(db);
  const partnerMember = alias(conversationMembers, "partner_member");
  // messages.sender_id は NOT NULL の外部キーなので、INNER JOIN で行は減らない（users は主キーで引く）
  const selectWithAuthor = () =>
    db
      .select(messageColumns)
      .from(messages)
      .innerJoin(users, eq(users.id, messages.senderId));
  const selectReplyWithAuthor = () =>
    db
      .select(replyColumns)
      .from(messages)
      .innerJoin(users, eq(users.id, messages.senderId));
  return {
    // 見てよいかの判定は Service が行う（チャンネルの Repository の読み取りを使う）
    findRoomForViewer: channels.findForViewer,
    async listMentionCandidates(
      options: Parameters<typeof profiles.listDirectory>[0],
    ) {
      const page = await profiles.listDirectory(options);
      return {
        items: page.items.map((item) => ({
          id: item.id,
          displayName: item.displayName,
          departmentName: item.department.name,
        })),
        nextCursor: page.nextCursor,
      };
    },
    activeMentionNames: (userIds: readonly string[]) =>
      activeMentionNames(db, userIds),
    /** 自分が当事者の DM なら、相手が有効かを返す（当事者でない・DM でない部屋は null） */
    async findDirectForParticipant(
      roomId: string,
      userId: string,
    ): Promise<{ partnerIsActive: boolean } | null> {
      const rows = await db
        .select({ partnerIsActive: users.isActive })
        .from(conversationMembers)
        .innerJoin(
          partnerMember,
          and(
            eq(
              partnerMember.conversationId,
              conversationMembers.conversationId,
            ),
            ne(partnerMember.userId, userId),
          ),
        )
        .innerJoin(users, eq(users.id, partnerMember.userId))
        .where(
          and(
            eq(conversationMembers.conversationId, roomId),
            eq(conversationMembers.userId, userId),
          ),
        );
      return rows[0] ?? null;
    },
    /** 編集・削除の前の確認用（部屋と投稿者と削除済みかだけ） */
    async findForModification(messageId: string): Promise<{
      id: string;
      roomId: string;
      senderId: string;
      deletedAt: string | null;
      parentMessageId: string | null;
    } | null> {
      const rows = await db
        .select({
          id: messages.id,
          roomId: messages.roomId,
          senderId: messages.senderId,
          deletedAt: messages.deletedAt,
          parentMessageId: messages.parentMessageId,
        })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      return rows[0] ?? null;
    },
    /**
     * スレッドの親の確認用（#137）。ID で引くだけで、通常の投稿か返信かは parentMessageId で呼び出し側が見る。
     * 見えるか・参加者かは Service が部屋の情報で判定する。
     */
    async findThreadParent(messageId: string): Promise<{
      id: string;
      roomId: string;
      senderId: string;
      deletedAt: string | null;
      parentMessageId: string | null;
    } | null> {
      const rows = await db
        .select({
          id: messages.id,
          roomId: messages.roomId,
          senderId: messages.senderId,
          deletedAt: messages.deletedAt,
          parentMessageId: messages.parentMessageId,
        })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      return rows[0] ?? null;
    },
    /** 1件の項目（スレッドの親の表示用。replyCount を含む） */
    async findItem(messageId: string): Promise<MessageItem | null> {
      const rows = await selectWithAuthor()
        .where(eq(messages.id, messageId))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      const mentions = await loadMessageMentions(db, [row.id]);
      return toItem(row, mentions.get(row.id) ?? []);
    },
    async isDepartmentActive(departmentId: string): Promise<boolean> {
      const rows = await db
        .select({ isActive: departments.isActive })
        .from(departments)
        .where(eq(departments.id, departmentId))
        .limit(1);
      return rows[0]?.isActive ?? false;
    },
    updateBodyIfModifiable: (
      input: Parameters<typeof updateBodyIfModifiable>[1],
    ) => updateBodyIfModifiable(db, input),
    deleteIfModifiable: (input: Parameters<typeof deleteIfModifiable>[1]) =>
      deleteIfModifiable(db, input),
    async findDisplayName(userId: string): Promise<string | null> {
      const row = await db.query.users.findFirst({
        columns: { displayName: true },
        where: (users, { eq: equals }) => equals(users.id, userId),
      });
      return row?.displayName ?? null;
    },
    /** 部屋の最大のID（返信も含む。メッセージがなければ null）。返信を除くと、ID の作り直しが終わらなくなる */
    async maxId(roomId: string): Promise<string | null> {
      const rows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.roomId, roomId))
        .orderBy(desc(messages.id))
        .limit(1);
      return rows[0]?.id ?? null;
    },
    /** 新しい順。nextCursor は古い側の続き */
    async listLatest(roomId: string, limit: number, cursor?: CursorPayload) {
      const rows = await selectWithAuthor()
        .where(
          and(
            eq(messages.roomId, roomId),
            isNull(messages.parentMessageId),
            cursor === undefined
              ? undefined
              : afterCursor(
                  { sort: messages.id, id: messages.id },
                  cursor,
                  "desc",
                ),
          ),
        )
        .orderBy(desc(messages.id))
        .limit(limit + 1);
      const page = toPage(rows, limit, cursorFor);
      const mentions = await loadMessageMentions(
        db,
        page.items.map((row) => row.id),
      );
      return {
        items: page.items.map((row) => toItem(row, mentions.get(row.id) ?? [])),
        nextCursor: page.nextCursor,
      };
    },
    /** ID昇順で after より後（after は含まない） */
    async listAfter(roomId: string, after: string, limit: number) {
      const rows = await selectWithAuthor()
        .where(
          and(
            eq(messages.roomId, roomId),
            isNull(messages.parentMessageId),
            afterId(messages.id, after),
          ),
        )
        .orderBy(asc(messages.id))
        .limit(limit + 1);
      const page = toAfterIdPage(rows, limit);
      const mentions = await loadMessageMentions(
        db,
        page.items.map((row) => row.id),
      );
      return {
        items: page.items.map((row) => toItem(row, mentions.get(row.id) ?? [])),
        hasMore: page.hasMore,
      };
    },
    /** スレッドの返信を新しい順に（#137）。nextCursor は古い側の続き */
    async listRepliesLatest(
      parentMessageId: string,
      limit: number,
      cursor?: CursorPayload,
    ) {
      const rows = await selectReplyWithAuthor()
        .where(
          and(
            eq(messages.parentMessageId, parentMessageId),
            cursor === undefined
              ? undefined
              : afterCursor(
                  { sort: messages.id, id: messages.id },
                  cursor,
                  "desc",
                ),
          ),
        )
        .orderBy(desc(messages.id))
        .limit(limit + 1);
      const page = toPage(rows, limit, cursorFor);
      const mentions = await loadMessageMentions(
        db,
        page.items.map((row) => row.id),
      );
      return {
        items: page.items.map((row) => toItem(row, mentions.get(row.id) ?? [])),
        nextCursor: page.nextCursor,
      };
    },
    /** スレッドの返信を ID 昇順で after より後（after は含まない。#137） */
    async listRepliesAfter(
      parentMessageId: string,
      after: string,
      limit: number,
    ) {
      const rows = await selectReplyWithAuthor()
        .where(
          and(
            eq(messages.parentMessageId, parentMessageId),
            afterId(messages.id, after),
          ),
        )
        .orderBy(asc(messages.id))
        .limit(limit + 1);
      const page = toAfterIdPage(rows, limit);
      const mentions = await loadMessageMentions(
        db,
        page.items.map((row) => row.id),
      );
      return {
        items: page.items.map((row) => toItem(row, mentions.get(row.id) ?? [])),
        hasMore: page.hasMore,
      };
    },
    /**
     * 次のすべてを満たすときだけ1行を挿入し、挿入した行数（1 か 0）を返す。確認から書き込みまでに状態が変わっても条件を破る行を残さない。
     * ① ID が部屋の最大より大きい ② チャンネルが未アーカイブ ③ 投稿者が今も参加者
     * ④ お知らせ専用なら、投稿者がそのチャンネルの部署のオーナーか全体管理者
     * ①のほかは、チャンネルなら②〜④、DM なら「投稿者が当事者で、当事者に無効な社員がいない」（DM の権限 perm.dm.message.send は固定ロールがすべて持つため、ここには入れず Service が確かめる）
     * ※ ④の役割は perm.announcement.post を持つ役割（lib/permissions.ts）と一致させる必要がある。一致は services/message.postable-permission.test.ts が固定している
     */
    async insertIfOrdered(input: MessageInsert): Promise<number> {
      const postable = sql`EXISTS (
        SELECT 1 FROM channels c
        JOIN channel_members m ON m.channel_id = c.room_id AND m.user_id = ${input.senderId}
        WHERE c.room_id = ${input.roomId} AND c.deleted_at IS NULL
          AND (c.purpose <> 'announcement'
            OR EXISTS (SELECT 1 FROM user_role_assignments a WHERE a.user_id = ${input.senderId} AND a.role_id = ${ROLE_IDS.owner} AND a.department_id = c.department_id)
            OR EXISTS (SELECT 1 FROM user_role_assignments a WHERE a.user_id = ${input.senderId} AND a.role_id = ${ROLE_IDS.globalAdmin})))`;
      const directPostable = sql`(
        EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = ${input.roomId} AND user_id = ${input.senderId})
        AND NOT EXISTS (SELECT 1 FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ${input.roomId} AND u.is_active = 0))`;
      // 末尾の NULL は edited_at・deleted_at・deleted_by・parent_message_id（Drizzle は挿入先に全列を並べるため、列数と順を合わせる）
      try {
        const [insert] = await db.batch([
          db.insert(messages).select(sql`
            SELECT ${input.id}, ${input.roomId}, ${input.senderId}, ${input.senderDisplayName}, ${input.body},
              ${input.createdAt ?? sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`},
              NULL, NULL, NULL, NULL
            WHERE NOT EXISTS (SELECT 1 FROM messages WHERE room_id = ${input.roomId} AND id >= ${input.id})
              AND (${postable} OR ${directPostable})`),
          guardInsertedMessage(db, input.roomId),
          insertMessageMentions(db, {
            messageId: input.id,
            roomId: input.roomId,
            mentions: input.mentions ?? [],
          }),
          insertMentionNotifications(db, {
            messageId: input.id,
            roomId: input.roomId,
            senderId: input.senderId,
            mentions: input.mentions ?? [],
          }),
        ]);
        return insert.meta.changes;
      } catch (error) {
        const translated = translateMessageInsertError(error);
        if (translated instanceof MessageInsertGuardError) return 0;
        throw translated;
      }
    },
    /** 返信の条件付きの INSERT（条件は reply-insert.sql.ts）。挿入した行数（1 か 0）を返す */
    insertReplyIfOrdered: (input: Parameters<typeof insertReplyIfOrdered>[1]) =>
      insertReplyIfOrdered(db, input),
  };
}

export type MessageRepository = ReturnType<typeof createMessageRepository>;

/** Repository を使う間だけ DB につなぐ */
export function withMessages<T>(
  env: Env,
  run: (repository: MessageRepository) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) => run(createMessageRepository(db)));
}
