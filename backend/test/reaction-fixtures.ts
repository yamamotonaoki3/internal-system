// #138 のテストで使う、リアクション（message_reactions）の架空のテストデータの作成・読み取り・後始末（識別子で消す）。
// 識別子：利用者は testuser_ で始め、部署名・チャンネル名・本文は [UNIT_TEST] を付ける。値はすべて架空のもの。
// 表の形は計画（#138）：message_reactions(message_id, user_id, kind, value, created_at)、主キー (message_id, kind, value, user_id)。migration 0022。
// このファイルは、まだない本番のコード（リアクションの Service・Repository）を読み込まない。読み込むと、これを使う既存のテストまで壊れるため。
// 既存の後始末（cleanupThreadScenario など）は、表がまだない段階でも既存のテストが動くよう、変えない。リアクションを作るテストは、ここの cleanupReactionScenario を使う。
import { env } from "cloudflare:workers";
import { apiRequest } from "./api-request";
import {
  TEST_TAG,
  cleanupThreadScenario,
  createThreadWorld,
  type ThreadWorld,
} from "./thread-fixtures";

export { TEST_TAG, createThreadWorld };
export type { ThreadWorld };

/** リアクションの付け外しのメッセージの時刻の基準より後の、リアクションの時刻（秒の番号 → ISO 文字列） */
export const reactionIsoAt = (n: number) =>
  new Date(Date.parse("2026-11-16T00:00:00.000Z") + n * 1000).toISOString();

// ---- API ----

export const reactionsPath = (messageId: string) =>
  `/api/messages/${messageId}/reactions`;
/** value は URL エンコードして渡す（EP-1-13） */
export const reactionItemPath = (
  messageId: string,
  kind: string,
  value: string,
) => `${reactionsPath(messageId)}/${kind}/${encodeURIComponent(value)}`;

export function postReaction(
  messageId: string,
  payload: unknown,
  token: string | null,
  origin?: string,
) {
  return apiRequest("POST", reactionsPath(messageId), {
    token,
    body: payload,
    ...(origin === undefined ? {} : { origin }),
  });
}

export function deleteReaction(
  messageId: string,
  kind: string,
  value: string,
  token: string | null,
  origin?: string,
) {
  return apiRequest("DELETE", reactionItemPath(messageId, kind, value), {
    token,
    ...(origin === undefined ? {} : { origin }),
  });
}

export type ReactionUser = {
  id: string;
  displayName: string;
  isActive: boolean;
};

export type ReactionView = {
  kind: string;
  value: string;
  count: number;
  reactedByMe: boolean;
  users: ReactionUser[];
};

export type ReactionsResponse = {
  messageId: string;
  reactions: ReactionView[];
};

/** 200 を確かめて、本文（{ messageId, reactions }）を返す */
export async function reactionsOk(
  response: Response,
): Promise<ReactionsResponse> {
  if (response.status !== 200)
    throw new Error(
      `リアクションの応答が ${response.status} でした：${await response.text()}`,
    );
  return (await response.json()) as ReactionsResponse;
}

// ---- 状態の作成・読み取り ----

export type ReactionRow = {
  message_id: string;
  user_id: string;
  kind: string;
  value: string;
  created_at: string;
};

/** 行を直接入れる（API・Repository を通さない）。createdAt を省略すると DB の既定の時刻 */
export async function insertReactionRow(seed: {
  messageId: string;
  userId: string;
  kind: "emoji" | "stamp";
  value: string;
  createdAt?: string;
}) {
  if (seed.createdAt === undefined)
    await env.DB.prepare(
      "INSERT INTO message_reactions (message_id, user_id, kind, value) VALUES (?, ?, ?, ?)",
    )
      .bind(seed.messageId, seed.userId, seed.kind, seed.value)
      .run();
  else
    await env.DB.prepare(
      "INSERT INTO message_reactions (message_id, user_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(seed.messageId, seed.userId, seed.kind, seed.value, seed.createdAt)
      .run();
}

/** 1つの投稿のリアクションの行（並びは固定） */
export async function reactionRows(messageId: string) {
  const { results } = await env.DB.prepare(
    "SELECT message_id, user_id, kind, value, created_at FROM message_reactions WHERE message_id = ? ORDER BY kind, value, user_id",
  )
    .bind(messageId)
    .all<ReactionRow>();
  return results;
}

/** message_reactions の全行数（テストの利用者のものに限らない。ほかのテストの行が残っていないことの確認にも使う） */
export async function reactionTotal(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM message_reactions",
  ).first<{ n: number }>();
  if (row === null)
    throw new Error("message_reactions の件数を読めませんでした");
  return row.n;
}

/** 20種類を埋める絵文字14個・スタンプ6個（計画の一覧のうち、実際に受け付ける値） */
export const TWENTY_REACTIONS: readonly {
  kind: "emoji" | "stamp";
  value: string;
}[] = [
  ...[
    "👍",
    "👏",
    "🙏",
    "🙇",
    "✅",
    "👀",
    "💯",
    "🎉",
    "✨",
    "🔥",
    "💪",
    "🙌",
    "👌",
    "⭐",
  ].map((value) => ({ kind: "emoji" as const, value })),
  ...["like", "ok", "thanks", "good-work", "checking", "congrats"].map(
    (value) => ({ kind: "stamp" as const, value }),
  ),
];

/** ある投稿に、20種類（TWENTY_REACTIONS）を1人が付けた状態を直接作る */
export async function seedTwentyTypes(messageId: string, userId: string) {
  for (const [index, reaction] of TWENTY_REACTIONS.entries())
    await insertReactionRow({
      messageId,
      userId,
      ...reaction,
      createdAt: reactionIsoAt(index),
    });
}

// ---- 後始末 ----

const TEST_USERS =
  "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";

/**
 * message_reactions を先に消し、その後、スレッド・メッセージ・DM・チャンネル・部署・利用者を消す（cleanupThreadScenario）。
 * 外部キーの都合：リアクションは利用者・メッセージを指すため、それらより先に消す。
 * 対象：利用者が testuser_/e2euser_ の行と、テストの利用者の投稿・テストの部署のチャンネルの投稿に付いた行。
 */
export async function cleanupReactionScenario() {
  const tagged = `${TEST_TAG}%`;
  try {
    await env.DB.prepare(
      `DELETE FROM message_reactions WHERE user_id IN (${TEST_USERS})
         OR message_id IN (SELECT id FROM messages WHERE sender_id IN (${TEST_USERS})
           OR room_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE name LIKE ?1) OR name LIKE ?1))`,
    )
      .bind(tagged)
      .run();
  } finally {
    await cleanupThreadScenario();
  }
}
