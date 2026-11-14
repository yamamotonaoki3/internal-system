// #137 AC-1・AC-2（1-4 AC-1・AC-2・R-30・C-59・U-6）: メッセージの Service（message.service.ts）の返信 postReply の判定の順と権限の拒否を確かめる。
// 契約（実装者へ。計画 決めたこと4）：createMessageService(repository, { authorizer }).postReply(actor, parentMessageId, body) が
//   { id, roomId, parentMessageId, createdAt } を返す。判定の順（この順を変えない）：
//   ① 親が存在して見えるか（404）→ ② 親が返信でないか（404）→ ③ チャンネルで参加しているか（403）
//   → ④ authorize(perm.message.reply)（拒否は 403。authorize が監査に記録する）→ ⑤ 親が削除済みか（409）→ ⑥ 部屋の状態（部署が無効・DM の相手が無効は 409）→ ⑦ 条件付きの INSERT
// Repository は本物（隔離 D1）。権限の拒否は固定ロールがすべて perm.message.reply を持つため、偽の authorizer（dm-fixtures の fakeAuthorizer）と、
// 割り当てを読めない（何も持たない）本物の authorizer の2通りで作る。データは架空（testuser_replysvc_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { fakeAuthorizer, insertDm } from "../../test/dm-fixtures";
import {
  deactivateDepartment,
  failureAuditLines,
  markDeleted,
} from "../../test/message-modify-fixtures";
import {
  TEST_TAG,
  cleanupThreadScenario,
  createThreadWorld,
  replyRows,
  roomRowCount,
  seedParent,
  seedReply,
  type ThreadWorld,
} from "../../test/thread-fixtures";
import { withMessages } from "../db/message.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { createLogger } from "../lib/logger/logger";
import type { Permission } from "../lib/permissions";
import { createAppAuthorizer } from "./authorizer";
import { createMessageService } from "./message.service";

let world: ThreadWorld;
let logLines: string[];
const BODY = `${TEST_TAG}サービスの返信`;

const actorOf = (userId: string) => ({ userId, traceId: "unit-137-reply" });

beforeEach(async () => {
  logLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("replysvc");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupThreadScenario();
});

