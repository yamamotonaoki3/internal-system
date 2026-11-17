// Service：案件の作成申請（#146 の 146-A）の申請・自分の申請・取り下げ・類似件名の確認の業務ルール。HTTP を知らない。
// 判定の順（計画 A-5。変えない）：
//   申請：(1) perm.case.request.create を会社の範囲で確かめる（拒否は authorize が記録）
//         (2) 全体管理者でなく所属もなければ 403（logger.audit に記録）
//         (4) 整形の後の件名の長さ・納期が今日（日本時間）より前なら 422 → (5) 再申請の元が使えなければ 422 → (6) batch
//   取り下げ：(1) 権限 → 本人の申請でなければ 404（logger.audit に記録）→ (2) batch の中で決裁済みなら 409
// 担当部署は誰でも全部署から選べる（C-132）。部署の範囲で拒否しない。
import {
  caseTitleSchema,
  formatCaseTitle,
  isDueDateBeforeToday,
} from "../../../shared/case-rules";
import {
  CaseRequestWriteError,
  withCaseRequests,
  type CaseRequestRepository,
  type CaseRequestWriteReason,
} from "../db/case-request.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { caseRequestSubmittedRecipients } from "../lib/case-request-rules";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import type { Permission } from "../lib/permissions";
import { createAppAuthorizer, reviewerFactsOf } from "./authorizer";

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
};

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
    action: "create" | "withdraw",
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
  function toAppError(actor: CaseRequestActor, error: unknown): unknown {
    if (!(error instanceof CaseRequestWriteError)) return error;
    const field = FIELD_OF[error.reason];
    if (field !== undefined) return validationError(field, error);
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
      case "recipients_changed":
        return new AppError(
          "CONFLICT",
          "審査する人が変わりました。もう一度申請してください",
          {},
          { cause: error },
        );
      case "decided":
        return new AppError(
          "CONFLICT",
          "この申請はすでに処理されています",
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
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw toAppError(actor, error);
    }
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

    /** 類似件名の確認：真偽と整形後の件名だけを返す（件名・申請者・件数は返さない） */
    async checkSimilarTitle(
      actor: CaseRequestActor,
      input: { clientId: string; title: string },
    ) {
      await authorize(actor);
      const formattedTitle = formatCaseTitle(input.title);
      const hasSimilar = await repository.hasSimilarTitle({
        clientId: input.clientId,
        title: formattedTitle,
      });
      return { hasSimilar, formattedTitle };
    },
  };
}
