// #155（155-C）既存の案件の件名の索引の登録（reindexCases。利用者の決定 2026-11-21：既存の案件の索引は、メッセージと同じ「登録の処理」で作る）。
// 期待は、計画 2章「登録」（cases.id の昇順に batchSize〔既定100〕件ずつ読み、案件ごとに件名の組を実行し、最後に読んだ ID を返す。
//   読む行がなければ null。afterId は含めない。べき等で、最初から・返った ID からの再開のどちらでもよい。進行中・終了のどちらも対象）から決める。
// 契約は test/search-case-fixtures.ts の冒頭（reindexCases）。メッセージの登録（reindexMessages）は変えない。
// データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  caseIdOf,
  cleanupCaseTestData,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  NO_CASE_TITLE_MISMATCH,
  buildCaseTitleIndex,
  caseTitleIndexMismatches,
  caseTitleIndexSnapshot,
  cleanupCaseTitleIndex,
  ftsInstrCaseIds,
  ftsMatchCaseIds,
  totalCaseTitleDocuments,
} from "../../test/search-case-fixtures";
import { cleanupSearchIndex } from "../../test/search-fixtures";
import { withDatabase } from "./database";
import { reindexCases } from "./search-reindex";

let w: CaseWorld;
let cases: SeededCase[];

const WORDS = ["萌黄書院", "若竹書院", "東雲書院", "茜色書院", "鈍色書院"];

const reindexOnce = (afterId: string | null, batchSize?: number) =>
  withDatabase(env, (db) =>
    reindexCases(db, {
      afterId,
      ...(batchSize === undefined ? {} : { batchSize }),
    }),
  );

beforeEach(async () => {
  w = await setupCaseWorld();
  cases = [];
  // 登録の順と ID の順を違える（n の順に ID が増える）
  for (const [i, n] of [1863, 1861, 1865, 1862, 1864].entries())
    cases.push(
      await seedCase({
        n,
        clientId: w.clientA.id,
        code: "QZA",
        title: `[UNIT_TEST]155C${WORDS[i] ?? ""}の案件`,
        createdBy: w.memberS1.id,
        departmentIds: [w.deptS.id],
        // 終了した案件も登録の対象
        ...(i === 2 ? { status: "closed" as const } : {}),
      }),
    );
});

afterEach(async () => {
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupCaseTestData();
    await cleanupCaseTitleIndex();
  }
});

describe("#155 4-2 AC-1 155-C 既存の案件の件名の登録（reindexCases）", () => {
  it("#155 4-2 AC-1: 登録の前は件名で引けず、登録の後は各案件（終了を含む）の件名で引ける（3文字以上・2文字）。不一致は0件", async () => {
    expect(await ftsMatchCaseIds(WORDS[0] ?? "")).toEqual([]);
    expect(await caseTitleIndexMismatches()).toEqual({
      ...NO_CASE_TITLE_MISMATCH,
      missing: 5,
    });
    await buildCaseTitleIndex();
    for (const [i, seeded] of cases.entries()) {
      expect(await ftsMatchCaseIds(WORDS[i] ?? "")).toEqual([seeded.id]);
      expect(await ftsInstrCaseIds((WORDS[i] ?? "").slice(0, 2))).toEqual([
        seeded.id,
      ]);
    }
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
  });

  it("#155 4-2 AC-1: 2回登録しても、件名の行は案件ごとに1行のまま（行の id も変わらない）", async () => {
    await buildCaseTitleIndex();
    const first = await caseTitleIndexSnapshot();
    expect(first.documents).toHaveLength(5);
    await buildCaseTitleIndex();
    expect(await caseTitleIndexSnapshot()).toEqual(first);
  });

  it("#155 4-2 AC-1: 戻り値は、その回に読んだ最後の案件の ID（ID の昇順）で、afterId は含めない。読む行がなければ null", async () => {
    const ascending = [...cases.map((c) => c.id)].sort();
    expect(await reindexOnce(null, 2)).toBe(ascending[1]);
    expect(await reindexOnce(ascending[1] ?? null, 2)).toBe(ascending[3]);
    expect(await reindexOnce(ascending[3] ?? null, 2)).toBe(ascending[4]);
    expect(await reindexOnce(ascending[4] ?? null, 2)).toBeNull();
    // afterId より後の行だけを読む（最初の2件の後から読んだ回は、最初の2件を登録しない）
    expect(await totalCaseTitleDocuments()).toBe(5);
  });

  it("#155 4-2 AC-1: 途中の ID から再開しても（1件ずつ・最初の回だけ実行した後に続きから）、最後は全件を1回ずつ登録した状態と同じ", async () => {
    const ascending = [...cases.map((c) => c.id)].sort();
    expect(await reindexOnce(null, 1)).toBe(ascending[0]);
    expect(await totalCaseTitleDocuments()).toBe(1);
    expect(await ftsMatchCaseIds("155C")).toEqual([ascending[0]]);
    // 返った ID から続ける
    let after: string | null = ascending[0] ?? null;
    for (let round = 0; round < 10 && after !== null; round += 1)
      after = await reindexOnce(after, 1);
    expect(after).toBeNull();
    expect(await totalCaseTitleDocuments()).toBe(5);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
    expect(await ftsMatchCaseIds("155C")).toEqual(ascending);
  });

  it("#155 4-2 AC-1: 既定の batchSize（100）を超える分も、回を分けて登録できる（回数は2回以上）", async () => {
    // 6件目以降を100件作る（合わせて105件。ID は既存の5件より大きい）
    const extra: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      const seeded = await seedCase({
        n: 1900 + i,
        clientId: w.clientA.id,
        code: "QZA",
        title: `[UNIT_TEST]155C大量登録${String(i).padStart(3, "0")}`,
        createdBy: w.memberS1.id,
        departmentIds: [w.deptS.id],
      });
      extra.push(seeded.id);
    }
    expect(extra[0]).toBe(caseIdOf(1900));
    const rounds = await buildCaseTitleIndex();
    expect(rounds).toBeGreaterThanOrEqual(2);
    expect(await totalCaseTitleDocuments()).toBe(105);
    expect(await caseTitleIndexMismatches()).toEqual(NO_CASE_TITLE_MISMATCH);
  });
});
