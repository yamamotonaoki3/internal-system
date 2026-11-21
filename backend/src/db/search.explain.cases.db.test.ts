// #155（155-C）X-1：案件の検索（EP-4-02 GET /api/search/cases）の SQL の実行計画（計画 5章・R1-8・ADR-0010）。
// 方法は search.explain.db.test.ts と同じ（実際のアプリ入口に、実行した SQL を記録する D1 を渡して呼び、search_fts を読む SELECT を EXPLAIN QUERY PLAN する）。
// 期待（計画 R1-8）：
//   件名の候補は、外側の案件に依らない集合として作る。検索用の表（search_fts）を読む段は1回だけで、相関の副問い合わせ（CORRELATED）の中にない
//     （案件ごとに FTS の検索を繰り返さない）。3文字以上（MATCH）は仮想の表の索引で引く。1〜2文字（instr）は検索用の表の全件を見る（ADR-0010 の前提）。
//   番号・取引先名の一致は cases・clients を走査する（案件が少ない前提。計画 11章）。ここでは判定せず、実行計画を記録として出力する（実測は #160）。
// データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_ORIGIN } from "../../test/api-request";
import {
  SESSION_COOKIE,
  TEST_IP,
  newThrottleKey,
} from "../../test/auth-fixtures";
import { cleanupCaseTestData, seedCase } from "../../test/case-fixtures";
import {
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import {
  buildCaseTitleIndex,
  cleanupCaseTitleIndex,
} from "../../test/search-case-fixtures";
import { cleanupSearchIndex } from "../../test/search-fixtures";
import { app } from "../index";

type Recorded = { sql: string; params: unknown[] };
type PlanRow = { id: number; parent: number; detail: string };

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

/** search_fts を読む SELECT の実行計画（行の id・parent つき）。文ごとに分けて返す */
async function searchPlans(statements: Recorded[]): Promise<PlanRow[][]> {
  const searchStatements = statements.filter(
    (s) => /^\s*(SELECT|WITH)\b/i.test(s.sql) && s.sql.includes("search_fts"),
  );
  if (searchStatements.length === 0)
    throw new Error("search_fts を読む SELECT が記録されていません");
  const plans: PlanRow[][] = [];
  for (const statement of searchStatements) {
    const { results } = await env.DB.prepare(
      `EXPLAIN QUERY PLAN ${statement.sql}`,
    )
      .bind(...statement.params)
      .all<PlanRow>();
    plans.push(results);
  }
  return plans;
}

/** 検索用の表（仮想の表）を読む行 */
const virtualScans = (plan: PlanRow[]) =>
  plan.filter((row) => row.detail.includes("VIRTUAL TABLE"));

/** その行の祖先（親を辿る）に、相関の副問い合わせがあるか */
function underCorrelated(plan: PlanRow[], row: PlanRow): boolean {
  const byId = new Map(plan.map((r) => [r.id, r]));
  let current = byId.get(row.parent);
  for (let depth = 0; current !== undefined && depth < 50; depth += 1) {
    if (/CORRELATED/.test(current.detail)) return true;
    current = byId.get(current.parent);
  }
  return false;
}

const text = (plan: PlanRow[]) =>
  plan.map((r) => `${String(r.id)}<${String(r.parent)} ${r.detail}`).join("\n");

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = await setupCaseWorld();
  for (let i = 0; i < 30; i += 1)
    await seedCase({
      n: 1950 + i,
      clientId: i % 2 === 0 ? w.clientA.id : w.clientB.id,
      code: i % 2 === 0 ? "QZA" : "QZB",
      title: `[UNIT_TEST]実行計画の案件${String(i)}`,
      createdBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
    });
  await buildCaseTitleIndex();
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupCaseTestData();
    await cleanupCaseTitleIndex();
  }
});

const path = (q: string) =>
  `/api/search/cases?${new URLSearchParams({ q }).toString()}`;

describe("#155 4-1 AC-3 155-C X-1 案件の検索の実行計画", () => {
  it.each([
    { name: "3文字以上（MATCH）", q: "実行計画の案件" },
    { name: "1〜2文字（instr）", q: "案件" },
  ])(
    "#155 X-1 R1-8: $name で、検索用の表を読む段は1回だけで、相関の副問い合わせの中にない（先に一致した行が返ることを確かめる）",
    async ({ q }) => {
      const { response, statements } = await recordedGet(
        path(q),
        w.memberS1.token,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: unknown[] };
      expect(body.items.length).toBeGreaterThan(0);
      const plans = await searchPlans(statements);
      expect(plans).toHaveLength(1);
      const plan = plans[0] ?? [];
      const scans = virtualScans(plan);
      expect(scans, text(plan)).toHaveLength(1);
      for (const scan of scans)
        expect(underCorrelated(plan, scan), text(plan)).toBe(false);
      // 番号・取引先名の走査の記録（判定しない。PR の知見に書く材料）
      console.info(`X-1 ${q}\n${text(plan)}`);
    },
  );

  it("#155 X-1: 3文字以上（MATCH）では、検索用の表を仮想の表の索引（MATCH）で引く", async () => {
    const { response, statements } = await recordedGet(
      path("実行計画の案件"),
      w.memberS1.token,
    );
    expect(response.status).toBe(200);
    const [plan = []] = await searchPlans(statements);
    expect(
      virtualScans(plan).some((row) =>
        /VIRTUAL TABLE INDEX \d+:M/.test(row.detail),
      ),
      text(plan),
    ).toBe(true);
  });
});
