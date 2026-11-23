// #298 AC-1・AC-2：画面の想定する利用者（X-Expected-User-Id）と、Cookie のセッションの利用者が食い違う要求を、
// 最終操作の時刻の更新・初回パスワードのゲート・認可・業務・DB の書き込み・監査・セッションの失効より前に、409 SESSION_USER_MISMATCH（no-store）で断る。
// 結合のテスト：実際の入口（index.ts の app）を、ローカルの D1 に対して呼び、DB の副作用（メッセージ・監査・last_active_at・失効）を見る。
// 期待値は受け入れ条件から独立に書く（ヘッダーの名前・コード・ステータスはリテラル。本番の定数を読み込まない）。
// データは架空のもの（testuser_mismatch_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  authAuditRows,
  insertSession,
  parseSetCookie,
  sessionRow,
} from "../../test/auth-fixtures";
import {
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  cleanupMessageScenario,
  messageCount,
} from "../../test/message-fixtures";
import { insertUser } from "../../test/role-fixtures";

const HEADER = "X-Expected-User-Id";
const MIN = 60_000;

type Seeded = { userId: string; token: string; sessionId: string };

let dept: SeededDepartment;
let userA: Seeded;
let userB: Seeded;
let logLines: string[];

/** 利用者と、最終操作が5分前のセッション（更新の間隔を過ぎていて、一致なら更新される）を作る */
async function seedUser(
  loginId: string,
  options: { mustChangePassword?: boolean } = {},
): Promise<Seeded> {
  const userId = await insertUser(loginId, dept.id);
  if (options.mustChangePassword !== true)
    await env.DB.prepare(
      "UPDATE users SET must_change_password = 0 WHERE id = ?",
    )
      .bind(userId)
      .run();
  const now = Date.now();
  const session = await insertSession(userId, {
    createdAt: new Date(now - 10 * MIN).toISOString(),
    lastActiveAt: new Date(now - 5 * MIN).toISOString(),
  });
  return { userId, token: session.token, sessionId: session.id };
}

const postMessage = (token: string | null, expected?: string) =>
  apiRequest("POST", `/api/rooms/${dept.dedicatedChannelId}/messages`, {
    token,
    body: { body: "[UNIT_TEST]#298 の投稿" },
    ...(expected === undefined ? {} : { headers: { [HEADER]: expected } }),
  });

const postLogout = (token: string, expected?: string) =>
  apiRequest("POST", "/api/auth/logout", {
    token,
    ...(expected === undefined ? {} : { headers: { [HEADER]: expected } }),
  });

/** ロガーが出した監査（log_type: audit）の行 */
const auditLogLines = () =>
  logLines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { attributes?: Record<string, unknown> })
    .filter((line) => line.attributes?.log_type === "audit");

