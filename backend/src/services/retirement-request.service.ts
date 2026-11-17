// Service：退職処理の申請（#128）の作成・一覧・却下・取り下げの業務ルール。HTTP も DB のライブラリも知らない。
// 判定の順（最初と、書き込みの前提が崩れた後の読み直しで、同じ関数を使う）：
//   作成：404（対象がない）→ 403（対象が無効・所属なし、または対象の今の部署で perm.workspace.manage がない）→ 再認証
//         → 409（対象が部署のオーナー〔申請者自身を含む〕・全体管理者。重複は一意索引の違反を変換して duplicate_pending）
//   却下：403（会社範囲で perm.account.deactivate がない。申請の有無を明かさない）→ 再認証 → 404 → 409（not_pending）
//   取り下げ：404（ない・自分の申請でない。同じ応答）→ 409（not_pending）。再認証は求めない
// 承認は専用の操作を作らず、アカウントの無効化（account.service.ts）で申請を完了にする。
import {
  RetirementRequestConflictError,
  RetirementRequestStateChangedError,
  withRetirementRequests,
  type RetirementRequestForDecision,
  type RetirementRequestListOptions,
  type RetirementRequestRepository,
  type RetirementRequestStatus,
} from "../db/retirement-request.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";
import { assertRecentReauth } from "./credentials.service";

export type RetirementRequestActor = {
  userId: string;
  traceId: string;
  reauthenticatedAt: string | null;
};

export type RetirementRequestCreated = {
  id: string;
  targetUserId: string;
  departmentId: string;
  status: "pending";
  createdAt: string;
};

type ConflictReason =
  "department_owner" | "global_admin" | "duplicate_pending" | "not_pending";

const CONFLICT_MESSAGES: Record<ConflictReason, string> = {
  department_owner:
    "部署のオーナーは退職処理を申請できません。先にオーナーを交代してください",
  global_admin: "全体管理者は退職処理を申請できません",
  duplicate_pending: "この社員には、すでに申請中の退職処理の申請があります",
  not_pending: "この申請はすでに処理されています",
};

function conflict(reason: ConflictReason, cause?: unknown): AppError {
  return new AppError(
    "CONFLICT",
    CONFLICT_MESSAGES[reason],
    { reason },
    cause === undefined ? undefined : { cause },
  );
}

const forbidden = () =>
  new AppError("FORBIDDEN", "この操作を行う権限がありません");

// 存在しない申請と他人の申請で、同じ応答にする
const requestNotFound = () =>
  new AppError("NOT_FOUND", "退職処理の申請が見つかりません");

/**
 * 書き込む。前提が崩れていたら（RetirementRequestStateChangedError）、最初と同じ判定で事実を読み直して理由を返す。
 * どの理由にも当たらなければ、成功にせず元のエラーを投げる。それ以外のエラーは、そのまま伝える。
 */
async function writeWithRecheck<T>(
  decide: () => Promise<unknown>,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!(error instanceof RetirementRequestStateChangedError)) throw error;
    await decide();
    throw error;
  }
}

export function withRetirementRequestService<T>(
  env: Env,
  run: (
    service: ReturnType<typeof createRetirementRequestService>,
  ) => Promise<T>,
): Promise<T> {
  return withRetirementRequests(env, (repository, roles) =>
    run(createRetirementRequestService(repository, roles)),
  );
}

