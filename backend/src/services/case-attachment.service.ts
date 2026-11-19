// Service：案件の添付の一覧（#148 の 148-B-1。EP-5-19）の業務ルール。HTTP を知らない。
// 判定の順（計画 148-B-1。クエリの検証〔422〕はルートが最初に行う）：
//   案件がない（404）→ 有効な参加者でない（403）→ perm.case.view → 読み取り（資格を SQL に入れる。資格がなければ 403）
// 管理の資格はあるが参加していない人（担当部署のオーナー・全体管理者）も 403。終了した案件でも、参加者は読める（5-1 AC-11）。
// 404・403 の拒否は logger.audit に残す（対象は案件の ID。ファイル名などの中身は入れない）。
import {
  withCaseAttachments,
  type CaseAttachmentRepository,
} from "../db/case-attachment.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";

export type CaseAttachmentActor = { userId: string; traceId: string };

/** 画面はこの文言をそのまま出す */
const NOT_FOUND_MESSAGE = "案件が見つかりません";
const PARTICIPANTS_ONLY_MESSAGE = "参加者だけが見られます（非公開）";

const VIEW_ACTION = "case.attachment.view";

export function withCaseAttachmentService<T>(
  env: Env,
  run: (service: ReturnType<typeof createCaseAttachmentService>) => Promise<T>,
): Promise<T> {
  return withCaseAttachments(env, (repository, roles) =>
    run(createCaseAttachmentService(repository, roles)),
  );
}

export function createCaseAttachmentService(
  repository: CaseAttachmentRepository,
  roles: RoleAssignmentRepository,
) {
  const loggerOf = (actor: CaseAttachmentActor) =>
    createLogger({ traceId: actor.traceId, userId: actor.userId });

  function deny(
    actor: CaseAttachmentActor,
    caseId: string,
    reason: "not_found" | "not_participant",
  ): never {
    loggerOf(actor).audit(VIEW_ACTION, caseId, "failure", { reason });
    throw reason === "not_found"
      ? new AppError("NOT_FOUND", NOT_FOUND_MESSAGE)
      : new AppError("FORBIDDEN", PARTICIPANTS_ONLY_MESSAGE);
  }

  return {
    /** 一覧（EP-5-19） */
    async list(
      actor: CaseAttachmentActor,
      caseId: string,
      options: { limit: number; cursor: string | null },
    ) {
      const facts = await repository.findAttachmentListFacts({
        caseId,
        actorId: actor.userId,
      });
      if (facts === null) deny(actor, caseId, "not_found");
      if (!facts.isParticipant) deny(actor, caseId, "not_participant");
      await createAppAuthorizer(roles, { logger: loggerOf(actor) }).authorize(
        { userId: actor.userId },
        "perm.case.view",
        { type: "company" },
      );
      // 認可の後に無効化・参加の解除が確定した場合に備え、読み取りそのものに資格を入れている
      const page = await repository.listCaseAttachments({
        caseId,
        viewerId: actor.userId,
        ...options,
      });
      if (page === "not_found") deny(actor, caseId, "not_found");
      if (page === "not_visible") deny(actor, caseId, "not_participant");
      return page;
    },
  };
}
