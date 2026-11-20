// #324（#148 148-B-2 のミューテーションの生き残り）：公開範囲の変更（case-attachment.service.ts の changeVisibility）の権限の確認が、
// perm.case.view と perm.case.attachment.visibility.change を「会社の範囲」で確かめていること。既存のテストは拒否させるだけで、範囲を見ていなかった。
// 実際の authorizer は、拒否のときに logger.audit に「権限の ID（body）・範囲（target。会社なら company）・reason: forbidden」を残すので、
// その記録で範囲を観測する（先例：services/case.service.test.ts）。2つ目の権限は、1つ目の確認では有効、2つ目の確認では無効の利用者として拒否させる。
// 期待値は計画 148-B-2 6.4 の判定の順の5（perm.case.view → perm.case.attachment.visibility.change。会社の範囲）から決める。
// データは架空の ID（ULID の形）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseAttachmentRepository } from "../db/case-attachment.repository";
import type {
  RoleAssignmentRepository,
  UserWithAssignments,
} from "../db/role-assignment.repository";
import { createCaseAttachmentService } from "./case-attachment.service";

const ACTOR = "01JTESTCASE324VSCPACT0000A";
const ATTACHMENT = "01JTESTCASE324VSCPATT0000A";
const CASE_ID = "01JTESTCASE324VSCPCASE000A";
const MESSAGE = "01JTESTCASE324VSCPMSG0000A";

const ACTIVE = {
  user: { isActive: true },
  assignments: [],
} as unknown as UserWithAssignments;
const INACTIVE = {
  user: { isActive: false },
  assignments: [],
} as unknown as UserWithAssignments;

let repository: {
  findVisibilityFacts: ReturnType<typeof vi.fn>;
  changeVisibility: ReturnType<typeof vi.fn>;
};
let roles: {
  findByUserId: ReturnType<
    typeof vi.fn<(userId: string) => Promise<UserWithAssignments | null>>
  >;
};
let logLines: string[];

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

const changeAs = () =>
  createCaseAttachmentService(
    repository as unknown as CaseAttachmentRepository,
    roles as unknown as RoleAssignmentRepository,
  ).changeVisibility(
    { userId: ACTOR, traceId: "trace-324-scope" },
    ATTACHMENT,
    {
      publicationVisibility: "public_archive",
    },
  );

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
    findVisibilityFacts: vi.fn(async () => ({
      messageId: MESSAGE,
      uploaderId: ACTOR,
      publicationVisibility: "participants_only",
      caseId: CASE_ID,
      caseStatus: "active",
      actorIsParticipant: true,
      actorCanManage: false,
    })),
    changeVisibility: vi.fn(async () => undefined),
  };
  roles = { findByUserId: vi.fn(async () => ACTIVE) };
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

const forbiddenAt = (permission: string) => [
  expect.objectContaining({
    body: permission,
    user_id: ACTOR,
    attributes: expect.objectContaining({
      target: "company",
      result: "failure",
      reason: "forbidden",
    }) as unknown,
  }),
];

describe("#324 #148 148-B-2 公開範囲の変更の権限の確認の範囲", () => {
  it("#324 #148 AC-9 6.4 の5: perm.case.view を会社の範囲で確かめ、拒否されたら 403 で書き込まない", async () => {
    roles.findByUserId.mockResolvedValue(INACTIVE);
    const error = await rejectionOf(changeAs());
    expect(error).toMatchObject({ code: "FORBIDDEN" });
    expect(audits()).toEqual(forbiddenAt("perm.case.view"));
    expect(repository.changeVisibility).not.toHaveBeenCalled();
  });

  it("#324 #148 AC-9 6.4 の5: perm.case.attachment.visibility.change を会社の範囲で確かめ、拒否されたら 403 で書き込まない", async () => {
    roles.findByUserId
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValue(INACTIVE);
    const error = await rejectionOf(changeAs());
    expect(error).toMatchObject({ code: "FORBIDDEN" });
    expect(roles.findByUserId).toHaveBeenCalledTimes(2);
    expect(audits()).toEqual(
      forbiddenAt("perm.case.attachment.visibility.change"),
    );
    expect(repository.changeVisibility).not.toHaveBeenCalled();
  });
});
