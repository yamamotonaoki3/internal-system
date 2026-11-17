// Service：S-39（チャンネル管理）・S-38（アーカイブ）の読み取り（#143-b。EP-2-42・EP-2-43・EP-2-40）。HTTP も DB のライブラリも知らない。
// 判定の順（この順を変えない）：
//   assertCanOpen（ルートのミドルウェア。入力の検証より先）：会社の範囲か、本人の部署範囲の割り当てのいずれかの部署で権限を持たなければ、
//     authorize（会社の範囲）で 403。拒否は authorize が運用ログに残す
//   取得：行の範囲は Repository の SQL（その時点の割り当て）だけで決める。0件のときだけ資格を読み直し、失っていれば 403（空の成功に見せかけない）。
//     資格があれば、一覧は空、1件は 404（存在しない・案件専用・範囲外で同じ文）
// 読み取りだけなので、監査の記録・通知は書かない。
import {
  withChannelAdmin,
  type AdminChannelRow,
  type AdminChannelState,
  type ChannelAdminRepository,
} from "../db/channel-admin.repository";
import {
  withRoleAssignments,
  type RoleAssignmentRepository,
} from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { channelManageActions } from "../lib/channel-rules";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import type { Permission } from "../lib/permissions";
import { canInAnyScope, createAppAuthorizer } from "./authorizer";

export type ChannelAdminActor = { userId: string; traceId: string };

export type ChannelAdminPermission =
  "perm.channel.edit" | "perm.channel.delete";

type Department = { id: string; name: string; isActive: boolean } | null;

export type AdminChannel = {
  id: string;
  name: string;
  description: string;
  purpose: AdminChannelRow["purpose"];
  visibility: AdminChannelRow["visibility"];
  department: Department;
  state: "active" | "archived";
  version: number;
  memberCount: number;
  archive: {
    archivedBy: { id: string; displayName: string };
    archivedAt: string;
    reason: string | null;
  } | null;
  manage: {
    canRename: boolean;
    canEditDescription: boolean;
    canArchive: boolean;
    canRestore: boolean;
  };
};

export type ArchivedItem = {
  type: "channel";
  id: string;
  name: string;
  caseNumber: null;
  deletedBy: { id: string; displayName: string };
  deletedAt: string;
  reason: string | null;
  version: number;
  department: Department;
  canRestore: boolean;
};

type Authorizer = Pick<ReturnType<typeof createAppAuthorizer>, "authorize">;

type ChannelAdminDependencies = {
  /** 拒否の記録に使う。省略時は roleAssignments から操作者ごとに組む */
  authorizer?: Authorizer;
  roleAssignments: RoleAssignmentRepository;
};

const NOT_FOUND_MESSAGE = "チャンネルが見つかりません";

function departmentOf(row: AdminChannelRow): Department {
  if (
    row.departmentId === null ||
    row.departmentName === null ||
    row.departmentIsActive === null
  )
    return null;
  return {
    id: row.departmentId,
    name: row.departmentName,
    isActive: row.departmentIsActive,
  };
}

/** アーカイブした人と日時。アーカイブ済みの行に欠けていれば異常（成功に見せかけない） */
function archivedByOf(row: AdminChannelRow & { deletedAt: string }) {
  if (row.deletedBy === null || row.deletedByName === null)
    throw new Error("アーカイブした人が読めません");
  return { id: row.deletedBy, displayName: row.deletedByName };
}

function toAdminChannel(row: AdminChannelRow): AdminChannel {
  const actions = channelManageActions(row);
  const { deletedAt } = row;
  return {
    id: row.roomId,
    name: row.name,
    description: row.description,
    purpose: row.purpose,
    visibility: row.visibility,
    department: departmentOf(row),
    state: deletedAt === null ? "active" : "archived",
    version: row.version,
    memberCount: row.memberCount,
    archive:
      deletedAt === null
        ? null
        : {
            archivedBy: archivedByOf({ ...row, deletedAt }),
            archivedAt: deletedAt,
            reason: row.archiveReason,
          },
    manage: {
      canRename: actions.rename,
      canEditDescription: actions.editDescription,
      canArchive: actions.archive,
      canRestore: actions.restore,
    },
  };
}

