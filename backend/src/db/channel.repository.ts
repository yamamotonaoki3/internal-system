// Repository：チャンネルの一覧・詳細・参加（DB へのアクセスはこの層に閉じ込める）。
// 参加の行と、参加の監査ログは、同じ db.batch で確定する（片方が失敗したら、どちらも残さない）。
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { channelMembers, channels, departments, users } from "../../db/schema";
import type { ChannelVisibility } from "../lib/channel-rules";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { isUlid } from "../lib/ulid";
import type { ChannelPurpose } from "../../../shared/message-rules";
import { auditLogInsert } from "./audit-log.repository";
import { withDatabase, type Database } from "./database";

export type ChannelListOptions = {
  limit: number;
  cursor?: CursorPayload;
  departmentId?: string;
  joined?: boolean;
};

export type ChannelListItem = {
  id: string;
  roomId: string;
  name: string;
  visibility: ChannelVisibility;
  departmentId: string | null;
  /** 会社直属（全社連絡など）は null */
  departmentName: string | null;
  joined: boolean;
};

export type ChannelDetailRow = {
  roomId: string;
  name: string;
  description: string;
  visibility: ChannelVisibility;
  departmentId: string | null;
  deletedAt: string | null;
  /** 閲覧者の参加の日時（未参加は null） */
  joinedAt: string | null;
};

/** 閲覧者から見たチャンネル。メッセージの投稿の判定が purpose を使う */
export type ChannelViewRow = ChannelDetailRow & {
  purpose: ChannelPurpose;
  /** チャンネルの部署が有効か。部署のない会社直属のチャンネルは true */
  departmentIsActive: boolean;
};

export type ChannelMember = { id: string; displayName: string };

export type ChannelJoinInput = {
  roomId: string;
  userId: string;
  traceId: string;
};

function cursorFor(row: { roomId: string; nameNormalized: string }) {
  if (!isUlid(row.roomId)) throw new Error("チャンネルIDが不正です");
  return { v: row.nameNormalized, id: row.roomId };
}

