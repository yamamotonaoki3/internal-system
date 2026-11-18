// #148（148-A）5-2 AC-1・5-1 AC-11・R-62〜R-64：案件専用チャンネル（案件の部屋）での、メッセージの Service（message.service.ts）の判定の順を確かめる。
// 計画 148-A「判定の順（案件の部屋）」：
//   読み（一覧・返信の一覧・メンションの候補）：部屋がない／見えない（404。非参加者も同じ）→ 案件の部屋なら perm.case.view（403）→ 中身
//   書き込み（投稿・返信・編集・削除・リアクション）：既存の資格（404 → 403）→ 案件の部屋なら perm.case.post（403）→ 案件が終了中（409）→ …
//   リアクションも perm.case.post を判定する（計画「案件の権限を確かめる経路」の表。拒否は services/case-room.permissions.test.ts で確かめる）
//   非参加者は 404 で、409 にも権限の判定にも進まない（案件の状態を漏らさない）。perm.case.post の拒否は 409 より先の 403。
//   案件でない部屋（通常のチャンネル）では perm.case.* を判定しない（退行なし）。
// 固定ロールはすべて perm.case.* を持つため、偽の authorizer（dm-fixtures の fakeAuthorizer）で拒否を作る。Repository は本物（隔離 D1）。
// 応答コードと経路の結線は結合のテスト（routes/messages.case-room.test.ts）、割り込みは messages.case-room.interleave.test.ts で確かめる。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CASE_CLOSED_MESSAGE,
  CASE_CLOSED_MESSAGES,
  cleanupCaseRoomWorld,
  messageCountIn,
  seedRoomMessage,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import { messageRow } from "../../test/message-modify-fixtures";
import { reactionRows } from "../../test/reaction-fixtures";
import { withMessages } from "../db/message.repository";
import type { Permission } from "../lib/permissions";
import { createMessageService } from "./message.service";

let cw: CaseRoomWorld;

const actor = (userId: string) => ({
  userId,
  traceId: "unit-148-case-room",
  reauthenticatedAt: new Date().toISOString(),
});

type Service = ReturnType<typeof createMessageService>;

async function run<T>(
  denied: readonly Permission[],
  action: (service: Service) => Promise<T>,
) {
  const authorizer = fakeAuthorizer(denied);
  const outcome = await withMessages(env, (repository) =>
    action(createMessageService(repository, { authorizer })).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null as T | null, error }),
    ),
  );
  return { ...outcome, calls: authorizer.calls };
}

const casePermissionCalls = (calls: readonly { permission: string }[]) =>
  calls
    .map((call) => call.permission)
    .filter((permission) => permission.startsWith("perm.case."));

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1510);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 5-2 AC-1・R-62 案件の部屋の読み（Service）", () => {
  it("#148 R-62: 参加者の一覧は perm.case.view を判定してから読む（終了中も読める）", async () => {
    const existing = await seedRoomMessage(
      cw.closed.roomId,
      cw.w.memberD1.id,
      1,
    );
    const { value, error, calls } = await run([], (s) =>
      s.list(actor(cw.w.memberS1.id), cw.closed.roomId, { limit: 50 }),
    );
    expect(error).toBeNull();
    expect(value?.items.map((item) => item.id)).toEqual([existing]);
    expect(casePermissionCalls(calls)).toEqual(["perm.case.view"]);
  });

  it("#148 R-62: perm.case.view を拒否されると、参加者でも一覧・返信の一覧・メンションの候補が 403", async () => {
    const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 2);
    const me = actor(cw.w.memberS1.id);
    const results = [
      await run(["perm.case.view"], (s) =>
        s.list(me, cw.open.roomId, { limit: 50 }),
      ),
      await run(["perm.case.view"], (s) =>
        s.listReplies(me, parent, { limit: 50 }),
      ),
      await run(["perm.case.view"], (s) =>
        s.mentionCandidates(me, cw.open.roomId, { limit: 20 }),
      ),
    ];
    for (const { error } of results)
      expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("#148 5-2 AC-3・存在の非開示: 非参加者は 404 で、perm.case.view の判定に進まない", async () => {
    const { error, calls } = await run(["perm.case.view"], (s) =>
      s.list(actor(cw.w.memberS2.id), cw.open.roomId, { limit: 50 }),
    );
    expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(casePermissionCalls(calls)).toEqual([]);
  });

  it("#148 退行なし: 案件でない通常のチャンネルの一覧では perm.case.* を判定しない（拒否していても読める）", async () => {
    const { error, calls } = await run(
      ["perm.case.view", "perm.case.post"],
      (s) => s.list(actor(cw.w.memberS1.id), cw.normal, { limit: 50 }),
    );
    expect(error).toBeNull();
    expect(casePermissionCalls(calls)).toEqual([]);
  });
});

