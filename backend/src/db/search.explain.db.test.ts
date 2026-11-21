// #155（155-A）D-13：メッセージの検索の SQL の実行計画（計画 4.6・ADR-0010）。
// 実際のアプリ入口（index.ts の app）に、実行した SQL を記録する D1 を渡して GET /api/search/messages を呼び、記録した SELECT を EXPLAIN QUERY PLAN する
// （threads.explain.db.test.ts と同じ方法。Repository の関数名に依存しない）。
// 期待：
//   3文字以上（MATCH）：検索用の表（search_fts）を仮想の表の索引で引き、ほかの表（messages・search_documents・資格の判定の表）は頭から読まない（SEARCH だけ）。
//   1〜2文字（instr）：ADR-0010 のとおり、検索用の表は全件を見る（仮想の表の走査）ことを前提とする。それ以外の表は頭から読まない。
//   1〜2文字＋部屋の絞り込み：対応の表（search_documents）を、部屋の列で始まる索引で引く（計画 4.1 の索引 (room_id, created_at, id)）。
// 155-B X-1：添付ファイル名の一致（kind=attachment）を含めても、検索用の表のほかに、添付・メッセージ・対応の表を頭から読まない（添付・メッセージは主キーで引く）。
//   添付の写しは、メッセージの半分に添付を結んでから登録して作る。
// データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_ORIGIN } from "../../test/api-request";
import {
  SESSION_COOKIE,
  TEST_IP,
  newThrottleKey,
} from "../../test/auth-fixtures";
import { cleanupCaseTestData } from "../../test/case-fixtures";
import {
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertMember,
} from "../../test/department-fixtures";
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import {
  cleanupRelatedReadsRooms,
  fixedIdAt,
  insertAttachmentRow,
} from "../../test/related-reads-fixtures";
import {
  buildSearchIndex,
  cleanupSearchIndex,
} from "../../test/search-fixtures";
import { app } from "../index";

type Recorded = { sql: string; params: unknown[] };

const BASE_MS = 1_876_000_000_000;
const ROOM = fixedIdAt(BASE_MS);
const OTHER_ROOM = fixedIdAt(BASE_MS + 1);
let w: CaseWorld;

async function recordedGet(path: string, token: string) {
  const statements: Recorded[] = [];
  const db = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare")
        return (query: string) => {
          const entry: Recorded = { sql: query, params: [] };
          statements.push(entry);
          const prepared = target.prepare(query);
          return new Proxy(prepared, {
            get(stmt, key) {
              if (key === "bind")
                return (...values: unknown[]) => {
                  entry.params = values;
                  return stmt.bind(...values);
                };
              const value: unknown = Reflect.get(stmt, key, stmt);
              return typeof value === "function" ? value.bind(stmt) : value;
            },
          });
        };
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const response = await app.request(
    path,
    {
      method: "GET",
      headers: {
        Origin: API_ORIGIN,
        "CF-Connecting-IP": TEST_IP,
        Cookie: `${SESSION_COOKIE}=${token}`,
      },
    },
    {
      ...env,
      DB: db,
      LOGIN_THROTTLE_KEY: newThrottleKey(),
      SETUP_TOKEN: newSetupToken(),
      PII_ENCRYPTION_KEY: newPiiKey(),
    } as unknown as Env,
  );
  return { response, statements };
}

/** 検索用の表を読む SELECT だけの実行計画 */
async function searchPlans(statements: Recorded[]): Promise<string[]> {
  const details: string[] = [];
  const searchStatements = statements.filter(
    (s) => /^\s*(SELECT|WITH)\b/i.test(s.sql) && s.sql.includes("search_fts"),
  );
  if (searchStatements.length === 0)
    throw new Error("search_fts を読む SELECT が記録されていません");
  for (const statement of searchStatements) {
    const { results } = await env.DB.prepare(
      `EXPLAIN QUERY PLAN ${statement.sql}`,
    )
      .bind(...statement.params)
      .all<{ detail: string }>();
    details.push(...results.map((row) => row.detail));
  }
  return details;
}

