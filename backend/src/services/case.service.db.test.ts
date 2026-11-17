// #147（147-A）コードレビュー1回目（重大1）：認可の判定（概要の読み取りでは有効な参加者）を通った後に、詳細の読み取りが「見られない」を返した場合
// （認可と取得の間に無効化・参加の解除が確定した場合）の Service の扱いを確かめる。
// 実際の D1 の Repository を使い、詳細の読み取り（findDetailExtras）だけを代役に差し替えて、その間の変化を再現する。
// 契約（実装の担当へ）：
//   repository.findDetailExtras({ caseId, actorId }): 詳細の項目 | "not_visible" | "not_found"
//   Service.detail は、not_visible なら 403 FORBIDDEN「参加者だけが見られます（非公開）」、not_found なら 404 NOT_FOUND「案件が見つかりません」
//   どちらも、説明・参加者を返さない（例外を投げる）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  casereqTraceId,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { withCases, type CaseRepository } from "../db/case.repository";
import { AppError } from "../lib/app-error";
import { createCaseService } from "./case.service";

let w: CaseWorld;
let target: SeededCase;

type DetailResult = Awaited<ReturnType<CaseRepository["findDetailExtras"]>>;

/** 詳細の読み取りだけを差し替えた Service で、memberS1 として詳細を取る */
function detailWith(result: DetailResult) {
  return withCases(env, (repository, roles) => {
    const findDetailExtras = vi.fn(async () => result);
    const service = createCaseService(
      { ...repository, findDetailExtras },
      roles,
    );
    return service
      .detail({ userId: w.memberS1.id, traceId: casereqTraceId() }, target.id)
      .then(
        (value) => ({ value, error: null, findDetailExtras }),
        (error: unknown) => ({ value: null, error, findDetailExtras }),
      );
  });
}

beforeEach(async () => {
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation(() => {});
  w = await setupCaseWorld();
  target = await seedCase({
    n: 1,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]147A認可と取得の間",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    description: "[UNIT_TEST]147A取得の間に見えなくなる説明",
    members: [{ userId: w.memberS1.id, joinedAt: joinedAt(1) }],
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#147 コードレビュー1回目（重大1）：認可の後に見られなくなった詳細", () => {
  it("#147 5-1 AC-14: 認可は通ったが、詳細の読み取りが not_visible なら 403「参加者だけが見られます（非公開）」で、中身を返さない", async () => {
    const { value, error, findDetailExtras } = await detailWith("not_visible");
    expect(findDetailExtras).toHaveBeenCalledWith({
      caseId: target.id,
      actorId: w.memberS1.id,
    });
    expect(value).toBeNull();
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "FORBIDDEN",
      message: "参加者だけが見られます（非公開）",
    });
    expect(JSON.stringify(error)).not.toContain("見えなくなる説明");
  });

  it("#147 判定の順: 詳細の読み取りが not_found（案件そのものが消えた）なら 404「案件が見つかりません」で、403 と区別する", async () => {
    const { value, error } = await detailWith("not_found");
    expect(value).toBeNull();
    expect(error).toMatchObject({
      code: "NOT_FOUND",
      message: "案件が見つかりません",
    });
  });
});
