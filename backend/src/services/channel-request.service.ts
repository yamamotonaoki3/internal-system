// Service：チャンネルの作成申請（#131）の申請・一覧・承認・却下・取り下げの業務ルール。HTTP を知らない。
// 決裁（承認・却下）の判定の順番は全 API で固定：
//   (1) 審査者の門（全体管理者か、いずれかの部署のオーナーか。でなければ 403 で、authorize が拒否を記録）
//   (2) 再認証（なければ 403 REAUTH_REQUIRED）
//   (3) 申請が見えない（存在しない・範囲外）なら 404（logger.audit に記録）
//   (4) 見えるが決裁できない（オーナー自身の申請）なら 403（logger.audit に記録）
//   (5) Repository の batch の中で、決裁済みなら 409
// Resolver の perm.channel.request.approve.owner は候補にすぎないため、(1) を通っても (3)(4) を必ず確かめる。
import {
  ChannelRequestConflictError,
  withChannelRequests,
  type ChannelRequestRepository,
  type ChannelRequestWrite,
  type RequestForDecision,
  type RequestStatus,
  type RequestVisibility,
} from "../db/channel-request.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import {
  canDecideChannelRequest,
  channelRequestReviewerIds,
  isReviewable,
  type DecisionInput,
} from "../lib/channel-request-rules";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import type { Permission } from "../lib/permissions";
import {
  createAppAuthorizer,
  reviewerFactsOf,
  type ReviewerFacts,
} from "./authorizer";
import { assertRecentReauth } from "./credentials.service";

export type ChannelRequestActor = {
  userId: string;
  traceId: string;
  reauthenticatedAt: string | null;
};

type DecideOperation = "approve" | "reject";

const CONFLICT_MESSAGES = {
  duplicate_name:
    "同じ名前のチャンネルまたは承認待ちの申請があります。別の名前を入力してください",
  name_taken: "同じ名前のチャンネルがあるため承認できません。却下してください",
  department_inactive: "部署が無効のため承認できません",
  decided: "この申請はすでに処理されています",
} as const;

/** Repository の専用エラーを AppError に変える。未知のエラーはそのまま返す（握りつぶさない） */
function toAppError(error: unknown): unknown {
  if (!(error instanceof ChannelRequestConflictError)) return error;
  return new AppError(
    "CONFLICT",
    CONFLICT_MESSAGES[error.reason],
    {},
    { cause: error },
  );
}

export function withChannelRequestService<T>(
  env: Env,
  run: (service: ReturnType<typeof createChannelRequestService>) => Promise<T>,
): Promise<T> {
  return withChannelRequests(env, (repository, roles) =>
    run(createChannelRequestService(repository, roles)),
  );
}

