// Service：案件の作成申請（#146）の申請・自分の申請・取り下げ・類似件名の確認（146-A）と、審査一覧・承認・却下（146-B）の業務ルール。HTTP を知らない。
// 判定の順（計画 A-5。変えない）：
//   申請：(1) perm.case.request.create を会社の範囲で確かめる（拒否は authorize が記録）
//         (2) 全体管理者でなく所属もなければ 403（logger.audit に記録）
//         (4) 整形の後の件名の長さ・納期が今日（日本時間）より前なら 422 → (5) 再申請の元が使えなければ 422 → (6) batch
//   取り下げ：(1) 権限 → 本人の申請でなければ 404（logger.audit に記録）→ (2) batch の中で決裁済みなら 409
//   承認・却下（146-B。計画 B-4）：(1) 審査者の門（全体管理者か、いずれかの部署のオーナー。でなければ 403 で、authorize が拒否を記録）
//         (2) 存在しない・範囲外なら 404（同じ本文。logger.audit に記録）→ (3) 全体管理者でないオーナーの自分の申請なら 403（logger.audit に記録）
//         (4) 承認者が足す候補が存在しない・無効なら 422 → (5) batch の中で 409（決裁済みが最優先）。再認証は求めない（C-81）
// 担当部署は誰でも全部署から選べる（C-132）。部署の範囲で拒否しない。
import {
  caseTitleSchema,
  formatCaseTitle,
  isDueDateBeforeToday,
} from "../../../shared/case-rules";
import {
  CaseRequestWriteError,
  withCaseRequests,
  type CaseRequestForDecision,
  type CaseRequestRepository,
  type CaseRequestStatus,
  type CaseRequestWriteReason,
} from "../db/case-request.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import {
  canDecideCaseRequest,
  caseRequestSubmittedRecipients,
  isCaseRequestReviewable,
  type CaseDecisionInput,
} from "../lib/case-request-rules";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import type { Permission } from "../lib/permissions";
import {
  createAppAuthorizer,
  reviewerFactsOf,
  type ReviewerFacts,
} from "./authorizer";

// 申請の状態の一覧（route が絞り込みの入力の形に使う。routes は db を直接参照しない）
export { CASE_REQUEST_STATUSES } from "../db/case-request.repository";

export type CaseRequestActor = { userId: string; traceId: string };

export type CreateCaseRequestBody = {
  clientId: string;
  title: string;
  description?: string;
  dueDate?: string;
  departmentIds: string[];
  candidateIds?: string[];
  resubmitOf?: string;
};

type Authorizer = {
  authorize(
    principal: { userId: string },
    permission: Permission,
    scope: { type: "company" },
  ): Promise<void>;
};

// 入力欄の誤りは、どの理由でも同じ文言にする（再申請の元の存在を、本文の違いで明かさないため）
const VALIDATION_MESSAGE = "入力内容を確かめてください";

const validationError = (field: string, cause?: unknown) =>
  new AppError(
    "VALIDATION_ERROR",
    VALIDATION_MESSAGE,
    { fields: [field] },
    cause === undefined ? undefined : { cause },
  );

const FIELD_OF: Partial<Record<CaseRequestWriteReason, string>> = {
  client_unavailable: "clientId",
  department_unavailable: "departmentIds",
  candidate_unavailable: "candidateIds",
  resubmit_unavailable: "resubmitOf",
  added_candidate_unavailable: "additionalCandidateIds",
};

/** batch の中の前提の崩れ（409）の文言。画面はこの文言をそのまま出す */
const CONFLICT_MESSAGE_OF: Partial<Record<CaseRequestWriteReason, string>> = {
  recipients_changed: "審査する人が変わりました。もう一度申請してください",
  decided: "この申請はすでに処理されています",
  department_inactive:
    "担当部署の一部が無効のため承認できません。却下して再申請を依頼してください",
  client_inactive:
    "取引先が無効のため承認できません。却下して再申請を依頼してください",
  candidate_inactive:
    "無効になった候補がいます。申請者に取り下げと再申請を依頼してください",
  number_exhausted:
    "この取引先の今年の案件番号が上限に達したため承認できません",
  number_conflict: "採番が競合しました。もう一度承認してください",
};