beforeEach(async () => {
  logLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  dept = await insertDepartmentWithChannels("食い違い");
  userA = await seedUser("testuser_mismatch_a");
  userB = await seedUser("testuser_mismatch_b");
  await insertMember(dept.dedicatedChannelId, userA.userId);
  await insertMember(dept.dedicatedChannelId, userB.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupMessageScenario();
});

describe("#298 AC-1 投稿（認証の要る API）", () => {
  it("#298 AC-1: Cookie は B・ヘッダーは A の投稿は 409 SESSION_USER_MISMATCH（no-store）。メッセージ・監査が増えず、B のセッションの last_active_at も変わらない", async () => {
    const before = await sessionRow(userB.sessionId);
    const res = await postMessage(userB.token, userA.userId);
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: "SESSION_USER_MISMATCH" });
    expect(typeof body.message).toBe("string");
    // 利用者向けの文は、決定済みの文を独立に書く（空文字や別の文への変更を検出する）
    expect(body.message).toBe(
      "別の利用者でログインし直されています。ページを読み込み直してください",
    );
    expect(await messageCount(dept.dedicatedChannelId)).toBe(0);
    expect(await authAuditRows()).toEqual([]);
    expect(auditLogLines()).toEqual([]);
    const after = await sessionRow(userB.sessionId);
    expect(after?.last_active_at).toBe(before?.last_active_at);
    expect(after?.revoked_at).toBeNull();
  });

  it("#298 AC-1（対照）: ヘッダーが Cookie の利用者と一致すれば 201 で、last_active_at は今どおり更新される", async () => {
    const before = await sessionRow(userB.sessionId);
    const res = await postMessage(userB.token, userB.userId);
    expect(res.status).toBe(201);
    expect(await messageCount(dept.dedicatedChannelId)).toBe(1);
    expect((await sessionRow(userB.sessionId))?.last_active_at).not.toBe(
      before?.last_active_at,
    );
  });

  it("#298 AC-1: ヘッダーが無い投稿は、今どおり 201", async () => {
    const res = await postMessage(userB.token);
    expect(res.status).toBe(201);
    expect(await messageCount(dept.dedicatedChannelId)).toBe(1);
  });

  it("#298 AC-1: セッションが無い（Cookie なし）要求にヘッダーだけがあっても、今どおり 401 UNAUTHENTICATED", async () => {
    const res = await postMessage(null, userA.userId);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await messageCount(dept.dedicatedChannelId)).toBe(0);
  });

  it.each([
    ["期限切れ（無操作30分）", { lastActiveAgoMin: 31, revoked: false }],
    ["失効", { lastActiveAgoMin: 0, revoked: true }],
  ] as const)(
    "#298 AC-1: セッションが%sなら、ヘッダーが食い違っていても 409 ではなく今どおり 401（使えないセッションの判定が先）",
    async (_label, { lastActiveAgoMin, revoked }) => {
      const now = Date.now();
      const session = await insertSession(userB.userId, {
        createdAt: new Date(now - 40 * MIN).toISOString(),
        lastActiveAt: new Date(now - lastActiveAgoMin * MIN).toISOString(),
        revokedAt: revoked ? new Date(now - MIN).toISOString() : null,
      });
      const res = await postMessage(session.token, userA.userId);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    },
  );

  it("#298 AC-1: 初回パスワードの変更が済んでいない利用者でも、食い違いは 403 PASSWORD_CHANGE_REQUIRED より先に 409", async () => {
    const pending = await seedUser("testuser_mismatch_c", {
      mustChangePassword: true,
    });
    const res = await postMessage(pending.token, userA.userId);
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ code: "SESSION_USER_MISMATCH" });
  });
});

describe("#298 AC-2 ログアウト（公開の経路）", () => {
  it("#298 AC-2: Cookie は B・ヘッダーは A のログアウトは 409（no-store）。B のセッションは有効のまま、Cookie を消す Set-Cookie も付かない", async () => {
    const res = await postLogout(userB.token, userA.userId);
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({
      code: "SESSION_USER_MISMATCH",
      message:
        "別の利用者でログインし直されています。ページを読み込み直してください",
    });
    const cookie = parseSetCookie(res.headers.get("Set-Cookie"));
    expect(cookie?.name === "__Host-session").toBe(false);
    expect((await sessionRow(userB.sessionId))?.revoked_at).toBeNull();
    expect(
      (await authAuditRows()).filter((r) => r.action === "auth.logout"),
    ).toEqual([]);
    // B のセッションは、そのまま使える
    expect(
      (await apiRequest("GET", "/api/auth/session", { token: userB.token }))
        .status,
    ).toBe(200);
  });

  it("#298 AC-2（対照）: ヘッダーが一致するログアウトは、今どおり 204 で失効し Cookie を消す", async () => {
    const res = await postLogout(userB.token, userB.userId);
    expect(res.status).toBe(204);
    expect(parseSetCookie(res.headers.get("Set-Cookie"))?.name).toBe(
      "__Host-session",
    );
    expect((await sessionRow(userB.sessionId))?.revoked_at).not.toBeNull();
  });
});
