// #201 AC-3: 投稿のIDの再試行に上限があること。部屋の最大IDより小さくて挿入できない状態が続いても、上限を超えたら503で案内し、行を増やさない（もみ消さない）。
// 契約（実装前の仮置き）：createMessageService(repository, { authorizer }) の post(actor, roomId, body) が { id, roomId, createdAt } を返す。
//   repository.insertIfOrdered(...) は挿入した行数（0 なら挿入されなかった）を返す。実際の Repository と D1 を使い、insertIfOrdered だけを「いつも 0」に差し替える。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  cleanupMessageScenario,
  messageCount,
} from "../../test/message-fixtures";
import { insertUser } from "../../test/role-fixtures";
import { withMessages } from "../db/message.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";
import { createMessageService } from "./message.service";

let dept: SeededDepartment;
let userId: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("メッセージ再試行");
  userId = await insertUser("testuser_msgretry_001", dept.id);
  await insertMember(dept.dedicatedChannelId, userId);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupMessageScenario();
});

describe("#201 AC-3 IDの再試行の上限", () => {
  it("#201 AC-3（U-10）: 挿入できない状態が続くと、再試行して、上限を超えたら503 SERVICE_UNAVAILABLE にし、行を増やさない", async () => {
    const insertIfOrdered = vi.fn(async () => 0);
    const error = await withMessages(env, (repository) =>
      withRoleAssignments(env, async (roles) => {
        const authorizer = createAppAuthorizer(roles, {
          logger: createLogger({ traceId: "unit-201-retry" }),
        });
        const service = createMessageService(
          { ...repository, insertIfOrdered },
          { authorizer },
        );
        return service
          .post(
            { userId, traceId: "unit-201-retry" },
            dept.dedicatedChannelId,
            "[UNIT_TEST]混み合い",
          )
          .then(
            () => null,
            (e: unknown) => e,
          );
      }),
    );
    expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE", status: 503 });
    // 再試行した（1回では諦めない）が、無限には繰り返さない
    expect(insertIfOrdered.mock.calls.length).toBeGreaterThan(1);
    expect(insertIfOrdered.mock.calls.length).toBeLessThanOrEqual(4);
    expect(await messageCount(dept.dedicatedChannelId)).toBe(0);
  });
});
