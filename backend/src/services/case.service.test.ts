// #147（147-A）ミューテーションの生き残り（認可・非開示）：案件の Service の権限の確認・非参加者の早期の拒否・業務の拒否の記録を確かめる。
// 全員が perm.case.summary.view・perm.case.view を持つため、結合の層では「権限で拒否される」状況を作れない。
// そのため、Repository とロールの割り当て（roles）を代役にする。実際の authorizer は、拒否のときに logger.audit に
// 「権限の ID（body）・範囲（target。会社なら company）・reason: forbidden」を残すので、無効な利用者（何の権限も持たない）として
// 拒否させ、その記録で、確かめた権限と範囲を観測する（vitest-pool-workers ではモジュールの差し替えが効かないため）。
// 期待値は設計書 docs/design/cases.md（判定の順）・決定記録 C-182・要件 5-1 から決める：
//   一覧・概要：perm.case.summary.view（会社の範囲）。詳細：概要の読み取り → 有効な参加者でなければ 403（logger.audit。理由 not_participant）
//     → perm.case.view（会社の範囲）→ findDetailExtras（not_found は 404・理由 not_found、not_visible は 403・理由 not_participant）
//   案件がなければ 404（logger.audit。理由 not_found）。監査の操作は、概要が case.summary.view、詳細が case.view、対象は案件の ID
// データは架空の ID（ULID の形）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseRepository } from "../db/case.repository";
import type {
  RoleAssignmentRepository,
  UserWithAssignments,
} from "../db/role-assignment.repository";
import { createCaseService } from "./case.service";

const ACTOR = "01JTESTCASE147ASVCACT00001";
const CASE_ID = "01JTESTCASE147ASVCCASE0001";
const TRACE = "trace-147a-service";

type Summary = Awaited<ReturnType<CaseRepository["findSummary"]>>;

const summaryOf = (isParticipant: boolean) =>
  ({
    id: CASE_ID,
    caseNumber: "QZA-261117-0001",
    title: "[UNIT_TEST]147A Service",
    status: "active",
    client: {
      id: "01JTESTCASE147ASVCC000001A",
      name: "テスト商事",
      isActive: true,
    },
    departments: [],
    dueDate: null,
    isParticipant,
    canManage: false,
    participantCount: isParticipant ? 1 : null,
  }) as unknown as NonNullable<Summary>;

let repository: {
  list: ReturnType<typeof vi.fn>;
  findSummary: ReturnType<typeof vi.fn>;
  findDetailExtras: ReturnType<typeof vi.fn>;
};
let roles: {
  findByUserId: ReturnType<
    typeof vi.fn<(userId: string) => Promise<UserWithAssignments | null>>
  >;
};
let logLines: string[];

function service() {
  return createCaseService(
    repository as unknown as CaseRepository,
    roles as unknown as RoleAssignmentRepository,
  );
}

const actor = { userId: ACTOR, traceId: TRACE };

type AuditLine = {
  body: string;
  user_id?: string;
  attributes: {
    log_type?: string;
    target?: string;
    result?: string;
    reason?: string;
  };
};
const audits = (): AuditLine[] =>
  logLines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as AuditLine)
    .filter((line) => line.attributes.log_type === "audit");

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("拒否されませんでした");
}

/** 権限を何も持たない利用者（無効）にして、authorize に拒否させる */
const denyAll = () =>
  roles.findByUserId.mockResolvedValue({
    user: { isActive: false },
    assignments: [],
  });

