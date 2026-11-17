// Service：案件の一覧・概要・詳細（#147 の 147-A）の業務ルール。HTTP を知らない。読み取りだけなので監査の記録（DB）は書かない。
// 判定の順（計画 147-A。変えない）：
//   一覧：perm.case.summary.view（会社の範囲。拒否は authorize が記録）
//   概要：perm.case.summary.view → 案件がない（404。logger.audit）
//   詳細：案件がない（404）→ 有効な参加者でない（403。logger.audit）→ perm.case.view（会社の範囲）
// 全体管理者・担当部署のオーナーでも、参加していなければ詳細は見られない（AC-2・AC-21）。
import {
  withCases,
  type CaseListScope,
  type CaseRepository,
  type CaseStatus,
  type CaseViewer,
} from "../db/case.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import type { Permission } from "../lib/permissions";
import { createAppAuthorizer, reviewerFactsOf } from "./authorizer";

// 一覧の範囲と状態（route が入力の形に使う。routes は db を直接参照しない）
export { CASE_LIST_SCOPES, CASE_STATUSES } from "../db/case.repository";

export type CaseActor = { userId: string; traceId: string };

/** 画面はこの文言をそのまま出す */
const NOT_FOUND_MESSAGE = "案件が見つかりません";
const PARTICIPANTS_ONLY_MESSAGE = "参加者だけが見られます（非公開）";

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

  /** 管理の資格の元を、割り当ての読み込み1回で導く（無効な操作者は何も持たない） */
  async function viewerOf(actor: CaseActor): Promise<CaseViewer> {
    const facts = reviewerFactsOf(await roles.findByUserId(actor.userId));
    return {
      actorId: actor.userId,
      isGlobalAdmin: facts.isAdmin,
      ownedDepartmentIds: facts.ownedDepartmentIds,
    };
  }

  function deny(
    actor: CaseActor,
    action: "case.summary.view" | "case.view",
    caseId: string,
    reason: string,
    error: AppError,
  ): never {
    loggerOf(actor).audit(action, caseId, "failure", { reason });
    throw error;
  }

  async function findOrNotFound(
    actor: CaseActor,
    action: "case.summary.view" | "case.view",
    caseId: string,
  ) {
    const summary = await repository.findSummary({
      ...(await viewerOf(actor)),
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
      return repository.list({ ...(await viewerOf(actor)), ...options });
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
      const extras = await repository.findDetailExtras(caseId);
      // 概要を読んだ後に消えた（物理削除は #151）ときは、存在しない案件と同じ 404 にする
      if (extras === null)
        deny(
          actor,
          "case.view",
          caseId,
          "not_found",
          new AppError("NOT_FOUND", NOT_FOUND_MESSAGE),
        );
      return { ...summary, ...extras };
    },
  };
}
