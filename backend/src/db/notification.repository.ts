// Repository：通知（#124）。DB へのアクセスはこの層に閉じ込める。
// 作成（notificationInserts）は文を返すだけで実行しない：業務の db.batch([...]) に入れて、業務の更新と同時に確定・失敗させる。
// 読み取り・既読はすべて「本人宛て」の条件を通す（visibleToRecipient）。他人宛てを取る関数は作らない（R-57）。
// 通知の作成・既読は監査ログに残さない（既定の方針 4）。
import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { notifications } from "../../db/schema";
import {
  NOTIFICATION_KIND_DEFINITIONS,
  roomContentKinds,
  type NotificationKind,
  type NotificationKindDefinitions,
} from "../../../shared/notification-kinds";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { isUlid, newUlid } from "../lib/ulid";
import { withDatabase, type Database } from "./database";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";

/** 未読数の上限。これを超える分は数えない（画面は「99+」と表示する） */
const UNREAD_COUNT_LIMIT = 100;

export type NotificationInput<K extends string = NotificationKind> = {
  // NoInfer：型引数を省くと既定値（NotificationKind）になり、定義にない種類は型エラーになる
  kind: NoInfer<K>;
  roomId?: string | null;
  messageId?: string | null;
  targetId?: string | null;
};

export type NotificationItem = {
  id: string;
  kind: string;
  roomId: string | null;
  messageId: string | null;
  targetId: string | null;
  createdAt: string;
  readAt: string | null;
};

/**
 * 宛先ごとに 1 件ずつ通知を作る文を返す（実行しない）。宛先の重複は 1 件にまとめ、0 人なら空配列。
 * 「操作した本人を除く」などの宛先の絞り込みは、呼び出し側の責務（渡された宛先にだけ作る）。
 * kind の型引数の既定値は定義元の種類：本番のコードは、定義にない種類を渡せない。
 */
export function notificationInserts<K extends string = NotificationKind>(
  db: Pick<DrizzleD1Database<Record<string, never>>, "insert">,
  recipientIds: readonly string[],
  input: NotificationInput<K>,
) {
  return [...new Set(recipientIds)].map((userId) =>
    db.insert(notifications).values({
      id: newUlid(),
      userId,
      kind: input.kind,
      roomId: input.roomId ?? null,
      messageId: input.messageId ?? null,
      targetId: input.targetId ?? null,
    }),
  );
}

/**
 * 閲覧できる部屋の条件（部屋の内容を含む通知を、閲覧権限を失った部屋の分だけ除くため。3-1 AC-3）。
 * 未アーカイブで（公開、または自分が参加中）のチャンネル、または自分が当事者の DM。存在しない部屋は見えない。
 * channel-rules の canViewChannel と同じ規則を SQL で書いたもの（二重定義）。全組の一致は notification.room-visibility.db.test.ts で固定している。
 */
function viewableRoom(recipientId: string): SQL {
  return sql`(exists (
    select 1 from channels c
    where c.room_id = ${notifications.roomId}
      and c.deleted_at is null
      and (c.visibility = 'public' or exists (
        select 1 from channel_members cm where cm.channel_id = c.room_id and cm.user_id = ${recipientId})))
    or exists (
      select 1 from conversation_members conv
      where conv.conversation_id = ${notifications.roomId} and conv.user_id = ${recipientId}))`;
}

/**
 * 本人が一覧・未読数・1件既読・すべて既読で扱ってよい通知の条件。四つが同じ条件を通る。
 * 部屋の内容を含む種類（containsRoomContent が true）にだけ部屋の条件（部屋の ID を持ち、その部屋を閲覧できること）を当てる。
 * 含む種類がなければ部屋の条件を付けない（空の IN を作らない。今の本番の定義はこの場合）。
 * 部屋の内容を含まない種類（アーカイブ・復元など、権限を失っても残したい通知）は、部屋の閲覧権限に影響されない。
 * 見られる範囲が別の規則の部屋を足すときは、viewableRoom と未読の対象の部屋（unread-targets.sql.ts）の両方を広げる。
 */
export function visibleToRecipient(
  recipientId: string,
  definitions: NotificationKindDefinitions = NOTIFICATION_KIND_DEFINITIONS,
): SQL {
  const own = eq(notifications.userId, recipientId);
  const roomKinds = roomContentKinds(definitions);
  if (roomKinds.length === 0) return own;
  return sql`(${own} and ${or(notInArray(notifications.kind, roomKinds), and(isNotNull(notifications.roomId), viewableRoom(recipientId)))})`;
}

export function createNotificationRepository(
  db: Database,
  deps: { definitions?: NotificationKindDefinitions } = {},
) {
  const definitions = deps.definitions ?? NOTIFICATION_KIND_DEFINITIONS;

  return {
    /** 本人宛ての通知を、新しい順（作成日時・ID の降順）に読む */
    async listForRecipient(
      recipientId: string,
      options: { limit: number; cursor?: CursorPayload },
    ) {
      const conditions: SQL[] = [visibleToRecipient(recipientId, definitions)];
      if (options.cursor !== undefined)
        conditions.push(
          afterCursor(
            { sort: notifications.createdAt, id: notifications.id },
            options.cursor,
            "desc",
          ),
        );
      const rows = await db
        .select({
          id: notifications.id,
          kind: notifications.kind,
          roomId: notifications.roomId,
          messageId: notifications.messageId,
          targetId: notifications.targetId,
          createdAt: notifications.createdAt,
          readAt: notifications.readAt,
        })
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(options.limit + 1);
      return toPage<NotificationItem>(rows, options.limit, (row) => {
        if (!isUlid(row.id)) throw new Error("通知IDが不正です");
        return { v: row.createdAt, id: row.id };
      });
    },

    /** 本人の未読数。UNREAD_COUNT_LIMIT で打ち切る */
    async countUnread(recipientId: string): Promise<number> {
      const rows = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            visibleToRecipient(recipientId, definitions),
            isNull(notifications.readAt),
          ),
        )
        .limit(UNREAD_COUNT_LIMIT);
      return rows.length;
    },

    /**
     * 本人宛ての通知を既読にし、本人宛てとして存在したかを返す。既読済みは read_at を変えず true。
     * 他人宛て・存在しない ID は何も変えず false（呼び出し側が 404 にして、存在を漏らさない）。
     */
    async markRead(
      recipientId: string,
      notificationId: string,
      nowIso: string,
    ): Promise<boolean> {
      const result = await db
        .update(notifications)
        .set({ readAt: sql`coalesce(${notifications.readAt}, ${nowIso})` })
        .where(
          and(
            eq(notifications.id, notificationId),
            visibleToRecipient(recipientId, definitions),
          ),
        )
        .run();
      return result.meta.changes > 0;
    },

    /** 本人の未読を既読にして、その件数を返す。既読の read_at は変えない */
    async markAllRead(recipientId: string, nowIso: string): Promise<number> {
      const result = await db
        .update(notifications)
        .set({ readAt: nowIso })
        .where(
          and(
            visibleToRecipient(recipientId, definitions),
            isNull(notifications.readAt),
          ),
        )
        .run();
      return result.meta.changes;
    },
  };
}

export type NotificationRepository = ReturnType<
  typeof createNotificationRepository
>;

export function withNotifications<T>(
  env: Env,
  run: (
    repository: NotificationRepository,
    roles: RoleAssignmentRepository,
  ) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(createNotificationRepository(db), createRoleAssignmentRepository(db)),
  );
}
