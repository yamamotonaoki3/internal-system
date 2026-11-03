// #118 AC-2：カーソルが壊れている・不正な場合は、422で応答する（エラー形式はSkill「error-api」に従う）。
// 単体（encode/decode/toPage）、テスト用Honoルートでの結合（validate + handleError）、D1結合（afterCursor/afterId）。
import { env } from "cloudflare:workers";
import fc from "fast-check";
import { asc, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "./app-error";
import {
  PAGE_LIMIT,
  afterCursor,
  afterId,
  cursorQuerySchema,
  decodeCursor,
  encodeCursor,
  toPage,
} from "./cursor";
import { handleError, handleNotFound } from "./error-handler";
import { createUlidFactory } from "./ulid";
import { validate } from "./validation";

const VALID_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const b64 = (s: string) => btoa(s);

describe("カーソル（単体）", () => {
  it("#118 AC-2: 1ページの件数の既定値が決まっている（C-90・ADR-0006）", () => {
    expect(PAGE_LIMIT).toEqual({ message: 50, default: 20, max: 100 });
  });

  it("#118 AC-2: encode した値を decode すると元に戻る", () => {
    const payload = { v: 1, id: VALID_ID };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it("#118 AC-2: v が文字列（日時など）でも往復できる", () => {
    const payload = { v: "2026-11-03T00:00:00.000Z", id: VALID_ID };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it("#118 AC-2: v が128文字のASCII・128文字の日本語（3バイト文字）でも往復できる", () => {
    for (const v of ["a".repeat(128), "あ".repeat(128)]) {
      const payload = { v, id: VALID_ID };
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    }
  });

  it("#118 AC-2: v の文字列が129文字になると、encodeCursor が Error を投げる（decodeできないカーソルを作らない）", () => {
    expect(() => encodeCursor({ v: "a".repeat(129), id: VALID_ID })).toThrow(
      Error,
    );
    expect(() => encodeCursor({ v: "あ".repeat(129), id: VALID_ID })).toThrow(
      Error,
    );
  });

  it("#118 AC-2: encodeCursor が成功した値は、必ず decodeCursor で元に戻る", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 200 }),
          fc.stringMatching(/^[ぁ-ん一-龠a-zA-Z0-9]{0,200}$/),
          fc
            .double({ noNaN: true, noDefaultInfinity: true })
            // JSONでは -0 が 0 になるため、往復の対象から外す
            .filter((n) => !Object.is(n, -0)),
        ),
        (v) => {
          const payload = { v, id: VALID_ID };
          let encoded: string;
          try {
            encoded = encodeCursor(payload);
          } catch {
            return; // 作れない値は encode が投げる。それで足りる
          }
          expect(decodeCursor(encoded)).toEqual(payload);
        },
      ),
    );
  });

  it("#118 AC-2: 壊れたカーソルは VALIDATION_ERROR（fields: cursor）で拒否する", () => {
    const bad = [
      "",
      "!!!not-base64!!!",
      b64("not json"),
      b64(JSON.stringify({ v: 1, id: "short" })),
      b64(JSON.stringify({ v: true, id: VALID_ID })),
      b64(JSON.stringify({ v: null, id: VALID_ID })),
      b64(JSON.stringify({ v: { a: 1 }, id: VALID_ID })),
      b64(JSON.stringify({ v: 1 })),
      b64(JSON.stringify([1, 2])),
      b64("null"),
      "a".repeat(513),
    ];
    for (const s of bad) {
      let caught: unknown;
      try {
        decodeCursor(s);
      } catch (e) {
        caught = e;
      }
      expect(caught, s.slice(0, 20)).toBeInstanceOf(AppError);
      const err = caught as AppError;
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.details).toEqual({ fields: ["cursor"] });
    }
  });

  it("#118 AC-2: 任意の文字列は、成功するか AppError(VALIDATION_ERROR) になる（他の例外にならない）", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        try {
          decodeCursor(s);
        } catch (e) {
          expect(e).toBeInstanceOf(AppError);
          expect((e as AppError).code).toBe("VALIDATION_ERROR");
        }
      }),
    );
  });

  it("#118 AC-2: toPage は limit+1 件のとき次ページのカーソルを返し、limit 件に切り詰める", () => {
    const rows = ["a", "b", "c"].map((id) => ({ id }));
    const page = toPage(rows, 2, (r) => ({ v: 1, id: `${r.id}` }));
    expect(page.items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(page.nextCursor).not.toBeNull();
  });

  it("#118 AC-2: toPage は limit 件ちょうどなら次ページなし（境界）", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const page = toPage(rows, 2, (r) => ({ v: 1, id: r.id }));
    expect(page.items).toEqual(rows);
    expect(page.nextCursor).toBeNull();
  });

  it("#118 AC-2: toPage は0件なら空で次ページなし", () => {
    const page = toPage([], 20, (r: { id: string }) => ({ v: 1, id: r.id }));
    expect(page).toEqual({ items: [], nextCursor: null });
  });
});

