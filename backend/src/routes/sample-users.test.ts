// 結合のテスト：本物と同じ実行エンジン（workerd）のローカルの D1 に対して、API（/api/sample-users）を通して確かめる。
// #120 0-2 AC-3（利用者の承認済みの移行）：/api/sample-users は認証が必要になった。認証済み（セッション）で成功し、未認証は 401（no-store）。
// セッションは、架空の利用者（testuser_、[UNIT_TEST]）に sessions の行を直接入れて作る。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  cleanupAuthTestData,
  insertSession,
} from "../../test/auth-fixtures";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { loadConfig } from "../config";
import { app } from "../index";

const USERNAME = "testuser_route_test";
// 一覧の上限（100件）より多い件数。routes は db/ を読まないため、数を直接書く
const BULK_COUNT = 101;
const ALLOWED_ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";

let token: string;

beforeEach(async () => {
  const dept = await insertDepartment("見本テスト部");
  const userId = await insertUser("testuser_sample_001", dept);
  await env.DB.prepare("UPDATE users SET must_change_password = 0 WHERE id = ?")
    .bind(userId)
    .run();
  token = (await insertSession(userId, { createdAt: new Date().toISOString() }))
    .token;
});

const auth = (authenticated: boolean): Record<string, string> =>
  authenticated ? { Cookie: `${SESSION_COOKIE}=${token}` } : {};

const post = (
  body: unknown,
  origin: string = ALLOWED_ORIGIN,
  authenticated = true,
) =>
  app.request(
    "/api/sample-users",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...auth(authenticated),
      },
      body: JSON.stringify(body),
    },
    env,
  );

const list = (authenticated = true) =>
  app.request("/api/sample-users", { headers: auth(authenticated) }, env);

afterEach(async () => {
  // このテストが足した行だけを、識別子で消す（C-05）
  await env.DB.prepare("DELETE FROM sample_users WHERE username = ?")
    .bind(USERNAME)
    .run();
  await env.DB.prepare(
    "DELETE FROM sample_users WHERE username LIKE 'testuser!_route!_bulk!_%' ESCAPE '!'",
  ).run();
  await cleanupAuthTestData();
  await cleanupRoleTestData();
});

describe("/api/sample-users（D1）", () => {
  it("POST：正しい入力は 201 で追加され、GET の一覧で読める", async () => {
    const created = await post({ username: USERNAME });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ username: USERNAME });

    const listed = await list();
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { users: { username: string }[] };
    expect(body.users).toContainEqual({ username: USERNAME });
  });

  it("POST：不正な入力は 422 で、追加されない", async () => {
    const res = await post({ username: "" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["username"],
    });
  });

  it("POST：許可していない送信元（Origin）は 403 で、追加されない", async () => {
    const res = await post({ username: USERNAME }, "https://origin.invalid");
    expect(res.status).toBe(403);
    const listed = await list();
    const body = (await listed.json()) as { users: { username: string }[] };
    expect(body.users).not.toContainEqual({ username: USERNAME });
  });

  it("POST：同じユーザー名の2回目は 409 で、追加されない", async () => {
    expect((await post({ username: USERNAME })).status).toBe(201);
    const second = await post({ username: USERNAME });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "CONFLICT" });
  });

  it("POST：一覧の上限（100件）より多い 101 件のの既存のデータがあっても、重複は 409", async () => {
    // 一覧に載らない位置にある同じユーザー名でも、重複を見逃さない（昇順で最後になる名前を使う）
    const bulk = Array.from({ length: BULK_COUNT }, (_, i) =>
      env.DB.prepare("INSERT INTO sample_users (username) VALUES (?)").bind(
        `testuser_route_bulk_${String(i).padStart(4, "0")}`,
      ),
    );
    await env.DB.batch(bulk);
    const last = `testuser_route_bulk_${String(BULK_COUNT - 1).padStart(4, "0")}`;
    const listed = await list();
    const body = (await listed.json()) as { users: { username: string }[] };
    expect(body.users.map((u) => u.username)).not.toContain(last);
    const res = await post({ username: last });
    expect(res.status).toBe(409);
  });

  it("#120 0-2 AC-3: 未認証の GET は 401（UNAUTHENTICATED）で no-store", async () => {
    const res = await list(false);
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("#120 0-2 AC-3: 未認証の POST は 401 で no-store、追加されない", async () => {
    const res = await post({ username: USERNAME }, ALLOWED_ORIGIN, false);
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const listed = await list();
    const body = (await listed.json()) as { users: { username: string }[] };
    expect(body.users).not.toContainEqual({ username: USERNAME });
  });
});
