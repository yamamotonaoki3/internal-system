// #201 AC-3: IDを作り直して再試行したとき、表示時刻が逆転しないこと。再試行のたびに createdAt を取り直す方針なので、
// 201応答の createdAt は、(a) 保存された行の created_at と一致し、(b) 同じ部屋の直前の投稿の created_at 以上である。
// 状況：直前の投稿（IDは未来の時刻のもの。別の投稿者が、最初の試行の後に、より進んだ時計で保存した想定）がすでにあり、最初の試行は0行になる。
//   Date だけを偽の時計にして、最初の試行の後に時計を進める。最初に決めた時刻のまま保存すると、直前の投稿より古い時刻になって逆転する。
// 方針：振る舞い（応答と保存された行の時刻の大小・一致）で確かめる。データは架空（testuser_msgat_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  cleanupMessageScenario,
  insertMessage,
  ulidAt,
} from "../../test/message-fixtures";
import { insertUser } from "../../test/role-fixtures";
import { withMessages } from "../db/message.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { createLogger } from "../lib/logger/logger";
import { createAppAuthorizer } from "./authorizer";
import { createMessageService } from "./message.service";

const T0 = Date.parse("2026-11-10T00:00:00.000Z");
const PREVIOUS_CREATED_AT = new Date(T0 + 1_000).toISOString();

let dept: SeededDepartment;
let userId: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("メッセージ時刻");
  userId = await insertUser("testuser_msgat_001", dept.id);
  await insertMember(dept.dedicatedChannelId, userId);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupMessageScenario();
});

describe("#201 AC-3 再試行で作り直したときの createdAt", () => {
  it("#201 AC-3: IDを作り直して保存した投稿の createdAt は、保存された行の created_at と一致し、直前の投稿の created_at 以上（時刻が逆転しない）", async () => {
    // 直前の投稿：IDは今のIDより大きい（最初の試行は0行になる）。created_at は T0 より後
    const previousId = await insertMessage({
      roomId: dept.dedicatedChannelId,
      senderId: userId,
      id: ulidAt(1_900_000_000_000),
    });
    await env.DB.prepare("UPDATE messages SET created_at = ? WHERE id = ?")
      .bind(PREVIOUS_CREATED_AT, previousId)
      .run();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);

    const created = await withMessages(env, (repository) =>
      withRoleAssignments(env, (roles) => {
        const authorizer = createAppAuthorizer(roles, {
          logger: createLogger({ traceId: "unit-201-created-at" }),
        });
        let calls = 0;
        const service = createMessageService(
          {
            ...repository,
            insertIfOrdered: async (input) => {
              calls += 1;
              const inserted = await repository.insertIfOrdered(input);
              // 最初の試行が終わったあとで、時計が進む
              if (calls === 1) {
                expect(inserted).toBe(0);
                vi.setSystemTime(T0 + 2_000);
              }
              return inserted;
            },
          },
          { authorizer },
        );
        return service.post(
          { userId, traceId: "unit-201-created-at" },
          dept.dedicatedChannelId,
          "[UNIT_TEST]時刻",
        );
      }),
    );

    const stored = await env.DB.prepare(
      "SELECT created_at FROM messages WHERE id = ?",
    )
      .bind(created.id)
      .first<{ created_at: string }>();
    expect(stored).not.toBeNull();
    expect(created.createdAt).toBe(stored?.created_at);
    expect(Date.parse(created.createdAt)).toBeGreaterThanOrEqual(
      Date.parse(PREVIOUS_CREATED_AT),
    );
  });

  it("#201 AC-3: 再試行しなかった通常の投稿でも、createdAt は保存された行の created_at と一致する", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const created = await withMessages(env, (repository) =>
      withRoleAssignments(env, (roles) =>
        createMessageService(repository, {
          authorizer: createAppAuthorizer(roles, {
            logger: createLogger({ traceId: "unit-201-created-at" }),
          }),
        }).post(
          { userId, traceId: "unit-201-created-at" },
          dept.dedicatedChannelId,
          "[UNIT_TEST]時刻",
        ),
      ),
    );
    const stored = await env.DB.prepare(
      "SELECT created_at FROM messages WHERE id = ?",
    )
      .bind(created.id)
      .first<{ created_at: string }>();
    expect(created.createdAt).toBe(stored?.created_at);
  });
});
