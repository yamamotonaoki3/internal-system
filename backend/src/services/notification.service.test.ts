// #124 AC-1（3-4 AC-3・R-57）：通知の Service（services/notification.service.ts）の業務ルールを、Repository の代役で確かめる。
// 契約（実装者へ。profile.service と同じ形）：
//   createNotificationService(notifications: NotificationRepository, roles: RoleAssignmentRepository, deps: { now?: () => Date } = {})
//     .list(actor: { userId, traceId }, options: { limit: number; cursor?: CursorPayload }) → notifications.listForRecipient(actor.userId, options) の結果
//     .countUnread(actor) → number（notifications.countUnread(actor.userId)）
//     .markRead(actor, notificationId: string) → void。notifications.markRead(actor.userId, notificationId, now().toISOString()) が false なら AppError("NOT_FOUND")
//     .markAllRead(actor) → void。notifications.markAllRead(actor.userId, now().toISOString())
//   認可：すべての操作で、権限 perm.notification.own を範囲 { type: "company" } で authorize する（拒否は FORBIDDEN。Repository は呼ばない）。
//   宛先は常に actor.userId。他人の利用者 ID を渡す引数を持たない（R-57）。
//   withNotificationService(env, run) も公開する。
// 拒否の監査ログ（authorize が出す）で、権限名と範囲を照合する。作成・既読の監査ログは残さない（既定の方針 4）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRepository } from "../db/notification.repository";
import type {
  RoleAssignmentRepository,
  UserWithAssignments,
} from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { createNotificationService } from "./notification.service";

const USER_ID = "01JTESTNOTIFSVC00000000001";
const NOTIFICATION_ID = "01JTESTNOTIFSVCITEM0000001";
const NOW = new Date("2026-11-11T00:00:00.000Z");
const actor = { userId: USER_ID, traceId: "unit-notif-svc-trace" };

const memberRoles: RoleAssignmentRepository = {
  findByUserId: vi.fn(async (): Promise<UserWithAssignments> => ({
    user: { isActive: true },
    assignments: [],
  })),
};
// 存在しない利用者として扱われ、権限を持たない（すべての操作が拒否され、拒否の監査が出る）
const noRoles: RoleAssignmentRepository = {
  findByUserId: vi.fn(async () => null),
};

function fakeNotifications(overrides: Record<string, unknown> = {}) {
  const repository = {
    listForRecipient: vi.fn(async () => ({
      items: [
        {
          id: NOTIFICATION_ID,
          kind: "test_kind",
          roomId: null,
          messageId: null,
          targetId: null,
          createdAt: NOW.toISOString(),
          readAt: null,
        },
      ],
      nextCursor: null,
    })),
    countUnread: vi.fn(async () => 3),
    markRead: vi.fn(async () => true),
    markAllRead: vi.fn(async () => 2),
    ...overrides,
  };
  return repository as unknown as NotificationRepository & typeof repository;
}

let logLines: string[];
const deniedAudits = () =>
  logLines
    .filter((line) => line.startsWith("{"))
    .map(
      (line) =>
        JSON.parse(line) as {
          body?: string;
          attributes?: Record<string, unknown>;
        },
    )
    .filter(
      (line) =>
        line.attributes?.log_type === "audit" &&
        line.attributes.result === "failure",
    )
    .map((line) => ({
      permission: line.body,
      target: line.attributes?.target,
    }));

