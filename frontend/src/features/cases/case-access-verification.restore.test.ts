// #342 AC-5・AC-6・AC-8・AC-10（計画 plan342a2 の 3-1「直接の概要取得の契約」、7 節の U12、計画レビュー3回目の軽微2）：
// verifyBySummaryFetch(caseId, { withFailureStatus: true }) は、判定に加えて、判定の根拠になった HTTP の状態（成功は null、通信の失敗は 0）を返す。
// 403 は判定としては unverified のまま、状態 403 を渡す。404 は notFound。特定の 409（SESSION_USER_MISMATCH）は既存の確かめを使い、
// その後のセッションの確かめが 401 なら、状態 401 を渡す。API の失敗でない例外（応答の検証の失敗）は、これまでどおり投げる。
// 1つの引数の呼び出し（通常の経路）は、これまでどおり5種類の判定（文字列）だけを返す。
// 軽微2：概要の取得の 409 の後の確かめは、既存の決まりどおり「同じ利用者が続いた回数」に数える（3回目で unknown・セッションは失敗の状態）。
// 通信は MSW。409 の後の確かめは本物（createSessionUserMismatchHandler を登録する）。データはすべて架空（testuser_・[UNIT_TEST]）。
// 前提にした口（実装の担当へ）：case-access-verification.ts の verifyBySummaryFetch の重ねた定義
//   verifyBySummaryFetch(caseId): Promise<CaseAccessVerdict>
//   verifyBySummaryFetch(caseId, { withFailureStatus: true }): Promise<{ verdict: CaseAccessVerdict; failureStatus: number | null }>
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUserSwitchReloadRequested } from "../access-loss";
import { createSessionUserMismatchHandler, installDocumentUser } from "../auth";
import { fetchSession } from "../auth/api/auth-api";
import { TEST_USER } from "../../test/auth-handlers";
import { caseSummary, outsiderSummary } from "../../test/case-handlers";
import { server } from "../../test/server";
import { verifyBySummaryFetch } from "./case-access-verification";

vi.mock("../access-loss", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isUserSwitchReloadRequested: vi.fn(() => false),
}));

const N = 3429;
const CASE = caseSummary(N).id;
const OTHER_USER = {
  id: "01JTESTUSER342000000000VF2",
  displayName: "testuser_342_vf",
  loginId: "testuser_342_vf",
};

type Summary =
  | { kind: "participant" }
  | { kind: "outsider" }
  | { kind: "status"; status: number; code: string }
  | { kind: "network" }
  | { kind: "invalid" };

let summaryAnswers: Summary[];
let sessionAnswers: (
  { id: string; displayName: string; loginId: string } | 401
)[];
let client: QueryClient;
let stopDocumentUser: () => void;

const sessionOf = (user: {
  id: string;
  displayName: string;
  loginId: string;
}) => ({
  user,
  permissions: [],
  mustChangePassword: false,
  reauthenticatedAt: null,
});

function summaryResponse(answer: Summary) {
  switch (answer.kind) {
    case "participant":
      return HttpResponse.json(caseSummary(N));
    case "outsider":
      return HttpResponse.json(outsiderSummary(N));
    case "status":
      return HttpResponse.json(
        { code: answer.code, message: "[UNIT_TEST]342概要の失敗" },
        { status: answer.status },
      );
    case "network":
      return HttpResponse.error();
    case "invalid":
      return HttpResponse.json({ id: CASE, isParticipant: "yes" });
  }
}