export function createChannelRequestService(
  repository: ChannelRequestRepository,
  roles: RoleAssignmentRepository,
  deps: { now?: () => Date } = {},
) {
  const now = deps.now ?? (() => new Date());

  const loggerOf = (actor: ChannelRequestActor) =>
    createLogger({ traceId: actor.traceId, userId: actor.userId });

  async function authorize(
    actor: ChannelRequestActor,
    permission: Permission,
  ): Promise<void> {
    await createAppAuthorizer(roles, { logger: loggerOf(actor) }).authorize(
      { userId: actor.userId },
      permission,
      { type: "company" },
    );
  }

  /** (1) 審査者の門。審査者でなければ authorize が拒否を記録して 403 にする */
  async function requireReviewer(
    actor: ChannelRequestActor,
  ): Promise<ReviewerFacts> {
    const found = await roles.findByUserId(actor.userId);
    const facts = reviewerFactsOf(found);
    if (facts.isAdmin || facts.ownedDepartmentIds.length > 0) return facts;
    // 拒否の記録は authorize が行う。万一 authorize が通っても、審査者でない人は通さない（デフォルト拒否）
    await createAppAuthorizer(
      { findByUserId: () => Promise.resolve(found) },
      { logger: loggerOf(actor) },
    ).authorize(
      { userId: actor.userId },
      "perm.channel.request.approve.owner",
      {
        type: "company",
      },
    );
    throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
  }

  const decisionInputOf = (
    request: RequestForDecision,
    actor: ChannelRequestActor,
    facts: ReviewerFacts,
  ): DecisionInput => ({
    departmentId: request.departmentId,
    requesterId: request.requestedBy,
    actorId: actor.userId,
    actorIsAdmin: facts.isAdmin,
    actorOwnsDepartment:
      request.departmentId !== null &&
      facts.ownedDepartmentIds.includes(request.departmentId),
    requesterOwnsDepartment: request.requesterOwnsDepartment,
  });

  function deny(
    actor: ChannelRequestActor,
    action: string,
    requestId: string,
    reason: string,
    error: AppError,
  ): never {
    loggerOf(actor).audit(`channel_request.${action}`, requestId, "failure", {
      reason,
    });
    throw error;
  }

  /** (2)〜(4)：再認証 → 申請が見えるか → 決裁できるか */
  async function loadDecidable(
    actor: ChannelRequestActor,
    facts: ReviewerFacts,
    operation: DecideOperation,
    requestId: string,
  ): Promise<RequestForDecision> {
    assertRecentReauth(actor.reauthenticatedAt, now());
    const request = await repository.findForDecision(requestId);
    if (
      request === null ||
      !isReviewable(decisionInputOf(request, actor, facts))
    )
      deny(
        actor,
        operation,
        requestId,
        "not_found",
        new AppError("NOT_FOUND", "申請が見つかりません"),
      );
    if (!canDecideChannelRequest(decisionInputOf(request, actor, facts)))
      deny(
        actor,
        operation,
        requestId,
        "own_request",
        new AppError("FORBIDDEN", "この申請は承認・却下できません"),
      );
    return request;
  }

  async function attempt<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw toAppError(error);
    }
  }

  const writeOf = (actor: ChannelRequestActor): ChannelRequestWrite => ({
    actorId: actor.userId,
    traceId: actor.traceId,
  });

  return {
    async create(
      actor: ChannelRequestActor,
      input: {
        scope: "department" | "company";
        name: string;
        description?: string;
        visibility: RequestVisibility;
      },
    ) {
      await authorize(actor, "perm.channel.request.create");
      // 部署は認証済みの利用者の所属からサーバーが決める（他部署を指定する手段を作らない）
      const departmentId =
        input.scope === "department"
          ? await repository.findUserDepartmentId(actor.userId)
          : null;
      if (input.scope === "department" && departmentId === null)
        throw new AppError(
          "VALIDATION_ERROR",
          "所属する部署がないため、自部署のチャンネルは申請できません",
          { fields: ["scope"] },
        );
      const candidates = await repository.readReviewerCandidates(departmentId);
      return attempt(() =>
        repository.create(
          {
            departmentId,
            name: input.name,
            description: input.description ?? "",
            visibility: input.visibility,
            requesterId: actor.userId,
            reviewerIds: channelRequestReviewerIds({
              departmentId,
              requesterId: actor.userId,
              ...candidates,
            }),
          },
          writeOf(actor),
        ),
      );
    },

    async listMine(
      actor: ChannelRequestActor,
      options: { limit: number; cursor?: CursorPayload },
    ) {
      await authorize(actor, "perm.channel.request.view.own");
      return repository.listMine(actor.userId, options);
    },

    async listForReview(
      actor: ChannelRequestActor,
      options: {
        limit: number;
        cursor?: CursorPayload;
        status?: RequestStatus;
        departmentId?: string;
      },
    ) {
      const facts = await requireReviewer(actor);
      const page = await repository.listReviewable(
        { actorId: actor.userId, ...facts },
        options,
      );
      return {
        items: page.items.map(({ requesterOwnsDepartment, ...item }) => ({
          ...item,
          // 決裁済み・取り下げ済みは決裁できない
          canApprove:
            item.status === "pending" &&
            canDecideChannelRequest({
              departmentId: item.departmentId,
              requesterId: item.requesterId,
              actorId: actor.userId,
              actorIsAdmin: facts.isAdmin,
              actorOwnsDepartment:
                item.departmentId !== null &&
                facts.ownedDepartmentIds.includes(item.departmentId),
              requesterOwnsDepartment,
            }),
        })),
        nextCursor: page.nextCursor,
      };
    },

    async approve(actor: ChannelRequestActor, requestId: string) {
      const facts = await requireReviewer(actor);
      const request = await loadDecidable(actor, facts, "approve", requestId);
      const created = await attempt(() =>
        repository.approve(request, writeOf(actor)),
      );
      return { requestId, status: "approved" as const, ...created };
    },

    async reject(
      actor: ChannelRequestActor,
      requestId: string,
      reason: string,
    ) {
      const facts = await requireReviewer(actor);
      const request = await loadDecidable(actor, facts, "reject", requestId);
      await attempt(() => repository.reject(request, reason, writeOf(actor)));
      return { requestId, status: "rejected" as const, reason };
    },

    /** 申請者本人だけが、承認待ちの申請を取り下げられる（再認証なし）。他人の申請は存在を明かさず 404 */
    async withdraw(actor: ChannelRequestActor, requestId: string) {
      await authorize(actor, "perm.channel.request.create");
      const request = await repository.findForDecision(requestId);
      if (request === null || request.requestedBy !== actor.userId)
        deny(
          actor,
          "withdraw",
          requestId,
          "not_found",
          new AppError("NOT_FOUND", "申請が見つかりません"),
        );
      await attempt(() => repository.withdraw(request, writeOf(actor)));
      return { requestId, status: "withdrawn" as const };
    },
  };
}
