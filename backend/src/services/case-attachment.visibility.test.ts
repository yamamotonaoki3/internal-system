// #148（148-B-2）5-2 AC-9・R-85・計画 6.4「判定の順」：公開範囲の変更（EP-1-23）の Service（case-attachment.service.ts の changeVisibility）の
// 判定の順を、Repository とロールの割り当て（roles）を代役にして確かめる（先例：services/case-attachment.service.test.ts）。
// 判定の順（計画 6.4）：
//   1. findVisibilityFacts が null → 404「添付が見つかりません」（配信と同じ本文）
//   2. 未投稿（messageId が null）→ 1 と同じ 404
//   3. 案件の部屋でない（caseId が null）→ 422 fields:["attachmentId"]
//   4. 有効な参加者でない → 1 と同じ 404（存在を漏らさない）
//   5. perm.case.view → perm.case.attachment.visibility.change（拒否は 403）
//   6. 本人でも管理の資格もない → 403「この添付の公開範囲は変更できません」
//   7. 本文（{ publicationVisibility }。必須・2値）→ 422 fields:["publicationVisibility"]
//   8. 案件が closed → 409「終了した案件の添付の公開範囲は変更できません」
//   9. 今と同じ値 → 書かずに 200（監査も書かない）
//   10. 書き込みが AttachmentStateChangedError → 読み直して 2〜8 と同じ順・同じ応答。求めた値なら 200。ほかは 409（状態が変わった）
// 404・403（6）・409 の拒否は logger.audit（対象は添付の ID。ファイル名を入れない）。
// 契約（実装前の仮置き。実装の担当へ）：
//   repository.findVisibilityFacts({ attachmentId, actorId }): Promise<null | { messageId: string | null; uploaderId: string;
//     publicationVisibility: "participants_only" | "public_archive"; caseId: string | null; caseStatus: "active" | "closed" | null;
//     actorIsParticipant: boolean; actorCanManage: boolean }>
//   repository.changeVisibility({ attachmentId, actorId, caseId, before, after, traceId }): Promise<void>（0行は AttachmentStateChangedError）
//   service.changeVisibility(actor: { userId, traceId }, attachmentId, body: unknown): Promise<{ id, publicationVisibility }>
// データは架空の ID（ULID の形）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AttachmentStateChangedError,
  type CaseAttachmentRepository,
} from "../db/case-attachment.repository";
import type {
  RoleAssignmentRepository,
  UserWithAssignments,
} from "../db/role-assignment.repository";
import { createCaseAttachmentService } from "./case-attachment.service";

const ACTOR = "01JTESTCASE148VSVCACT00001";
const OTHER = "01JTESTCASE148VSVCACT00002";
const ATTACHMENT = "01JTESTCASE148VSVCATT00001";
const CASE_ID = "01JTESTCASE148VSVCCASE0001";
const MESSAGE = "01JTESTCASE148VSVCMSG00001";
const TRACE = "trace-148b2-service";

const MESSAGES = {
  notFound: "添付が見つかりません",
  forbidden: "この添付の公開範囲は変更できません",
  closed: "終了した案件の添付の公開範囲は変更できません",
  stateChanged:
    "状態が変わったため、変更できませんでした。読み込み直してからお試しください",
};

type Facts = {
  messageId: string | null;
  uploaderId: string;
  publicationVisibility: "participants_only" | "public_archive";
  caseId: string | null;
  caseStatus: "active" | "closed" | null;
  actorIsParticipant: boolean;
  actorCanManage: boolean;
};

const facts = (over: Partial<Facts> = {}): Facts => ({
  messageId: MESSAGE,
  uploaderId: ACTOR,
  publicationVisibility: "participants_only",
  caseId: CASE_ID,
  caseStatus: "active",
  actorIsParticipant: true,
  actorCanManage: false,
  ...over,
});

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

const actor = { userId: ACTOR, traceId: TRACE };
const changeAs = (
  body: unknown = { publicationVisibility: "public_archive" },
) =>
  createCaseAttachmentService(
    repository as unknown as CaseAttachmentRepository,
    roles as unknown as RoleAssignmentRepository,
  ).changeVisibility(actor, ATTACHMENT, body);

