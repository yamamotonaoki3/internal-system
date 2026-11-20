// #149（149-D）軽微1・計画 10節「OpenAPI」：参加者の削除（DELETE /api/cases/{caseId}/participants/{userId}）が、
// 記録の ID・対象の件数の作り直しの上限を超えたとき、503 を、仕様（components.responses.ServiceUnavailable）の形で返すことを、
// 実際のアプリの入口から確かめる。毎回 batch の直前に、外す人を担当にした TODO を1件足して、前提を崩し続ける。
// 期待値は計画 6.3.7（149-A と同じ code・文言）から決める。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_TRACE_PREFIX,
  SESSION_COOKIE,
  TEST_IP,
  newThrottleKey,
} from "../../test/auth-fixtures";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import { participantIdsOf } from "../../test/case-participant-fixtures";
import {
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { insertTodo, todoIdAt } from "../../test/case-todo-fixtures";
import { newPiiKey, newSetupToken } from "../../test/random-secrets";
import { loadConfig } from "../config";
import { app } from "../index";

const ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
const BUSY_MESSAGE = "混み合っています。しばらくしてからもう一度お試しください";

let w: CaseWorld;
let room: SeededCase;
let added = 0;

function busyDb(): D1Database {
  return new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          added += 1;
          await insertTodo({
            id: todoIdAt(600 + added),
            caseId: room.id,
            createdBy: w.memberS1.id,
            title: `[UNIT_TEST]149D混雑${added}`,
            assigneeId: w.memberD1.id,
          });
          return target.batch(statements);
        };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

beforeEach(async () => {
  added = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1541,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]149D混雑",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#149 149-D 軽微1 参加者の削除の 503", () => {
  it("#149 149-D 軽微1: 作り直しの上限を超えると 503 で、本文は code SERVICE_UNAVAILABLE と 149-A と同じ文言。参加の行は残る", async () => {
    const res = await app.request(
      `/api/cases/${room.id}/participants/${w.memberD1.id}`,
      {
        method: "DELETE",
        headers: {
          Origin: ORIGIN,
          "CF-Connecting-IP": TEST_IP,
          "X-Request-Id": `${AUTH_TRACE_PREFIX}${crypto.randomUUID()}`,
          Cookie: `${SESSION_COOKIE}=${w.memberS1.token}`,
        },
      },
      {
        ...env,
        DB: busyDb(),
        LOGIN_THROTTLE_KEY: newThrottleKey(),
        SETUP_TOKEN: newSetupToken(),
        PII_ENCRYPTION_KEY: newPiiKey(),
      } as unknown as Env,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: BUSY_MESSAGE,
    });
    expect(await participantIdsOf(room.roomId)).toContain(w.memberD1.id);
  });
});