// テスト用のHonoルート。本番と同じ validate と handleError を通す
const route = (defaultLimit: number) =>
  new Hono()
    .get(
      "/items",
      validate("query", cursorQuerySchema({ defaultLimit })),
      (c) => c.json(c.req.valid("query")),
    )
    .onError(handleError)
    .notFound(handleNotFound);

describe("カーソル（Honoルートでの結合）", () => {
  it("#118 AC-2: 壊れたカーソルは 422・VALIDATION_ERROR・fields:[cursor] で、入力値を応答に含めない", async () => {
    const secretLike = "SENTINEL_INPUT_VALUE_xyz";
    const res = await route(20).request(`/items?cursor=${secretLike}`);
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      code: "VALIDATION_ERROR",
      message: "入力内容を確かめてください",
      fields: ["cursor"],
    });
    expect(text).not.toContain(secretLike);
  });

  it("#118 AC-2: 513文字のカーソルは 422", async () => {
    const res = await route(20).request(`/items?cursor=${"A".repeat(513)}`);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { fields: string[] }).fields).toContain(
      "cursor",
    );
  });

  it("#118 AC-2: 正しいカーソルは受け付け、デコードした値を渡す", async () => {
    const cursor = encodeCursor({ v: 1, id: VALID_ID });
    const res = await route(20).request(
      `/items?cursor=${encodeURIComponent(cursor)}`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      cursor: { v: 1, id: VALID_ID },
    });
  });

  it("#118 AC-2: limit を省くと defaultLimit（20・50）になる", async () => {
    for (const n of [PAGE_LIMIT.default, PAGE_LIMIT.message]) {
      const res = await route(n).request("/items");
      expect(res.status).toBe(200);
      expect(((await res.json()) as { limit: number }).limit).toBe(n);
    }
  });

  it("#118 AC-2: limit は 1 と 100 を受け付ける", async () => {
    for (const n of [1, 100]) {
      const res = await route(20).request(`/items?limit=${n}`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { limit: number }).limit).toBe(n);
    }
  });

  it("#118 AC-2: limit が 0・101・数字でない値は 422（fields:[limit]）", async () => {
    for (const v of ["0", "101", "-1", "abc", "1.5"]) {
      const res = await route(20).request(`/items?limit=${v}`);
      expect(res.status, v).toBe(422);
      expect(await res.json()).toEqual({
        code: "VALIDATION_ERROR",
        message: "入力内容を確かめてください",
        fields: ["limit"],
      });
    }
  });
});

// D1結合：テスト専用の一時テーブル（テスト後に削除）。grp（並び替えの値）は同じ値が続く
const items = sqliteTable("unit_cursor_items", {
  id: text("id").primaryKey(),
  grp: integer("grp").notNull(),
  label: text("label").notNull(),
});
const db = drizzle(env.DB);
const cols = { sort: items.grp, id: items.id };

beforeAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS unit_cursor_items");
  await env.DB.exec(
    "CREATE TABLE unit_cursor_items (id TEXT PRIMARY KEY, grp INTEGER NOT NULL, label TEXT NOT NULL)",
  );
  // 同じミリ秒内に生成したID。grp は 0,1,2 が繰り返され、同じ値の行が複数ある
  const next = createUlidFactory({ now: () => 1_700_000_000_000 });
  for (let i = 0; i < 25; i++)
    await env.DB.prepare("INSERT INTO unit_cursor_items VALUES (?, ?, ?)")
      .bind(next(), i % 3, `[UNIT_TEST] item_${i}`)
      .run();
});

afterAll(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS unit_cursor_items");
});

const ordered = (dir: "asc" | "desc") =>
  dir === "asc"
    ? [asc(items.grp), asc(items.id)]
    : [desc(items.grp), desc(items.id)];

async function allIds(dir: "asc" | "desc") {
  const rows = await db
    .select()
    .from(items)
    .orderBy(...ordered(dir));
  return rows.map((r) => r.id);
}

