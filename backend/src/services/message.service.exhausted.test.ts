// #201 AC-3・AC-4: 再試行を使い切った後の読み分け。最後の挿入が0行だったとき、その間に状態が崩れていれば（参加が外れた／アーカイブされた／お知らせ専用の権限を失った）
// 503 ではなく 404／403 を返す。503 になるのは、状態は正しいのにIDの競合で挿入できなかった場合だけ。
// 方法：message.service.retry.test.ts と同じく、実際の Repository と D1 を使い、insertIfOrdered だけを「いつも 0」に差し替える。
//   差し替えた関数が「最後の呼び出し」で状態を崩す（途中で崩すと、再試行の途中の確認で検出されてしまい、最後の読み分けを確かめられない）。
// 方針：振る舞い（status・code・行の有無）で確かめ、文言の完全一致は使わない。データは架空（testuser_msgex_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  insertDepartmentWithChannels,
  insertMember,
  makeOwner,
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

/** 最初の1回＋再試行の上限（message.service.retry.test.ts と同じ前提：呼び出しは4回以内） */
const LAST_CALL = 4;

let dept: SeededDepartment;
let userId: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("メッセージ使い切り");
  userId = await insertUser("testuser_msgex_001", dept.id);
  await insertMember(dept.dedicatedChannelId, userId);
  await insertMember(dept.announcementChannelId, userId);
  await makeOwner(userId, dept.id);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupMessageScenario();
});

/** insertIfOrdered がいつも 0 を返し、LAST_CALL 回目の呼び出しの中で breakState を実行する状態で投稿し、結果を返す */
async function postWithExhaustedRetries(
  roomId: string,
  breakState: (() => Promise<unknown>) | null,
) {
  let calls = 0;
  const insertIfOrdered = vi.fn(async () => {
    calls += 1;
    if (calls === LAST_CALL && breakState !== null) await breakState();
    return 0;
  });
  const error = await withMessages(env, (repository) =>
    withRoleAssignments(env, (roles) => {
      const authorizer = createAppAuthorizer(roles, {
        logger: createLogger({ traceId: "unit-201-exhausted" }),
      });
      const service = createMessageService(
        { ...repository, insertIfOrdered },
        { authorizer },
      );
      return service
        .post(
          { userId, traceId: "unit-201-exhausted" },
          roomId,
          "[UNIT_TEST]使い切り",
        )
        .then(
          () => null,
          (e: unknown) => e,
        );
    }),
  );
  return { error, calls: insertIfOrdered.mock.calls.length };
}

describe("#201 AC-3 再試行を使い切った後の読み分け", () => {
  it.each([
    [
      "最後の挿入が0行の間に参加が外れた",
      () => dept.dedicatedChannelId,
      () =>
        env.DB.prepare("DELETE FROM channel_members WHERE user_id = ?")
          .bind(userId)
          .run(),
      403,
      "FORBIDDEN",
    ],
    [
      "最後の挿入が0行の間にチャンネルがアーカイブされた",
      () => dept.dedicatedChannelId,
      () =>
        env.DB.prepare(
          "UPDATE channels SET deleted_at = '2026-11-09T00:00:00.000Z' WHERE room_id = ?",
        )
          .bind(dept.dedicatedChannelId)
          .run(),
      404,
      "NOT_FOUND",
    ],
    [
      "最後の挿入が0行の間にお知らせ専用の権限を失った",
      () => dept.announcementChannelId,
      () =>
        env.DB.prepare("DELETE FROM user_role_assignments WHERE user_id = ?")
          .bind(userId)
          .run(),
      403,
      "FORBIDDEN",
    ],
  ])(
    "#201 AC-3（読み分け）: %s と、503ではなく状況に応じた拒否になり、行は増えない",
    async (_label, roomId, breakState, status, code) => {
      const { error, calls } = await postWithExhaustedRetries(
        roomId(),
        breakState,
      );
      // 最後の呼び出しまで再試行した（途中で打ち切られて別の理由になっていない）
      expect(calls).toBe(LAST_CALL);
      expect(error).toMatchObject({ status, code });
      expect(await messageCount(dept.dedicatedChannelId)).toBe(0);
      expect(await messageCount(dept.announcementChannelId)).toBe(0);
    },
  );

  it("#201 AC-3（読み分け）: 状態が正しいまま挿入できなかったときだけ 503 SERVICE_UNAVAILABLE になる（専用チャンネル）", async () => {
    const { error, calls } = await postWithExhaustedRetries(
      dept.dedicatedChannelId,
      null,
    );
    expect(calls).toBe(LAST_CALL);
    expect(error).toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
    expect(await messageCount(dept.dedicatedChannelId)).toBe(0);
  });

  it("#201 AC-3（読み分け）: オーナーとして投稿できる状態のお知らせ専用でも、挿入できないだけなら 503 になる", async () => {
    const { error, calls } = await postWithExhaustedRetries(
      dept.announcementChannelId,
      null,
    );
    expect(calls).toBe(LAST_CALL);
    expect(error).toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
    expect(await messageCount(dept.announcementChannelId)).toBe(0);
  });
});
