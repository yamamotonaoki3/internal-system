// #200 AC-2・AC-3: チャンネルの Service（channel.service.ts）の単体テスト。Repository はスタブにする。
// 見えるか → 参加済みか → 参加できるか の順と、404 の文言を確かめる。
import { describe, expect, it, vi } from "vitest";
import type {
  ChannelDetailRow,
  ChannelRepository,
} from "../db/channel.repository";
import { createChannelService } from "./channel.service";

const actor = { userId: "testuser_200_svc", traceId: "unit-200-svc" };
const ROOM = "01JTESTCHAN00000000000SV01";

function row(overrides: Partial<ChannelDetailRow> = {}): ChannelDetailRow {
  return {
    roomId: ROOM,
    name: "[UNIT_TEST]チャンネル",
    description: "",
    visibility: "public",
    departmentId: null,
    deletedAt: null,
    joinedAt: null,
    ...overrides,
  };
}

function stub(found: ChannelDetailRow | null, departmentExists = true) {
  const repository = {
    departmentExists: vi.fn(async () => departmentExists),
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    findForViewer: vi.fn(async () => found),
    countMembers: vi.fn(async () => 1),
    listMembers: vi.fn(async () => []),
    join: vi.fn(async () => "2026-11-09T00:00:00.000Z"),
  };
  return {
    repository,
    service: createChannelService(repository as unknown as ChannelRepository),
  };
}

describe("#200 AC-2 一覧", () => {
  it("#200 AC-2: 存在しない部署で絞ると 404 NOT_FOUND（部署が見つかりません）で、一覧は読まない", async () => {
    const { repository, service } = stub(null, false);
    await expect(
      service.list(actor, { limit: 20, departmentId: "dept" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      userMessage: "部署が見つかりません",
    });
    expect(repository.list).not.toHaveBeenCalled();
  });

  it("#200 AC-2: 部署を指定しなければ、部署の確認をせずに一覧を読む", async () => {
    const { repository, service } = stub(null);
    await service.list(actor, { limit: 20 });
    expect(repository.departmentExists).not.toHaveBeenCalled();
    expect(repository.list).toHaveBeenCalledWith(actor.userId, { limit: 20 });
  });
});

describe("#200 AC-3 参加の判定", () => {
  it.each([
    ["見つからない", null],
    ["非公開で未参加", row({ visibility: "private" })],
    ["アーカイブ済み", row({ deletedAt: "2026-11-09T00:00:00.000Z" })],
  ])(
    "#200 AC-3: %s ときは 404 NOT_FOUND（チャンネルが見つかりません）で、参加しない",
    async (_label, found) => {
      const { repository, service } = stub(found);
      await expect(service.join(actor, ROOM)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
        userMessage: "チャンネルが見つかりません",
      });
      expect(repository.join).not.toHaveBeenCalled();
    },
  );

  it("#200 AC-3: 参加済みの非公開チャンネルは、見えるのでべき等に200を返し、参加の処理を呼ばない", async () => {
    const joined = row({
      visibility: "private",
      joinedAt: "2026-11-08T00:00:00.000Z",
    });
    const { repository, service } = stub(joined);
    await expect(service.join(actor, ROOM)).resolves.toEqual({
      channelId: ROOM,
      roomId: ROOM,
      joinedAt: "2026-11-08T00:00:00.000Z",
    });
    expect(repository.join).not.toHaveBeenCalled();
  });

  it("#200 AC-3: 確認の後にアーカイブ・非公開化され、Repository が参加を挿入できず null を返したときは、404 NOT_FOUND（チャンネルが見つかりません）にする", async () => {
    const { repository, service } = stub(row());
    repository.join.mockResolvedValueOnce(null as unknown as string);
    await expect(service.join(actor, ROOM)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      userMessage: "チャンネルが見つかりません",
    });
    expect(repository.join).toHaveBeenCalledTimes(1);
  });

  it("#200 AC-3: 公開で未参加なら参加し、Repository へ roomId・userId・traceId を渡す", async () => {
    const { repository, service } = stub(row());
    await expect(service.join(actor, ROOM)).resolves.toEqual({
      channelId: ROOM,
      roomId: ROOM,
      joinedAt: "2026-11-09T00:00:00.000Z",
    });
    expect(repository.join).toHaveBeenCalledWith({
      roomId: ROOM,
      userId: actor.userId,
      traceId: actor.traceId,
    });
  });
});
