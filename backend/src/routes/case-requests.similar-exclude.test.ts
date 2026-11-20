// #150（150-C）C-122(6)・計画 4.5：類似件名の確認（GET /api/case-requests/similar-title）の任意のクエリ excludeCaseId を、
// 実際のアプリ入口と隔離 D1 で確かめる。再編集の画面は、編集中の案件自身を「似た案件」に数えないために使う。
// 確かめるもの：excludeCaseId でその案件自身が除かれ、ほかの同名の案件・審査中の申請は残る。省くと従来どおり。形の誤りは 422。
// 応答は従来どおり { hasSimilar, formattedTitle } だけ（件名・件数・案件 ID を返さない）。
// 計画の「db/case-request.repository.db.test.ts への追加」は、既存の大きなファイルに足さず、ここ（Controller から DB まで通す層）で確かめる。
// 期待値は計画 150-C 4.5 と 5-3 AC-14・C-141(3)（同じ取引先・整形後の件名の完全一致）から決める。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  MISSING_CASE_ID,
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  BASE,
  CASEREQ_NOW,
  insertCaseRequest,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";

const TITLE = "[UNIT_TEST]150C 類似の件名";

let w: CaseWorld;
let room: SeededCase;

const similar = (query: Record<string, string>) =>
  apiRequest(
    "GET",
    `${BASE}/similar-title?${new URLSearchParams(query).toString()}`,
    { token: w.memberS1.token },
  );

async function hasSimilar(query: Record<string, string>): Promise<boolean> {
  const res = await similar(query);
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["formattedTitle", "hasSimilar"]);
  return body.hasSimilar as boolean;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1671,
    clientId: w.clientA.id,
    code: "QZA",
    title: TITLE,
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [{ userId: w.memberS1.id, joinedAt: joinedAt(1) }],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#150 150-C 類似件名の確認の excludeCaseId（計画 4.5）", () => {
  it("#150 C-122(6): 同名の案件がその案件だけなら、excludeCaseId を付けると似た案件はない（付けなければある）", async () => {
    expect(await hasSimilar({ clientId: w.clientA.id, title: TITLE })).toBe(
      true,
    );
    expect(
      await hasSimilar({
        clientId: w.clientA.id,
        title: TITLE,
        excludeCaseId: room.id,
      }),
    ).toBe(false);
  });

  it("#150 C-122(6): 同じ取引先・同名のほかの案件は、excludeCaseId を付けても残る", async () => {
    await seedCase({
      n: 1672,
      clientId: w.clientA.id,
      code: "QZA",
      title: TITLE,
      createdBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
    });
    expect(
      await hasSimilar({
        clientId: w.clientA.id,
        title: TITLE,
        excludeCaseId: room.id,
      }),
    ).toBe(true);
  });

  it("#150 4.5: 同じ取引先・同名の審査中の申請は、excludeCaseId を付けても残る（申請の側は変えない）", async () => {
    await insertCaseRequest({
      clientId: w.clientA.id,
      title: TITLE,
      requestedBy: w.memberS2.id,
      departmentIds: [w.deptS.id],
    });
    expect(
      await hasSimilar({
        clientId: w.clientA.id,
        title: TITLE,
        excludeCaseId: room.id,
      }),
    ).toBe(true);
  });

  it("#150 4.5: 存在しない案件 ID を excludeCaseId にしても、従来どおりの結果（エラーにしない）", async () => {
    expect(
      await hasSimilar({
        clientId: w.clientA.id,
        title: TITLE,
        excludeCaseId: MISSING_CASE_ID,
      }),
    ).toBe(true);
  });

  it.each(["not-a-ulid", ""])(
    "#150 4.5: excludeCaseId が ULID の形でない（%j）なら 422",
    async (value) => {
      const res = await similar({
        clientId: w.clientA.id,
        title: TITLE,
        excludeCaseId: value,
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    },
  );
});
