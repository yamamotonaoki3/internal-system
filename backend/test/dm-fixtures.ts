// #136 のテストで使う、ダイレクトメッセージ（DM）の架空のテストデータの作成・読み取り・後始末（識別子で消す。C-05）。
// 利用者は testuser_dm_ で始め、部署名は [UNIT_TEST] で始める。本文は [UNIT_TEST] を付ける。値はすべて架空のもの。
// 表の形は migration 0016・0017：rooms(kind='direct')、conversations(room_id, direct_key, created_at)、conversation_members(conversation_id, user_id)。
// direct_key は計画 2章の決まり（2人の利用者IDを小さい順に ':' でつなぐ）を、本番の directKeyOf を使わずにここで独立に作る。
// このファイルは本番の DM のコード（まだないもの）を読み込まない。読み込むと、これを使う既存のテストまで壊れるため。
import { env } from "cloudflare:workers";
import { apiRequest, insertReadyUser } from "./api-request";
import { cleanupMessageScenario, ulidAt } from "./message-fixtures";
import { TEST_TAG, testId } from "./role-fixtures";
import { AppError } from "../src/lib/app-error";
import type { Principal } from "../src/lib/authorization";
import type { Permission } from "../src/lib/permissions";

export { TEST_TAG };
export const DM_NOW = "2026-11-12T00:00:00.000Z";

export type AuthorizeCall = { userId: string | null; permission: Permission };

/**
 * 偽の authorizer（Service の単体テスト用）。denied に入れた権限だけを、本物と同じ FORBIDDEN（403）で拒否する。
 * 固定ロールはすべて DM の権限を持つため、権限の拒否（403）と判定の順は、これを渡して確かめる。呼ばれた順に calls に記録する。
 */
export function fakeAuthorizer(denied: readonly Permission[] = []) {
  const calls: AuthorizeCall[] = [];
  return {
    calls,
    // 範囲（Scope）は判定に使わない。本物の authorize と同じ形で呼べるよう、第3引数は受け取らずに無視する
    async authorize(
      principal: Principal | null,
      permission: Permission,
    ): Promise<void> {
      calls.push({ userId: principal?.userId ?? null, permission });
      if (denied.includes(permission))
        throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
    },
  };
}

/** calls のうち、DM の権限（perm.dm.*）の呼び出しだけ */
export function dmPermissionCalls(calls: readonly AuthorizeCall[]) {
  return calls.filter((call) => call.permission.startsWith("perm.dm."));
}

/** 計画の決まりどおりの direct_key（本番の定義から作らない） */
export function expectedDirectKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export type DmUser = { userId: string; token: string };

/** パスワード変更の必要がない有効な利用者を、表示名つきで作り、セッションを返す */
export async function insertDmUser(
  loginId: string,
  departmentId: string,
  displayName: string,
): Promise<DmUser> {
  if (!loginId.startsWith("testuser_dm_"))
    throw new Error("DM のテストの利用者は testuser_dm_ で始めてください");
  const user = await insertReadyUser(loginId, departmentId);
  await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
    .bind(displayName, user.userId)
    .run();
  return user;
}

/** 社員を無効にする（無効化の処理の結果だけを直接作る） */
export async function deactivateUser(userId: string) {
  await env.DB.prepare(
    "UPDATE users SET is_active = 0, deactivated_at = ? WHERE id = ?",
  )
    .bind(DM_NOW, userId)
    .run();
}

const fixtureRooms: string[] = [];

/**
 * 2人の DM を、rooms・conversations・conversation_members に直接入れる（API を通さずに状態を作る）。
 * roomId を時刻つきの ULID（ulidAt）で渡すと、最終活動の並びを決めて確かめられる。
 */
