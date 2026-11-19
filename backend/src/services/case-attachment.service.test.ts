// #148（148-B-1）5-2 AC-7・R-62・R-64、計画 148-B-1「判定の順」：案件の添付の一覧の Service（case-attachment.service.ts）の判定の順を、
// Repository とロールの割り当て（roles）を代役にして確かめる（先例：services/case.service.test.ts）。
// 全員が perm.case.view を持つため、結合の層では「権限で拒否される」状況を作れない。実際の authorizer は、拒否のときに logger.audit に
// 「権限の ID（body）・範囲（target。会社なら company）・reason: forbidden」を残すので、無効な利用者（何の権限も持たない）として拒否させて観測する。
// 判定の順（計画。クエリの 422 はルートで最初に行うため、ここでは扱わない。結合テストで確かめる）：
//   1. findAttachmentListFacts が null → 404「案件が見つかりません」（logger.audit。理由 not_found）。権限の確認も一覧の読み取りもしない
//   2. 有効な参加者でない → 403「参加者だけが見られます（非公開）」（理由 not_participant）。権限の確認も一覧の読み取りもしない
//   3. perm.case.view（会社の範囲）。拒否は 403。一覧を読まない
//   4. listCaseAttachments（資格を同じ batch で確かめる）：not_found → 404、not_visible → 403（中身を返さない）
// 契約（実装前の仮置き。実装の担当へ）：backend/src/services/case-attachment.service.ts
//   createCaseAttachmentService(repository: CaseAttachmentRepository, roles: RoleAssignmentRepository)
//   service.list(actor: { userId, traceId }, caseId, { limit: number, cursor: string | null }): Promise<{ items, nextCursor }>
// データは架空の ID（ULID の形）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseAttachmentRepository } from "../db/case-attachment.repository";
import type {
  RoleAssignmentRepository,
  UserWithAssignments,
} from "../db/role-assignment.repository";
import { createCaseAttachmentService } from "./case-attachment.service";

const ACTOR = "01JTESTCASE148BSVCACT00001";
const CASE_ID = "01JTESTCASE148BSVCCASE0001";
const TRACE = "trace-148b-service";

const PAGE = {
  items: [
    {
      id: "01JTESTCASE148BSVCATT00001",
      name: "[UNIT_TEST]148B.txt",
      kind: "document",
      contentType: "text/plain; charset=utf-8",
      size: 10,
      uploadedAt: "2026-11-17T03:00:00.000Z",
      messageId: "01JTESTCASE148BSVCMSG00001",
      threadParentId: null,
      uploader: { id: ACTOR, displayName: "テスト太郎", isActive: true },
    },
  ],
  nextCursor: null,
};

let repository: {
  findAttachmentListFacts: ReturnType<typeof vi.fn>;
  listCaseAttachments: ReturnType<typeof vi.fn>;
};
let roles: {
  findByUserId: ReturnType<
    typeof vi.fn<(userId: string) => Promise<UserWithAssignments | null>>
  >;
};
let logLines: string[];

const service = () =>
  createCaseAttachmentService(
    repository as unknown as CaseAttachmentRepository,
    roles as unknown as RoleAssignmentRepository,
  );
const actor = { userId: ACTOR, traceId: TRACE };
const listAs = () =>
  service().list(actor, CASE_ID, { limit: 50, cursor: null });

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

beforeEach(() => {
  repository = {
    findAttachmentListFacts: vi.fn(async () => ({ isParticipant: true })),
    listCaseAttachments: vi.fn(async () => PAGE),
  };
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

describe("#148 AC-7 148-B-1 判定の順（Service）", () => {
  it("#148 AC-7: 案件がなければ 404「案件が見つかりません」。権限の確認も一覧の読み取りもしない。logger.audit に案件の ID・not_found", async () => {
    repository.findAttachmentListFacts.mockResolvedValue(null);
    const error = await rejectionOf(listAs());
    expect(error).toMatchObject({
      code: "NOT_FOUND",
      message: "案件が見つかりません",
    });
    expect(repository.findAttachmentListFacts).toHaveBeenCalledWith({
      caseId: CASE_ID,
      actorId: ACTOR,
    });
    expect(roles.findByUserId).not.toHaveBeenCalled();
    expect(repository.listCaseAttachments).not.toHaveBeenCalled();
    expect(audits()).toEqual([
      expect.objectContaining({
        user_id: ACTOR,
        attributes: expect.objectContaining({
          target: CASE_ID,
          result: "failure",
          reason: "not_found",
        }) as unknown,
      }),
    ]);
  });

  it("#148 AC-7 R-62: 有効な参加者でなければ 403「参加者だけが見られます（非公開）」。権限の確認も一覧の読み取りもしない。logger.audit に not_participant", async () => {
    repository.findAttachmentListFacts.mockResolvedValue({
      isParticipant: false,
    });
    const error = await rejectionOf(listAs());
    expect(error).toMatchObject({
      code: "FORBIDDEN",
      message: "参加者だけが見られます（非公開）",
    });
    expect(roles.findByUserId).not.toHaveBeenCalled();
    expect(repository.listCaseAttachments).not.toHaveBeenCalled();
    expect(audits()).toEqual([
      expect.objectContaining({
        user_id: ACTOR,
        attributes: expect.objectContaining({
          target: CASE_ID,
          result: "failure",
          reason: "not_participant",
        }) as unknown,
      }),
    ]);
  });

  it("#148 AC-7 R-62・R-64: perm.case.view を会社の範囲で操作者について確かめ、拒否されたら 403 で、一覧を読まない", async () => {
    roles.findByUserId.mockResolvedValue({
      user: { isActive: false },
      assignments: [],
    } as unknown as UserWithAssignments);
    const error = await rejectionOf(listAs());
    expect(error).toMatchObject({ code: "FORBIDDEN" });
    expect(roles.findByUserId).toHaveBeenCalledWith(ACTOR);
    expect(audits()).toEqual([
      expect.objectContaining({
        body: "perm.case.view",
        user_id: ACTOR,
        attributes: expect.objectContaining({
          target: "company",
          result: "failure",
          reason: "forbidden",
        }) as unknown,
      }),
    ]);
    expect(repository.listCaseAttachments).not.toHaveBeenCalled();
  });

  it.each([
    [
      "not_visible",
      "FORBIDDEN",
      "参加者だけが見られます（非公開）",
      "not_participant",
    ],
    ["not_found", "NOT_FOUND", "案件が見つかりません", "not_found"],
  ] as const)(
    "#148 AC-7 #196: 一覧の読み取りが %s なら %s（判定の後に資格を失った人に中身を返さない）。logger.audit に %s",
    async (result, code, message, reason) => {
      repository.listCaseAttachments.mockResolvedValue(result);
      const error = await rejectionOf(listAs());
      expect(error).toMatchObject({ code, message });
      expect(audits()).toEqual([
        expect.objectContaining({
          attributes: expect.objectContaining({
            target: CASE_ID,
            result: "failure",
            reason,
          }) as unknown,
        }),
      ]);
    },
  );

  it("#148 AC-7: 権限のある参加者には、操作者の ID・limit・cursor で読んだ一覧をそのまま返し、拒否の記録を残さない", async () => {
    const page = await service().list(actor, CASE_ID, {
      limit: 7,
      cursor: "c1",
    });
    expect(page).toEqual(PAGE);
    expect(repository.listCaseAttachments).toHaveBeenCalledWith({
      caseId: CASE_ID,
      viewerId: ACTOR,
      limit: 7,
      cursor: "c1",
    });
    expect(audits()).toEqual([]);
  });
});