/** 仮想の表でない表を、索引なしで頭から読む行 */
function plainFullScans(details: string[]): string[] {
  return details.filter(
    (d) =>
      /^SCAN /.test(d) &&
      !d.includes("VIRTUAL TABLE") &&
      !d.includes(" USING ") &&
      !/^SCAN CONSTANT ROW/.test(d),
  );
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = await setupCaseWorld();
  for (const [id, name] of [
    [ROOM, "explain"],
    [OTHER_ROOM, "explain-other"],
  ] as const) {
    await insertChannel({
      id,
      name: `${TEST_TAG}search-${name}`,
      purpose: "normal",
      departmentId: w.deptS.id,
      visibility: "public",
    });
    await insertMember(id, w.memberS1.id);
  }
  const statements = Array.from({ length: 30 }, (_, i) =>
    env.DB.prepare(
      `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at)
       VALUES (?, ?, ?, 'テスト太郎', ?, ?)`,
    ).bind(
      fixedIdAt(BASE_MS + 1_000 + i * 1_000),
      i % 2 === 0 ? ROOM : OTHER_ROOM,
      w.memberS1.id,
      `${TEST_TAG}実行計画の確認${i}`,
      new Date(BASE_MS + 1_000 + i * 1_000).toISOString(),
    ),
  );
  await env.DB.batch(statements);
  await buildSearchIndex();
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupRelatedReadsRooms([ROOM, OTHER_ROOM]);
    await cleanupCaseTestData();
  }
});

const path = (query: Record<string, string>) =>
  `/api/search/messages?${new URLSearchParams(query).toString()}`;

describe("#155 AC-3 D-13 実行計画", () => {
  it("#155 AC-3 D-13: 3文字以上（MATCH）は検索用の表を仮想の表の索引で引き、ほかの表は頭から読まない（部屋・期間の指定あり・なし）", async () => {
    const queries: Record<string, string>[] = [
      { q: "実行計画の確認" },
      { q: "実行計画の確認", roomId: ROOM },
      { q: "実行計画の確認", from: "2029-06-01", to: "2029-06-30" },
    ];
    for (const query of queries) {
      const { response, statements } = await recordedGet(
        path(query),
        w.memberS1.token,
      );
      expect(response.status).toBe(200);
      const plan = await searchPlans(statements);
      const text = `${JSON.stringify(query)}\n${plan.join("\n")}`;
      expect(
        plan.some((d) =>
          /search_fts.*VIRTUAL TABLE|VIRTUAL TABLE.*search_fts|^SCAN \w+ VIRTUAL TABLE INDEX \d+:M/.test(
            d,
          ),
        ),
        text,
      ).toBe(true);
      expect(plainFullScans(plan), text).toEqual([]);
    }
  });

  it("#155 AC-3 D-13: 1〜2文字（instr）は検索用の表の全件を見る（ADR-0010 の前提）。ほかの表は頭から読まない", async () => {
    const { response, statements } = await recordedGet(
      path({ q: "確認" }),
      w.memberS1.token,
    );
    expect(response.status).toBe(200);
    const plan = await searchPlans(statements);
    expect(plainFullScans(plan), plan.join("\n")).toEqual([]);
  });

  it("#155 AC-3 D-13: 1〜2文字＋部屋の絞り込みは、対応の表を部屋の列の索引で引く", async () => {
    const { response, statements } = await recordedGet(
      path({ q: "確認", roomId: ROOM }),
      w.memberS1.token,
    );
    expect(response.status).toBe(200);
    const plan = await searchPlans(statements);
    const text = plan.join("\n");
    expect(
      plan.some((d) => /USING (?:COVERING )?INDEX \S*room\S*/i.test(d)),
      text,
    ).toBe(true);
    expect(plainFullScans(plan), text).toEqual([]);
  });
});

describe("#155 AC-3 155-B X-1 実行計画（添付ファイル名の一致を含む）", () => {
  it("#155 AC-3 X-1: 添付の写しがあっても、3文字以上（部屋・期間の指定あり・なし）・1〜2文字・1〜2文字＋部屋で、検索用の表以外を頭から読まない", async () => {
    for (let i = 0; i < 30; i += 2)
      await insertAttachmentRow({
        roomId: i % 2 === 0 ? ROOM : OTHER_ROOM,
        uploaderId: w.memberS1.id,
        messageId: fixedIdAt(BASE_MS + 1_000 + i * 1_000),
        originalName: `実行計画の添付名${i}.txt`,
      });
    await buildSearchIndex();
    const queries: Record<string, string>[] = [
      { q: "実行計画の添付名" },
      { q: "実行計画の添付名", roomId: ROOM },
      { q: "実行計画の添付名", from: "2029-06-01", to: "2029-06-30" },
      { q: "添付" },
      { q: "添付", roomId: ROOM },
    ];
    for (const query of queries) {
      const { response, statements } = await recordedGet(
        path(query),
        w.memberS1.token,
      );
      expect(response.status).toBe(200);
      // 先に「ある」を確かめる（添付の名前で一致した行が返っている）
      const body = (await response.json()) as { items: unknown[] };
      if (query.from === undefined)
        expect(body.items.length, JSON.stringify(query)).toBeGreaterThan(0);
      const plan = await searchPlans(statements);
      const text = [JSON.stringify(query), ...plan].join("\n");
      expect(plainFullScans(plan), text).toEqual([]);
    }
  });
});
