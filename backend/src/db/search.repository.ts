// Repository：メッセージの検索（#155・EP-4-01・C-152）。DB へのアクセスはこの層に閉じ込める。
// 一致：語が3文字（コードポイント）以上なら search_fts の MATCH（語全体を1つの句にしてバインド）、未満なら instr（ADR-0010・D-3）。
// 見える範囲：閲覧者がいま見てよい部屋（roomViewableBy）・権限で除く部屋（DM・案件）・未削除の元の行を、LIMIT より前の WHERE に入れる。
//   見えない一致が件数・次の有無・抜粋に影響しない。総件数は返さない（limit+1 件で次の有無だけを判定する）。
// 並び：メッセージの作成日時の降順、同じなら ID の降順。カーソルはメッセージの (created_at, id)。対応の表の整数の番号は並びに使わない。
// 抜粋：資格を確かめた後のいまの本文から記号を除き、その中の一致の前後を切り出す（FTS5 の snippet() は使わない）。名前だけの一致なら本文の先頭。
// 一致の対象：本文（kind=message）と添付のファイル名（kind=attachment）。一致した写しの行ごとに、元の行と合うか・見てよいかを WHERE で確かめ、
//   適格な行だけをメッセージ単位にまとめる（GROUP BY）。まとめは LIMIT より前なので、本文と名前が両方一致しても1件で、見えない一致は名前の一覧にも混ざらない。
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { toSearchText } from "../../../shared/search-text";
import { toPage, type CursorPayload } from "../lib/cursor";
import { buildExcerpt, searchMethodOf, toFtsPhrase } from "../lib/search-query";
import { isUlid } from "../lib/ulid";
import { caseRoomListable } from "./case-room.sql";
import { withDatabase, type Database } from "./database";
import { fromStoredBody } from "./message-body";
import { directRoomListable, roomViewableBy } from "./room-visibility.sql";

export type SearchMessagesOptions = {
  /** 前後の空白を除いた検索語（Service が検証済み） */
  term: string;
  limit: number;
  cursor?: CursorPayload;
  roomId?: string;
  /** この日時（UTC の ISO 8601）以降に作られたもの */
  createdFrom?: string;
  /** この日時（UTC の ISO 8601）より前に作られたもの */
  createdBefore?: string;
  /** perm.dm.message.view を持つか。偽なら DM の部屋を含めない */
  includeDirect: boolean;
  /** perm.case.view を持つか。偽なら案件専用チャンネルを含めない */
  includeCase: boolean;
};

export type SearchMatchSource = "body" | "attachment";

export type SearchMessageItem = {
  messageId: string;
  parentMessageId: string | null;
  roomId: string;
  roomKind: "channel" | "direct" | "case";
  roomName: string;
  author: { id: string; displayName: string };
  excerpt: string;
  createdAt: string;
  /** 一致した対象（1つ以上。body → attachment の順） */
  matchedIn: SearchMatchSource[];
  /** 名前が一致した添付（添付の ID の昇順。本文だけの一致なら空） */
  matchedAttachments: { id: string; name: string }[];
};

const matchedAttachmentsSchema = z.array(
  z.object({ id: z.string(), name: z.string() }),
);

const rowSchema = z.object({
  id: z.string(),
  parent_message_id: z.string().nullable(),
  room_id: z.string(),
  room_kind: z.enum(["channel", "direct", "case"]),
  room_name: z.string(),
  sender_id: z.string(),
  sender_display_name: z.string(),
  body: z.string(),
  created_at: z.string(),
  body_matched: z.number(),
  matched_attachments: z.string(),
});

function termCondition(term: string): SQL {
  return searchMethodOf(term) === "match"
    ? sql`search_fts MATCH ${toFtsPhrase(term)}`
    : sql`instr(lower(f.text), lower(${term})) > 0`;
}

/** カーソルの (created_at, id) より古い行の条件 */
function olderThan(cursor: CursorPayload | undefined): SQL {
  if (cursor === undefined) return sql`1 = 1`;
  const createdAt = String(cursor.v);
  return sql`(m.created_at < ${createdAt} OR (m.created_at = ${createdAt} AND m.id < ${cursor.id}))`;
}