beforeEach(() => {
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const codeOf = (error: unknown) =>
  error instanceof AppError ? error.code : String(error);

describe("#124 AC-1 認可：すべての操作で perm.notification.own（範囲 company）", () => {
  it.each<
    [
      string,
      (s: ReturnType<typeof createNotificationService>) => Promise<unknown>,
    ]
  >([
    ["list", (s) => s.list(actor, { limit: 20 })],
    ["countUnread", (s) => s.countUnread(actor)],
    ["markRead", (s) => s.markRead(actor, NOTIFICATION_ID)],
    ["markAllRead", (s) => s.markAllRead(actor)],
  ])(
    "#124 AC-1: %s は拒否なら FORBIDDEN で、Repository を呼ばない。拒否の監査に権限名と範囲が出る",
    async (_name, call) => {
      const notifications = fakeNotifications();
      const service = createNotificationService(notifications, noRoles, {
        now: () => NOW,
      });
      const error = await call(service).catch((e: unknown) => e);
      expect(codeOf(error)).toBe("FORBIDDEN");
      expect(deniedAudits()).toEqual([
        { permission: "perm.notification.own", target: "company" },
      ]);
      expect(notifications.listForRecipient).not.toHaveBeenCalled();
      expect(notifications.countUnread).not.toHaveBeenCalled();
      expect(notifications.markRead).not.toHaveBeenCalled();
      expect(notifications.markAllRead).not.toHaveBeenCalled();
    },
  );

  it("#124 AC-1: 一般の社員（ロールの割り当てなし）でも、4 つの操作を使える（全ロール可）", async () => {
    const notifications = fakeNotifications();
    const service = createNotificationService(notifications, memberRoles, {
      now: () => NOW,
    });
    await service.list(actor, { limit: 20 });
    await service.countUnread(actor);
    await service.markRead(actor, NOTIFICATION_ID);
    await service.markAllRead(actor);
    expect(deniedAudits()).toEqual([]);
  });
});

describe("#124 AC-1（R-57）宛先は常に操作した本人", () => {
  it("#124 AC-1（R-57）: list・countUnread は actor.userId の分だけを Repository に頼む", async () => {
    const notifications = fakeNotifications();
    const service = createNotificationService(notifications, memberRoles, {
      now: () => NOW,
    });
    const result = await service.list(actor, { limit: 5 });
    expect(notifications.listForRecipient).toHaveBeenCalledWith(USER_ID, {
      limit: 5,
    });
    expect(result.items).toHaveLength(1);
    expect(await service.countUnread(actor)).toBe(3);
    expect(notifications.countUnread).toHaveBeenCalledWith(USER_ID);
  });

  it("#124 AC-1: markRead は actor.userId・通知の ID・注入した現在時刻（ISO 8601）で Repository を呼ぶ", async () => {
    const notifications = fakeNotifications();
    const service = createNotificationService(notifications, memberRoles, {
      now: () => NOW,
    });
    await expect(
      service.markRead(actor, NOTIFICATION_ID),
    ).resolves.toBeUndefined();
    expect(notifications.markRead).toHaveBeenCalledWith(
      USER_ID,
      NOTIFICATION_ID,
      NOW.toISOString(),
    );
  });

  it("#124 AC-1（R-57）: 本人宛てでない・存在しない通知（Repository が false）は NOT_FOUND にする（成功にしない）", async () => {
    const notifications = fakeNotifications({
      markRead: vi.fn(async () => false),
    });
    const service = createNotificationService(notifications, memberRoles, {
      now: () => NOW,
    });
    const error = await service
      .markRead(actor, NOTIFICATION_ID)
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe("NOT_FOUND");
  });

  it("#124 AC-1: markAllRead は actor.userId と現在時刻で Repository を呼び、0 件でもエラーにしない", async () => {
    const notifications = fakeNotifications({
      markAllRead: vi.fn(async () => 0),
    });
    const service = createNotificationService(notifications, memberRoles, {
      now: () => NOW,
    });
    await expect(service.markAllRead(actor)).resolves.toBeUndefined();
    expect(notifications.markAllRead).toHaveBeenCalledWith(
      USER_ID,
      NOW.toISOString(),
    );
  });

  it("#124 AC-1: Repository の失敗は握りつぶさず、そのまま呼び出し元へ伝える", async () => {
    const notifications = fakeNotifications({
      markAllRead: vi.fn(async () => {
        throw new Error("unit test failure");
      }),
    });
    const service = createNotificationService(notifications, memberRoles, {
      now: () => NOW,
    });
    await expect(service.markAllRead(actor)).rejects.toThrow(
      "unit test failure",
    );
  });
});
