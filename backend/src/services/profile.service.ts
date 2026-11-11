// Service：プロフィール・社員一覧・ステータス（#130）の業務ルール。HTTP を知らない。
// 順序：認可 → 業務の検証（戻り予定。書き込みより前）→ Repository（1操作＝1 db.batch）。
// 本名の復号は、プロフィールカードと自分のプロフィールだけ。ログ・監査には本名・メール・表示名・一言を出さない。
import { loadConfig } from "../config";
import {
  withProfiles,
  type ProfileRepository,
  type UserStatus,
} from "../db/profile.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import {
  latestReturnAt,
  type UserStatusKind,
} from "../../../shared/profile-rules";
import { AppError } from "../lib/app-error";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import { decryptLegalName } from "../lib/pii-crypto";
import type { Permission } from "../lib/permissions";
import { canForDepartments, createAppAuthorizer } from "./authorizer";

export type ProfileActor = { userId: string; traceId: string };

const RETURN_AT_MESSAGE =
  "戻り予定は、現在より後で、1年以内の日時を指定してください";

const IN_OFFICE_MESSAGE = "在席のときは戻り予定を指定できません";

function returnAtError(message: string) {
  return new AppError("VALIDATION_ERROR", message, { fields: ["returnAt"] });
}

export function withProfileService<T>(
  env: Env,
  run: (service: ReturnType<typeof createProfileService>) => Promise<T>,
): Promise<T> {
  const { piiEncryptionKey } = loadConfig(env);
  return withProfiles(env, (profiles, roles) =>
    run(createProfileService(profiles, roles, { piiKey: piiEncryptionKey })),
  );
}

export function createProfileService(
  profiles: ProfileRepository,
  roles: RoleAssignmentRepository,
  deps: { now?: () => Date; piiKey?: string | null } = {},
) {
  const now = deps.now ?? (() => new Date());

  async function authorize(
    actor: ProfileActor,
    permission: Permission,
    scope: { type: "company" } | { type: "department"; departmentId: string },
  ): Promise<void> {
    await createAppAuthorizer(roles, {
      logger: createLogger({ traceId: actor.traceId, userId: actor.userId }),
    }).authorize({ userId: actor.userId }, permission, scope);
  }

  async function decrypt(stored: string, userId: string): Promise<string> {
    if (deps.piiKey === undefined || deps.piiKey === null)
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "本名の表示は現在使えません。運用担当者に連絡してください",
      );
    return decryptLegalName(stored, deps.piiKey, userId);
  }

  /** 戻り予定を「現在より後、かつ現在から1年以内」で確かめ、UTC の ISO 8601 にそろえて返す */
  function normalizeReturnAt(returnAt: string, current: Date): string {
    const time = new Date(returnAt);
    if (
      time.getTime() <= current.getTime() ||
      time.getTime() > latestReturnAt(current).getTime()
    )
      throw returnAtError(RETURN_AT_MESSAGE);
    return time.toISOString();
  }

  /** 種類と戻り予定の関係（P-3）：在席は戻り予定を持たない。種類を変えて戻り予定がなければ消える */
  function resolveReturnAt(
    kind: UserStatusKind,
    returnAt: string | undefined,
    current: Date,
  ): string | null {
    if (kind === "available") {
      if (returnAt !== undefined) throw returnAtError(IN_OFFICE_MESSAGE);
      return null;
    }
    return returnAt === undefined ? null : normalizeReturnAt(returnAt, current);
  }

  return {
    async getOwnProfile(actor: ProfileActor) {
      const own = await profiles.findOwnProfile(actor.userId);
      if (own === null)
        throw new AppError("NOT_FOUND", "利用者が見つかりません");
      const { legalNameEncrypted, ...rest } = own;
      return {
        ...rest,
        legalName: await decrypt(legalNameEncrypted, own.id),
      };
    },

    async updateOwnProfile(
      actor: ProfileActor,
      input: {
        displayName?: string;
        status?: UserStatusKind;
        returnAt?: string;
        statusMessage?: string | null;
      },
    ) {
      await authorize(actor, "perm.profile.edit.own", { type: "company" });
      const current = now();
      let statusReturnAt: string | null | undefined;
      if (input.status !== undefined) {
        statusReturnAt = resolveReturnAt(input.status, input.returnAt, current);
      } else if (input.returnAt !== undefined) {
        // 戻り予定だけの変更は、いまの種類（在席でなければ）に対して行う
        const own = await profiles.findOwnProfile(actor.userId);
        if (own === null)
          throw new AppError("NOT_FOUND", "利用者が見つかりません");
        statusReturnAt = resolveReturnAt(
          own.status.kind,
          input.returnAt,
          current,
        );
      }
      const changed = await profiles.updateOwnProfile(
        actor.userId,
        {
          displayName: input.displayName,
          statusKind: input.status,
          statusReturnAt,
          statusMessage: input.statusMessage,
          onlyIfNotAvailable:
            input.status === undefined && input.returnAt !== undefined,
        },
        { actorId: actor.userId, traceId: actor.traceId },
        current.toISOString(),
      );
      // 事前の確認から書き込みまでの間に在席へ変わっていた（Repository が0行で返した）
      if (changed === null) throw returnAtError(IN_OFFICE_MESSAGE);
      return changed;
    },

    async getProfileCard(actor: ProfileActor, userId: string) {
      await authorize(actor, "perm.employee.legal_name.view", {
        type: "company",
      });
      const card = await profiles.findProfileCard(userId);
      if (card === null || !card.isActive)
        throw new AppError("NOT_FOUND", "社員が見つかりません");
      return {
        userId: card.id,
        displayName: card.displayName,
        legalName: await decrypt(card.legalNameEncrypted, card.id),
        department: card.department,
        status: card.status satisfies UserStatus,
      };
    },

    async listDepartments(actor: ProfileActor) {
      await authorize(actor, "perm.employee.view", { type: "company" });
      return { items: await profiles.listActiveDepartments() };
    },

    async listDirectory(
      actor: ProfileActor,
      options: {
        departmentId?: string;
        limit: number;
        cursor?: CursorPayload;
      },
    ) {
      await authorize(actor, "perm.employee.view", { type: "company" });
      const page = await profiles.listDirectory(options);
      const canSet = await canForDepartments(
        roles,
        actor.userId,
        "perm.status.proxy.set",
        page.items.map((item) => item.department.id),
      );
      return {
        items: page.items.map((item) => ({
          ...item,
          canSetStatus: canSet.get(item.department.id) === true,
        })),
        nextCursor: page.nextCursor,
      };
    },

    async setStatusByProxy(
      actor: ProfileActor,
      targetUserId: string,
      input: { status: UserStatusKind; returnAt?: string },
    ) {
      const target = await profiles.findStatusTarget(targetUserId);
      if (target === null || !target.isActive || target.departmentId === null)
        throw new AppError("NOT_FOUND", "社員が見つかりません");
      await authorize(actor, "perm.status.proxy.set", {
        type: "department",
        departmentId: target.departmentId,
      });
      const current = now();
      const statusReturnAt = resolveReturnAt(
        input.status,
        input.returnAt,
        current,
      );
      return profiles.setStatusByProxy(
        { userId: target.id, departmentId: target.departmentId },
        { statusKind: input.status, statusReturnAt },
        { actorId: actor.userId, traceId: actor.traceId },
        current.toISOString(),
      );
    },
  };
}
