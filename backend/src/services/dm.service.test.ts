// #136 AC-1（1-2 AC-1・AC-2）・AC-3（C-168(4)・(5)・(7)）: DM の Service（dm.service.ts）の判定の順・権限の拒否・同時作成の扱いを確かめる。
// 契約（実装前の仮定。計画 3章・改訂2 指摘2・レビュー2回目(3)）：
//  - createDmService(repository: ConversationRepository, { authorizer }) を、withConversations(env, run) の Repository で組める
//  - start(actor, partnerUserId)：perm.dm.message.send → 自分宛て 422（details.fields に partnerUserId）→ 相手なし 404 → 相手が無効 422 → 既存を返す／作る
//      → { roomId, partner: { id, displayName } }。作成で一意違反（DirectConversationExistsError）になったら、読み直して既存を返す。未知のエラーはそのまま伝える
//  - list(actor, { limit, cursor? })：perm.dm.message.view が先（拒否は 403）
//  - get(actor, roomId)：当事者でなければ 404（authorize に進まない）→ perm.dm.message.view（403）
//  - Repository の findRoomIdByDirectKey(directKey) と create(input) を、同時作成の再現のために差し替える
// 固定ロールはすべて DM の権限を持つため、偽の authorizer（dm-fixtures の fakeAuthorizer）で拒否を作る。Repository は本物（隔離 D1）。
// データは架空（testuser_dm_dsvc_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupDmScenario,
  deactivateUser,
  dmCounts,
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
import {
  withConversations,
  type ConversationRepository,
} from "../db/conversation.repository";
import type { Permission } from "../lib/permissions";
import { createDmService } from "./dm.service";

const MISSING_ID = "01JTESTDM0N0NE000000000000";

let dept: SeededDepartment;
let alice: string;
let bob: string;
let carol: string;
let stranger: string;

const actor = (userId: string) => ({ userId, traceId: "unit-136-dm-service" });

type Service = ReturnType<typeof createDmService>;

async function run<T>(
  denied: readonly Permission[],
  action: (service: Service) => Promise<T>,
  wrap: (repository: ConversationRepository) => ConversationRepository = (r) =>
    r,
) {
  const authorizer = fakeAuthorizer(denied);
  const outcome = await withConversations(env, (repository) =>
    action(createDmService(wrap(repository), { authorizer })).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null as T | null, error }),
    ),
  );
  return { ...outcome, calls: authorizer.calls };
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("DMサービス");
  alice = (
    await insertDmUser("testuser_dm_dsvc_alice", dept.id, "テストDMアリス")
  ).userId;
  bob = (await insertDmUser("testuser_dm_dsvc_bob", dept.id, "テストDMボブ"))
    .userId;
  carol = (
    await insertDmUser("testuser_dm_dsvc_carol", dept.id, "テストDMキャロル")
  ).userId;
  stranger = (
    await insertDmUser("testuser_dm_dsvc_stranger", dept.id, "テストDM第三者")
  ).userId;
  await deactivateUser(carol);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupDmScenario();
});

describe("#136 C-168(5)・(7) DM の開始（start）の判定の順", () => {
  it.each([
    ["有効な相手", () => bob],
    ["自分", () => alice],
    ["存在しない相手", () => MISSING_ID],
    ["無効な相手", () => carol],
  ])(
    "#136 C-168(7): perm.dm.message.send が拒否されれば、%s でも 403 FORBIDDEN（authorize が先）で、行は増えない",
    async (_label, partner) => {
      const before = await dmCounts();
      const { error, calls } = await run(["perm.dm.message.send"], (service) =>
        service.start(actor(alice), partner()),
      );
      expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(dmPermissionCalls(calls)).toEqual([
        { userId: alice, permission: "perm.dm.message.send" },
      ]);
      expect(await dmCounts()).toEqual(before);
    },
  );

  it("#136 C-168(5)（C-55）: 自分宛ては 422 VALIDATION_ERROR（fields に partnerUserId）", async () => {
    const before = await dmCounts();
    const { error } = await run([], (service) =>
      service.start(actor(alice), alice),
    );
    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      details: { fields: expect.arrayContaining(["partnerUserId"]) as unknown },
    });
    expect(await dmCounts()).toEqual(before);
  });

  it("#136 AC-1: 存在しない相手は 404 NOT_FOUND", async () => {
    const { error } = await run([], (service) =>
      service.start(actor(alice), MISSING_ID),
    );
    expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("#136 C-168(5)（C-24）: 無効な相手は 422 VALIDATION_ERROR で、行は増えない", async () => {
    const before = await dmCounts();
    const { error } = await run([], (service) =>
      service.start(actor(alice), carol),
    );
    expect(error).toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(await dmCounts()).toEqual(before);
  });

  it("#136 C-168(5): 有効な相手とは DM を作って { roomId, partner } を返し、2回目は同じ roomId", async () => {
    const first = await run([], (service) => service.start(actor(alice), bob));
    expect(first.error).toBeNull();
    expect(first.value).toEqual({
      roomId: expect.any(String) as unknown,
      partner: { id: bob, displayName: "テストDMボブ" },
    });
    const second = await run([], (service) => service.start(actor(bob), alice));
    expect(second.value?.roomId).toBe(first.value?.roomId);
    expect((await dmCounts()).conversations).toBe(1);
  });
});

