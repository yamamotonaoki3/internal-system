// #128（128-a）コードレビュー1回目の重大1：公開チャンネルへの参加の確認の後、書き込みの前に本人が無効化された場合の Service の応答。
// 契約：repository.join が null（0行）を返したら、repository.isUserActive(actor.userId) を読み直す。
//   無効なら、無効な社員がほかの API で受けるのと同じ 401 UNAUTHENTICATED「ログインしてください」（招待 #135 の読み直しと同じ。チャンネルの状態を伝えない）。
//   有効なら従来どおり 404（channel.service.test.ts）。
// データは架空（testuser_128_・[UNIT_TEST]）。
import { describe, expect, it, vi } from "vitest";
import type {
  ChannelDetailRow,
  ChannelRepository,
} from "../db/channel.repository";
import { createChannelService } from "./channel.service";

const actor = { userId: "testuser_128_join", traceId: "unit-128-join" };
const ROOM = "01JTEST128JOINROOM00000001";

const visible: ChannelDetailRow = {
  roomId: ROOM,
  name: "[UNIT_TEST]128参加",
  description: "",
  visibility: "public",
  departmentId: null,
  deletedAt: null,
  joinedAt: null,
};

describe("#128 AC-9: 参加の確認の後に本人が無効化された場合（Service）", () => {
  it("#128 AC-9: 参加の書き込みが0行で、本人が無効になっていたら 401 UNAUTHENTICATED「ログインしてください」", async () => {
    const repository = {
      findForViewer: vi.fn(async () => visible),
      join: vi.fn(async (): Promise<string | null> => null),
      isUserActive: vi.fn(async () => false),
    };
    const service = createChannelService(
      repository as unknown as ChannelRepository,
    );
    await expect(service.join(actor, ROOM)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
      userMessage: "ログインしてください",
    });
    expect(repository.join).toHaveBeenCalledTimes(1);
    expect(repository.isUserActive).toHaveBeenCalledWith(actor.userId);
  });
});
