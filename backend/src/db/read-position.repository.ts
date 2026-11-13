// Repository：既読位置と未読数（#237。ADR-0006）。DB へのアクセスはこの層に閉じ込める。
// 未読数は、既読位置（なければ参加の時刻）より後のメッセージを上限つきで数え直す。カウンター・rooms.last_message_id は持たない。
// 1回の取得は SQL 2本（対象の部屋 → 部屋ごとの数）で、部屋の数に比例しない。
import { and, eq } from "drizzle-orm";
import { messages } from "../../db/schema";
import { toPage, type CursorPayload } from "../lib/cursor";
import { isUlid } from "../lib/ulid";
import { unreadLowerBound } from "../lib/unread-bound";
import { withDatabase, type Database } from "./database";
import { advanceReadPosition } from "./read-position-advance.sql";
import { listUnreadCountRows } from "./unread-counts.sql";
import { listUnreadTargetRows } from "./unread-targets.sql";

export type UnreadRoom = { roomId: string; count: number };

export function createReadPositionRepository(db: Database) {
  return {
    /**
     * 自分の対象の部屋（参加中・未アーカイブのチャンネルと当事者の DM）を room_id の昇順で limit 件調べ、未読のある部屋だけを返す。
     * カーソルは「調べた対象の部屋」の最後の room_id。items は limit より少なく、空でも nextCursor がありうる。
     * 2本の SQL の間に参加が変わると、その1回だけ古い対象で数える（次の取得で直る）。
     */
    async listUnread(
      userId: string,
      options: { limit: number; cursor?: CursorPayload },
    ): Promise<{ items: UnreadRoom[]; nextCursor: string | null }> {
      const rows = await listUnreadTargetRows(db, userId, {
        limit: options.limit + 1,
        ...(options.cursor === undefined
          ? {}
          : { cursorRoomId: options.cursor.id }),
      });
      const targets = toPage(rows, options.limit, (row) => {
        if (!isUlid(row.room_id)) throw new Error("部屋IDが不正です");
        return { v: row.room_id, id: row.room_id };
      });
      const items = await listUnreadCountRows(
        db,
        userId,
        targets.items.map((row) => ({
          roomId: row.room_id,
          lower: unreadLowerBound({
            lastReadMessageId: row.last_read_message_id,
            joinedAt: row.joined_at,
          }),
        })),
      );
      return { items, nextCursor: targets.nextCursor };
    },

    /** 既読位置を前に進めた行数（1 か 0）。0 の理由の読み分けは Service */
    advance(input: {
      userId: string;
      roomId: string;
      messageId: string;
      now: string;
    }): Promise<number> {
      return advanceReadPosition(db, input);
    },

    async messageExistsInRoom(
      roomId: string,
      messageId: string,
    ): Promise<boolean> {
      const rows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.roomId, roomId)))
        .limit(1);
      return rows.length > 0;
    },
  };
}

export type ReadPositionRepository = ReturnType<
  typeof createReadPositionRepository
>;

export function withReadPositions<T>(
  env: Env,
  run: (repository: ReadPositionRepository) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) => run(createReadPositionRepository(db)));
}
