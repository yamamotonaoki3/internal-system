// Repository：S-39（チャンネル管理）・S-38（アーカイブ）の読み取り（#143-b。EP-2-42・EP-2-43・EP-2-40）。
// 見える範囲は取得の後に取り除かず、SQL の WHERE に入れる（channelManagerSql：その時点の操作者の有効性と割り当て）。
// 値の数は、行・部署・参加者の数によらず一定（操作者の ID・ロールの ID・検索語・カーソル・件数）。D1 の1文あたりの上限に当たらない。
// 名前の検索は LIKE・GLOB を使わず instr で部分一致（D1 の LIKE はパターンの長さに上限がある。profile.repository.ts と同じ理由）。
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { formatChannelName } from "../../../shared/channel-name-rules";
import { channelNameKey } from "../../../shared/department-rules";
import { toPage, type CursorPayload } from "../lib/cursor";
import { isUlid } from "../lib/ulid";
import { channelManagerSql } from "./channel-manage.sql";
import { withDatabase, type Database } from "./database";

export const ADMIN_CHANNEL_ROW_PURPOSES = [
  "normal",
  "department",
  "announcement",
  "company_general",
] as const;

export type AdminChannelState = "all" | "active" | "archived";

const rowSchema = z.object({
  room_id: z.string(),
  name: z.string(),
  description: z.string(),
  purpose: z.enum(ADMIN_CHANNEL_ROW_PURPOSES),
  visibility: z.enum(["public", "private"]),
  department_id: z.string().nullable(),
  department_name: z.string().nullable(),
  department_is_active: z.union([z.literal(0), z.literal(1)]).nullable(),
  name_normalized: z.string(),
  version: z.number(),
  member_count: z.number(),
  deleted_at: z.string().nullable(),
  deleted_by: z.string().nullable(),
  deleted_by_name: z.string().nullable(),
  archive_reason: z.string().nullable(),
});

type RawRow = z.infer<typeof rowSchema>;

export type AdminChannelRow = {
  roomId: string;
  name: string;
  description: string;
  purpose: (typeof ADMIN_CHANNEL_ROW_PURPOSES)[number];
  visibility: "public" | "private";
  departmentId: string | null;
  departmentName: string | null;
  departmentIsActive: boolean | null;
  version: number;
  /** 有効な社員の参加者の数 */
  memberCount: number;
  deletedAt: string | null;
  deletedBy: string | null;
  deletedByName: string | null;
  /** 開いているアーカイブの記録の理由 */
  archiveReason: string | null;
};

function toRow(raw: RawRow): AdminChannelRow {
  return {
    roomId: raw.room_id,
    name: raw.name,
    description: raw.description,
    purpose: raw.purpose,
    visibility: raw.visibility,
    departmentId: raw.department_id,
    departmentName: raw.department_name,
    departmentIsActive:
      raw.department_is_active === null ? null : raw.department_is_active === 1,
    version: raw.version,
    memberCount: raw.member_count,
    deletedAt: raw.deleted_at,
    deletedBy: raw.deleted_by,
    deletedByName: raw.deleted_by_name,
    archiveReason: raw.archive_reason,
  };
}

function cursorOf(id: string, v: string | null): CursorPayload {
  if (!isUlid(id) || v === null) throw new Error("チャンネルの行が不正です");
  return { v, id };
}

/** 名前の部分一致：変換前の検索語と、全角英数字を半角にした検索語のどちらか（保存の側は name_normalized = channelNameKey(name)） */
function nameMatches(q: string): SQL {
  const raw = channelNameKey(q);
  const formatted = channelNameKey(formatChannelName(q));
  if (raw === formatted) return sql`instr(c.name_normalized, ${raw}) > 0`;
  return sql`(instr(c.name_normalized, ${raw}) > 0 OR instr(c.name_normalized, ${formatted}) > 0)`;
}

function stateMatches(state: AdminChannelState): SQL {
  if (state === "active") return sql`c.deleted_at IS NULL`;
  if (state === "archived") return sql`c.deleted_at IS NOT NULL`;
  return sql`1 = 1`;
}