type DecideOperation = "approve" | "reject";

export function withCaseRequestService<T>(
  env: Env,
  run: (service: ReturnType<typeof createCaseRequestService>) => Promise<T>,
): Promise<T> {
  return withCaseRequests(env, (repository, roles) =>
    run(createCaseRequestService(repository, roles)),
  );
}

export function createCaseRequestService(
  repository: CaseRequestRepository,
  roles: RoleAssignmentRepository,
  deps: { now?: () => Date; authorizer?: Authorizer } = {},
) {
  const now = deps.now ?? (() => new Date());

  const loggerOf = (actor: CaseRequestActor) =>
    createLogger({ traceId: actor.traceId, userId: actor.userId });

  async function authorize(actor: CaseRequestActor): Promise<void> {
    const authorizer =
      deps.authorizer ??
      createAppAuthorizer(roles, { logger: loggerOf(actor) });
    await authorizer.authorize(
      { userId: actor.userId },
      "perm.case.request.create",
      { type: "company" },
    );
  }

  function deny(
    actor: CaseRequestActor,
    action: "create" | "withdraw" | DecideOperation,
    target: string,
    reason: string,
    error: AppError,
  ): never {
    loggerOf(actor).audit(`case_request.${action}`, target, "failure", {
      reason,
    });
    throw error;
  }

  /** 書き込みの専用エラーを AppError に変える。未知のエラーはそのまま返す（握りつぶさない） */
  function toAppError(
    actor: CaseRequestActor,
    error: unknown,
    decided?: { operation: DecideOperation; requestId: string },
  ): unknown {
    if (!(error instanceof CaseRequestWriteError)) return error;
    const field = FIELD_OF[error.reason];
    if (field !== undefined) return validationError(field, error);
    const conflict = CONFLICT_MESSAGE_OF[error.reason];
    if (conflict !== undefined)
      return new AppError("CONFLICT", conflict, {}, { cause: error });
    switch (error.reason) {
      case "requester_ineligible":
        loggerOf(actor).audit("case_request.create", actor.userId, "failure", {
          reason: error.reason,
        });
        return new AppError(
          "FORBIDDEN",
          "申請できません",
          {},
          { cause: error },
        );
      // 最初の判定の後に、決裁者の資格がなくなった（突き合わせの表 146-B）
      case "reviewer_ineligible":
        loggerOf(actor).audit(
          `case_request.${decided?.operation ?? "approve"}`,
          decided?.requestId ?? actor.userId,
          "failure",
          { reason: error.reason },
        );
        return new AppError(
          "FORBIDDEN",
          "この申請を審査する権限がありません",
          {},
          { cause: error },
        );
      default:
        return new AppError(
          "NOT_FOUND",
          "申請が見つかりません",
          {},
          { cause: error },
        );
    }
  }

  async function attempt<T>(
    actor: CaseRequestActor,
    run: () => Promise<T>,
    decided?: { operation: DecideOperation; requestId: string },
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw toAppError(actor, error, decided);
    }
  }

  /** (1) 審査者の門。審査者でなければ authorize が拒否を記録して 403 にする */
  async function requireReviewer(
    actor: CaseRequestActor,
  ): Promise<ReviewerFacts> {
    const found = await roles.findByUserId(actor.userId);
    const facts = reviewerFactsOf(found);
    if (facts.isAdmin || facts.ownedDepartmentIds.length > 0) return facts;
    // 拒否の記録は authorize が行う。万一 authorize が通っても、審査者でない人は通さない（デフォルト拒否）
    const authorizer =
      deps.authorizer ??
      createAppAuthorizer(
        { findByUserId: () => Promise.resolve(found) },
        { logger: loggerOf(actor) },
      );
    await authorizer.authorize(
      { userId: actor.userId },
      "perm.case.request.approve",
      { type: "company" },
    );
    throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
  }

  const decisionInputOf = (
    request: { requestedBy: string; departmentIds: readonly string[] },
    actor: CaseRequestActor,
    facts: ReviewerFacts,
  ): CaseDecisionInput => ({
    departmentIds: request.departmentIds,
    requesterId: request.requestedBy,
    actorId: actor.userId,
    actorIsAdmin: facts.isAdmin,
    actorOwnedDepartmentIds: facts.ownedDepartmentIds,
  });

  /** (1)〜(3)：審査者の門 → 申請が見えるか → 決裁できるか */
  async function loadDecidable(
    actor: CaseRequestActor,
    operation: DecideOperation,
    requestId: string,
  ): Promise<CaseRequestForDecision> {
    const facts = await requireReviewer(actor);
    const request = await repository.findForDecision(requestId);
    if (
      request === null ||
      !isCaseRequestReviewable(decisionInputOf(request, actor, facts))
    )
      deny(
        actor,
        operation,
        requestId,
        "not_found",
        new AppError("NOT_FOUND", "申請が見つかりません"),
      );
    if (!canDecideCaseRequest(decisionInputOf(request, actor, facts)))
      deny(
        actor,
        operation,
        requestId,
        "own_request",
        new AppError("FORBIDDEN", "この申請は承認・却下できません"),
      );
    return request;
  }

  return {
    async create(actor: CaseRequestActor, input: CreateCaseRequestBody) {
      await authorize(actor);
      const facts = reviewerFactsOf(await roles.findByUserId(actor.userId));
      if (
        !facts.isAdmin &&
        (await repository.findUserDepartmentId(actor.userId)) === null
      )
        deny(
          actor,
          "create",
          actor.userId,
          "no_department",
          new AppError("FORBIDDEN", "所属部署がないため申請できません"),
        );
      const parsedTitle = caseTitleSchema.safeParse(input.title);
      if (!parsedTitle.success) throw validationError("title");
      const title = parsedTitle.data;
      const dueDate = input.dueDate ?? null;
      if (dueDate !== null && isDueDateBeforeToday(dueDate, now()))
        throw validationError("dueDate");
      const candidateIds = input.candidateIds ?? [];
      if (candidateIds.includes(actor.userId))
        throw validationError("candidateIds");
      const resubmitOf = input.resubmitOf ?? null;
      if (
        resubmitOf !== null &&
        !(await repository.findOwnResubmittable({
          requestId: resubmitOf,
          requesterId: actor.userId,
        }))
      )
        throw validationError("resubmitOf");
      // 書き込みの前に比べる（後では自分の申請が一致してしまうため）
      const hasSimilarTitle = await repository.hasSimilarTitle({
        clientId: input.clientId,
        title,
      });
      const candidates = await repository.readSubmittedRecipientCandidates(
        input.departmentIds,
      );
      const { id } = await attempt(actor, () =>
        repository.create({
          requesterId: actor.userId,
          clientId: input.clientId,
          title,
          description: input.description ?? "",
          dueDate,
          departmentIds: input.departmentIds,
          candidateIds,
          resubmitOf,
          recipientIds: caseRequestSubmittedRecipients({
            requesterId: actor.userId,
            ...candidates,
          }),
          now: now().toISOString(),
          traceId: actor.traceId,
        }),
      );
      const item = await repository.findOwnItem({
        requestId: id,
        requesterId: actor.userId,
      });
      if (item === null) throw new Error("作成した申請を読めませんでした");
      return {
        ...item,
        titleFormatted: title !== input.title,
        hasSimilarTitle,
      };
    },

    async listMine(
      actor: CaseRequestActor,
      options: { limit: number; cursor?: CursorPayload },
    ) {
      await authorize(actor);
      return repository.listMine({ requesterId: actor.userId, ...options });
    },

    /** 申請者本人だけが、審査中の申請を取り下げられる（再認証なし）。他人の申請は存在を明かさず 404 */
    async withdraw(actor: CaseRequestActor, requestId: string) {
      await authorize(actor);
      const own = { requestId, requesterId: actor.userId };
      const request = await repository.findOwnForWithdraw(own);
      if (request === null)
        deny(
          actor,
          "withdraw",
          requestId,
          "not_found",
          new AppError("NOT_FOUND", "申請が見つかりません"),
        );
      await attempt(actor, () =>
        repository.withdraw({
          ...own,
          version: request.version,
          now: now().toISOString(),
          traceId: actor.traceId,
        }),
      );
      return { requestId, status: "withdrawn" as const };
    },

    /** 審査一覧（S-29）：審査の範囲の申請を新しい順に返す。canApprove は審査中で決裁できるときだけ true */
    async listForReview(
      actor: CaseRequestActor,
      options: {
        limit: number;
        cursor?: CursorPayload;
        status?: CaseRequestStatus;
      },
    ) {
      const facts = await requireReviewer(actor);
      const page = await repository.listReviewable(facts, options);
      return {
        items: page.items.map((item) => ({
          ...item,
          canApprove:
            item.status === "pending" &&
            canDecideCaseRequest(
              decisionInputOf(
                {
                  requestedBy: item.requesterId,
                  departmentIds: item.departments.map((d) => d.id),
                },
                actor,
                facts,
              ),
            ),
        })),
        nextCursor: page.nextCursor,
      };
    },

    /** 承認：案件・案件専用チャンネル・参加者を作る（再認証なし。C-81） */
    async approve(
      actor: CaseRequestActor,
      requestId: string,
      input: { additionalCandidateIds?: string[] },
    ) {
      const request = await loadDecidable(actor, "approve", requestId);
      const additionalCandidateIds = input.additionalCandidateIds ?? [];
      // (4) 足す候補が存在して有効か。読んだ後に無効になった場合は batch の中で確かめ直す
      if (
        (await repository.countActiveUsers(additionalCandidateIds)) !==
        additionalCandidateIds.length
      )
        throw validationError("additionalCandidateIds");
      const created = await attempt(
        actor,
        () =>
          repository.approve({
            requestId,
            version: request.version,
            deciderId: actor.userId,
            additionalCandidateIds,
            now: now().toISOString(),
            traceId: actor.traceId,
          }),
        { operation: "approve", requestId },
      );
      return { requestId, status: "approved" as const, ...created };
    },

    /** 却下：理由は前後の空白を除いた 1〜200 文字（route で確かめる）。部署・取引先・候補が無効でも却下できる */
    async reject(actor: CaseRequestActor, requestId: string, reason: string) {
      const request = await loadDecidable(actor, "reject", requestId);
      await attempt(
        actor,
        () =>
          repository.reject({
            requestId,
            version: request.version,
            deciderId: actor.userId,
            reason,
            now: now().toISOString(),
            traceId: actor.traceId,
          }),
        { operation: "reject", requestId },
      );
      return { requestId, status: "rejected" as const };
    },

    /** 類似件名の確認：真偽と整形後の件名だけを返す（件名・申請者・件数は返さない） */
    async checkSimilarTitle(
      actor: CaseRequestActor,
      input: { clientId: string; title: string; excludeCaseId?: string },
    ) {
      await authorize(actor);
      const formattedTitle = formatCaseTitle(input.title);
      const hasSimilar = await repository.hasSimilarTitle({
        clientId: input.clientId,
        title: formattedTitle,
        ...(input.excludeCaseId === undefined
          ? {}
          : { excludeCaseId: input.excludeCaseId }),
      });
      return { hasSimilar, formattedTitle };
    },
  };
}