beforeEach(() => {
  repository = {
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    findSummary: vi.fn(async () => summaryOf(true)),
    findDetailExtras: vi.fn(async () => ({
      description: "[UNIT_TEST]147A説明",
      channelId: "01JTESTCASE147ASVCR00M001A",
      createdBy: ACTOR,
      participants: [],
    })),
  };
  // 有効な一般メンバー（全員が perm.case.summary.view・perm.case.view を持つ）
  roles = {
    findByUserId: vi.fn(async () => ({
      user: { isActive: true },
      assignments: [],
    })),
  };
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#147 ミューテーション：権限の確認の中身（1）", () => {
  it.each([
    ["一覧", "list", "perm.case.summary.view"],
    ["概要", "summary", "perm.case.summary.view"],
    ["詳細", "detail", "perm.case.view"],
  ] as const)(
    "#147 security: %sは %s を会社の範囲で操作者について確かめ、拒否されたら 403 で、案件の中身を読まない",
    async (_label, kind, permission) => {
      denyAll();
      const s = service();
      const call =
        kind === "list"
          ? s.list(actor, { scope: "joined", status: "active", limit: 20 })
          : kind === "summary"
            ? s.summary(actor, CASE_ID)
            : s.detail(actor, CASE_ID);
      const error = await rejectionOf(call);
      expect(error).toMatchObject({ code: "FORBIDDEN" });
      expect(roles.findByUserId).toHaveBeenCalledWith(ACTOR);
      // authorizer の拒否の記録：確かめた権限と範囲（会社）
      expect(audits()).toEqual([
        expect.objectContaining({
          body: permission,
          user_id: ACTOR,
          attributes: expect.objectContaining({
            target: "company",
            result: "failure",
            reason: "forbidden",
          }) as unknown,
        }),
      ]);
      expect(repository.list).not.toHaveBeenCalled();
      expect(repository.findDetailExtras).not.toHaveBeenCalled();
      if (kind === "summary")
        expect(repository.findSummary).not.toHaveBeenCalled();
    },
  );

  it("#147 5-1 AC-4: 一覧は、権限のある操作者の ID で読む", async () => {
    await service().list(actor, { scope: "all", status: "active", limit: 20 });
    expect(roles.findByUserId).toHaveBeenCalledWith(ACTOR);
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR, scope: "all" }),
    );
  });
});

describe("#147 ミューテーション：非参加者の詳細（2）と拒否の記録（3）", () => {
  it("#147 5-1 AC-14: 非参加者の詳細は、詳細の読み取りも権限の確認も呼ばずに 403。logger.audit に case.view・案件の ID・not_participant", async () => {
    repository.findSummary.mockResolvedValue(summaryOf(false));
    const error = await rejectionOf(service().detail(actor, CASE_ID));
    expect(error).toMatchObject({
      code: "FORBIDDEN",
      message: "参加者だけが見られます（非公開）",
    });
    expect(repository.findDetailExtras).not.toHaveBeenCalled();
    // 権限の確認（roles の読み込み）より前に拒否する
    expect(roles.findByUserId).not.toHaveBeenCalled();
    expect(audits()).toEqual([
      expect.objectContaining({
        body: "case.view",
        user_id: ACTOR,
        attributes: expect.objectContaining({
          target: CASE_ID,
          result: "failure",
          reason: "not_participant",
        }) as unknown,
      }),
    ]);
  });

  it.each([
    ["概要", "summary", "case.summary.view"],
    ["詳細", "detail", "case.view"],
  ] as const)(
    "#147 判定の順: 案件がなければ%sは 404。logger.audit に %s・案件の ID・not_found",
    async (_label, kind, action) => {
      repository.findSummary.mockResolvedValue(null);
      const s = service();
      const error = await rejectionOf(
        kind === "summary"
          ? s.summary(actor, CASE_ID)
          : s.detail(actor, CASE_ID),
      );
      expect(error).toMatchObject({
        code: "NOT_FOUND",
        message: "案件が見つかりません",
      });
      expect(audits()).toEqual([
        expect.objectContaining({
          body: action,
          attributes: expect.objectContaining({
            target: CASE_ID,
            result: "failure",
            reason: "not_found",
          }) as unknown,
        }),
      ]);
    },
  );

  it.each([
    ["not_visible", "FORBIDDEN", "not_participant"],
    ["not_found", "NOT_FOUND", "not_found"],
  ] as const)(
    "#147 コードレビュー1回目（重大1）: 詳細の読み取りが %s なら %s。logger.audit に case.view・案件の ID・%s",
    async (result, code, reason) => {
      repository.findDetailExtras.mockResolvedValue(result);
      const error = await rejectionOf(service().detail(actor, CASE_ID));
      expect(error).toMatchObject({ code });
      expect(audits()).toEqual([
        expect.objectContaining({
          body: "case.view",
          attributes: expect.objectContaining({
            target: CASE_ID,
            result: "failure",
            reason,
          }) as unknown,
        }),
      ]);
    },
  );

  it("#147: 成功した読み取りでは、拒否の記録を残さない", async () => {
    await service().detail(actor, CASE_ID);
    await service().summary(actor, CASE_ID);
    expect(audits()).toEqual([]);
  });
});
