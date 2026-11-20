// #324（#150 150-B のミューテーションの生き残り）：再開の選び直し（case.service.ts の reopen）の、宛先・やり直し・拒否のときの書き込みを、
// Repository とロールの割り当て（roles）を代役にして確かめる（先例：services/case.service.test.ts）。
// 割り込みのテスト（case-reopen-reselect.interleave.test.ts）は、読み取りの直後に世界を変えるため、書き込み（reopenCase）が
// 「1回目だけ前提の崩れで失敗し、2回目に成功する」「2回続けて崩れる」「状態の変化でないエラーで失敗する」経路を通らない。ここで代役で通す。
// 期待値は設計書 docs/design/cases.md（150-B：版は最初に読んだものを使い続ける。前提が崩れたら読み直し、理由に当たればそれ、
// 版だけ変わっていれば 409 stale、どれにも当たらなければ宛先を読み直して1回だけやり直し、それでも崩れたら 409 retry）と、
// 要件 3-3 AC-2（再開の通知の宛先：選び直しの後の有効な参加者。外した人は含めず、足した人を含める）から決める。
// データは架空の ID（ULID の形）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CaseStateChangedError,
  type CaseReopenFacts,
  type CaseRepository,
} from "../db/case.repository";
import type {
  RoleAssignmentRepository,
  UserWithAssignments,
} from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { createCaseService } from "./case.service";

const ACTOR = "01JTESTCASE324SVCACT00001A";
const MEMBER_A = "01JTESTCASE324SVCMEM0000A1";
const MEMBER_B = "01JTESTCASE324SVCMEM0000B1";
const NEWCOMER = "01JTESTCASE324SVCNEW0000A1";
const CASE_ID = "01JTESTCASE324SVCCASE000A1";
const DEPT = "01JTESTCASE324SVCDEPT000A1";
const TRACE = "trace-324-reopen-service";

const facts = (over: Partial<CaseReopenFacts> = {}): CaseReopenFacts => ({
  status: "closed",
  version: 3,
  actorIsParticipant: true,
  actorCanManage: false,
  caseDepartmentIds: [DEPT],
  activeParticipantIds: [ACTOR, MEMBER_A, MEMBER_B],
  targets: [
    {
      userId: MEMBER_A,
      isActive: true,
      hasMembershipRow: true,
      isGlobalAdmin: false,
      ownedDepartmentIds: [],
    },
    {
      userId: NEWCOMER,
      isActive: true,
      hasMembershipRow: false,
      isGlobalAdmin: false,
      ownedDepartmentIds: [],
    },
  ],
  ...over,
});

/** MEMBER_A を外し、NEWCOMER を足す本文 */
const body = () => ({
  participantIds: [ACTOR, MEMBER_A, MEMBER_B],
  addUserIds: [NEWCOMER],
  removeUserIds: [MEMBER_A],
});

let repository: {
  findReopenFacts: ReturnType<typeof vi.fn>;
  listCaseNotifyRecipients: ReturnType<typeof vi.fn>;
  reopenCase: ReturnType<typeof vi.fn>;
};
let roles: {
  findByUserId: ReturnType<
    typeof vi.fn<(userId: string) => Promise<UserWithAssignments | null>>
  >;
};

const reopen = (input: unknown = body()) =>
  createCaseService(
    repository as unknown as CaseRepository,
    roles as unknown as RoleAssignmentRepository,
  ).reopen({ userId: ACTOR, traceId: TRACE }, CASE_ID, input);

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("拒否されませんでした");
}

const reasonOf = (error: unknown) =>
  error instanceof AppError
    ? { code: error.code, reason: error.details.reason }
    : { code: "not AppError", reason: String(error) };

/** 呼ばれるたびに順に返す（尽きたら最後のものを返し続ける）。書き込みの失敗が止まらない変異で、無限に回らないよう上限を置く */
const LIMIT = 5;
function writeOutcomes(...outcomes: (Error | "ok")[]) {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls > LIMIT) throw new Error("書き込みが上限を超えて呼ばれました");
    const outcome = outcomes[Math.min(calls, outcomes.length) - 1];
    if (outcome instanceof Error) throw outcome;
  };
}

beforeEach(() => {
  repository = {
    findReopenFacts: vi.fn(async () => facts()),
    // 読んだ宛先（本人を除く有効な参加者）：外す MEMBER_A を含む
    listCaseNotifyRecipients: vi.fn(async () => [MEMBER_A, MEMBER_B]),
    reopenCase: vi.fn(async () => undefined),
  };
  // 有効な一般メンバー（perm.case.close を持つ）
  roles = {
    findByUserId: vi.fn(
      async () =>
        ({
          user: { isActive: true },
          assignments: [],
        }) as unknown as UserWithAssignments,
    ),
  };
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#324 #150 150-B 再開の通知の宛先（3-3 AC-2）", () => {
  it("#324 #150 3-3 AC-2: 書き込みに渡す宛先は、読んだ宛先から外した人を除き、足した人を加えたもの（外した人は宛先に入らない）", async () => {
    await expect(reopen()).resolves.toEqual({
      caseId: CASE_ID,
      status: "active",
    });
    expect(repository.reopenCase).toHaveBeenCalledTimes(1);
    expect(repository.reopenCase).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        actorId: ACTOR,
        version: 3,
        addUserIds: [NEWCOMER],
        removeUserIds: [MEMBER_A],
        readRecipientIds: [MEMBER_A, MEMBER_B],
        recipientIds: [MEMBER_B, NEWCOMER].sort(),
      }),
    );
  });
});

