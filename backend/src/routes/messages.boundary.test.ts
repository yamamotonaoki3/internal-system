// #201 AC-1・AC-3・AC-6: メッセージの一覧・投稿の境界（ミューテーションで生き残った分岐）。
// 422 の fields、principal が無いときの401、複数の利用者がいても投稿者の表示名が本人のものになること、表示名が取れないときの401。
// 方針：振る舞い（ステータス・code・fields・行の有無・表示名）で確かめ、文言は見ない。データは架空（testuser_msgb_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, insertReadyUser } from "../../test/api-request";
import {
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  ZERO_ID,
  cleanupMessageScenario,
  findDisplayNames,
  messageCount,
  postWithMissingDisplayName,
} from "../../test/message-fixtures";
import { insertUser } from "../../test/role-fixtures";
import { encodeCursor } from "../lib/cursor";
import { handleError } from "../lib/error-handler";
import { messageRoutes } from "./messages";

type User = { userId: string; token: string };

let dept: SeededDepartment;
let alice: User;
let bob: User;

const path = (roomId: string) => `/api/rooms/${roomId}/messages`;
const get = (query: string) =>
  apiRequest("GET", `${path(dept.dedicatedChannelId)}${query}`, {
    token: alice.token,
  });
const setDisplayName = (userId: string, name: string) =>
  env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
    .bind(name, userId)
    .run();

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("メッセージ境界");
  alice = await insertReadyUser("testuser_msgb_alice", dept.id);
  bob = await insertReadyUser("testuser_msgb_bob", dept.id);
  await insertMember(dept.dedicatedChannelId, alice.userId);
  await insertMember(dept.dedicatedChannelId, bob.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupMessageScenario();
});

describe("#201 AC-3 一覧のクエリの422（fields）", () => {
  it("#201 AC-3: after と cursor は、どちらも正しくても同時には指定できない（422。fields は cursor）", async () => {
    const cursor = encodeCursor({ v: ZERO_ID, id: ZERO_ID });
    const response = await get(`?after=${ZERO_ID}&cursor=${cursor}`);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["cursor"],
    });
  });

  it.each([
    ["after なしの limit=0", "?limit=0", ["limit"]],
    ["after なしの limit=101", "?limit=101", ["limit"]],
    ["after なしの壊れた cursor", "?cursor=!!", ["cursor"]],
    ["after ありの limit=0", `?after=${ZERO_ID}&limit=0`, ["limit"]],
    ["after ありの壊れた after", "?after=broken", ["after"]],
  ])(
    "#201 AC-3: %s は422で、fields は問題の項目だけ",
    async (_l, query, fields) => {
      const response = await get(query);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        fields,
      });
    },
  );
});

describe("#201 AC-1 principal が無いとき", () => {
  it.each(["GET", "POST"])(
    "#201 AC-1: ログイン情報が無いまま到達した %s は、500ではなく401 UNAUTHENTICATED で、行は増えない",
    async (method) => {
      const app = new Hono<{ Bindings: Env }>()
        .use("*", async (c, next) => {
          c.set("principal", null);
          await next();
        })
        .route("/api/rooms", messageRoutes())
        .onError(handleError);
      const response = await app.request(
        path(dept.dedicatedChannelId),
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: method === "POST" ? JSON.stringify({ body: "x" }) : undefined,
        },
        env,
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
      expect(await messageCount(dept.dedicatedChannelId)).toBe(0);
    },
  );
});

describe("#201 AC-6 投稿者の表示名", () => {
  it("#201 AC-6: 複数の利用者がいても、投稿者の表示名は本人のものになる", async () => {
    await setDisplayName(alice.userId, "テスト花子");
    await setDisplayName(bob.userId, "テスト次郎");
    for (const [user, text] of [
      [bob, "[UNIT_TEST]次郎"],
      [alice, "[UNIT_TEST]花子"],
    ] as const) {
      const response = await apiRequest("POST", path(dept.dedicatedChannelId), {
        token: user.token,
        body: { body: text },
      });
      expect(response.status).toBe(201);
    }
    const page = (await (await get("")).json()) as {
      items: { body: string; author: { id: string; displayName: string } }[];
    };
    expect(
      Object.fromEntries(
        page.items.map((i) => [i.body, [i.author.id, i.author.displayName]]),
      ),
    ).toEqual({
      "[UNIT_TEST]次郎": [bob.userId, "テスト次郎"],
      "[UNIT_TEST]花子": [alice.userId, "テスト花子"],
    });
  });

  it("#201 AC-6: Repository は存在しない利用者の表示名を null で返し、複数の利用者から指定した本人の表示名を返す", async () => {
    await setDisplayName(alice.userId, "テスト花子");
    await setDisplayName(bob.userId, "テスト次郎");
    const [aliceName, bobName, missingName] = await findDisplayNames([
      alice.userId,
      bob.userId,
      "01JTESTNOUSER0000000000000",
    ]);
    expect({ alice: aliceName, bob: bobName, missing: missingName }).toEqual({
      alice: "テスト花子",
      bob: "テスト次郎",
      missing: null,
    });
  });

  it("#201 AC-6: 投稿者の表示名が取れない（利用者が見つからない）ときは401 UNAUTHENTICATED で、挿入を試みない", async () => {
    const userId = await insertUser("testuser_msgb_ghost", dept.id);
    await insertMember(dept.dedicatedChannelId, userId);
    const { error, insertCalls } = await postWithMissingDisplayName(
      userId,
      dept.dedicatedChannelId,
      "[UNIT_TEST]表示名なし",
    );
    expect(error).toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(insertCalls).toBe(0);
  });
});