async function pageThrough(dir: "asc" | "desc", limit: number) {
  const seen: string[] = [];
  let cursor: { v: string | number; id: string } | undefined;
  for (let guard = 0; guard < 30; guard++) {
    const rows = await db
      .select()
      .from(items)
      .where(cursor ? afterCursor(cols, cursor, dir) : undefined)
      .orderBy(...ordered(dir))
      .limit(limit + 1);
    const page = toPage(rows, limit, (r) => ({ v: r.grp, id: r.id }));
    seen.push(...page.items.map((r) => r.id));
    if (page.nextCursor === null) break;
    cursor = decodeCursor(page.nextCursor);
  }
  return seen;
}

describe("カーソル（D1結合）", () => {
  it("#118 AC-2: afterCursor（昇順）で、並び替えの値が同じ行が続いても重複・欠落なく全件を読める", async () => {
    expect(await pageThrough("asc", 4)).toEqual(await allIds("asc"));
    expect(await pageThrough("asc", 1)).toEqual(await allIds("asc"));
  });

  it("#118 AC-2: afterCursor（降順）でも、重複・欠落なく全件を読める", async () => {
    expect(await pageThrough("desc", 4)).toEqual(await allIds("desc"));
  });

  it("#118 AC-2: afterCursor は (sort, id) の組の境界を含まず、その後ろだけを返す", async () => {
    const all = await db
      .select()
      .from(items)
      .orderBy(...ordered("asc"));
    const pivot = all[10]!;
    const rows = await db
      .select()
      .from(items)
      .where(afterCursor(cols, { v: pivot.grp, id: pivot.id }, "asc"))
      .orderBy(...ordered("asc"));
    expect(rows.map((r) => r.id)).toEqual(all.slice(11).map((r) => r.id));
    expect(rows.map((r) => r.id)).not.toContain(pivot.id);
    // 同じ sort の値で ID が小さい行は、後ろに含まれない
    for (const r of rows)
      expect(
        r.grp > pivot.grp || (r.grp === pivot.grp && r.id > pivot.id),
      ).toBe(true);
  });

  it("#118 AC-2: afterCursor（降順）の境界は、組が小さい側", async () => {
    const all = await db
      .select()
      .from(items)
      .orderBy(...ordered("desc"));
    const pivot = all[10]!;
    const rows = await db
      .select()
      .from(items)
      .where(afterCursor(cols, { v: pivot.grp, id: pivot.id }, "desc"))
      .orderBy(...ordered("desc"));
    expect(rows.map((r) => r.id)).toEqual(all.slice(11).map((r) => r.id));
  });

  it("#118 AC-2: 並び替えの値が文字列（日時）の列でも、afterCursor で重複・欠落なく並べられる", async () => {
    const seen: string[] = [];
    const orderBy = [asc(items.label), asc(items.id)];
    const all = (
      await db
        .select()
        .from(items)
        .orderBy(...orderBy)
    ).map((r) => r.id);
    let cursor: { v: string | number; id: string } | undefined;
    for (let guard = 0; guard < 30; guard++) {
      const rows = await db
        .select()
        .from(items)
        .where(
          cursor
            ? afterCursor({ sort: items.label, id: items.id }, cursor, "asc")
            : undefined,
        )
        .orderBy(...orderBy)
        .limit(6);
      const page = toPage(rows, 5, (r) => ({ v: r.label, id: r.id }));
      seen.push(...page.items.map((r) => r.id));
      if (page.nextCursor === null) break;
      cursor = decodeCursor(page.nextCursor);
    }
    expect(seen).toEqual(all);
  });

  it("#118 AC-2: afterId は境界のIDを含めず、昇順で返す", async () => {
    const all = (await db.select().from(items).orderBy(asc(items.id))).map(
      (r) => r.id,
    );
    const rows = await db
      .select()
      .from(items)
      .where(afterId(items.id, all[4]!))
      .orderBy(asc(items.id));
    expect(rows.map((r) => r.id)).toEqual(all.slice(5));
  });

  it("#118 AC-2: afterId に ULID でない値を渡すと 422（fields:[after]）", () => {
    let caught: unknown;
    try {
      afterId(items.id, "'; DROP TABLE unit_cursor_items; --");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("VALIDATION_ERROR");
    expect((caught as AppError).details).toEqual({ fields: ["after"] });
  });
});