beforeEach(() => {
  summaryAnswers = [];
  sessionAnswers = [];
  server.use(
    http.get("/api/cases/:caseId", () =>
      summaryResponse(summaryAnswers.shift() ?? { kind: "participant" }),
    ),
    http.get("/api/auth/session", () => {
      const next = sessionAnswers.shift() ?? TEST_USER;
      return next === 401
        ? HttpResponse.json(
            { code: "UNAUTHENTICATED", message: "[UNIT_TEST]342未ログイン" },
            { status: 401 },
          )
        : HttpResponse.json(sessionOf(next));
    }),
  );
  vi.mocked(isUserSwitchReloadRequested).mockReset();
  vi.mocked(isUserSwitchReloadRequested).mockReturnValue(false);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // アプリでは useSession が与える取得の関数（409 の後の取り直しが、手で置いたセッションの Query でも動くように）
  client.setQueryDefaults(["auth", "session"], { queryFn: fetchSession });
  client.setQueryData(["auth", "session"], sessionOf(TEST_USER));
  stopDocumentUser = installDocumentUser(client);
  createSessionUserMismatchHandler({
    queryClient: client,
    onOtherUser: vi.fn(),
  });
});
afterEach(() => {
  stopDocumentUser();
  client.clear();
});

const mismatch: Summary = {
  kind: "status",
  status: 409,
  code: "SESSION_USER_MISMATCH",
};

describe("#342 AC-5・AC-6 U12 詳しい結果（判定と、根拠の HTTP の状態）", () => {
  it.each([
    [
      "参加者",
      { kind: "participant" },
      { verdict: "participant", failureStatus: null },
    ],
    [
      "成功して非参加",
      { kind: "outsider" },
      { verdict: "lost", failureStatus: null },
    ],
    [
      "404",
      { kind: "status", status: 404, code: "NOT_FOUND" },
      { verdict: "notFound", failureStatus: 404 },
    ],
    [
      "403",
      { kind: "status", status: 403, code: "FORBIDDEN" },
      { verdict: "unverified", failureStatus: 403 },
    ],
    [
      "500",
      { kind: "status", status: 500, code: "INTERNAL_ERROR" },
      { verdict: "unverified", failureStatus: 500 },
    ],
    [
      "503",
      { kind: "status", status: 503, code: "SERVICE_UNAVAILABLE" },
      { verdict: "unverified", failureStatus: 503 },
    ],
    [
      "401",
      { kind: "status", status: 401, code: "UNAUTHENTICATED" },
      { verdict: "unverified", failureStatus: 401 },
    ],
    [
      "通信の失敗",
      { kind: "network" },
      { verdict: "unverified", failureStatus: 0 },
    ],
  ] as [string, Summary, { verdict: string; failureStatus: number | null }][])(
    "#342 AC-5・AC-6 U12: 概要が%sなら、判定と、根拠の状態を返す（期待は表のとおり）",
    async (_label, answer, expected) => {
      summaryAnswers.push(answer);
      await expect(
        verifyBySummaryFetch(CASE, { withFailureStatus: true }),
      ).resolves.toEqual(expected);
    },
  );

  it("#342 AC-8 U12: 409 SESSION_USER_MISMATCH の後のセッションの確かめが 401 なら、状態 401 を渡す（判定は unverified）", async () => {
    summaryAnswers.push(mismatch);
    sessionAnswers.push(401);
    await expect(
      verifyBySummaryFetch(CASE, { withFailureStatus: true }),
    ).resolves.toEqual({ verdict: "unverified", failureStatus: 401 });
  });

  it("#342 AC-6 U12: 409 の後のセッションの確かめが同じ利用者なら、判定は unverified で、状態は 409", async () => {
    summaryAnswers.push(mismatch);
    await expect(
      verifyBySummaryFetch(CASE, { withFailureStatus: true }),
    ).resolves.toEqual({ verdict: "unverified", failureStatus: 409 });
  });

  it("#342 AC-3 U12: 409 の後に別の利用者と確かめられ、切り替えの入口が動いていれば、判定は switched", async () => {
    vi.mocked(isUserSwitchReloadRequested).mockReturnValue(true);
    summaryAnswers.push(mismatch);
    sessionAnswers.push(OTHER_USER);
    const result = await verifyBySummaryFetch(CASE, {
      withFailureStatus: true,
    });
    expect(result.verdict).toBe("switched");
  });

  it("#342 AC-6 U12: 応答が契約に合わない（検証の失敗）なら、詳しい結果にせず、投げる", async () => {
    summaryAnswers.push({ kind: "invalid" });
    const outcome = await verifyBySummaryFetch(CASE, {
      withFailureStatus: true,
    }).then(
      (value) => ({ resolved: value }),
      (error: unknown) => ({ rejected: error }),
    );
    expect(outcome).not.toHaveProperty("resolved");
    expect(outcome).toHaveProperty("rejected");
  });
});

