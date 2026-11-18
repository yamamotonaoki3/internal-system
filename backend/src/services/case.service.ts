// Service：案件の一覧・概要・詳細（#147 の 147-A）と、参加者の追加・削除・納期の変更（147-B）の業務ルール。HTTP を知らない。
// 判定の順（計画 147-A。変えない）：
//   一覧：perm.case.summary.view（会社の範囲。拒否は authorize が記録）
//   概要：perm.case.summary.view → 案件がない（404。logger.audit）
//   詳細：案件がない（404）→ 有効な参加者でない（403。logger.audit）→ perm.case.view（会社の範囲）
// 全体管理者・担当部署のオーナーでも、参加していなければ詳細は見られない（AC-2・AC-21）。
// 判定の順（計画 147-B「API と判定の順」。変えない）：
//   追加：案件がない（404）→ 操作者が有効な参加者でない（403）→ perm.case.participant.edit → 本文の形（422）
//     → 対象の社員がいない・無効（422。同じ本文）→ 終了中（409 closed）→ すでに参加者（409 already_participant）→ batch
//   削除・退出：404 → 403 → perm.case.participant.edit → 対象が参加者でない（404）→ 409 closed
//     → 自動参加の人（409 auto_participant。本人の退出も。Q2）→ 最後の有効な参加者（409 last_active_participant。Q1）→ batch
//   納期：404 → 編集できない（403。有効な参加者か管理の資格）→ perm.case.edit → 形・今日より前（422）→ 409 closed
//     → 今と同じ値（何も書かない）→ batch
// batch の前提が崩れたら（CaseStateChangedError）、最初と同じ判定の関数で読み直す。理由に当たればそれを返し、当たらなければ
// 成功にせず元のエラーを投げる。読み直しも最初と同じ順なので、外された・無効になった操作者には 403 が先に返り、案件の状態を漏らさない。
// 147-B の操作はどれも再認証を求めない（5-1 AC-3、C-122）。
import { z } from "zod";
import {
  caseDueDateSchema,
  isDueDateBeforeToday,
} from "../../../shared/case-rules";
import {
  CaseStateChangedError,
  withCases,
  type CaseListScope,
  type CaseRepository,
  type CaseStatus,
  type CaseWriteFacts,
} from "../db/case.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import {
  autoRoleOf,
  canRemoveParticipant,
} from "../lib/case-participant-rules";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import type { Permission } from "../lib/permissions";
import { isUlid } from "../lib/ulid";
import { createAppAuthorizer } from "./authorizer";

// 一覧の範囲と状態（route が入力の形に使う。routes は db を直接参照しない）
export { CASE_LIST_SCOPES, CASE_STATUSES } from "../db/case.repository";

export type CaseActor = { userId: string; traceId: string };

/** 画面はこの文言をそのまま出す */
const NOT_FOUND_MESSAGE = "案件が見つかりません";
const PARTICIPANTS_ONLY_MESSAGE = "参加者だけが見られます（非公開）";
const PARTICIPANTS_ONLY_TO_EDIT_MESSAGE = "参加者だけが操作できます";
const PARTICIPANT_NOT_FOUND_MESSAGE = "参加者が見つかりません";
const DUE_DATE_FORBIDDEN_MESSAGE =
  "納期を変更できるのは、参加者・担当部署のオーナー・全体管理者だけです";
const VALIDATION_MESSAGE = "入力内容を確かめてください";
/** 対象の社員がいない・無効のどちらでも同じ本文にする（社員の有無・状態を本文の違いで明かさない） */
const TARGET_INVALID_MESSAGE = "追加できる社員を選んでください";

export type CaseConflictReason =
  | "closed"
  | "already_participant"
  | "auto_participant"
  | "last_active_participant";

