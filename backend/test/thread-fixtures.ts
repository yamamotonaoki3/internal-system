// #137 のテストで使う、スレッド（返信・スレッド一覧・スレッドの既読）の架空のテストデータの作成・読み取り・後始末（識別子で消す）。
// 識別子：利用者は testuser_ で始め、部署名・チャンネル名・本文は [UNIT_TEST] を付ける。値はすべて架空のもの。
// 表の形は計画（#137）：messages.parent_message_id（NULL 可・messages(id) 参照。migration 0020）、
//   thread_read_positions(user_id, parent_message_id, last_read_message_id, updated_at)、主キー (user_id, parent_message_id)。
// このファイルは、まだない本番のコード（返信の Service・Repository）を読み込まない。読み込むと、これを使う既存のテストまで壊れるため。
import { env } from "cloudflare:workers";
import { apiRequest } from "./api-request";
import {
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "./department-fixtures";
import { TEST_TAG, insertMessage } from "./message-fixtures";
import {
  cleanupMessageModifyScenario,
  insertModifyUser,
  type ModifyUser,
} from "./message-modify-fixtures";
import { ulidAtMs } from "./read-position-fixtures";

export { TEST_TAG, ulidAtMs };
export type { ModifyUser };

/** 参加の時刻（department-fixtures の DEPT_NOW = 2026-11-09）より後の、メッセージの時刻の基準（ミリ秒） */
export const THREAD_BASE_MS = Date.parse("2026-11-12T00:00:00.000Z");
export const BAD_ORIGIN = "https://origin.invalid";
/** after に渡すと「最初から全部」になる、最小のULID */
export const ZERO = "00000000000000000000000000";
export const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const idCache = new Map<number, string>();
/** n 番目（秒）の時刻の ULID。n が大きいほど後ろ。同じ n は、同じファイルの中では同じ ID を返す（テストの中で何度呼んでも同じ） */
export const idAt = (n: number) => {
  const cached = idCache.get(n);
  if (cached !== undefined) return cached;
  const id = ulidAtMs(THREAD_BASE_MS + n * 1000);
  idCache.set(n, id);
  return id;
};
/** idAt(n) と同じ時刻の ISO 文字列 */
export const isoAt = (n: number) =>
  new Date(THREAD_BASE_MS + n * 1000).toISOString();

// ---- API ----

export const repliesPath = (parentId: string) =>
  `/api/messages/${parentId}/replies`;
export const threadReadPath = (parentId: string) =>
  `/api/messages/${parentId}/thread-read-position`;
export const THREADS_PATH = "/api/me/threads";

export function postReply(
  parentId: string,
  payload: unknown,
  token: string | null,
  origin?: string,
) {
  return apiRequest("POST", repliesPath(parentId), {
    token,
    body: payload,
    ...(origin === undefined ? {} : { origin }),
  });
}

export function getReplies(
  parentId: string,
  query: string,
  token: string | null,
) {
  return apiRequest("GET", `${repliesPath(parentId)}${query}`, { token });
}

export function getThreads(query: string, token: string | null) {
  return apiRequest("GET", `${THREADS_PATH}${query}`, { token });
}

export function putThreadRead(
  parentId: string,
  payload: unknown,
  token: string | null,
  origin?: string,
) {
  return apiRequest("PUT", threadReadPath(parentId), {
    token,
    body: payload,
    ...(origin === undefined ? {} : { origin }),
  });
}

/** #138：一覧の項目の reactions（種類ごとの集計。付けた人は最大50人） */
export type ReactionShape = {
  kind: string;
  value: string;
  count: number;
  reactedByMe: boolean;
  users: { id: string; displayName: string; isActive: boolean }[];
};

export type ReplyItem = {
  id: string;
  roomId: string;
  parentMessageId: string | null;
  replyCount: number;
  author: { id: string; displayName: string; isActive: boolean };
  body: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  /** #138：削除済みは [] */
  reactions: ReactionShape[];
};

export type RepliesPage = {
  parent: ReplyItem;
  replyBlockedReason: string | null;
  /** #137：チャンネルは今参加しているか、DM は当事者か */
  joined: boolean;
  /** #137：部屋に今書き込めるか（チャンネルは参加中・未アーカイブ・部署が有効、DM は当事者で相手が有効） */
  roomWritable: boolean;
  items: ReplyItem[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

export type ThreadListItem = {
  parent: ReplyItem;
  room:
    | { kind: "channel"; id: string; name: string }
    | {
        kind: "direct";
        id: string;
        partner: { id: string; displayName: string; isActive: boolean };
      };
  lastReplyAt: string;
  unreadCount: number;
};

export type ThreadListPage = {
  items: ThreadListItem[];
  nextCursor: string | null;
};

export async function repliesOk(
  parentId: string,
  query: string,
  token: string,
): Promise<RepliesPage> {
  const response = await getReplies(parentId, query, token);
  if (response.status !== 200)
    throw new Error(`返信の取得が ${response.status} でした`);
  return (await response.json()) as RepliesPage;
}

export async function threadsOk(
  query: string,
  token: string,
): Promise<ThreadListPage> {
  const response = await getThreads(query, token);
  if (response.status !== 200)
    throw new Error(`スレッド一覧の取得が ${response.status} でした`);
  return (await response.json()) as ThreadListPage;
}

/** スレッド一覧を最後まで辿る（limit ごと） */
export async function allThreads(
  token: string,
  limit: number,
): Promise<ThreadListItem[]> {
  const items: ThreadListItem[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i += 1) {
    const query: string =
      cursor === null ? `?limit=${limit}` : `?limit=${limit}&cursor=${cursor}`;
    const page: ThreadListPage = await threadsOk(query, token);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return items;
  }
  throw new Error("スレッド一覧のページが終わりませんでした");
}

/** 部屋の一覧（EP-1-01）。after なしは新しい順 */
export async function roomItems(
  roomId: string,
  query: string,
  token: string,
): Promise<{
  items: ReplyItem[];
  hasMore?: boolean;
  nextCursor?: string | null;
}> {
  const response = await apiRequest(
    "GET",
    `/api/rooms/${roomId}/messages${query}`,
    { token },
  );
  if (response.status !== 200)
    throw new Error(`部屋の一覧の取得が ${response.status} でした`);
  return (await response.json()) as {
    items: ReplyItem[];
    hasMore?: boolean;
    nextCursor?: string | null;
  };
}

export async function codeOf(response: Response) {
  return ((await response.json()) as { code?: string }).code;
}

// ---- 状態の作成・読み取り ----

export type ThreadReadRow = {
  user_id: string;
  parent_message_id: string;
  last_read_message_id: string;
  updated_at: string;
};

const TEST_USERS =
  "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";

export async function insertThreadReadPosition(
  userId: string,
  parentId: string,
  lastReadMessageId: string,
  updatedAt = "2026-11-13T00:00:00.000Z",
) {
  await env.DB.prepare(
    "INSERT INTO thread_read_positions (user_id, parent_message_id, last_read_message_id, updated_at) VALUES (?, ?, ?, ?)",
  )
    .bind(userId, parentId, lastReadMessageId, updatedAt)
    .run();
}

export async function threadReadPositionOf(
  userId: string,
  parentId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT last_read_message_id AS id FROM thread_read_positions WHERE user_id = ? AND parent_message_id = ?",
  )
    .bind(userId, parentId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** テストの利用者のスレッドの既読位置の行（利用者・親の順） */
export async function threadReadRows(): Promise<ThreadReadRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT user_id, parent_message_id, last_read_message_id, updated_at FROM thread_read_positions
     WHERE user_id IN (${TEST_USERS}) ORDER BY user_id, parent_message_id`,
  ).all<ThreadReadRow>();
  return results;
}

export async function tableCount(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
    n: number;
  }>();
  if (row === null) throw new Error(`${table} の件数を読めませんでした`);
  return row.n;
}

export type ParentRow = {
  id: string;
  room_id: string;
  sender_id: string;
  body: string;
  parent_message_id: string | null;
  deleted_at: string | null;
};

export async function parentRow(id: string) {
  return env.DB.prepare(
    "SELECT id, room_id, sender_id, body, parent_message_id, deleted_at FROM messages WHERE id = ?",
  )
    .bind(id)
    .first<ParentRow>();
}

/** 返信の行（parent_message_id が親の行）を ID 昇順で */
export async function replyRows(parentId: string): Promise<ParentRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, room_id, sender_id, body, parent_message_id, deleted_at FROM messages WHERE parent_message_id = ? ORDER BY id",
  )
    .bind(parentId)
    .all<ParentRow>();
  return results;
}

/** 部屋のメッセージの行数（返信を含む） */
export async function roomRowCount(roomId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM messages WHERE room_id = ?",
  )
    .bind(roomId)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

// ---- 世界（部署・利用者・部屋）の作成 ----

export type ThreadWorld = {
  dept: SeededDepartment;
  /** 通常のチャンネル（公開。alice・bob・dave が参加。carol は未参加） */
  channel: string;
  alice: ModifyUser;
  bob: ModifyUser;
  carol: ModifyUser;
  dave: ModifyUser;
};

/**
 * 部署・利用者4人（alice・bob・carol・dave。いずれも同じ部署）・通常の公開チャンネル1つを作る。
 * alice・bob・dave はチャンネルに参加、carol は参加しない。login_id は testuser_<prefix>_<名前>。
 */
export async function createThreadWorld(prefix: string): Promise<ThreadWorld> {
  const dept = await insertDepartmentWithChannels(`スレッド${prefix}`);
  const user = (name: string) =>
    insertModifyUser(`testuser_${prefix}_${name}`, dept.id);
  const [alice, bob, carol, dave] = [
    await user("alice"),
    await user("bob"),
    await user("carol"),
    await user("dave"),
  ] as [ModifyUser, ModifyUser, ModifyUser, ModifyUser];
  const channel = await insertChannel({
    name: `${TEST_TAG}スレッド通常${prefix}`,
    purpose: "normal",
    departmentId: dept.id,
  });
  for (const member of [alice, bob, dave])
    await insertMember(channel, member.userId);
  return { dept, channel, alice, bob, carol, dave };
}

/** 親の投稿を入れ、ID を返す（n は idAt の番号） */
export async function seedParent(
  roomId: string,
  senderId: string,
  n: number,
  body = `${TEST_TAG}親${n}`,
): Promise<string> {
  const id = idAt(n);
  await insertMessage({
    roomId,
    senderId,
    id,
    body,
    createdAt: isoAt(n),
  });
  return id;
}

/** 返信を入れ、ID を返す（n は idAt の番号。親より大きい番号にする） */
export async function seedReply(
  roomId: string,
  parentId: string,
  senderId: string,
  n: number,
  body = `${TEST_TAG}返信${n}`,
): Promise<string> {
  const id = idAt(n);
  await insertMessage({
    roomId,
    senderId,
    id,
    body,
    createdAt: isoAt(n),
    parentMessageId: parentId,
  });
  return id;
}

// ---- 後始末 ----

/**
 * スレッドの既読位置（thread_read_positions）を先に消し、その後、メッセージ・DM・セッション・チャンネル・部署・利用者を消す。
 * 外部キーの都合：既読位置は利用者・親メッセージを指すため、それらより先に消す。
 * 対象：利用者が testuser_/e2euser_ の行と、親が testuser_ の投稿・テストの部屋のメッセージの行。
 * 返信（自己参照の親子）は、メッセージを消す1文の中で、親と返信が一緒に消える（同じ部屋・テストの利用者）。
 */
export async function cleanupThreadScenario() {
  const tagged = `${TEST_TAG}%`;
  try {
    await env.DB.prepare(
      `DELETE FROM thread_read_positions WHERE user_id IN (${TEST_USERS})
         OR parent_message_id IN (SELECT id FROM messages WHERE sender_id IN (${TEST_USERS})
           OR room_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE name LIKE ?1) OR name LIKE ?1))`,
    )
      .bind(tagged)
      .run();
  } finally {
    await cleanupMessageModifyScenario();
  }
}
