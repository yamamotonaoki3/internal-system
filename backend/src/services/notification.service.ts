// Service：通知（#124）の業務ルール。HTTP を知らない。
// 順序：認可（perm.notification.own・全ロール可）→ Repository。宛先は常に操作した本人で、他人の利用者 ID を受け取る引数を持たない（R-57）。
// 作成・既読は監査ログに残さない（既定の方針 4）。認可の拒否は authorize が記録する。
import {
  withNotifications,
  type NotificationRepository,
} from "../db/notification.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import type { CursorPayload } from "../lib/cursor";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";

export type NotificationActor = { userId: string; traceId: string };

export function withNotificationService<T>(
  env: Env,
  run: (service: ReturnType<typeof createNotificationService>) => Promise<T>,
): Promise<T> {
  return withNotifications(env, (notifications, roles) =>
    run(createNotificationService(notifications, roles)),
  );
}

export function createNotificationService(
  notifications: NotificationRepository,
  roles: RoleAssignmentRepository,
  deps: { now?: () => Date } = {},
) {
  const now = deps.now ?? (() => new Date());

  async function authorizeOwn(actor: NotificationActor): Promise<void> {
    await createAppAuthorizer(roles, {
      logger: createLogger({ traceId: actor.traceId, userId: actor.userId }),
    }).authorize({ userId: actor.userId }, "perm.notification.own", {
      type: "company",
    });
  }

  return {
    async list(
      actor: NotificationActor,
      options: { limit: number; cursor?: CursorPayload },
    ) {
      await authorizeOwn(actor);
      return notifications.listForRecipient(actor.userId, options);
    },

    async countUnread(actor: NotificationActor): Promise<number> {
      await authorizeOwn(actor);
      return notifications.countUnread(actor.userId);
    },

    async markRead(
      actor: NotificationActor,
      notificationId: string,
    ): Promise<void> {
      await authorizeOwn(actor);
      const found = await notifications.markRead(
        actor.userId,
        notificationId,
        now().toISOString(),
      );
      if (!found) throw new AppError("NOT_FOUND", "通知が見つかりません");
    },

    async markAllRead(actor: NotificationActor): Promise<void> {
      await authorizeOwn(actor);
      await notifications.markAllRead(actor.userId, now().toISOString());
    },
  };
}
