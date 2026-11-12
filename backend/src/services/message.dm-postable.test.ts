// #136 AC-1（1-2 AC-2）・AC-3（C-168(2)）: DM への投稿の判定の一致と、確認から書き込みまでの間の変化を確かめる。
// (1) Service の判定（当事者か・相手が有効か）と、Repository の条件付き INSERT（insertIfOrdered の DM の条件：送信者が当事者で、当事者に無効な人がいない）が、
//     同じ人に同じ結果を返すこと。3通り：当事者／第三者／相手が無効な DM の当事者（計画のテストケース「Service と SQL の一致」）。
//     「Service が投稿を許す」＝ post が成功する（挿入は 1 を返すスタブ）、「SQL が挿入できる」＝実際の insertIfOrdered が 1 行入れる。
// (2) Service の確認の後、挿入の直前に相手が無効になっても、SQL が止めて 0 行になり、Service は読み直して 409 CONFLICT にする（行は増えない）。
// authorizer は本物（createAppAuthorizer）を使う。データは架空（testuser_dm_post_、[UNIT_TEST]）。接続先は vitest-pool-workers の一時 D1 だけ。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupDmScenario,
  deactivateUser,
  insertDm,
  insertDmUser,
} from "../../test/dm-fixtures";
import {
  insertDepartmentWithChannels,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { messageIds, ulidAt } from "../../test/message-fixtures";
import { withMessages, type MessageRepository } from "../db/message.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";
import { createMessageService } from "./message.service";

let dept: SeededDepartment;
let alice: string;
let bob: string;
let carol: string;
let stranger: string;
let activeRoom: string;
let retiredRoom: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("DM一致");
  alice = (
    await insertDmUser("testuser_dm_post_alice", dept.id, "テストDMアリス")
  ).userId;
  bob = (await insertDmUser("testuser_dm_post_bob", dept.id, "テストDMボブ"))
    .userId;
  carol = (
    await insertDmUser("testuser_dm_post_carol", dept.id, "テストDMキャロル")
  ).userId;
  stranger = (
    await insertDmUser("testuser_dm_post_stranger", dept.id, "テストDM第三者")
  ).userId;
  activeRoom = await insertDm(alice, bob);
  retiredRoom = await insertDm(alice, carol);
  await deactivateUser(carol);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupDmScenario();
});

function withService<T>(
  wrap: (repository: MessageRepository) => MessageRepository,
  run: (service: ReturnType<typeof createMessageService>) => Promise<T>,
) {
  return withMessages(env, (repository) =>
    withRoleAssignments(env, (roles) =>
      run(
        createMessageService(wrap(repository), {
          authorizer: createAppAuthorizer(roles, {
            logger: createLogger({ traceId: "unit-136-dm-postable" }),
          }),
        }),
      ),
    ),
  );
}

/** Service の判定：投稿が許されれば true、NOT_FOUND・CONFLICT なら false（挿入は 1 を返すスタブで、行は入れない） */
async function serviceAllows(userId: string, roomId: string): Promise<boolean> {
  const error = await withService(
    (repository) => ({ ...repository, insertIfOrdered: async () => 1 }),
    (service) =>
      service
        .post(
          { userId, traceId: "unit-136-dm-postable" },
          roomId,
          "[UNIT_TEST]判定",
        )
        .then(
          () => null,
          (e: unknown) => e,
        ),
  );
  if (error === null) return true;
  if (
    error instanceof AppError &&
    ["NOT_FOUND", "CONFLICT"].includes(error.code)
  )
    return false;
  throw error;
}

let sequence = 0;
/** SQL の判定：実際の insertIfOrdered が1行を入れれば true */
async function sqlAllows(userId: string, roomId: string): Promise<boolean> {
  sequence += 1;
  const inserted = await withMessages(env, (repository) =>
    repository.insertIfOrdered({
      id: ulidAt(1_800_000_000_000 + sequence),
      roomId,
      senderId: userId,
      senderDisplayName: "テスト太郎",
      body: "[UNIT_TEST]SQLの判定",
    }),
  );
  return inserted > 0;
}

describe("#136 AC-1（1-2 AC-2）・C-168(2) Service と SQL の判定の一致（DM）", () => {
  it.each([
    ["当事者（送信者）", true, () => alice, () => activeRoom],
    ["当事者（相手側）", true, () => bob, () => activeRoom],
    ["第三者", false, () => stranger, () => activeRoom],
    ["相手が無効な DM の当事者", false, () => alice, () => retiredRoom],
  ])(
    "#136 AC-1・C-168(2): %s は、Service と SQL の判定が同じ（期待=%s）",
    async (_label, expected, who, room) => {
      expect(await serviceAllows(who(), room())).toBe(expected);
      expect(await sqlAllows(who(), room())).toBe(expected);
    },
  );
});

describe("#136 C-168(2) 確認の後に相手が無効になった場合", () => {
  it("#136 C-168(2): Service の確認の後、挿入の直前に相手が無効になっても 409 CONFLICT で、行は増えない", async () => {
    let insertCalls = 0;
    const error = await withService(
      (repository) => ({
        ...repository,
        insertIfOrdered: async (input) => {
          insertCalls += 1;
          // 最初の挿入の直前に、別の操作で相手が無効になる
          if (insertCalls === 1) await deactivateUser(bob);
          return repository.insertIfOrdered(input);
        },
      }),
      (service) =>
        service
          .post(
            { userId: alice, traceId: "unit-136-dm-race" },
            activeRoom,
            "[UNIT_TEST]直前に無効",
          )
          .then(
            () => null,
            (e: unknown) => e,
          ),
    );
    expect(error).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await messageIds(activeRoom)).toEqual([]);
    // 無効が原因の 0 行を、IDの作り直しで何度も試さない（読み直しで 409 にする）
    expect(insertCalls).toBe(1);
  });
});