export function createChannelAdminRepository(db: Database) {
  /** 操作者が管理できる、案件専用以外のチャンネル（別名 c）の行を読む。条件と並びは呼び出し側が渡す */
  async function select(
    actorId: string,
    conditions: SQL[],
    tail: SQL,
  ): Promise<RawRow[]> {
    // JOIN で同じ列名（name・is_active）が重なるため、すべて別名を付ける
    const rows = await db.all(sql`
      SELECT c.room_id AS room_id, c.name AS name, c.description AS description, c.purpose AS purpose,
        c.visibility AS visibility, c.department_id AS department_id,
        d.name AS department_name, d.is_active AS department_is_active,
        c.name_normalized AS name_normalized, c.version AS version,
        (SELECT COUNT(*) FROM channel_members m JOIN users mu ON mu.id = m.user_id
          WHERE m.channel_id = c.room_id AND mu.is_active = 1) AS member_count,
        c.deleted_at AS deleted_at, c.deleted_by AS deleted_by, du.display_name AS deleted_by_name,
        (SELECT e.reason FROM channel_archive_events e
          WHERE e.channel_id = c.room_id AND e.restored_at IS NULL
          ORDER BY e.archived_at DESC, e.id DESC LIMIT 1) AS archive_reason
      FROM channels c
      LEFT JOIN departments d ON d.id = c.department_id
      LEFT JOIN users du ON du.id = c.deleted_by
      WHERE c.purpose <> 'case' AND ${channelManagerSql(actorId)}
        ${sql.join(
          conditions.map((condition) => sql` AND ${condition}`),
          sql``,
        )}
      ${tail}`);
    // 生 SQL の結果は型が付かない。想定と違う行は、ここで見つける
    return z.array(rowSchema).parse(rows);
  }

  return {
    /** S-39 の一覧：名前の比較キーの昇順。状態・名前の検索・カーソルは範囲の条件と AND で組む */
    async listManageable(
      actorId: string,
      options: {
        q?: string;
        state: AdminChannelState;
        limit: number;
        cursor?: CursorPayload;
      },
    ): Promise<{ items: AdminChannelRow[]; nextCursor: string | null }> {
      const conditions = [stateMatches(options.state)];
      if (options.q !== undefined) conditions.push(nameMatches(options.q));
      if (options.cursor !== undefined) {
        const v = String(options.cursor.v);
        conditions.push(
          sql`(c.name_normalized > ${v} OR (c.name_normalized = ${v} AND c.room_id > ${options.cursor.id}))`,
        );
      }
      const rows = await select(
        actorId,
        conditions,
        sql`ORDER BY c.name_normalized, c.room_id LIMIT ${options.limit + 1}`,
      );
      const page = toPage(rows, options.limit, (row) =>
        cursorOf(row.room_id, row.name_normalized),
      );
      return { items: page.items.map(toRow), nextCursor: page.nextCursor };
    },

    /** S-39 の1件。範囲外・存在しない・案件専用は null */
    async findManageable(
      actorId: string,
      roomId: string,
    ): Promise<AdminChannelRow | null> {
      const rows = await select(
        actorId,
        [sql`c.room_id = ${roomId}`],
        sql`LIMIT 1`,
      );
      const row = rows[0];
      return row === undefined ? null : toRow(row);
    },

    /** S-38 のアーカイブしたチャンネル：アーカイブした日時の新しい順（同じなら room_id の降順） */
    async listArchived(
      actorId: string,
      options: { limit: number; cursor?: CursorPayload },
    ): Promise<{ items: AdminChannelRow[]; nextCursor: string | null }> {
      const conditions = [sql`c.deleted_at IS NOT NULL`];
      if (options.cursor !== undefined) {
        const v = String(options.cursor.v);
        conditions.push(
          sql`(c.deleted_at < ${v} OR (c.deleted_at = ${v} AND c.room_id < ${options.cursor.id}))`,
        );
      }
      const rows = await select(
        actorId,
        conditions,
        sql`ORDER BY c.deleted_at DESC, c.room_id DESC LIMIT ${options.limit + 1}`,
      );
      const page = toPage(rows, options.limit, (row) =>
        cursorOf(row.room_id, row.deleted_at),
      );
      return { items: page.items.map(toRow), nextCursor: page.nextCursor };
    },
  };
}

export type ChannelAdminRepository = ReturnType<
  typeof createChannelAdminRepository
>;

export function withChannelAdmin<T>(
  env: Env,
  run: (repository: ChannelAdminRepository) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) => run(createChannelAdminRepository(db)));
}