/** 偽の authorizer と本物の Repository で postReply を呼び、成功の値か投げたエラーと、authorize の呼び出しを返す */
async function post(
  userId: string,
  parentId: string,
  denied: readonly Permission[] = [],
) {
  const authorizer = fakeAuthorizer(denied);
  const outcome = await withMessages(env, (repository) =>
    createMessageService(repository, { authorizer })
      .postReply(actorOf(userId), parentId, BODY)
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

describe("#137 AC-1（1-4 AC-1）成功", () => {
  it("#137 AC-1: 参加者の返信は perm.message.reply を判定し、{ id, roomId, parentMessageId, createdAt } を返して1行入れる", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const outcome = await post(world.bob.userId, parentId);
    expect(outcome.error).toBeNull();
    expect(outcome.value).toEqual({
      id: expect.any(String) as string,
      roomId: world.channel,
      parentMessageId: parentId,
      createdAt: expect.any(String) as string,
    });
    expect(outcome.permissions).toContain("perm.message.reply");
    expect(await replyRows(parentId)).toHaveLength(1);
  });
});

describe("#137 AC-1 判定の順（404 → 403 → 権限 → 409）", () => {
  it("#137 AC-1（①）: 非公開で未参加の親は、権限を拒否されていても 404 で、perm.message.reply を判定しない", async () => {
    const room = await insertChannel({
      name: `${TEST_TAG}順序の非公開`,
      purpose: "normal",
      departmentId: world.dept.id,
      visibility: "private",
    });
    await insertMember(room, world.alice.userId);
    const parentId = await seedParent(room, world.alice.userId, 1);
    const outcome = await post(world.bob.userId, parentId, [
      "perm.message.reply",
    ]);
    expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(outcome.permissions).not.toContain("perm.message.reply");
    expect(await replyRows(parentId)).toEqual([]);
  });

  it("#137 AC-1（②）: 親が返信なら、権限を拒否されていても 404（返信は1段だけ）", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const reply = await seedReply(world.channel, parentId, world.bob.userId, 2);
    const outcome = await post(world.alice.userId, reply, [
      "perm.message.reply",
    ]);
    expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await replyRows(reply)).toEqual([]);
  });

  it("#137 AC-1（③）: 未参加の公開チャンネルは 403 FORBIDDEN で、perm.message.reply を判定しない", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const outcome = await post(world.carol.userId, parentId);
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(outcome.permissions).not.toContain("perm.message.reply");
    expect(await replyRows(parentId)).toEqual([]);
  });

  it("#137 AC-1（④）: perm.message.reply を拒否されると、参加者でも 403 FORBIDDEN で、書き込まない", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const outcome = await post(world.bob.userId, parentId, [
      "perm.message.reply",
    ]);
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(outcome.permissions).toContain("perm.message.reply");
    expect(await replyRows(parentId)).toEqual([]);
  });

  it("#137 AC-1（④→⑤）: 親が削除済みでも、権限を拒否されていれば 409 ではなく 403", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    await markDeleted(parentId, world.alice.userId);
    const outcome = await post(world.bob.userId, parentId, [
      "perm.message.reply",
    ]);
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("#137 AC-2（⑤）: 親が削除済みなら 409 CONFLICT で、書き込まない", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    await markDeleted(parentId, world.alice.userId);
    const outcome = await post(world.bob.userId, parentId);
    expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await replyRows(parentId)).toEqual([]);
  });

  it("#137 AC-1（⑥）: 部署が無効のチャンネルは 409 CONFLICT、DM の相手が無効な DM も 409 で、書き込まない", async () => {
    await insertMember(world.dept.dedicatedChannelId, world.alice.userId);
    await insertMember(world.dept.dedicatedChannelId, world.bob.userId);
    const channelParent = await seedParent(
      world.dept.dedicatedChannelId,
      world.alice.userId,
      1,
    );
    await deactivateDepartment(world.dept.id);
    const channelOutcome = await post(world.bob.userId, channelParent);
    expect(channelOutcome.error).toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
    expect(await replyRows(channelParent)).toEqual([]);

    const dm = await insertDm(world.alice.userId, world.dave.userId);
    const dmParent = await seedParent(dm, world.alice.userId, 2);
    await env.DB.prepare(
      "UPDATE users SET is_active = 0, deactivated_at = ? WHERE id = ?",
    )
      .bind("2026-11-14T00:00:00.000Z", world.dave.userId)
      .run();
    const dmOutcome = await post(world.alice.userId, dmParent);
    expect(dmOutcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await replyRows(dmParent)).toEqual([]);
  });
});

describe("#137 AC-1（R-30）権限の拒否は監査に残る", () => {
  it("#137 AC-1: 権限を持たない（割り当てを読めない）利用者の返信は 403 で、logger.audit に perm.message.reply の拒否が残り、本文は出ない。書き込まない", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const error = await withMessages(env, (repository) =>
      withRoleAssignments(env, async (roles) => {
        const noRoles = { ...roles, findByUserId: async () => null };
        const authorizer = createAppAuthorizer(noRoles, {
          logger: createLogger({
            traceId: "unit-137-audit",
            userId: world.bob.userId,
          }),
        });
        return createMessageService(repository, { authorizer })
          .postReply(actorOf(world.bob.userId), parentId, BODY)
          .then(
            () => null,
            (e: unknown) => e,
          );
      }),
    );
    expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    const denied = failureAuditLines(logLines);
    expect(denied.map((line) => line.body)).toContain("perm.message.reply");
    expect(JSON.stringify(denied)).not.toContain(BODY);
    expect(await replyRows(parentId)).toEqual([]);
    expect(await roomRowCount(world.channel)).toBe(1);
  });
});
