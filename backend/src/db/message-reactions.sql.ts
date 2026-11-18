// DAO：メッセージのリアクションの書き込みと集計（#138）。「付けてよい」条件を持つ SQL をここに閉じ込める。
// 条件を INSERT・DELETE の WHERE に置くのは、Service の確認から書き込みまでの間に状態が変わっても、条件を破る行を書かないため。
// 部屋の条件は message-modify.sql.ts の modifiable と同じ形で、「本人の投稿か」だけを除いたもの。
// 条件が似ているため、部屋の条件を変えるときは、このファイルの reactable と modifiable の両方を直す（偶然似ているだけの処理ではなく、同じ「部屋に参加している本人が操作できるか」の規則）。
//   メッセージが未削除で、部屋が次のどちらか。
//   チャンネル：本人が参加中・未アーカイブ・部署が有効（部署のない会社直属のチャンネルは有効として扱う）
//   DM：本人が当事者で、当事者に無効な社員がいない
// お知らせ専用の投稿権限は条件に入れない（投稿とは別の操作。参加者なら誰でも付けられる）。
// 配列は JSON 1パラメータで渡し、D1 の bind 数を投稿の数に依存させない。未知の DB のエラーは変換せずに呼び出し元へ投げる。
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  MAX_REACTION_TYPES,
  MAX_REACTION_USERS_SHOWN,
} from "../../../shared/reaction-rules";
import { messageReactions } from "../../db/schema";
import type { Database } from "./database";
import { activeChannelMember } from "./channel-member.sql";
import { messageViewableBy } from "./room-visibility.sql";

export type ReactionUser = {
  id: string;
  displayName: string;
  isActive: boolean;
};

export type Reaction = {
  kind: "emoji" | "stamp";
  value: string;
  /** 付けた人の全数（users は最大50人に打ち切るが、count は打ち切らない） */
  count: number;
  reactedByMe: boolean;
  /** 付けた時刻の順 */
  users: ReactionUser[];
};

export type ReactionWriteInput = {
  messageId: string;
  userId: string;
  kind: "emoji" | "stamp";
  value: string;
};

export type ReactionWriteResult = { changes: number; reactions: Reaction[] };

