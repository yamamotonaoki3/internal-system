// Repository：チャンネルの一覧・詳細・参加（DB へのアクセスはこの層に閉じ込める）。
// 参加の行と、参加の監査ログは、同じ db.batch で確定する（片方が失敗したら、どちらも残さない）。
import { and, asc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { channelMembers, channels, departments, users } from "../../db/schema";
import { channelNameKey } from "../../../shared/department-rules";
import type { ChannelVisibility } from "../lib/channel-rules";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { isUlid } from "../lib/ulid";
import type { ChannelPurpose } from "../../../shared/message-rules";
import { auditLogInsert } from "./audit-log.repository";
import {
  channelInviteStatements,
  type ChannelInviteInput,
} from "./channel-invite.sql";
import {
  channelArchiveStatements,
  channelRestoreStatements,
  channelUpdateStatements,
  type ChannelArchiveInput,
  type ChannelRestoreInput,
  type ChannelUpdateInput,
} from "./channel-manage.sql";
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
  /** 管理の操作（#143）が送る版 */
  version: number;
  /** チャンネルの部署が有効か。部署のない会社直属のチャンネルは true */
  departmentIsActive: boolean;
};

export type ChannelMember = { id: string; displayName: string };

/** 招待の相手の状態（#135） */
export type ChannelInvitee = { isActive: boolean; joined: boolean };

export type ChannelJoinInput = {
  roomId: string;
  userId: string;
  traceId: string;
};

/** 管理の判定に使うチャンネルの行（#143）。メッセージの中身は持たない */
export type ChannelManageRow = {
  roomId: string;
  name: string;
  description: string;
  visibility: ChannelVisibility;
  departmentId: string | null;
  purpose: ChannelPurpose;
  deletedAt: string | null;
  version: number;
  /** 操作者が参加しているか */
  isMember: boolean;
  /** 開いている（復元していない）最新のアーカイブの記録の ID */
  openArchiveEventId: string | null;
};

export type ChannelUpdated = {
  id: string;
  name: string;
  description: string;
  version: number;
  updatedAt: string;
};

export type ChannelArchived = {
  id: string;
  version: number;
  deletedAt: string;
};

export type ChannelRestored = {
  id: string;
  version: number;
  restoredAt: string;
};

/** 管理の前提の確認（channel-manage.sql.ts）が崩れて、batch 全体が取り消されたときに投げる。何も残らない */
export class ChannelManageConflictError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      "チャンネルの状態が変わったため、操作を実行できませんでした",
      options,
    );
    this.name = "ChannelManageConflictError";
  }
}

/** 名前の変更が、ほかのチャンネル（アーカイブ済みを含む）の名前と重なったときに投げる。何も残らない */
export class ChannelNameTakenError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("同じ名前のチャンネルがあります", options);
    this.name = "ChannelNameTakenError";
  }
}

/** 前提の確認の失敗・名前の一意索引の違反だけを専用エラーにし、それ以外（未知のDBエラー）は変えずに返す */
function translateManageError(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (/NOT NULL constraint failed: channels.version/i.test(current.message))
      return new ChannelManageConflictError({ cause: error });
    if (
      /UNIQUE constraint failed: channels.name_normalized/i.test(
        current.message,
      )
    )
      return new ChannelNameTakenError({ cause: error });
    current = current.cause;
  }
  return error;
}

/** batch の最後の文（チャンネルの UPDATE … RETURNING）の結果。通知の文の数は宛先の数で変わるため、最後の位置で取る */
function lastReturned<T>(results: readonly (T[] | D1Result)[]): T[] {
  const last = results[results.length - 1];
  if (!Array.isArray(last))
    throw new Error("チャンネルの更新の結果を読み取れません");
  return last;
}