export function createChannelRepository(db: Database) {
  return {
    async departmentExists(id: string): Promise<boolean> {
      const rows = await db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.id, id))
        .limit(1);
      return rows.length > 0;
    },
    // 閲覧者が見てよいもの：アーカイブされていない、公開または参加中の非公開
    async list(viewerId: string, options: ChannelListOptions) {
      const joinedFilter =
        options.joined === undefined
          ? undefined
          : options.joined
            ? isNotNull(channelMembers.userId)
            : isNull(channelMembers.userId);
      const rows = await db
        .select({
          roomId: channels.roomId,
          name: channels.name,
          nameNormalized: channels.nameNormalized,
          visibility: channels.visibility,
          departmentId: channels.departmentId,
          departmentName: departments.name,
          joined: sql<boolean>`${channelMembers.userId} IS NOT NULL`.mapWith(
            Boolean,
          ),
        })
        .from(channels)
        .leftJoin(departments, eq(departments.id, channels.departmentId))
        .leftJoin(
          channelMembers,
          and(
            eq(channelMembers.channelId, channels.roomId),
            eq(channelMembers.userId, viewerId),
          ),
        )
        .where(
          and(
            isNull(channels.deletedAt),
            or(
              eq(channels.visibility, "public"),
              isNotNull(channelMembers.userId),
            ),
            options.departmentId === undefined
              ? undefined
              : eq(channels.departmentId, options.departmentId),
            joinedFilter,
            options.cursor === undefined
              ? undefined
              : afterCursor(
                  { sort: channels.nameNormalized, id: channels.roomId },
                  options.cursor,
                  "asc",
                ),
          ),
        )
        .orderBy(asc(channels.nameNormalized), asc(channels.roomId))
        .limit(options.limit + 1);
      const page = toPage(rows, options.limit, cursorFor);
      const items: ChannelListItem[] = page.items.map((row) => ({
        id: row.roomId,
        roomId: row.roomId,
        name: row.name,
        visibility: row.visibility,
        departmentId: row.departmentId,
        departmentName: row.departmentName,
        joined: row.joined,
      }));
      return { items, nextCursor: page.nextCursor };
    },
    // アーカイブ済みも返す（見てよいかの判定は Service が channel-rules で行う）
    async findForViewer(
      roomId: string,
      viewerId: string,
    ): Promise<ChannelViewRow | null> {
      const rows = await db
        .select({
          roomId: channels.roomId,
          name: channels.name,
          description: channels.description,
          visibility: channels.visibility,
          departmentId: channels.departmentId,
          purpose: channels.purpose,
          deletedAt: channels.deletedAt,
          joinedAt: channelMembers.joinedAt,
          // 会社直属のチャンネルを落とさないよう、部署は外部結合で読む
          departmentIsActive:
            sql<boolean>`${departments.id} IS NULL OR ${departments.isActive} = 1`.mapWith(
              Boolean,
            ),
        })
        .from(channels)
        .leftJoin(departments, eq(departments.id, channels.departmentId))
        .leftJoin(
          channelMembers,
          and(
            eq(channelMembers.channelId, channels.roomId),
            eq(channelMembers.userId, viewerId),
          ),
        )
        .where(eq(channels.roomId, roomId))
        .limit(1);
      return rows[0] ?? null;
    },
    // 参加者は有効な社員だけ。無効にした社員は、参加者の表示にも数にも含めない
    async countMembers(roomId: string): Promise<number> {
      const rows = await db
        .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
        .from(channelMembers)
        .innerJoin(users, eq(users.id, channelMembers.userId))
        .where(
          and(eq(channelMembers.channelId, roomId), eq(users.isActive, true)),
        );
      return rows[0]?.n ?? 0;
    },
    async listMembers(roomId: string, limit: number): Promise<ChannelMember[]> {
      return db
        .select({ id: users.id, displayName: users.displayName })
        .from(channelMembers)
        .innerJoin(users, eq(users.id, channelMembers.userId))
        .where(
          and(eq(channelMembers.channelId, roomId), eq(users.isActive, true)),
        )
        .orderBy(asc(users.id))
        .limit(limit);
    },
    // 監査ログは参加の行がまだないときだけ書く。参加の挿入より前に置く（後ろだと、挿入済みで常に条件が偽になる）
    // 確認から書き込みまでの間にアーカイブ・非公開化された場合に備え、どちらも「今も公開で未アーカイブ」を条件にする。
    // 参加の行が作られず既存の行もないときは null を返す（呼び出し側が 404 にする）
    async join(input: ChannelJoinInput): Promise<string | null> {
      const joinable = sql`EXISTS (SELECT 1 FROM channels WHERE room_id = ${input.roomId} AND deleted_at IS NULL AND visibility = 'public')`;
      await db.batch([
        auditLogInsert(
          db,
          {
            actorId: input.userId,
            action: "channel.join",
            targetType: "channel",
            targetId: input.roomId,
            result: "success",
            traceId: input.traceId,
          },
          {
            onlyWhen: sql`${joinable} AND NOT EXISTS (SELECT 1 FROM channel_members WHERE channel_id = ${input.roomId} AND user_id = ${input.userId})`,
          },
        ),
        db.insert(channelMembers).select(sql`
          SELECT ${input.roomId}, ${input.userId}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE ${joinable} AND NOT EXISTS (SELECT 1 FROM channel_members WHERE channel_id = ${input.roomId} AND user_id = ${input.userId})`),
      ]);
      const rows = await db
        .select({ joinedAt: channelMembers.joinedAt })
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.channelId, input.roomId),
            eq(channelMembers.userId, input.userId),
          ),
        )
        .limit(1);
      return rows[0]?.joinedAt ?? null;
    },
  };
}

export type ChannelRepository = ReturnType<typeof createChannelRepository>;

/** Repository を使う間だけ DB につなぐ */
export function withChannels<T>(
  env: Env,
  run: (repository: ChannelRepository) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) => run(createChannelRepository(db)));
}