export async function insertDm(
  userA: string,
  userB: string,
  options: { roomId?: string } = {},
): Promise<string> {
  const roomId = options.roomId ?? testId("DMROOM");
  fixtureRooms.push(roomId);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO rooms (id, kind, created_at) VALUES (?, 'direct', ?)",
    ).bind(roomId, DM_NOW),
    env.DB.prepare(
      "INSERT INTO conversations (room_id, direct_key, created_at) VALUES (?, ?, ?)",
    ).bind(roomId, expectedDirectKey(userA, userB), DM_NOW),
    env.DB.prepare(
      "INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)",
    ).bind(roomId, userA),
    env.DB.prepare(
      "INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)",
    ).bind(roomId, userB),
  ]);
  return roomId;
}

/** 指定した時刻（ミリ秒）の ULID を部屋のIDにして DM を作る */
export function insertDmAt(userA: string, userB: string, ms: number) {
  return insertDm(userA, userB, { roomId: ulidAt(ms) });
}

export type DmCounts = {
  directRooms: number;
  conversations: number;
  members: number;
  messages: number;
};

/** DM に関わる行の件数（行が増えないことの確認に使う） */
export async function dmCounts(): Promise<DmCounts> {
  const count = async (sql: string) =>
    (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? -1;
  return {
    directRooms: await count(
      "SELECT COUNT(*) AS n FROM rooms WHERE kind = 'direct'",
    ),
    conversations: await count("SELECT COUNT(*) AS n FROM conversations"),
    members: await count("SELECT COUNT(*) AS n FROM conversation_members"),
    messages: await count("SELECT COUNT(*) AS n FROM messages"),
  };
}

/** 2人の DM の部屋のID（direct_key で引く。なければ null） */
export async function dmRoomIdOf(a: string, b: string) {
  const row = await env.DB.prepare(
    "SELECT room_id FROM conversations WHERE direct_key = ?",
  )
    .bind(expectedDirectKey(a, b))
    .first<{ room_id: string }>();
  return row?.room_id ?? null;
}

/** DM の当事者（user_id の昇順） */
export async function dmMembersOf(roomId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY user_id",
  )
    .bind(roomId)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

export async function roomKindOf(roomId: string) {
  const row = await env.DB.prepare("SELECT kind FROM rooms WHERE id = ?")
    .bind(roomId)
    .first<{ kind: string }>();
  return row?.kind ?? null;
}

/** DM の一覧・詳細・開始の API（/api/dms）への要求 */
export const dmApi = {
  start: (body: unknown, token: string | null, origin?: string) =>
    apiRequest("POST", "/api/dms", {
      token,
      body,
      ...(origin === undefined ? {} : { origin }),
    }),
  list: (query: string, token: string | null) =>
    apiRequest("GET", `/api/dms${query}`, { token }),
  detail: (roomId: string, token: string | null) =>
    apiRequest("GET", `/api/dms/${roomId}`, { token }),
};

/**
 * このテストの DM だけを消す。対象は「testuser_/e2euser_ の利用者が当事者に含まれる会話」と、このファイルが作った部屋。
 * 外部キーの順：メッセージ → 当事者（その会話の全員分）→ 会話 → 部屋。利用者を消す後始末より先に呼ぶ。
 */
export async function cleanupDmTestData() {
  const testUsers =
    "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT conversation_id AS id FROM conversation_members WHERE user_id IN (${testUsers})`,
  ).all<{ id: string }>();
  const ids = [
    ...new Set([...results.map((r) => r.id), ...fixtureRooms.splice(0)]),
  ];
  if (ids.length === 0) return;
  await env.DB.batch(
    ids.flatMap((id) => [
      env.DB.prepare("DELETE FROM messages WHERE room_id = ?").bind(id),
      env.DB.prepare(
        "DELETE FROM conversation_members WHERE conversation_id = ?",
      ).bind(id),
      env.DB.prepare("DELETE FROM conversations WHERE room_id = ?").bind(id),
      env.DB.prepare("DELETE FROM rooms WHERE id = ? AND kind = 'direct'").bind(
        id,
      ),
    ]),
  );
}

/** DM → メッセージ → セッション・監査 → チャンネル・部署・利用者の順に後始末する。途中で失敗しても残りは必ず行う */
export async function cleanupDmScenario() {
  try {
    await cleanupDmTestData();
  } finally {
    await cleanupMessageScenario();
  }
}