describe("#148 5-2 AC-1・5-1 AC-11・R-63 案件の部屋への書き込み（Service）", () => {
  it("#148 R-63: 進行中の案件の部屋への投稿は perm.case.post を判定してから書き込む", async () => {
    const { value, error, calls } = await run([], (s) =>
      s.post(actor(cw.w.memberS1.id), cw.open.roomId, "[UNIT_TEST]148投稿"),
    );
    expect(error).toBeNull();
    expect(value).toMatchObject({ roomId: cw.open.roomId });
    expect(casePermissionCalls(calls)).toContain("perm.case.post");
    expect(await messageCountIn(cw.open.roomId)).toBe(1);
  });

  it("#148 5-1 AC-11: 終了の案件の部屋への投稿は、参加者でも 409「終了した案件には投稿できません」で、行は増えない", async () => {
    const { error } = await run([], (s) =>
      s.post(actor(cw.w.memberS1.id), cw.closed.roomId, "[UNIT_TEST]148拒否"),
    );
    expect(error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      userMessage: CASE_CLOSED_MESSAGE,
    });
    expect(await messageCountIn(cw.closed.roomId)).toBe(0);
  });

  it("#148 存在の非開示: 終了の案件の部屋でも、非参加者の投稿は 404（409 にならない）で、perm.case.* の判定に進まない", async () => {
    const { error, calls } = await run([], (s) =>
      s.post(actor(cw.w.memberS2.id), cw.closed.roomId, "[UNIT_TEST]148"),
    );
    expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(casePermissionCalls(calls)).toEqual([]);
  });

  it("#148 R-63: perm.case.post を拒否されると、終了の案件の部屋でも 409 より先に 403", async () => {
    const { error } = await run(["perm.case.post"], (s) =>
      s.post(actor(cw.w.memberS1.id), cw.closed.roomId, "[UNIT_TEST]148"),
    );
    expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("#148 5-1 AC-11: 終了の案件の部屋では、返信・編集・削除・リアクションの追加と取り消しも 409 で、何も変わらない", async () => {
    const parent = await seedRoomMessage(cw.closed.roomId, cw.w.memberS1.id, 3);
    await env.DB.prepare(
      "INSERT INTO message_reactions (message_id, kind, value, user_id, created_at) VALUES (?, 'emoji', '🎉', ?, ?)",
    )
      .bind(parent, cw.w.memberS1.id, "2026-11-17T03:00:00.000Z")
      .run();
    const me = actor(cw.w.memberS1.id);
    const results = [
      await run([], (s) => s.postReply(me, parent, "[UNIT_TEST]148返信")),
      await run([], (s) => s.edit(me, parent, "[UNIT_TEST]148編集")),
      await run([], (s) => s.addReaction(me, parent, "emoji", "👍")),
      await run([], (s) => s.removeReaction(me, parent, "emoji", "🎉")),
      await run([], (s) => s.remove(me, parent)),
    ];
    const M = CASE_CLOSED_MESSAGES;
    expect(results.map(({ error }) => error)).toEqual(
      [M.post, M.modify, M.reaction, M.reaction, M.modify].map((userMessage) =>
        expect.objectContaining({ code: "CONFLICT", status: 409, userMessage }),
      ),
    );
    expect(await messageCountIn(cw.closed.roomId)).toBe(1);
    expect(await messageRow(parent)).toMatchObject({
      body: expect.stringContaining("148投稿") as unknown,
      edited_at: null,
      deleted_at: null,
    });
    expect((await reactionRows(parent)).map((row) => row.value)).toEqual([
      "🎉",
    ]);
  });

  it("#148 R-63: 返信・編集・削除は perm.case.post を判定し、拒否されれば 403（終了の 409 より先）", async () => {
    const parent = await seedRoomMessage(cw.closed.roomId, cw.w.memberS1.id, 4);
    const me = actor(cw.w.memberS1.id);
    const results = [
      await run(["perm.case.post"], (s) =>
        s.postReply(me, parent, "[UNIT_TEST]148返信"),
      ),
      await run(["perm.case.post"], (s) =>
        s.edit(me, parent, "[UNIT_TEST]148編集"),
      ),
      await run(["perm.case.post"], (s) => s.remove(me, parent)),
    ];
    for (const { error } of results)
      expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("#148 退行なし: 通常のチャンネルへの投稿では perm.case.* を判定しない（拒否していても投稿できる）", async () => {
    const { error, calls } = await run(
      ["perm.case.view", "perm.case.post"],
      (s) => s.post(actor(cw.w.memberS1.id), cw.normal, "[UNIT_TEST]148通常"),
    );
    expect(error).toBeNull();
    expect(casePermissionCalls(calls)).toEqual([]);
  });
});
