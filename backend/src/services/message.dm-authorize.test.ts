// #136 AC-1（1-2 AC-2）・AC-3（C-168(2)・(7)）: メッセージの Service（message.service.ts）の DM の枝の、判定の順と権限の拒否を確かめる。
// 計画 改訂2 指摘2：当事者か（違えば 404）→ perm.dm.message.view（一覧）／perm.dm.message.send（投稿）の authorize（拒否は 403）→（投稿だけ）相手が無効なら 409。
// 固定ロールはすべて DM の権限を持つため、偽の authorizer（dm-fixtures の fakeAuthorizer）で拒否を作る。Repository は本物（隔離 D1）を使う。
// 方針：拒否のときに行が増えないこと、当事者でない人には権限の判定に進まない（authorize を呼ばない）ことを確かめる。
// データは架空（testuser_dm_svc_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupDmScenario,
  deactivateUser,
  dmPermissionCalls,
  fakeAuthorizer,
  insertDm,
  insertDmUser,
} from "../../test/dm-fixtures";
import {
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { insertMessage, messageIds } from "../../test/message-fixtures";
import { withMessages } from "../db/message.repository";
import type { Permission } from "../lib/permissions";
import { createMessageService } from "./message.service";

let dept: SeededDepartment;
let alice: string;
let bob: string;
let stranger: string;
let roomId: string;

const actor = (userId: string) => ({
  userId,
  traceId: "unit-136-dm-authorize",
});

/** 偽の authorizer と本物の Repository で Service を組み、結果（成功の値か、投げたエラー）を返す */
async function run<T>(
  denied: readonly Permission[],
  action: (service: ReturnType<typeof createMessageService>) => Promise<T>,
) {
  const authorizer = fakeAuthorizer(denied);
  const outcome = await withMessages(env, (repository) =>
    action(createMessageService(repository, { authorizer })).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    ),
  );
  return { ...outcome, calls: authorizer.calls };
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("DM権限");
  alice = (
    await insertDmUser("testuser_dm_svc_alice", dept.id, "テストDMアリス")
  ).userId;
  bob = (await insertDmUser("testuser_dm_svc_bob", dept.id, "テストDMボブ"))
    .userId;
  stranger = (
    await insertDmUser("testuser_dm_svc_stranger", dept.id, "テストDM第三者")
  ).userId;
  roomId = await insertDm(alice, bob);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupDmScenario();
});

describe("#136 AC-1（1-2 AC-2）・C-168(7) DM の一覧（Service）", () => {
  it("#136 C-168(7): 当事者の一覧は perm.dm.message.view を本人で判定してから読む", async () => {
    const existing = await insertMessage({ roomId, senderId: bob });
    const { value, error, calls } = await run([], (service) =>
      service.list(actor(alice), roomId, { limit: 50 }),
    );
    expect(error).toBeNull();
    expect(
      (value as { items: { id: string }[] }).items.map((i) => i.id),
    ).toEqual([existing]);
    expect(dmPermissionCalls(calls)).toEqual([
      { userId: alice, permission: "perm.dm.message.view" },
    ]);
  });

  it("#136 C-168(7): perm.dm.message.view が拒否されれば、当事者でも 403 FORBIDDEN", async () => {
    const { error } = await run(["perm.dm.message.view"], (service) =>
      service.list(actor(alice), roomId, { limit: 50 }),
    );
    expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("#136 AC-1（1-2 AC-2）: 当事者でなければ 404 NOT_FOUND で、権限の判定（authorize）に進まない", async () => {
    const { error, calls } = await run(["perm.dm.message.view"], (service) =>
      service.list(actor(stranger), roomId, { limit: 50 }),
    );
    expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(dmPermissionCalls(calls)).toEqual([]);
  });

  it("#136 C-168(2): 相手が無効でも、当事者の一覧は読める（409 にしない）", async () => {
    const existing = await insertMessage({ roomId, senderId: bob });
    await deactivateUser(bob);
    const { value, error } = await run([], (service) =>
      service.list(actor(alice), roomId, {
        after: "00000000000000000000000000",
        limit: 100,
      }),
    );
    expect(error).toBeNull();
    expect(
      (value as { items: { id: string }[] }).items.map((i) => i.id),
    ).toEqual([existing]);
  });
});

describe("#136 AC-1（1-2 AC-1・AC-2）・C-168(2)・(7) DM への投稿（Service）", () => {
  it("#136 C-168(7): 当事者の投稿は perm.dm.message.send を本人で判定してから書き込む", async () => {
    const { value, error, calls } = await run([], (service) =>
      service.post(actor(alice), roomId, "[UNIT_TEST]こんにちは"),
    );
    expect(error).toBeNull();
    expect(value).toMatchObject({ roomId });
    expect(dmPermissionCalls(calls)).toEqual([
      { userId: alice, permission: "perm.dm.message.send" },
    ]);
    expect(await messageIds(roomId)).toHaveLength(1);
  });

  it("#136 C-168(7): perm.dm.message.send が拒否されれば 403 FORBIDDEN で、行は増えない", async () => {
    const { error } = await run(["perm.dm.message.send"], (service) =>
      service.post(actor(alice), roomId, "[UNIT_TEST]拒否"),
    );
    expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await messageIds(roomId)).toEqual([]);
  });

  it("#136 AC-1（1-2 AC-2）: 当事者でなければ 404 NOT_FOUND で、権限の判定に進まず、行は増えない", async () => {
    const { error, calls } = await run(["perm.dm.message.send"], (service) =>
      service.post(actor(stranger), roomId, "[UNIT_TEST]のぞき見"),
    );
    expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(dmPermissionCalls(calls)).toEqual([]);
    expect(await messageIds(roomId)).toEqual([]);
  });

  it("#136 C-168(2)・(7): 判定の順：相手が無効でも、権限が拒否されれば 409 ではなく 403（authorize が先）", async () => {
    await deactivateUser(bob);
    const { error } = await run(["perm.dm.message.send"], (service) =>
      service.post(actor(alice), roomId, "[UNIT_TEST]x"),
    );
    expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await messageIds(roomId)).toEqual([]);
  });

  it("#136 C-168(2): 相手が無効なら、権限があっても 409 CONFLICT で、行は増えない", async () => {
    await deactivateUser(bob);
    const { error } = await run([], (service) =>
      service.post(actor(alice), roomId, "[UNIT_TEST]届かない"),
    );
    expect(error).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await messageIds(roomId)).toEqual([]);
  });

  it("#136 C-168(7): チャンネルへの投稿では、DM の権限を判定しない（チャンネルの動きは変えない）", async () => {
    await insertMember(dept.dedicatedChannelId, alice);
    const { error, calls } = await run(
      ["perm.dm.message.send", "perm.dm.message.view"],
      async (service) => {
        await service.post(
          actor(alice),
          dept.dedicatedChannelId,
          "[UNIT_TEST]チャンネル",
        );
        return service.list(actor(alice), dept.dedicatedChannelId, {
          limit: 50,
        });
      },
    );
    expect(error).toBeNull();
    expect(dmPermissionCalls(calls)).toEqual([]);
  });
});