describe("#342 AC-10 U12 1つの引数の呼び出し（通常の経路）は、これまでどおり5種類の判定だけ", () => {
  it.each([
    ["参加者", { kind: "participant" }, "participant"],
    ["成功して非参加", { kind: "outsider" }, "lost"],
    ["404", { kind: "status", status: 404, code: "NOT_FOUND" }, "notFound"],
    ["403", { kind: "status", status: 403, code: "FORBIDDEN" }, "unverified"],
    [
      "500",
      { kind: "status", status: 500, code: "INTERNAL_ERROR" },
      "unverified",
    ],
    ["通信の失敗", { kind: "network" }, "unverified"],
  ] as [string, Summary, string][])(
    "#342 AC-10 U12: 概要が%sなら、判定の文字列だけを返す（期待は表のとおり）",
    async (_label, answer, verdict) => {
      summaryAnswers.push(answer);
      await expect(verifyBySummaryFetch(CASE)).resolves.toBe(verdict);
    },
  );

  it("#342 AC-10 U12: 409 の後に別の利用者と確かめられ、切り替えの入口が動いていれば switched（文字列）", async () => {
    vi.mocked(isUserSwitchReloadRequested).mockReturnValue(true);
    summaryAnswers.push(mismatch);
    sessionAnswers.push(OTHER_USER);
    await expect(verifyBySummaryFetch(CASE)).resolves.toBe("switched");
  });

  it("#342 AC-10 U12: 応答の検証の失敗は、これまでどおり投げる", async () => {
    summaryAnswers.push({ kind: "invalid" });
    const outcome = await verifyBySummaryFetch(CASE).then(
      (value) => ({ resolved: value }),
      (error: unknown) => ({ rejected: error }),
    );
    expect(outcome).not.toHaveProperty("resolved");
  });
});

describe("#342 計画レビュー3回目の軽微2 概要の取得の 409 は、既存の決まりどおり数える", () => {
  it("#342 AC-10 軽微2（対照）: 1つの引数の呼び出しで、409 の後に同じ利用者が3回続けば、3回目でセッションを失敗の状態にする（いまの決まり）", async () => {
    summaryAnswers.push(mismatch, mismatch, mismatch);
    for (let i = 0; i < 2; i += 1) {
      await expect(verifyBySummaryFetch(CASE)).resolves.toBe("unverified");
      expect(client.getQueryState(["auth", "session"])?.status).toBe("success");
    }
    await expect(verifyBySummaryFetch(CASE)).resolves.toBe("unverified");
    expect(client.getQueryState(["auth", "session"])?.status).toBe("error");
  });

  it("#342 AC-10 軽微2: 詳しい結果の呼び出しでも、409 の後に同じ利用者が3回続けば、3回目でセッションを「確かめられない」（失敗の状態）にする", async () => {
    summaryAnswers.push(mismatch, mismatch, mismatch);
    for (let i = 0; i < 2; i += 1) {
      await expect(
        verifyBySummaryFetch(CASE, { withFailureStatus: true }),
      ).resolves.toEqual({ verdict: "unverified", failureStatus: 409 });
      expect(client.getQueryState(["auth", "session"])?.status).toBe("success");
    }
    await expect(
      verifyBySummaryFetch(CASE, { withFailureStatus: true }),
    ).resolves.toMatchObject({ verdict: "unverified" });
    expect(client.getQueryState(["auth", "session"])?.status).toBe("error");
  });
});
