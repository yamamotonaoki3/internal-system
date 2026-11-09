// #201 AC-4: お知らせ専用の権限判定の一致。Service の判定（authorizer の perm.announcement.post）と、
// Repository の条件付き INSERT（insertIfOrdered の postable 条件：自部署のオーナー役割か全体管理者役割）が、同じ人に同じ結果を返すこと。
// 権限の定義と SQL が食い違うと、この比較が落ちる。4者：自部署オーナー／全体管理者／一般（参加者）／他部署オーナー。
// 方針：「Service が投稿を許す」＝ post が成功する（挿入は 1 を返すスタブ）、「SQL が挿入できる」＝実際の insertIfOrdered が 1 行入れる。
// データは架空（testuser_msgperm_、[UNIT_TEST]）。接続先は vitest-pool-workers の一時 D1 だけ。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  insertDepartmentWithChannels,
  insertMember,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { cleanupMessageScenario, ulidAt } from "../../test/message-fixtures";
import { insertUser } from "../../test/role-fixtures";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";
import { createMessageService } from "./message.service";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { withMessages } from "../db/message.repository";

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let people: { label: string; userId: string; expected: boolean }[];

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deptA = await insertDepartmentWithChannels("メッセージ権限A");
  deptB = await insertDepartmentWithChannels("メッセージ権限B");
  const owner = await insertUser("testuser_msgperm_owner", deptA.id);
  const admin = await insertUser("testuser_msgperm_admin", deptA.id);
  const general = await insertUser("testuser_msgperm_general", deptA.id);
  const otherOwner = await insertUser("testuser_msgperm_other", deptB.id);
  await makeOwner(owner, deptA.id);
  await makeGlobalAdmin(admin);
  await makeOwner(otherOwner, deptB.id);
  // 判定の差だけを見るため、4者とも お知らせ専用チャンネルの参加者にする
  for (const id of [owner, admin, general, otherOwner])
    await insertMember(deptA.announcementChannelId, id);
  people = [
    { label: "自部署のオーナー", userId: owner, expected: true },
    { label: "全体管理者", userId: admin, expected: true },
    { label: "一般の参加者", userId: general, expected: false },
    { label: "他部署のオーナー", userId: otherOwner, expected: false },
  ];
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupMessageScenario();
});

/** Service の判定：投稿が許されれば true、FORBIDDEN なら false（挿入は呼ばれても 1 を返すだけで、行は入れない） */
async function serviceAllows(userId: string): Promise<boolean> {
  const error = await withMessages(env, (repository) =>
    withRoleAssignments(env, (roles) => {
      const authorizer = createAppAuthorizer(roles, {
        logger: createLogger({ traceId: "unit-201-perm" }),
      });
      const service = createMessageService(
        { ...repository, insertIfOrdered: async () => 1 },
        { authorizer },
      );
      return service
        .post(
          { userId, traceId: "unit-201-perm" },
          deptA.announcementChannelId,
          "[UNIT_TEST]権限",
        )
        .then(
          () => null,
          (e: unknown) => e,
        );
    }),
  );
  if (error === null) return true;
  expect(error).toMatchObject({ status: 403, code: "FORBIDDEN" });
  return false;
}

/** SQL の判定：実際の insertIfOrdered が1行入れられるか */
async function sqlAllows(userId: string, index: number): Promise<boolean> {
  const inserted = await withMessages(env, (repository) =>
    repository.insertIfOrdered({
      id: ulidAt(1_800_000_000_000 + index),
      roomId: deptA.announcementChannelId,
      senderId: userId,
      senderDisplayName: "テスト太郎",
      body: "[UNIT_TEST]権限",
    }),
  );
  return inserted > 0;
}

describe("#201 AC-4 お知らせ専用の権限判定：Service と SQL の一致", () => {
  it("#201 AC-4: 4者それぞれで、Service の判定と SQL の挿入可否が同じ結果になる（権限の定義と SQL が食い違うと落ちる）", async () => {
    const results: { label: string; service: boolean; sql: boolean }[] = [];
    for (const [index, person] of people.entries()) {
      results.push({
        label: person.label,
        service: await serviceAllows(person.userId),
        sql: await sqlAllows(person.userId, index),
      });
    }
    for (const result of results)
      expect(result.sql, `${result.label}：SQL が Service と一致`).toBe(
        result.service,
      );
  });

  it("#201 AC-4: 期待値（仕様）：自部署のオーナーと全体管理者は投稿でき、一般の参加者と他部署のオーナーは投稿できない（Service も SQL も）", async () => {
    for (const [index, person] of people.entries()) {
      expect(
        await serviceAllows(person.userId),
        `${person.label}（Service）`,
      ).toBe(person.expected);
      expect(
        await sqlAllows(person.userId, index),
        `${person.label}（SQL）`,
      ).toBe(person.expected);
    }
  });
});