async function runManageBatch<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw translateManageError(error);
  }
}

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
    // 閲覧者が見てよいもの：アーカイブされていない、公開または参加中の非公開。
    // 案件専用チャンネルは参加者にも一覧に出さない（案件の画面から開く。#146 5-1 AC-6）
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
            ne(channels.purpose, "case"),
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
          version: channels.version,
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
    // 招待の相手（#135）。社員が存在しなければ null。無効な社員の参加の行が残っている場合も joined を返す
    async findInvitee(
      roomId: string,
      userId: string,
    ): Promise<ChannelInvitee | null> {
      const rows = await db
        .select({
          isActive: users.isActive,
          joined: sql<boolean>`${channelMembers.userId} IS NOT NULL`.mapWith(
            Boolean,
          ),
        })
        .from(users)
        .leftJoin(
          channelMembers,
          and(
            eq(channelMembers.channelId, roomId),
            eq(channelMembers.userId, users.id),
          ),
        )
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0] ?? null;
    },
    async isUserActive(userId: string): Promise<boolean> {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.isActive, true)))
        .limit(1);
      return rows.length > 0;
    },
    // 管理の判定に使う行（#143）。アーカイブ済み・参加していない非公開も返す（見てよいか・管理できるかは Service が判定する）
    async findForManage(
      roomId: string,
      actorId: string,
    ): Promise<ChannelManageRow | null> {
      const rows = await db
        .select({
          roomId: channels.roomId,
          name: channels.name,
          description: channels.description,
          visibility: channels.visibility,
          departmentId: channels.departmentId,
          purpose: channels.purpose,
          deletedAt: channels.deletedAt,
          version: channels.version,
          isMember: sql<boolean>`${channelMembers.userId} IS NOT NULL`.mapWith(
            Boolean,
          ),
          openArchiveEventId: sql<
            string | null
          >`(SELECT e.id FROM channel_archive_events e
            WHERE e.channel_id = ${channels.roomId} AND e.restored_at IS NULL
            ORDER BY e.archived_at DESC, e.id DESC LIMIT 1)`,
        })
        .from(channels)
        .leftJoin(
          channelMembers,
          and(
            eq(channelMembers.channelId, channels.roomId),
            eq(channelMembers.userId, actorId),
          ),
        )
        .where(eq(channels.roomId, roomId))
        .limit(1);
      return rows[0] ?? null;
    },
    // アーカイブ・復元の通知の宛先：有効な参加者で、操作した本人以外（D-5）。ID の昇順
    async listNotifyRecipients(
      roomId: string,
      actorId: string,
    ): Promise<string[]> {
      const rows = await db
        .select({ id: users.id })
        .from(channelMembers)
        .innerJoin(users, eq(users.id, channelMembers.userId))
        .where(
          and(
            eq(channelMembers.channelId, roomId),
            eq(users.isActive, true),
            ne(users.id, actorId),
          ),
        )
        .orderBy(asc(users.id));
      return rows.map((row) => row.id);
    },
    // 名前・説明の変更。行がなければ null。前提が崩れたら ChannelManageConflictError、名前の重複は ChannelNameTakenError
    async update(input: ChannelUpdateInput): Promise<ChannelUpdated | null> {
      const now = new Date().toISOString();
      const statements = channelUpdateStatements(db, {
        ...input,
        ...(input.name === undefined
          ? {}
          : { nameKey: channelNameKey(input.name) }),
        now,
      });
      const [, , updated] = await runManageBatch(() => db.batch(statements));
      return updated[0] ?? null;
    },
    // アーカイブ。業務の更新・記録・監査・通知を同じ batch で確定する。行がなければ null
    async archive(input: ChannelArchiveInput): Promise<ChannelArchived | null> {
      const now = new Date().toISOString();
      const results = await runManageBatch(() =>
        db.batch(channelArchiveStatements(db, { ...input, now })),
      );
      const row = lastReturned(results)[0];
      return row === undefined ? null : { ...row, deletedAt: now };
    },
    // 復元。開いている記録を閉じ、業務の更新・監査・通知を同じ batch で確定する。行がなければ null
    async restore(input: ChannelRestoreInput): Promise<ChannelRestored | null> {
      const now = new Date().toISOString();
      const results = await runManageBatch(() =>
        db.batch(channelRestoreStatements(db, { ...input, now })),
      );
      const row = lastReturned(results)[0];
      return row === undefined ? null : { ...row, restoredAt: now };
    },
    // 監査・通知・参加を同じ batch で確定する。条件が成り立たず参加の行を作らなかったときは null（既存の参加の行があっても null）
    async invite(input: ChannelInviteInput): Promise<string | null> {
      const [, , inserted] = await db.batch(channelInviteStatements(db, input));
      return inserted[0]?.joinedAt ?? null;
    },
    // 監査ログは参加の行がまだないときだけ書く。参加の挿入より前に置く（後ろだと、挿入済みで常に条件が偽になる）
    // 確認から書き込みまでの間にアーカイブ・非公開化された場合に備え、どちらも「今も公開で未アーカイブ」を条件にする。
    // 参加の行が作られず既存の行もないときは null を返す（呼び出し側が 404 にする）
    async join(input: ChannelJoinInput): Promise<string | null> {
      // 本人が有効であることも条件にする（無効化と同時の参加で、無効な社員の参加の行を作らない）
      const joinable = sql`EXISTS (SELECT 1 FROM channels WHERE room_id = ${input.roomId} AND deleted_at IS NULL AND visibility = 'public') AND EXISTS (SELECT 1 FROM users WHERE id = ${input.userId} AND is_active = 1)`;
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
