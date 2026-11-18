// #137 AC-1（1-4 AC-4・R-55）: スレッド一覧の Service（thread.service.ts）が perm.notification.own を判定し、拒否されたら 403 で一覧を返さないことを確かめる。
// 固定ロールはすべて perm.notification.own を持つため、API では拒否を作れない。偽の authorizer（dm-fixtures の fakeAuthorizer）で拒否を作る。Repository は本物（隔離 D1）。
// 契約（実装者へ）：withThreads(env, run)（db/thread.repository.ts）と createThreadService(repository, { authorizer })（services/thread.service.ts）。
//   service.list(actor: { userId, traceId }, { limit: number; cursor?: CursorPayload }) が { items, nextCursor } を返す。
// データは架空（testuser_thrsvc_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deactivateUser,
  fakeAuthorizer,
  insertDm,
} from "../../test/dm-fixtures";
import {
  cleanupThreadScenario,
  createThreadWorld,
  seedParent,
  seedReply,
  type ThreadWorld,
} from "../../test/thread-fixtures";
import { withThreads } from "../db/thread.repository";
import { decodeCursor } from "../lib/cursor";
import { AppError } from "../lib/app-error";
import type { Permission } from "../lib/permissions";
import { createThreadService, withThreadService } from "./thread.service";

let world: ThreadWorld;
let parent: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("thrsvc");
  parent = await seedParent(world.channel, world.alice.userId, 1);
  await seedReply(world.channel, parent, world.bob.userId, 2);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupThreadScenario();
});

async function list(denied: readonly Permission[]) {
  const authorizer = fakeAuthorizer(denied);
  const outcome = await withThreads(env, (repository) =>
    createThreadService(repository, { authorizer })
      .list(
        { userId: world.alice.userId, traceId: "unit-137-threads" },
        { limit: 20 },
      )
      .then(
        (value) => ({ value, error: null as unknown }),
        (error: unknown) => ({ value: null, error }),
      ),
  );
  return {
    ...outcome,
    permissions: authorizer.calls.map((call) => call.permission),
  };
}

describe("#137 AC-4（R-55）スレッド一覧の権限", () => {
  it("#137 AC-4: perm.notification.own を判定して、自分のスレッドの一覧を返す", async () => {
    const outcome = await list([]);
    expect(outcome.error).toBeNull();
    expect(outcome.permissions).toContain("perm.notification.own");
    expect(outcome.value?.items.map((item) => item.parent.id)).toEqual([
      parent,
    ]);
    expect(outcome.value?.nextCursor).toBeNull();
  });

  it("#137 AC-4: perm.notification.own を拒否されると 403 FORBIDDEN で、一覧を返さない", async () => {
    const outcome = await list(["perm.notification.own"]);
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(outcome.value).toBeNull();
  });
});

// コードレビュー：perm.dm.message.view を持たない利用者には、DM のスレッドを一覧に出さない（チャンネルのスレッドは出す）。拒否しても一覧自体は成功する。
// 契約（実装者へ）：Service は authorize（拒否で投げる）か can（真偽）のどちらで判定してもよい。下の偽の authorizer は、両方を同じ拒否の集合で動かし、呼ばれた権限を記録する。
function dualAuthorizer(denied: readonly Permission[]) {
  const asked: Permission[] = [];
  const authorized: Permission[] = [];
  const checked: Permission[] = [];
  return {
    asked,
    authorized,
    checked,
    async can(_principal: unknown, permission: Permission) {
      asked.push(permission);
      checked.push(permission);
      return !denied.includes(permission);
    },
    async authorize(_principal: unknown, permission: Permission) {
      asked.push(permission);
      authorized.push(permission);
      if (denied.includes(permission))
        throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
    },
  };
}

async function listBoth(denied: readonly Permission[]) {
  const authorizer = dualAuthorizer(denied);
  const dm = await insertDm(world.alice.userId, world.dave.userId);
  const dmParent = await seedParent(dm, world.dave.userId, 10);
  await seedReply(dm, dmParent, world.alice.userId, 11);
  const outcome = await withThreads(env, (repository) =>
    createThreadService(repository, { authorizer })
      .list(
        { userId: world.alice.userId, traceId: "unit-137-threads-dm" },
        { limit: 20 },
      )
      .then(
        (value) => ({ value, error: null as unknown }),
        (error: unknown) => ({ value: null, error }),
      ),
  );
  return {
    ...outcome,
    dmParent,
    asked: authorizer.asked,
    authorized: authorizer.authorized,
    checked: authorizer.checked,
  };
}