describe("#136 C-168(5) 同時作成（一意違反）の扱い", () => {
  it("#136 C-168(5): 既存の確認の後に別の要求が同じ2人の DM を作っていても、一意違反を読み直して既存の roomId を返す。行は増えない", async () => {
    const existing = await insertDm(alice, bob);
    const before = await dmCounts();
    let createCalls = 0;
    const { value, error } = await run(
      [],
      (service) => service.start(actor(alice), bob),
      (repository) => {
        let lookups = 0;
        return {
          ...repository,
          // 最初の確認だけ「まだない」と答える（確認と作成の間に、別の要求が作った状況）
          findRoomIdByDirectKey: async (key: string) => {
            lookups += 1;
            return lookups === 1 ? null : repository.findRoomIdByDirectKey(key);
          },
          create: async (input) => {
            createCalls += 1;
            return repository.create(input);
          },
        };
      },
    );
    expect(error).toBeNull();
    expect(value?.roomId).toBe(existing);
    expect(createCalls).toBe(1);
    expect(await dmCounts()).toEqual(before);
  });

  it("#136 C-168(5): 作成で想定外のエラーが起きたら、もみ消さずにそのまま伝える", async () => {
    const failure = new Error("unit-136: 想定外の失敗");
    const before = await dmCounts();
    const { error } = await run(
      [],
      (service) => service.start(actor(alice), bob),
      (repository) => ({
        ...repository,
        create: async () => {
          throw failure;
        },
      }),
    );
    expect(error).toBe(failure);
    expect(await dmCounts()).toEqual(before);
  });
});

describe("#136 C-168(7) DM の一覧（list）", () => {
  it("#136 C-168(7): perm.dm.message.view が拒否されれば 403 FORBIDDEN", async () => {
    await insertDm(alice, bob);
    const { error, calls } = await run(["perm.dm.message.view"], (service) =>
      service.list(actor(alice), { limit: 20 }),
    );
    expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(dmPermissionCalls(calls)).toEqual([
      { userId: alice, permission: "perm.dm.message.view" },
    ]);
  });

  it("#136 AC-1（1-2 AC-2）: 自分が当事者の DM だけを返す", async () => {
    const mine = await insertDm(alice, bob);
    await insertDm(bob, stranger);
    const { value } = await run([], (service) =>
      service.list(actor(alice), { limit: 20 }),
    );
    expect(
      (value as { items: { roomId: string }[] }).items.map((i) => i.roomId),
    ).toEqual([mine]);
  });
});

describe("#136 C-168(4) DM の詳細（get）の判定の順", () => {
  it("#136 C-168(4)（レビュー2回目(3)）: 当事者でなければ、権限の有無にかかわらず 404 で、authorize に進まない", async () => {
    const roomId = await insertDm(alice, bob);
    for (const denied of [[], ["perm.dm.message.view"]] as Permission[][]) {
      const { error, calls } = await run(denied, (service) =>
        service.get(actor(stranger), roomId),
      );
      expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(dmPermissionCalls(calls)).toEqual([]);
    }
  });

  it("#136 C-168(4): 当事者でも perm.dm.message.view が拒否されれば 403 FORBIDDEN", async () => {
    const roomId = await insertDm(alice, bob);
    const { error } = await run(["perm.dm.message.view"], (service) =>
      service.get(actor(alice), roomId),
    );
    expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("#136 C-168(4): チャンネルの部屋・存在しない部屋は 404", async () => {
    await insertMember(dept.dedicatedChannelId, alice);
    for (const roomId of [dept.dedicatedChannelId, MISSING_ID]) {
      const { error } = await run([], (service) =>
        service.get(actor(alice), roomId),
      );
      expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    }
  });

  it("#136 C-168(4): 当事者には roomId と相手を返し、相手が有効なら canPost が真、無効なら偽", async () => {
    const active = await insertDm(alice, bob);
    const retired = await insertDm(alice, carol);
    const ok = await run([], (service) => service.get(actor(alice), active));
    expect(ok.value).toMatchObject({
      roomId: active,
      partner: { id: bob, isActive: true },
      canPost: true,
    });
    const gone = await run([], (service) => service.get(actor(alice), retired));
    expect(gone.value).toMatchObject({
      roomId: retired,
      partner: { id: carol, isActive: false, status: null },
      canPost: false,
    });
  });
});