function toArchivedItem(row: AdminChannelRow): ArchivedItem {
  const { deletedAt } = row;
  if (deletedAt === null) throw new Error("アーカイブされていない行です");
  return {
    type: "channel",
    id: row.roomId,
    name: row.name,
    caseNumber: null,
    deletedBy: archivedByOf({ ...row, deletedAt }),
    deletedAt,
    reason: row.archiveReason,
    version: row.version,
    department: departmentOf(row),
    canRestore: channelManageActions(row).restore,
  };
}

export function createChannelAdminService(
  repository: Pick<
    ChannelAdminRepository,
    "listManageable" | "findManageable" | "listArchived"
  >,
  deps: ChannelAdminDependencies,
) {
  const authorizerFor = (actor: ChannelAdminActor): Authorizer =>
    deps.authorizer ??
    createAppAuthorizer(deps.roleAssignments, {
      logger: createLogger({ traceId: actor.traceId, userId: actor.userId }),
    });

  /** どこかの範囲で権限を持たなければ 403（拒否は authorize が運用ログに残す） */
  async function assertCanOpen(
    actor: ChannelAdminActor,
    permission: ChannelAdminPermission,
  ): Promise<void> {
    if (await canInAnyScope(deps.roleAssignments, actor.userId, permission))
      return;
    await authorizerFor(actor).authorize(
      { userId: actor.userId },
      permission satisfies Permission,
      { type: "company" },
    );
    // 会社の範囲で持つなら canInAnyScope も真になるため、ここには来ない。来たら拒否する（通さない）
    throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
  }

  /** 0件のときの読み直し：資格を失っていれば 403 */
  async function recheck(
    actor: ChannelAdminActor,
    permission: ChannelAdminPermission,
  ): Promise<void> {
    if (!(await canInAnyScope(deps.roleAssignments, actor.userId, permission)))
      throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
  }

  return {
    assertCanOpen,

    async list(
      actor: ChannelAdminActor,
      input: {
        q?: string;
        state: AdminChannelState;
        limit: number;
        cursor?: CursorPayload;
      },
    ): Promise<{ items: AdminChannel[]; nextCursor: string | null }> {
      const page = await repository.listManageable(actor.userId, input);
      if (page.items.length === 0) await recheck(actor, "perm.channel.edit");
      return {
        items: page.items.map(toAdminChannel),
        nextCursor: page.nextCursor,
      };
    },

    async get(actor: ChannelAdminActor, roomId: string): Promise<AdminChannel> {
      const row = await repository.findManageable(actor.userId, roomId);
      if (row === null) {
        await recheck(actor, "perm.channel.edit");
        throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE);
      }
      return toAdminChannel(row);
    },

    async listArchived(
      actor: ChannelAdminActor,
      input: { limit: number; cursor?: CursorPayload },
    ): Promise<{ items: ArchivedItem[]; nextCursor: string | null }> {
      const page = await repository.listArchived(actor.userId, input);
      if (page.items.length === 0) await recheck(actor, "perm.channel.delete");
      return {
        items: page.items.map(toArchivedItem),
        nextCursor: page.nextCursor,
      };
    },
  };
}

export type ChannelAdminService = ReturnType<typeof createChannelAdminService>;

export function withChannelAdminService<T>(
  env: Env,
  run: (service: ChannelAdminService) => Promise<T>,
): Promise<T> {
  return withChannelAdmin(env, (repository) =>
    withRoleAssignments(env, (roleAssignments) =>
      run(createChannelAdminService(repository, { roleAssignments })),
    ),
  );
}