const CONFLICT_MESSAGES: Record<CaseConflictReason, string> = {
  closed: "終了した案件は変更できません",
  already_participant: "この社員はすでに参加者です",
  auto_participant: "担当部署のオーナー・全体管理者は外せません",
  last_active_participant:
    "最後の参加者は外せません。先にほかの社員を追加してください",
};

type ViewAction = "case.summary.view" | "case.view";
type WriteAction =
  "case.participant.add" | "case.participant.remove" | "case.due_date.change";

const addBodySchema = z.object({ userId: z.string().refine(isUlid) }).strict();
const dueDateBodySchema = z
  .object({ dueDate: caseDueDateSchema.nullable() })
  .strict();

const validationError = (fields: string[], message = VALIDATION_MESSAGE) =>
  new AppError("VALIDATION_ERROR", message, { fields });

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw validationError([
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ]);
  return parsed.data;
}

/** 判定の結果。deny は logger.audit に残す（404・403）。null は通ること */
type Decision =
  | { kind: "deny"; reason: string; error: AppError }
  | { kind: "error"; error: AppError }
  | null;

const conflict = (reason: CaseConflictReason): Decision => ({
  kind: "error",
  error: new AppError("CONFLICT", CONFLICT_MESSAGES[reason], { reason }),
});
const notFound = (): Decision => ({
  kind: "deny",
  reason: "not_found",
  error: new AppError("NOT_FOUND", NOT_FOUND_MESSAGE),
});

/** 追加・削除の 403 までの判定 */
function decideParticipantGate(facts: CaseWriteFacts | null): Decision {
  if (facts === null) return notFound();
  if (!facts.actorIsParticipant)
    return {
      kind: "deny",
      reason: "not_participant",
      error: new AppError("FORBIDDEN", PARTICIPANTS_ONLY_TO_EDIT_MESSAGE),
    };
  return null;
}

/** 追加の、認可・本文の形の後の判定 */
function decideAdd(facts: CaseWriteFacts): Decision {
  const target = facts.target;
  if (target === null || !target.isActive)
    return {
      kind: "error",
      error: validationError(["userId"], TARGET_INVALID_MESSAGE),
    };
  if (facts.status !== "active") return conflict("closed");
  if (target.isParticipant) return conflict("already_participant");
  return null;
}

/** 削除・退出の、認可の後の判定 */
function decideRemove(facts: CaseWriteFacts): Decision {
  const target = facts.target;
  if (target === null || !target.isParticipant)
    return {
      kind: "deny",
      reason: "participant_not_found",
      error: new AppError("NOT_FOUND", PARTICIPANT_NOT_FOUND_MESSAGE),
    };
  if (facts.status !== "active") return conflict("closed");
  const targetAutoRole = autoRoleOf({
    isActive: target.isActive,
    isGlobalAdmin: target.isGlobalAdmin,
    ownedDepartmentIds: target.ownedDepartmentIds,
    caseDepartmentIds: facts.caseDepartmentIds,
  });
  if (targetAutoRole !== null) return conflict("auto_participant");
  const activeCountAfter =
    facts.activeParticipantCount - (target.isActive ? 1 : 0);
  if (!canRemoveParticipant({ targetAutoRole, activeCountAfter }))
    return conflict("last_active_participant");
  return null;
}

/** 納期の 403 までの判定（有効な参加者か、管理の資格。R-82） */
function decideDueDateGate(facts: CaseWriteFacts | null): Decision {
  if (facts === null) return notFound();
  if (!facts.actorIsParticipant && !facts.actorCanManage)
    return {
      kind: "deny",
      reason: "cannot_edit",
      error: new AppError("FORBIDDEN", DUE_DATE_FORBIDDEN_MESSAGE),
    };
  return null;
}

/** 403 までの判定を通った材料（案件がある）。判定で null を除いた後にだけ呼ぶ */
function present(facts: CaseWriteFacts | null): CaseWriteFacts {
  if (facts === null)
    throw new Error("案件の材料がありません（404 の判定の前に呼ばれました）");
  return facts;
}