/** 本人がこの投稿にリアクションの付け外しをしてよい部屋の状態か（modifiable との関係は、ファイルの先頭のコメント） */
export function reactable(messageId: string, userId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM messages m
    WHERE m.id = ${messageId} AND m.deleted_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM channels c
          LEFT JOIN departments d ON d.id = c.department_id
          WHERE c.room_id = m.room_id AND c.deleted_at IS NULL
            AND ${activeChannelMember(sql`c.room_id`, userId)}
            AND (c.department_id IS NULL OR d.is_active = 1))
        OR (
          EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = m.room_id AND user_id = ${userId})
          AND NOT EXISTS (SELECT 1 FROM conversation_members cv JOIN users u ON u.id = cv.user_id WHERE cv.conversation_id = m.room_id AND u.is_active = 0))))`;
}

const rowSchema = z.object({
  message_id: z.string(),
  kind: z.enum(["emoji", "stamp"]),
  value: z.string(),
  count: z.number().int().min(1),
  mine: z.union([z.literal(0), z.literal(1)]),
  user_id: z.string(),
  display_name: z.string(),
  is_active: z.union([z.literal(0), z.literal(1)]),
});

/**
 * 集計の SELECT。1文で、種類ごとの全数・自分が付けたか・付けた人（付けた時刻の順に最大 MAX_REACTION_USERS_SHOWN 人）を読む。
 * 並びは投稿ごとに、種類を最初に付けられた時刻の順（同時刻は kind・value の順）、付けた人は付けた時刻の順。
 * allowed を渡すと、同じ条件を満たすときだけ行を返す（書き込みと同じ batch で読むとき、条件が崩れていれば0行になる）。
 * 同じ種類の行は主キー（message_id, kind, value, user_id）の索引で数える。ウィンドウ関数・副問い合わせの表は使わず、表を頭から読まない形にする。
 * db.batch に入れられる形にするため、素の SQL ではなく select(...).from(...).where(...).orderBy(...) にする。
 */
function selectReactions(
  db: Database,
  messageIds: readonly string[],
  viewerId: string | null,
  allowed?: SQL,
) {
  const sameType = sql`c.message_id = r.message_id AND c.kind = r.kind AND c.value = r.value`;
  const addedBefore = sql`(c.created_at < r.created_at OR (c.created_at = r.created_at AND c.user_id < r.user_id))`;
  return db
    .select({
      message_id: sql<string>`r.message_id`,
      kind: sql<string>`r.kind`,
      value: sql<string>`r.value`,
      count: sql<number>`(SELECT COUNT(*) FROM message_reactions c WHERE ${sameType})`,
      mine: sql<number>`EXISTS (SELECT 1 FROM message_reactions c WHERE ${sameType} AND c.user_id IS ${viewerId})`,
      user_id: sql<string>`r.user_id`,
      display_name: sql<string>`u.display_name`,
      is_active: sql<number>`u.is_active`,
    })
    .from(sql`message_reactions r JOIN users u ON u.id = r.user_id`)
    .where(
      sql`r.message_id IN (SELECT value FROM json_each(${JSON.stringify(messageIds)}))
        AND ${allowed ?? sql`1 = 1`}
        AND (SELECT COUNT(*) FROM message_reactions c WHERE ${sameType} AND ${addedBefore}) < ${MAX_REACTION_USERS_SHOWN}`,
    )
    .orderBy(
      sql`r.message_id, (SELECT MIN(c.created_at) FROM message_reactions c WHERE ${sameType}), r.kind, r.value, r.created_at, r.user_id`,
    );
}

function groupReactions(rows: readonly unknown[]): Map<string, Reaction[]> {
  const result = new Map<string, Reaction[]>();
  for (const raw of rows) {
    const row = rowSchema.parse(raw);
    const reactions = result.get(row.message_id) ?? [];
    const last = reactions[reactions.length - 1];
    const user = {
      id: row.user_id,
      displayName: row.display_name,
      isActive: row.is_active === 1,
    };
    if (last?.kind === row.kind && last.value === row.value) {
      last.users.push(user);
    } else {
      reactions.push({
        kind: row.kind,
        value: row.value,
        count: row.count,
        reactedByMe: row.mine === 1,
        users: [user],
      });
    }
    result.set(row.message_id, reactions);
  }
  return result;
}

/**
 * 投稿ごとの集計を、1回の問い合わせで読む。リアクションのない投稿は Map に入らない（呼び出し側は ?? [] で扱う）。
 * 本文の読み取りの後に閲覧者が資格を失っても付随の情報を返さないよう、SQL の条件でも、その時点の資格（部屋を見てよいか）で絞る。
 */
export async function loadMessageReactions(
  db: Database,
  messageIds: readonly string[],
  viewerId: string,
): Promise<Map<string, Reaction[]>> {
  if (messageIds.length === 0) return new Map();
  return groupReactions(
    await selectReactions(
      db,
      messageIds,
      viewerId,
      messageViewableBy(sql`r.message_id`, viewerId),
    ),
  );
}

/**
 * 0行の後の読み直し用。reactable の条件を満たすときだけ、その投稿の集計を返す（付いていなければ []）。
 * 条件が成り立たないとき（確認の直後に参加を外された・アーカイブされた・削除されたなど）は null。付けた人の名前を返さない。
 * 条件の確認と集計は同じ batch で読み、読む間に状態が変わらないようにする。
 */
export async function loadReactionsIfReactable(
  db: Database,
  messageId: string,
  userId: string,
): Promise<Reaction[] | null> {
  const allowed = reactable(messageId, userId);
  const [rows, check] = await db.batch([
    selectReactions(db, [messageId], userId, allowed),
    db
      .select({ ok: sql<number>`1` })
      .from(sql`(SELECT 1) c`)
      .where(allowed),
  ]);
  if (check.length === 0) return null;
  return groupReactions(rows).get(messageId) ?? [];
}

/**
 * 条件を満たすときだけ1行を追加し、追加した行数（1 か 0）と、同じ batch で読んだ最新の集計を返す。
 * 0行になるのは、重複（同じ人が同じものをすでに付けている）・20種類に達している・部屋の条件が崩れている、のいずれか（原因は Service が読み直して分ける）。
 */
export async function addReactionIfReactable(
  db: Database,
  input: ReactionWriteInput,
): Promise<ReactionWriteResult> {
  const allowed = reactable(input.messageId, input.userId);
  const [write, rows] = await db.batch([
    db
      .insert(messageReactions)
      .select(
        sql`
        SELECT ${input.messageId}, ${input.userId}, ${input.kind}, ${input.value}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE ${allowed}
          AND (
            EXISTS (SELECT 1 FROM message_reactions WHERE message_id = ${input.messageId} AND kind = ${input.kind} AND value = ${input.value})
            OR (SELECT COUNT(*) FROM (SELECT DISTINCT kind, value FROM message_reactions WHERE message_id = ${input.messageId})) < ${MAX_REACTION_TYPES})`,
      )
      .onConflictDoNothing(),
    selectReactions(db, [input.messageId], input.userId, allowed),
  ]);
  return {
    changes: write.meta.changes,
    reactions: groupReactions(rows).get(input.messageId) ?? [],
  };
}

/** 本人の行だけを、条件を満たすときに消す。結果の形は addReactionIfReactable と同じ */
export async function removeReactionIfReactable(
  db: Database,
  input: ReactionWriteInput,
): Promise<ReactionWriteResult> {
  const allowed = reactable(input.messageId, input.userId);
  const [write, rows] = await db.batch([
    db.delete(messageReactions).where(
      sql`${messageReactions.messageId} = ${input.messageId} AND ${messageReactions.kind} = ${input.kind}
          AND ${messageReactions.value} = ${input.value} AND ${messageReactions.userId} = ${input.userId}
          AND ${allowed}`,
    ),
    selectReactions(db, [input.messageId], input.userId, allowed),
  ]);
  return {
    changes: write.meta.changes,
    reactions: groupReactions(rows).get(input.messageId) ?? [],
  };
}