type AuditLine = {
  body: string;
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

/** 権限の確認で拒否させる（無効な利用者は何の権限も持たない） */
const denyPermissions = () =>
  roles.findByUserId.mockResolvedValue({
    user: { isActive: false },
    assignments: [],
  } as unknown as UserWithAssignments);

beforeEach(() => {
  repository = {
    findVisibilityFacts: vi.fn(async () => facts()),
    changeVisibility: vi.fn(async () => undefined),
  };
  roles = {
    findByUserId: vi.fn(
      async () =>
        ({
          user: { isActive: true },
          assignments: [],
        }) as unknown as UserWithAssignments,
    ),
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

describe("#148 AC-9 判定の順（Service）：存在の非開示", () => {
  it("#148 AC-9 計画 6.4 の1: 見えない・存在しない添付は 404「添付が見つかりません」。権限の確認も書き込みもしない。logger.audit に添付の ID", async () => {
    repository.findVisibilityFacts.mockResolvedValue(null);
    expect(await rejectionOf(changeAs())).toMatchObject({
      code: "NOT_FOUND",
      message: MESSAGES.notFound,
    });
    expect(repository.findVisibilityFacts).toHaveBeenCalledWith({
      attachmentId: ATTACHMENT,
      actorId: ACTOR,
    });
    expect(roles.findByUserId).not.toHaveBeenCalled();
    expect(repository.changeVisibility).not.toHaveBeenCalled();
    expect(audits()).toEqual([
      expect.objectContaining({
        body: "case.attachment.visibility.change",
        attributes: expect.objectContaining({
          target: ATTACHMENT,
          result: "failure",
        }) as unknown,
      }),
    ]);
  });

  it("#148 AC-9 計画 6.4 の2: 自分の未投稿の添付は、1 と同じ 404", async () => {
    repository.findVisibilityFacts.mockResolvedValue(
      facts({ messageId: null }),
    );
    expect(await rejectionOf(changeAs())).toMatchObject({
      code: "NOT_FOUND",
      message: MESSAGES.notFound,
    });
    expect(repository.changeVisibility).not.toHaveBeenCalled();
  });

  it("#148 AC-9 計画 6.4 の3: 案件でない部屋の添付は 422 fields:[attachmentId]（本文が不正でも、権限がなくても 422 が先）", async () => {
    repository.findVisibilityFacts.mockResolvedValue(
      facts({ caseId: null, caseStatus: null }),
    );
    denyPermissions();
    expect(await rejectionOf(changeAs({}))).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { fields: ["attachmentId"] },
    });
    expect(repository.changeVisibility).not.toHaveBeenCalled();
  });

  it("#148 AC-9 計画 6.4 の4: 有効な参加者でなければ、管理の資格があっても 1 と同じ 404", async () => {
    repository.findVisibilityFacts.mockResolvedValue(
      facts({ actorIsParticipant: false, actorCanManage: true }),
    );
    const error = await rejectionOf(changeAs());
    expect(error).toMatchObject({
      code: "NOT_FOUND",
      message: MESSAGES.notFound,
    });
    expect(roles.findByUserId).not.toHaveBeenCalled();
  });
});

describe("#148 AC-9 判定の順（Service）：権限・本人か管理の資格", () => {
  it("#148 AC-9 計画 6.4 の5: 権限（perm.*）の拒否は 403。本文が不正でも 403 が先で、書き込まない", async () => {
    denyPermissions();
    expect(
      await rejectionOf(changeAs({ publicationVisibility: "bad" })),
    ).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repository.changeVisibility).not.toHaveBeenCalled();
  });

  it("#148 AC-9 R-85 計画 6.4 の6: 本人でも管理の資格もない参加者は 403「この添付の公開範囲は変更できません」。本文が不正でも 403 が先。logger.audit に残す", async () => {
    repository.findVisibilityFacts.mockResolvedValue(
      facts({ uploaderId: OTHER }),
    );
    expect(await rejectionOf(changeAs({}))).toMatchObject({
      code: "FORBIDDEN",
      message: MESSAGES.forbidden,
    });
    expect(repository.changeVisibility).not.toHaveBeenCalled();
    expect(audits()).toEqual([
      expect.objectContaining({
        body: "case.attachment.visibility.change",
        attributes: expect.objectContaining({
          target: ATTACHMENT,
          result: "failure",
        }) as unknown,
      }),
    ]);
  });

  it("#148 AC-9 R-85: 管理の資格がある参加者（担当部署のオーナー・全体管理者）は、ほかの人の添付を変えられる", async () => {
    repository.findVisibilityFacts.mockResolvedValue(
      facts({ uploaderId: OTHER, actorCanManage: true }),
    );
    expect(await changeAs()).toEqual({
      id: ATTACHMENT,
      publicationVisibility: "public_archive",
    });
  });
});

describe("#148 AC-9 判定の順（Service）：本文・終了・同じ値", () => {
  it.each([
    ["本文がない項目", {}],
    ["null", { publicationVisibility: null }],
    ["一覧にない値", { publicationVisibility: "public" }],
    ["大文字違い", { publicationVisibility: "PUBLIC_ARCHIVE" }],
    ["数", { publicationVisibility: 1 }],
    ["本文が null", null],
  ])(
    "#148 AC-9 計画 6.4 の7: %s は 422 fields:[publicationVisibility]",
    async (_l, body) => {
      expect(await rejectionOf(changeAs(body))).toMatchObject({
        code: "VALIDATION_ERROR",
        details: { fields: ["publicationVisibility"] },
      });
      expect(repository.changeVisibility).not.toHaveBeenCalled();
    },
  );

  it("#148 AC-9 計画 6.4 の8: 終了した案件は 409「終了した案件の添付の公開範囲は変更できません」（同じ値を求めても 409）", async () => {
    repository.findVisibilityFacts.mockResolvedValue(
      facts({ caseStatus: "closed" }),
    );
    for (const value of ["public_archive", "participants_only"]) {
      expect(
        await rejectionOf(changeAs({ publicationVisibility: value })),
      ).toMatchObject({ code: "CONFLICT", message: MESSAGES.closed });
    }
    expect(repository.changeVisibility).not.toHaveBeenCalled();
  });

  it("#148 AC-9 計画 6.4 の9: 今と同じ値なら、書かずに 200", async () => {
    expect(
      await changeAs({ publicationVisibility: "participants_only" }),
    ).toEqual({
      id: ATTACHMENT,
      publicationVisibility: "participants_only",
    });
    expect(repository.changeVisibility).not.toHaveBeenCalled();
  });

  it("#148 AC-9: 本人（一般）が違う値を求めると、読んだ値を before にして書く", async () => {
    expect(await changeAs()).toEqual({
      id: ATTACHMENT,
      publicationVisibility: "public_archive",
    });
    expect(repository.changeVisibility).toHaveBeenCalledWith({
      attachmentId: ATTACHMENT,
      actorId: ACTOR,
      caseId: CASE_ID,
      before: "participants_only",
      after: "public_archive",
      traceId: TRACE,
    });
  });
});

describe("#148 AC-9 計画 6.4 の10：書き込みが0行のときの読み直し", () => {
  const conflictThen = (second: Facts | null) => {
    repository.changeVisibility.mockRejectedValue(
      new AttachmentStateChangedError(),
    );
    repository.findVisibilityFacts
      .mockResolvedValueOnce(facts())
      .mockResolvedValueOnce(second);
  };

  it.each<[string, Facts | null, Record<string, unknown>]>([
    ["見えなくなった", null, { code: "NOT_FOUND", message: MESSAGES.notFound }],
    [
      "参加から外れた",
      facts({ actorIsParticipant: false }),
      { code: "NOT_FOUND", message: MESSAGES.notFound },
    ],
    [
      "本人でも管理の資格もなくなった",
      facts({ uploaderId: OTHER }),
      { code: "FORBIDDEN", message: MESSAGES.forbidden },
    ],
    [
      "案件が終了した",
      facts({ caseStatus: "closed" }),
      { code: "CONFLICT", message: MESSAGES.closed },
    ],
    [
      "どれにも当たらない（値はまだ前のまま）",
      facts(),
      { code: "CONFLICT", message: MESSAGES.stateChanged },
    ],
  ])(
    "#148 AC-9: 読み直しで %s なら、その応答（成功にしない）",
    async (_l, second, expected) => {
      conflictThen(second);
      expect(await rejectionOf(changeAs())).toMatchObject(expected);
      expect(repository.findVisibilityFacts).toHaveBeenCalledTimes(2);
    },
  );

  it("#148 AC-9 計画 7章1行目: 読み直した値が求めた値なら 200（書き直さない）", async () => {
    conflictThen(facts({ publicationVisibility: "public_archive" }));
    expect(await changeAs()).toEqual({
      id: ATTACHMENT,
      publicationVisibility: "public_archive",
    });
    expect(repository.changeVisibility).toHaveBeenCalledTimes(1);
  });

  it("#148 AC-9: 書き込みのほかの失敗（D1 の失敗）は、読み直さずにそのまま伝える", async () => {
    const failure = new Error("[UNIT_TEST] 注入した D1 の失敗");
    repository.changeVisibility.mockRejectedValue(failure);
    expect(await rejectionOf(changeAs())).toBe(failure);
    expect(repository.findVisibilityFacts).toHaveBeenCalledTimes(1);
  });
});