function matchesOf(
  row: z.infer<typeof rowSchema>,
): Pick<SearchMessageItem, "matchedIn" | "matchedAttachments"> {
  const matchedAttachments = matchedAttachmentsSchema
    .parse(JSON.parse(row.matched_attachments))
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const matchedIn: SearchMatchSource[] = [
    ...(row.body_matched === 1 ? (["body"] as const) : []),
    ...(matchedAttachments.length > 0 ? (["attachment"] as const) : []),
  ];
  // 適格な一致の行だけをまとめているので、どちらも無い行は返らないはず。返ったら SQL の誤りとして止める
  if (matchedIn.length === 0) throw new Error("一致の対象のない行です");
  return { matchedIn, matchedAttachments };
}

export function createSearchRepository(db: Database) {
  return {
    async searchMessages(
      viewerId: string,
      options: SearchMessagesOptions,
    ): Promise<{ items: SearchMessageItem[]; nextCursor: string | null }> {
      const rows = await db.all(sql`
        SELECT m.id AS id, m.parent_message_id AS parent_message_id, m.room_id AS room_id,
          CASE
            WHEN EXISTS (SELECT 1 FROM cases k WHERE k.channel_id = m.room_id) THEN 'case'
            WHEN c.room_id IS NOT NULL THEN 'channel'
            ELSE 'direct'
          END AS room_kind,
          COALESCE(c.name, (
            SELECT pu.display_name FROM conversation_members pm JOIN users pu ON pu.id = pm.user_id
            WHERE pm.conversation_id = m.room_id AND pm.user_id <> ${viewerId}
            ORDER BY pm.user_id LIMIT 1), '') AS room_name,
          m.sender_id AS sender_id, m.sender_display_name AS sender_display_name,
          m.body AS body, m.created_at AS created_at,
          MAX(d.kind = 'message') AS body_matched,
          json_group_array(json_object('id', a.id, 'name', a.original_name)) FILTER (WHERE a.id IS NOT NULL)
            AS matched_attachments
        FROM search_fts f
        JOIN search_documents d ON d.id = f.rowid
        JOIN messages m ON m.id = d.message_id
        LEFT JOIN message_attachments a ON d.kind = 'attachment' AND a.id = d.ref_id
        LEFT JOIN channels c ON c.room_id = m.room_id
        WHERE ${termCondition(options.term)}
          AND (
            (d.kind = 'message' AND d.ref_id = m.id)
            -- 索引が遅れても、消えた・削除済みの（#270）・結び付きや部屋や名前の変わった添付を出さない
            OR (d.kind = 'attachment' AND a.id IS NOT NULL AND a.deleted_at IS NULL AND a.message_id = m.id
              AND a.room_id = m.room_id AND a.original_name = d.source_body))
          AND m.deleted_at IS NULL AND m.room_id = d.room_id
          ${options.roomId === undefined ? sql`` : sql`AND d.room_id = ${options.roomId}`}
          ${options.createdFrom === undefined ? sql`` : sql`AND d.created_at >= ${options.createdFrom}`}
          ${options.createdBefore === undefined ? sql`` : sql`AND d.created_at < ${options.createdBefore}`}
          AND ${roomViewableBy(sql`m.room_id`, viewerId)}
          AND ${directRoomListable(sql`m.room_id`, options.includeDirect)}
          AND ${caseRoomListable(sql`m.room_id`, options.includeCase)}
          AND ${olderThan(options.cursor)}
        GROUP BY m.id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${options.limit + 1}`);
      // 生 SQL の結果は型が付かない。想定と違う行は、ここで見つける
      const page = toPage(
        z.array(rowSchema).parse(rows),
        options.limit,
        (row) => {
          if (!isUlid(row.id))
            throw new Error("メッセージの ID の形が不正です");
          return { v: row.created_at, id: row.id };
        },
      );
      return {
        items: page.items.map((row) => ({
          messageId: row.id,
          parentMessageId: row.parent_message_id,
          roomId: row.room_id,
          roomKind: row.room_kind,
          roomName: row.room_name,
          author: { id: row.sender_id, displayName: row.sender_display_name },
          excerpt: buildExcerpt(
            toSearchText(fromStoredBody(row.body)),
            options.term,
          ),
          createdAt: row.created_at,
          ...matchesOf(row),
        })),
        nextCursor: page.nextCursor,
      };
    },
  };
}

export type SearchRepository = ReturnType<typeof createSearchRepository>;

export function withSearch<T>(
  env: Env,
  run: (repository: SearchRepository) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) => run(createSearchRepository(db)));
}