describe("#137 AC-1（1-4 AC-4・perm.dm.message.view）DM のスレッドの権限", () => {
  it("#137 AC-1: perm.dm.message.view を持つ利用者には、DM のスレッドもチャンネルのスレッドも出す", async () => {
    const outcome = await listBoth([]);
    expect(outcome.error).toBeNull();
    expect(outcome.value?.items.map((item) => item.parent.id).sort()).toEqual(
      [parent, outcome.dmParent].sort(),
    );
  });

  it("#137 AC-1: perm.dm.message.view を拒否された利用者には、DM のスレッドを出さず、チャンネルのスレッドは出す。一覧自体は成功する", async () => {
    const outcome = await listBoth(["perm.dm.message.view"]);
    expect(outcome.error).toBeNull();
    expect(outcome.asked).toContain("perm.dm.message.view");
    expect(outcome.value?.items.map((item) => item.parent.id)).toEqual([
      parent,
    ]);
    expect(outcome.value?.nextCursor).toBeNull();
  });

  it("#137 AC-1: perm.dm.message.view の拒否は表示の判定（can。真偽）で行い、authorize で投げない（2秒ごとの取り直しで監査の拒否を残さない）", async () => {
    const outcome = await listBoth(["perm.dm.message.view"]);
    expect(outcome.error).toBeNull();
    expect(outcome.checked).toContain("perm.dm.message.view");
    expect(outcome.authorized).not.toContain("perm.dm.message.view");
    expect(outcome.authorized).toContain("perm.notification.own");
    expect(outcome.value?.items.map((item) => item.parent.id)).toEqual([
      parent,
    ]);
  });

  it("#137 AC-1: perm.notification.own の拒否は従来どおり 403（perm.dm.message.view の可否にかかわらず）", async () => {
    const outcome = await listBoth(["perm.notification.own"]);
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(outcome.value).toBeNull();
  });
});

describe("#137 AC-1（1-4 AC-4・コードレビュー2回目）perm.dm.message.view がないときのページ送り（DM を除いてから limit で切る）", () => {
  async function page(
    denied: readonly Permission[],
    options: { limit: number; cursor?: string },
  ) {
    const authorizer = dualAuthorizer(denied);
    return withThreads(env, (repository) =>
      createThreadService(repository, { authorizer }).list(
        { userId: world.alice.userId, traceId: "unit-137-threads-page" },
        {
          limit: options.limit,
          ...(options.cursor === undefined
            ? {}
            : { cursor: decodeCursor(options.cursor) }),
        },
      ),
    );
  }

  it("#137 AC-1: DM のスレッドが最新でも、perm.dm.message.view のない利用者には limit: 1 でチャンネルのスレッドが1件返り、nextCursor は null（取得の後に DM を除く誤った実装だと、空の1ページ目になる）", async () => {
    const dm = await insertDm(world.alice.userId, world.dave.userId);
    const dmParent = await seedParent(dm, world.dave.userId, 10);
    await seedReply(dm, dmParent, world.alice.userId, 11);
    const result = await page(["perm.dm.message.view"], { limit: 1 });
    expect(result.items.map((item) => item.parent.id)).toEqual([parent]);
    expect(result.nextCursor).toBeNull();
    const withView = await page([], { limit: 1 });
    expect(withView.items.map((item) => item.parent.id)).toEqual([dmParent]);
    expect(withView.nextCursor).not.toBeNull();
  });

  it("#137 AC-1: チャンネルのスレッドの間に DM のスレッドが挟まっても、DM を除いた次のページが正しく続き、重複も欠落もない", async () => {
    const dm = await insertDm(world.alice.userId, world.dave.userId);
    const dmParent = await seedParent(dm, world.dave.userId, 10);
    await seedReply(dm, dmParent, world.alice.userId, 11);
    const newest = await seedParent(world.channel, world.alice.userId, 20);
    await seedReply(world.channel, newest, world.bob.userId, 21);
    // 並び：newest（返信21）→ DM（返信11）→ parent（返信2）
    const first = await page(["perm.dm.message.view"], { limit: 1 });
    expect(first.items.map((item) => item.parent.id)).toEqual([newest]);
    expect(first.nextCursor).not.toBeNull();
    const second = await page(["perm.dm.message.view"], {
      limit: 1,
      cursor: first.nextCursor ?? "",
    });
    expect(second.items.map((item) => item.parent.id)).toEqual([parent]);
    expect(second.nextCursor).toBeNull();
  });
});