describe("#324 #150 150-B 書き込みが失敗したときのやり直し", () => {
  it("#324 #150 6.2: 書き込みが状態の変化でないエラーを投げたら、読み直さず・やり直さずに、そのエラーを伝える", async () => {
    const failure = new Error("[UNIT_TEST]324 未知のDBエラー");
    repository.reopenCase.mockImplementation(writeOutcomes(failure));
    const error = await rejectionOf(reopen());
    expect(error).toBe(failure);
    expect(repository.reopenCase).toHaveBeenCalledTimes(1);
    // 最初の資格の読み取り＋判定の読み取りの2回だけ（失敗の後に読み直さない）
    expect(repository.findReopenFacts).toHaveBeenCalledTimes(2);
  });

  it("#324 #150 6.2: 1回目は前提の崩れ（CaseStateChangedError）、読み直しの理由も版の変化もなければ、宛先を読み直して2回目で成功する", async () => {
    repository.reopenCase.mockImplementation(
      writeOutcomes(new CaseStateChangedError(), "ok"),
    );
    await expect(reopen()).resolves.toEqual({
      caseId: CASE_ID,
      status: "active",
    });
    expect(repository.reopenCase).toHaveBeenCalledTimes(2);
    expect(repository.listCaseNotifyRecipients).toHaveBeenCalledTimes(2);
    // 2回目も、最初に読んだ版を使う
    for (const [input] of repository.reopenCase.mock.calls)
      expect(input).toMatchObject({ version: 3 });
  });

  it("#324 #150 6.2: 2回続けて前提が崩れたら、409 retry（3回目は書かない）", async () => {
    repository.reopenCase.mockImplementation(
      writeOutcomes(new CaseStateChangedError()),
    );
    const error = await rejectionOf(reopen());
    expect(reasonOf(error)).toEqual({ code: "CONFLICT", reason: "retry" });
    expect(repository.reopenCase).toHaveBeenCalledTimes(2);
  });

  it("#324 #150 6.2: 前提が崩れた後の読み直しで、版だけが変わっていたら、409 stale（やり直さない）", async () => {
    repository.findReopenFacts
      .mockResolvedValueOnce(facts())
      .mockResolvedValueOnce(facts())
      .mockResolvedValue(facts({ version: 4 }));
    repository.reopenCase.mockImplementation(
      writeOutcomes(new CaseStateChangedError(), "ok"),
    );
    const error = await rejectionOf(reopen());
    expect(reasonOf(error)).toEqual({ code: "CONFLICT", reason: "stale" });
    expect(repository.reopenCase).toHaveBeenCalledTimes(1);
  });
});

describe("#324 #150 150-B 最初の判定で拒否するときは、書き込みを呼ばない", () => {
  it.each([
    [
      "操作者が有効な参加者でない → 403",
      (): CaseReopenFacts | null => facts({ actorIsParticipant: false }),
      { code: "FORBIDDEN", reason: undefined },
    ],
    [
      "案件がない → 404",
      (): CaseReopenFacts | null => null,
      { code: "NOT_FOUND", reason: undefined },
    ],
    [
      "終了中でない（進行中） → 409 already_active",
      (): CaseReopenFacts | null => facts({ status: "active" }),
      { code: "CONFLICT", reason: "already_active" },
    ],
    [
      "画面で見た参加者といまの参加者が違う → 409 participants_changed",
      (): CaseReopenFacts | null =>
        facts({ activeParticipantIds: [ACTOR, MEMBER_A] }),
      { code: "CONFLICT", reason: "participants_changed" },
    ],
    [
      "追加の人が無効 → 422",
      () =>
        facts({
          targets: [
            {
              userId: MEMBER_A,
              isActive: true,
              hasMembershipRow: true,
              isGlobalAdmin: false,
              ownedDepartmentIds: [],
            },
            {
              userId: NEWCOMER,
              isActive: false,
              hasMembershipRow: false,
              isGlobalAdmin: false,
              ownedDepartmentIds: [],
            },
          ],
        }),
      { code: "VALIDATION_ERROR", reason: undefined },
    ],
  ] as const)("#324 #150 6.1: %s", async (_label, make, expected) => {
    repository.findReopenFacts.mockImplementation(async () => make());
    const error = await rejectionOf(reopen());
    expect(reasonOf(error)).toEqual(expected);
    expect(repository.reopenCase).not.toHaveBeenCalled();
    expect(repository.listCaseNotifyRecipients).not.toHaveBeenCalled();
  });

  it("#324 #150 6.1: 権限（perm.case.close）がなければ 403 で、書き込みを呼ばない", async () => {
    roles.findByUserId.mockResolvedValue({
      user: { isActive: false },
      assignments: [],
    } as unknown as UserWithAssignments);
    const error = await rejectionOf(reopen());
    expect(reasonOf(error)).toEqual({ code: "FORBIDDEN", reason: undefined });
    expect(repository.reopenCase).not.toHaveBeenCalled();
  });
});