/** 納期の、本文の検証の後の判定 */
function decideDueDate(facts: CaseWriteFacts): Decision {
  return facts.status === "active" ? null : conflict("closed");
}

export function withCaseService<T>(
  env: Env,
  run: (service: ReturnType<typeof createCaseService>) => Promise<T>,
): Promise<T> {
  return withCases(env, (repository, roles) =>
    run(createCaseService(repository, roles)),
  );
}

export function createCaseService(
  repository: CaseRepository,
  roles: RoleAssignmentRepository,
) {
  const loggerOf = (actor: CaseActor) =>
    createLogger({ traceId: actor.traceId, userId: actor.userId });

  async function authorize(
    actor: CaseActor,
    permission: Permission,
  ): Promise<void> {
    await createAppAuthorizer(roles, { logger: loggerOf(actor) }).authorize(
      { userId: actor.userId },
      permission,
      { type: "company" },
    );
  }

  function deny(
    actor: CaseActor,
    action: ViewAction | WriteAction,
    caseId: string,
    reason: string,
    error: AppError,
  ): never {
    loggerOf(actor).audit(action, caseId, "failure", { reason });
    throw error;
  }

  /** 判定が理由を返したら投げる（404・403 は logger.audit に残す） */
  function raiseIf(
    actor: CaseActor,
    action: WriteAction,
    caseId: string,
    decision: Decision,
  ): void {
    if (decision === null) return;
    if (decision.kind === "deny")
      deny(actor, action, caseId, decision.reason, decision.error);
    throw decision.error;
  }

  /**
   * 書き込む。前提が崩れていたら（CaseStateChangedError）、最初と同じ判定で読み直して理由を返す。
   * どの理由にも当たらなければ、成功にせず元のエラーを投げる。それ以外のエラーは、そのまま伝える
   */
  async function writeOrRedecide(
    actor: CaseActor,
    action: WriteAction,
    caseId: string,
    write: () => Promise<void>,
    redecide: () => Promise<Decision>,
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      if (!(error instanceof CaseStateChangedError)) throw error;
      raiseIf(actor, action, caseId, await redecide());
      throw error;
    }
  }

  async function findOrNotFound(
    actor: CaseActor,
    action: ViewAction,
    caseId: string,
  ) {
    const summary = await repository.findSummary({
      actorId: actor.userId,
      caseId,
    });
    if (summary === null)
      deny(
        actor,
        action,
        caseId,
        "not_found",
        new AppError("NOT_FOUND", NOT_FOUND_MESSAGE),
      );
    return summary;
  }

  return {
    async list(
      actor: CaseActor,
      options: {
        scope: CaseListScope;
        status: CaseStatus;
        limit: number;
        cursor?: CursorPayload;
      },
    ) {
      await authorize(actor, "perm.case.summary.view");
      return repository.list({ actorId: actor.userId, ...options });
    },

    async summary(actor: CaseActor, caseId: string) {
      await authorize(actor, "perm.case.summary.view");
      return findOrNotFound(actor, "case.summary.view", caseId);
    },

    async detail(actor: CaseActor, caseId: string) {
      const summary = await findOrNotFound(actor, "case.view", caseId);
      if (!summary.isParticipant)
        deny(
          actor,
          "case.view",
          caseId,
          "not_participant",
          new AppError("FORBIDDEN", PARTICIPANTS_ONLY_MESSAGE),
        );
      await authorize(actor, "perm.case.view");
      // 認可の後に無効化・参加の解除が確定した場合に備え、詳細の読み取りそのものが有効な参加者かを確かめる
      const extras = await repository.findDetailExtras({
        caseId,
        actorId: actor.userId,
      });
      if (extras === "not_found")
        deny(
          actor,
          "case.view",
          caseId,
          "not_found",
          new AppError("NOT_FOUND", NOT_FOUND_MESSAGE),
        );
      if (extras === "not_visible")
        deny(
          actor,
          "case.view",
          caseId,
          "not_participant",
          new AppError("FORBIDDEN", PARTICIPANTS_ONLY_MESSAGE),
        );
      return { ...summary, ...extras };
    },
    /** 参加者の追加（EP-5-09）。body は検証前の本文（403 までの判定の後に形を確かめる。存在の非開示） */
    async addParticipant(
      actor: CaseActor,
      caseId: string,
      body: unknown,
    ): Promise<{ caseId: string; userId: string }> {
      const action = "case.participant.add";
      const gate = await repository.findWriteFacts({
        caseId,
        actorId: actor.userId,
      });
      raiseIf(actor, action, caseId, decideParticipantGate(gate));
      await authorize(actor, "perm.case.participant.edit");
      const { userId } = parseBody(addBodySchema, body);
      const decide = async (): Promise<Decision> => {
        const facts = await repository.findWriteFacts({
          caseId,
          actorId: actor.userId,
          targetId: userId,
        });
        return decideParticipantGate(facts) ?? decideAdd(present(facts));
      };
      raiseIf(actor, action, caseId, await decide());
      await writeOrRedecide(
        actor,
        action,
        caseId,
        () =>
          repository.addParticipant({
            caseId,
            actorId: actor.userId,
            userId,
            traceId: actor.traceId,
          }),
        decide,
      );
      return { caseId, userId };
    },

    /** 参加者の削除・本人の退出（EP-5-10。userId が本人なら退出） */
    async removeParticipant(
      actor: CaseActor,
      caseId: string,
      userId: string,
    ): Promise<void> {
      const action = "case.participant.remove";
      const read = () =>
        repository.findWriteFacts({
          caseId,
          actorId: actor.userId,
          targetId: userId,
        });
      const facts = await read();
      raiseIf(actor, action, caseId, decideParticipantGate(facts));
      await authorize(actor, "perm.case.participant.edit");
      raiseIf(actor, action, caseId, decideRemove(present(facts)));
      await writeOrRedecide(
        actor,
        action,
        caseId,
        () =>
          repository.removeParticipant({
            caseId,
            actorId: actor.userId,
            userId,
            traceId: actor.traceId,
          }),
        async () => {
          const again = await read();
          return decideParticipantGate(again) ?? decideRemove(present(again));
        },
      );
    },

    /** 納期の変更。非参加の担当部署のオーナー・全体管理者もできる（AC-21・Q6）。null は未定に戻す */
    async changeDueDate(
      actor: CaseActor,
      caseId: string,
      body: unknown,
    ): Promise<{ caseId: string; dueDate: string | null }> {
      const action = "case.due_date.change";
      const read = () =>
        repository.findWriteFacts({ caseId, actorId: actor.userId });
      const read0 = await read();
      raiseIf(actor, action, caseId, decideDueDateGate(read0));
      const facts = present(read0);
      await authorize(actor, "perm.case.edit");
      const { dueDate } = parseBody(dueDateBodySchema, body);
      if (dueDate !== null && isDueDateBeforeToday(dueDate, new Date()))
        throw validationError(["dueDate"]);
      raiseIf(actor, action, caseId, decideDueDate(facts));
      const result = { caseId, dueDate };
      // 今と同じ値なら何も書かない（版・監査を変えない）
      if (facts.dueDate === dueDate) return result;
      try {
        await repository.changeDueDate({
          caseId,
          actorId: actor.userId,
          before: facts.dueDate,
          after: dueDate,
          traceId: actor.traceId,
        });
      } catch (error) {
        if (!(error instanceof CaseStateChangedError)) throw error;
        const again = await read();
        raiseIf(
          actor,
          action,
          caseId,
          decideDueDateGate(again) ?? decideDueDate(present(again)),
        );
        // ほかの人が同じ値にしていたら、求めた結果になっている（何も書かない）
        if (present(again).dueDate === dueDate) return result;
        throw error;
      }
      return result;
    },
  };
}