export function createRetirementRequestService(
  repository: RetirementRequestRepository,
  roles: RoleAssignmentRepository,
  deps: { now?: () => Date } = {},
) {
  const now = deps.now ?? (() => new Date());

  const authorizerOf = (actor: RetirementRequestActor) =>
    createAppAuthorizer(roles, {
      logger: createLogger({ traceId: actor.traceId, userId: actor.userId }),
    });

  /** 全体管理者の一覧・却下の門（会社範囲の perm.account.deactivate。拒否は authorize が記録する） */
  const authorizeReviewer = (actor: RetirementRequestActor) =>
    authorizerOf(actor).authorize(
      { userId: actor.userId },
      "perm.account.deactivate",
      { type: "company" },
    );

  /** 作成の判定。対象の今の部署を返す */
  async function decideCreate(
    actor: RetirementRequestActor,
    targetUserId: string,
  ): Promise<string> {
    const target = await repository.findTarget(targetUserId);
    if (target === null)
      throw new AppError("NOT_FOUND", "社員が見つかりません");
    if (!target.isActive || target.departmentId === null) throw forbidden();
    await authorizerOf(actor).authorize(
      { userId: actor.userId },
      "perm.workspace.manage",
      { type: "department", departmentId: target.departmentId },
    );
    assertRecentReauth(actor.reauthenticatedAt, now());
    if (target.isDepartmentOwner) throw conflict("department_owner");
    if (target.isGlobalAdmin) throw conflict("global_admin");
    return target.departmentId;
  }

  /** 却下の判定 */
  async function decideReject(
    actor: RetirementRequestActor,
    requestId: string,
  ): Promise<void> {
    await authorizeReviewer(actor);
    assertRecentReauth(actor.reauthenticatedAt, now());
    const request = await repository.findForDecision(requestId);
    if (request === null) throw requestNotFound();
    if (request.status !== "pending") throw conflict("not_pending");
  }

  /** 取り下げの判定 */
  async function decideWithdraw(
    actor: RetirementRequestActor,
    requestId: string,
  ): Promise<RetirementRequestForDecision> {
    const request = await repository.findForDecision(requestId);
    if (request === null || request.requestedBy !== actor.userId)
      throw requestNotFound();
    if (request.status !== "pending") throw conflict("not_pending");
    return request;
  }

  return {
    async create(
      actor: RetirementRequestActor,
      input: { targetUserId: string },
    ): Promise<RetirementRequestCreated> {
      const decide = () => decideCreate(actor, input.targetUserId);
      const departmentId = await decide();
      // 申請者本人が全体管理者を兼ねるなら、自分には知らせない
      const reviewerIds = (await repository.findGlobalAdminIds()).filter(
        (id) => id !== actor.userId,
      );
      const createdAt = now().toISOString();
      try {
        const created = await writeWithRecheck(decide, () =>
          repository.create({
            targetUserId: input.targetUserId,
            departmentId,
            actorId: actor.userId,
            reviewerIds,
            now: createdAt,
            traceId: actor.traceId,
          }),
        );
        return {
          id: created.id,
          targetUserId: input.targetUserId,
          departmentId,
          status: "pending",
          createdAt,
        };
      } catch (error) {
        if (error instanceof RetirementRequestConflictError)
          throw conflict(error.reason, error);
        throw error;
      }
    },

    async listMine(
      actor: RetirementRequestActor,
      options: RetirementRequestListOptions,
    ) {
      return repository.listMine(actor.userId, options);
    },

    async listForReview(
      actor: RetirementRequestActor,
      options: RetirementRequestListOptions & {
        status?: RetirementRequestStatus;
      },
    ) {
      await authorizeReviewer(actor);
      return repository.listForReview(options);
    },

    async reject(
      actor: RetirementRequestActor,
      requestId: string,
      reason: string,
    ): Promise<{ id: string; status: "rejected" }> {
      const decide = () => decideReject(actor, requestId);
      await decide();
      await writeWithRecheck(decide, () =>
        repository.reject({
          id: requestId,
          actorId: actor.userId,
          reason,
          now: now().toISOString(),
          traceId: actor.traceId,
        }),
      );
      return { id: requestId, status: "rejected" };
    },

    async withdraw(
      actor: RetirementRequestActor,
      requestId: string,
    ): Promise<{ id: string; status: "withdrawn" }> {
      const decide = () => decideWithdraw(actor, requestId);
      await decide();
      await writeWithRecheck(decide, () =>
        repository.withdraw({
          id: requestId,
          actorId: actor.userId,
          now: now().toISOString(),
          traceId: actor.traceId,
        }),
      );
      return { id: requestId, status: "withdrawn" };
    },
  };
}