// R-55：perm.notification.own は会社の範囲で判定する。perm.dm.message.view も会社の範囲（DM は部署に属さない）。
// 固定ロールでは範囲によって結果が変わらないため、偽の authorizer で渡された範囲を確かめる。
describe("#137 AC-1（1-4 AC-4・R-55）権限の判定の範囲", () => {
  it("#137 AC-1（1-4 AC-4）: perm.notification.own（authorize）と perm.dm.message.view（can）を、本人・会社の範囲（{ type: company }）で判定する", async () => {
    const authorize = vi.fn(async () => {});
    const can = vi.fn(async () => true);
    const result = await withThreads(env, (repository) =>
      createThreadService(repository, { authorizer: { authorize, can } }).list(
        { userId: world.alice.userId, traceId: "unit-137-threads-scope" },
        { limit: 20 },
      ),
    );
    expect(result.items.map((item) => item.parent.id)).toEqual([parent]);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith(
      { userId: world.alice.userId },
      "perm.notification.own",
      { type: "company" },
    );
    // #148：DM の判定に続けて、案件専用チャンネルの perm.case.view（計画「案件の権限を確かめる経路」）
    expect(can.mock.calls).toEqual([
      [
        { userId: world.alice.userId },
        "perm.dm.message.view",
        { type: "company" },
      ],
      [{ userId: world.alice.userId }, "perm.case.view", { type: "company" }],
    ]);
  });
});

// withThreadService は、本物の権限判定（createAppAuthorizer）に、操作した人の traceId・userId を持つロガーを渡す。
// 拒否の監査ログ（authorize が記録する）に、追跡用の trace_id と user_id が入ることで確かめる（C-30）。
// 有効な利用者は全員 perm.notification.own を持つため、無効にした利用者（セッションが残っていた退職者に相当）で拒否を作る。
describe("#137 AC-1（1-4 AC-4・R-55・C-30）本物の権限判定での拒否と監査ログ", () => {
  it("#137 AC-1（1-4 AC-4）: 無効な利用者は 403 FORBIDDEN で、拒否の監査ログに traceId・userId・権限・会社の範囲が残る", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await deactivateUser(world.alice.userId);
    const actor = {
      userId: world.alice.userId,
      traceId: "unit-137-threads-audit",
    };
    const outcome = await withThreadService(env, actor, (service) =>
      service.list(actor, { limit: 20 }),
    ).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    );
    expect(outcome.error).toBeInstanceOf(AppError);
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(outcome.value).toBeNull();
    const audits = logSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .filter(
        (record) =>
          (record.attributes as { log_type?: string } | undefined)?.log_type ===
          "audit",
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      body: "perm.notification.own",
      trace_id: "unit-137-threads-audit",
      user_id: world.alice.userId,
      attributes: {
        log_type: "audit",
        target: "company",
        result: "failure",
        reason: "forbidden",
      },
    });
  });

  it("#137 AC-1（1-4 AC-4）: 有効な利用者は、本物の権限判定で自分のスレッドの一覧を受け取り、拒否の監査ログを残さない", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const actor = {
      userId: world.alice.userId,
      traceId: "unit-137-threads-allowed",
    };
    const result = await withThreadService(env, actor, (service) =>
      service.list(actor, { limit: 20 }),
    );
    expect(result.items.map((item) => item.parent.id)).toEqual([parent]);
    const audits = logSpy.mock.calls.filter((call) =>
      String(call[0]).includes('"log_type":"audit"'),
    );
    expect(audits).toEqual([]);
  });
});
