// #147（147-C-1）ミューテーションの生き残りへの対応：チャンネルの詳細で、資格の確認（findForViewer）は「参加中の非公開」を返したが、
// 参加者の数の読み取り（閲覧者の資格で絞る countMembers）が 0 を返した場合（＝確認の後に資格を失った。C-182(10)）は、
// 見えないものと同じ 404 NOT_FOUND（「チャンネルが見つかりません」）にし、名前・説明・参加者を返さない。
// チャンネルの Repository は代役（型付き）。表示用の管理の判定に使うロールの Repository は本物（隔離 D1。存在しない架空の利用者なので、管理の操作は出ない）。データは架空（testuser_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { withRoleAssignments } from "../db/role-assignment.repository";
import type {
  ChannelRepository,
  ChannelViewRow,
} from "../db/channel.repository";
import { createChannelService } from "./channel.service";

const actor = { userId: "testuser_147_svc", traceId: "unit-147-svc" };
const ROOM = "01KTESTCHAN0000000000SV147";
const NAME = "[UNIT_TEST]非公開の名前";
const DESCRIPTION = "[UNIT_TEST]非公開の説明";

function joinedPrivate(): ChannelViewRow {
  return {
    roomId: ROOM,
    name: NAME,
    description: DESCRIPTION,
    visibility: "private",
    departmentId: null,
    purpose: "normal",
    version: 1,
    deletedAt: null,
    joinedAt: "2026-11-17T03:00:00.000Z",
    departmentIsActive: true,
  };
}

function get(memberCount: number) {
  const repository = {
    findForViewer: vi.fn(async () => joinedPrivate()),
    countMembers: vi.fn(async () => memberCount),
    listMembers: vi.fn(async () =>
      memberCount === 0
        ? []
        : [{ id: actor.userId, displayName: "テスト太郎" }],
    ),
  };
  return withRoleAssignments(env, (roles) =>
    createChannelService(repository as unknown as ChannelRepository, roles).get(
      actor,
      ROOM,
    ),
  );
}

describe("#147 147-C-1 チャンネルの詳細：確認の後に資格を失ったら 404", () => {
  it("#147 147-C-1 対: 参加者の数が1以上なら、参加中の詳細を返す", async () => {
    const detail = await get(1);
    expect(detail).toMatchObject({ joined: true, name: NAME, memberCount: 1 });
  });

  it("#147 147-C-1 C-182(10): 参加者の数が 0 なら 404 NOT_FOUND（チャンネルが見つかりません）で、名前・説明・参加者を返さない", async () => {
    let result: unknown = null;
    let error: unknown = null;
    try {
      result = await get(0);
    } catch (e) {
      error = e;
    }
    expect(result).toBeNull();
    expect(error).toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      userMessage: "チャンネルが見つかりません",
    });
    expect(JSON.stringify(error)).not.toContain(NAME);
    expect(JSON.stringify(error)).not.toContain(DESCRIPTION);
  });
});
