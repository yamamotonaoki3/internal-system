// Service：部署の一覧・作成・改名・オーナー交代の業務ルール（#196）。HTTP を知らない。
// 順序：認可 → 再認証（書き込みのみ）→ 存在確認 → Repository（1操作＝1 db.batch）→ 専用エラーを AppError に変換。
import {
  DepartmentConflictError,
  DuplicateDepartmentError,
  withDepartments,
  type DepartmentRepository,
} from "../db/department.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import type { Permission } from "../lib/permissions";
import { createAppAuthorizer } from "./authorizer";
import { assertRecentReauth } from "./credentials.service";

export type DepartmentActor = {
  userId: string;
  traceId: string;
  reauthenticatedAt: string | null;
};

const NAME_CONFLICT_MESSAGE =
  "同じ名前の部署またはチャンネルがあります。別の部署名を入力してください";
const STALE_MESSAGE = "他の人が先に更新しました。読み込み直してください";

/** Repository の専用エラーを AppError に変える。未知のエラーはそのまま返す（握りつぶさない） */
function toAppError(error: unknown): unknown {
  if (error instanceof DuplicateDepartmentError)
    return new AppError(
      "CONFLICT",
      NAME_CONFLICT_MESSAGE,
      {},
      { cause: error },
    );
  if (!(error instanceof DepartmentConflictError)) return error;
  const options = { cause: error };
  switch (error.reason) {
    case "owner_not_found":
      return new AppError(
        "NOT_FOUND",
        "指名した社員が見つかりません",
        {},
        options,
      );
    case "owner_inactive":
      return new AppError(
        "VALIDATION_ERROR",
        "無効な社員はオーナーに指名できません",
        { fields: ["ownerUserId"] },
        options,
      );
    case "successor_required":
      return new AppError(
        "VALIDATION_ERROR",
        "元部署の後任を、元部署の有効な一般社員から選んでください",
        { fields: ["previousDepartmentSuccessorUserId"] },
        options,
      );
    case "successor_unneeded":
      return new AppError(
        "VALIDATION_ERROR",
        "この指名では元部署の後任は要りません",
        { fields: ["previousDepartmentSuccessorUserId"] },
        options,
      );
    case "successor_invalid":
      return new AppError(
        "VALIDATION_ERROR",
        "元部署の後任は、元部署の有効な一般社員から選んでください",
        { fields: ["previousDepartmentSuccessorUserId"] },
        options,
      );
    case "already_owner":
      return new AppError(
        "CONFLICT",
        "すでにこの部署のオーナーです",
        {},
        options,
      );
    case "inactive_department":
      return new AppError(
        "CONFLICT",
        "無効な部署は変更できません",
        {},
        options,
      );
    case "version":
    case "state_changed":
      return new AppError("CONFLICT", STALE_MESSAGE, {}, options);
  }
}

export function withDepartmentService<T>(
  env: Env,
  run: (service: ReturnType<typeof createDepartmentService>) => Promise<T>,
): Promise<T> {
  return withDepartments(env, (repository, roles) =>
    run(createDepartmentService(repository, roles)),
  );
}

export function createDepartmentService(
  repository: DepartmentRepository,
  roles: RoleAssignmentRepository,
  deps: { now?: () => Date } = {},
) {
  const now = deps.now ?? (() => new Date());

  async function authorize(
    actor: DepartmentActor,
    permission: Permission,
  ): Promise<void> {
    await createAppAuthorizer(roles, {
      logger: createLogger({ traceId: actor.traceId, userId: actor.userId }),
    }).authorize({ userId: actor.userId }, permission, { type: "company" });
  }

  async function requireDepartment(id: string) {
    const department = await repository.findById(id);
    if (department === null)
      throw new AppError("NOT_FOUND", "部署が見つかりません");
    return department;
  }

  async function attempt<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw toAppError(error);
    }
  }

  const writeOf = (actor: DepartmentActor) => ({
    actorId: actor.userId,
    traceId: actor.traceId,
  });

  return {
    async list(
      actor: DepartmentActor,
      options: { limit: number; cursor?: CursorPayload },
    ) {
      await authorize(actor, "perm.workspace.create");
      return repository.list(options);
    },

    async listOwnerCandidates(
      actor: DepartmentActor,
      options: { q: string; limit: number; cursor?: CursorPayload },
    ) {
      await authorize(actor, "perm.workspace.create");
      return repository.listOwnerCandidates(options);
    },

    async create(
      actor: DepartmentActor,
      input: {
        name: string;
        description?: string;
        ownerUserId?: string;
        previousDepartmentSuccessorUserId?: string;
      },
    ) {
      await authorize(actor, "perm.workspace.create");
      if (input.ownerUserId !== undefined)
        await authorize(actor, "perm.workspace.owner.designate");
      assertRecentReauth(actor.reauthenticatedAt, now());
      return attempt(() =>
        repository.create(
          {
            name: input.name,
            description: input.description ?? "",
            ownerUserId: input.ownerUserId ?? actor.userId,
            previousDepartmentSuccessorUserId:
              input.previousDepartmentSuccessorUserId ?? null,
            previousDepartmentVersion: null,
          },
          writeOf(actor),
        ),
      );
    },

    async rename(
      actor: DepartmentActor,
      id: string,
      input: { name: string; version: number },
    ) {
      await authorize(actor, "perm.workspace.create");
      assertRecentReauth(actor.reauthenticatedAt, now());
      await requireDepartment(id);
      return attempt(() =>
        repository.rename(
          { id, version: input.version, name: input.name },
          writeOf(actor),
        ),
      );
    },

    async changeOwner(
      actor: DepartmentActor,
      id: string,
      input: {
        ownerUserId: string;
        previousDepartmentSuccessorUserId?: string;
        version: number;
      },
    ) {
      await authorize(actor, "perm.role.assign");
      assertRecentReauth(actor.reauthenticatedAt, now());
      await requireDepartment(id);
      return attempt(() =>
        repository.changeOwner(
          {
            departmentId: id,
            version: input.version,
            ownerUserId: input.ownerUserId,
            previousDepartmentSuccessorUserId:
              input.previousDepartmentSuccessorUserId ?? null,
            previousDepartmentVersion: null,
          },
          writeOf(actor),
        ),
      );
    },
  };
}
