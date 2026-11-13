// #237 AC-1・AC-2（3-1 AC-1・AC-2）：未読の Service（services/unread.service.ts）の判定の順と、0行のときの読み分けを、Repository の代役で確かめる。
// 判定の順（計画「Service の判定の順」。この順を変えない）：
//   markRead：① 部屋を探す（チャンネル → 見えなければ 404、見えるが未参加は 403。チャンネルでなければ当事者の DM → 違えば 404）
//             → ② perm.notification.own（範囲 company）を authorize（拒否は 403。書き込まない）
//             → ③ 既読位置を進める（1行なら完了）
//             → ④ 0行のとき：部屋の判定をもう一度（崩れていれば 404／403）→ メッセージがその部屋になければ 404 → あれば完了（既に同じかより新しい位置）
//   list：最初に perm.notification.own を authorize（拒否は 403 で、Repository を呼ばない）→ listUnread の結果をそのまま返す
// 契約（実装者へ）：
//   createUnreadService(
//     readPositions: Pick<ReadPositionRepository, "listUnread" | "advance" | "messageExistsInRoom">,
//     rooms: Pick<MessageRepository, "findRoomForViewer" | "findDirectForParticipant">,
//     deps: { authorizer: Pick<AppAuthorizer, "authorize">; now?: () => Date },
//   )
//     .list(actor: { userId, traceId }, options: { limit: number; cursor?: CursorPayload })
//         → readPositions.listUnread(actor.userId, options) の結果
//     .markRead(actor, roomId: string, lastReadMessageId: string): Promise<void>
//         → readPositions.advance({ userId: actor.userId, roomId, messageId: lastReadMessageId, now: now().toISOString() })
//   withUnreadService(env, actor, run) も公開する。
//   想定できるエラーは AppError（NOT_FOUND・FORBIDDEN）。未知のエラーはそのまま伝える（受け止めない）。
import { describe, expect, it, vi } from "vitest";
import type { ChannelViewRow } from "../db/channel.repository";
import { AppError } from "../lib/app-error";
import type { Principal } from "../lib/authorization";
import type { Permission } from "../lib/permissions";
import { createUnreadService } from "./unread.service";

const USER_ID = "01JTESTUNREADSVC0000000001";
const ROOM_ID = "01JTESTUNREADSVCR000000001";
const MESSAGE_ID = "01JTESTUNREADSVCM000000001";
const NOW = new Date("2026-11-13T00:00:00.000Z");
const actor = { userId: USER_ID, traceId: "unit-237-unread-service" };

type Log = string[];

function channelRow(overrides: Partial<ChannelViewRow> = {}): ChannelViewRow {
  return {
    roomId: ROOM_ID,
    name: "[UNIT_TEST]未読サービス",
    description: "",
    visibility: "public",
    departmentId: null,
    purpose: "normal",
    deletedAt: null,
    joinedAt: "2026-11-09T00:00:00.000Z",
    ...overrides,
  } as ChannelViewRow;
}

type RoomState =
  | { kind: "channel"; row: ChannelViewRow }
  | { kind: "direct" }
  | { kind: "none" };

function setup(
  options: {
    room?: RoomState | RoomState[];
    advance?: () => Promise<number>;
    messageExists?: boolean;
    denied?: readonly Permission[];
  } = {},
) {
  const log: Log = [];
  const states = Array.isArray(options.room)
    ? [...options.room]
    : [options.room ?? { kind: "channel", row: channelRow() }];
  // 部屋の判定は findRoomForViewer から始まる。n 回目の判定には states[n-1]（なければ最後）を使う（④の読み直しで状態が崩れた場合を作る）
  let lookups = 0;
  const current = () => {
    const state = states[Math.min(lookups - 1, states.length - 1)];
    if (state === undefined) throw new Error("部屋の状態がありません");
    return state;
  };
  const rooms = {
    findRoomForViewer: vi.fn(async (roomId: string, userId: string) => {
      lookups += 1;
      log.push(`findRoomForViewer:${roomId}:${userId}`);
      const state = current();
      return state.kind === "channel" ? state.row : null;
    }),
    findDirectForParticipant: vi.fn(async (roomId: string, userId: string) => {
      log.push(`findDirectForParticipant:${roomId}:${userId}`);
      return current().kind === "direct" ? { partnerIsActive: true } : null;
    }),
  };

  const readPositions = {
    listUnread: vi.fn(async () => {
      log.push("listUnread");
      return { items: [{ roomId: ROOM_ID, count: 3 }], nextCursor: null };
    }),
    advance: vi.fn(
      async (input: {
        userId: string;
        roomId: string;
        messageId: string;
        now: string;
      }) => {
        log.push(
          `advance:${input.userId}:${input.roomId}:${input.messageId}:${input.now}`,
        );
        return options.advance === undefined ? 1 : options.advance();
      },
    ),
    messageExistsInRoom: vi.fn(async (roomId: string, messageId: string) => {
      log.push(`messageExistsInRoom:${roomId}:${messageId}`);
      return options.messageExists ?? true;
    }),
  };
  const denied = options.denied ?? [];
  const authorizeCalls: {
    userId: string | null;
    permission: Permission;
    scope: unknown;
  }[] = [];
  const authorizer = {
    async authorize(
      principal: Principal | null,
      permission: Permission,
      scope?: unknown,
    ): Promise<void> {
      log.push(`authorize:${permission}`);
      authorizeCalls.push({
        userId: principal?.userId ?? null,
        permission,
        scope,
      });
      if (denied.includes(permission))
        throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
    },
  };
  const service = createUnreadService(readPositions as never, rooms as never, {
    authorizer,
    now: () => NOW,
  });
  return { service, log, readPositions, rooms, authorizeCalls };
}

const codeOf = (error: unknown) =>
  error instanceof AppError ? error.code : String(error);

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

describe("#237 AC-1 list：本人の未読の一覧", () => {
  it("#237 AC-1: perm.notification.own（範囲 company）を認可してから、本人の ID で listUnread を呼び、結果をそのまま返す", async () => {
    const { service, log, readPositions, authorizeCalls } = setup();
    const page = await service.list(actor, { limit: 20 });
    expect(page).toEqual({
      items: [{ roomId: ROOM_ID, count: 3 }],
      nextCursor: null,
    });
    expect(log).toEqual(["authorize:perm.notification.own", "listUnread"]);
    expect(readPositions.listUnread).toHaveBeenCalledWith(USER_ID, {
      limit: 20,
    });
    expect(authorizeCalls).toEqual([
      {
        userId: USER_ID,
        permission: "perm.notification.own",
        scope: { type: "company" },
      },
    ]);
  });

  it("#237 AC-1: 認可が拒否なら 403 で、DB を読まない（listUnread を呼ばない）", async () => {
    const { service, readPositions } = setup({
      denied: ["perm.notification.own"],
    });
    expect(codeOf(await failure(service.list(actor, { limit: 20 })))).toBe(
      "FORBIDDEN",
    );
    expect(readPositions.listUnread).not.toHaveBeenCalled();
  });
});

describe("#237 AC-2 markRead：判定の順（部屋 → 権限 → 書き込み）", () => {
  it("#237 AC-2: 参加中のチャンネルは、部屋 → 権限 → 書き込みの順で、本人・部屋・メッセージ・現在時刻を渡す", async () => {
    const { service, log } = setup();
    await service.markRead(actor, ROOM_ID, MESSAGE_ID);
    expect(log).toEqual([
      `findRoomForViewer:${ROOM_ID}:${USER_ID}`,
      "authorize:perm.notification.own",
      `advance:${USER_ID}:${ROOM_ID}:${MESSAGE_ID}:${NOW.toISOString()}`,
    ]);
  });

  it("#237 AC-2: 当事者の DM は、チャンネルでないことを確かめてから DM として探し、権限 → 書き込み", async () => {
    const { service, log } = setup({ room: { kind: "direct" } });
    await service.markRead(actor, ROOM_ID, MESSAGE_ID);
    expect(log).toEqual([
      `findRoomForViewer:${ROOM_ID}:${USER_ID}`,
      `findDirectForParticipant:${ROOM_ID}:${USER_ID}`,
      "authorize:perm.notification.own",
      `advance:${USER_ID}:${ROOM_ID}:${MESSAGE_ID}:${NOW.toISOString()}`,
    ]);
  });

  it.each<[string, RoomState, string]>([
    ["存在しない部屋・当事者でない DM", { kind: "none" }, "NOT_FOUND"],
    [
      "非公開で未参加のチャンネル",
      {
        kind: "channel",
        row: channelRow({ visibility: "private", joinedAt: null }),
      },
      "NOT_FOUND",
    ],
    [
      "アーカイブ済みのチャンネル（参加中でも）",
      {
        kind: "channel",
        row: channelRow({ deletedAt: "2026-11-12T00:00:00.000Z" }),
      },
      "NOT_FOUND",
    ],
    [
      "公開で未参加のチャンネル（読めるが未読の対象ではない）",
      { kind: "channel", row: channelRow({ joinedAt: null }) },
      "FORBIDDEN",
    ],
  ])(
    "#237 AC-2: %s は %s で、権限の確認も書き込みもしない",
    async (_label, room, code) => {
      const { service, readPositions, authorizeCalls } = setup({ room });
      expect(
        codeOf(await failure(service.markRead(actor, ROOM_ID, MESSAGE_ID))),
      ).toBe(code);
      expect(authorizeCalls).toEqual([]);
      expect(readPositions.advance).not.toHaveBeenCalled();
    },
  );

  it("#237 AC-2: 権限の拒否は 403 で、書き込みをしない", async () => {
    const { service, readPositions } = setup({
      denied: ["perm.notification.own"],
    });
    expect(
      codeOf(await failure(service.markRead(actor, ROOM_ID, MESSAGE_ID))),
    ).toBe("FORBIDDEN");
    expect(readPositions.advance).not.toHaveBeenCalled();
  });

  it("#237 AC-2: 1行進んだら、追加の読み取りをしない", async () => {
    const { service, readPositions, rooms } = setup();
    await service.markRead(actor, ROOM_ID, MESSAGE_ID);
    expect(readPositions.messageExistsInRoom).not.toHaveBeenCalled();
    expect(rooms.findRoomForViewer).toHaveBeenCalledTimes(1);
  });
});

describe("#237 AC-2 markRead：0行のときの読み分け（もみ消さない）", () => {
  it("#237 AC-2: 部屋の状態がそのままで、メッセージがその部屋にあれば、既に同じかより新しい位置まで既読なので成功（後戻りしない）", async () => {
    const { service, log } = setup({
      advance: async () => 0,
      messageExists: true,
    });
    await expect(
      service.markRead(actor, ROOM_ID, MESSAGE_ID),
    ).resolves.toBeUndefined();
    expect(log.slice(-1)).toEqual([
      `messageExistsInRoom:${ROOM_ID}:${MESSAGE_ID}`,
    ]);
  });

  it("#237 AC-2: メッセージがその部屋にない（別の部屋・存在しない）なら 404", async () => {
    const { service } = setup({ advance: async () => 0, messageExists: false });
    expect(
      codeOf(await failure(service.markRead(actor, ROOM_ID, MESSAGE_ID))),
    ).toBe("NOT_FOUND");
  });

  it.each<[string, RoomState, string]>([
    [
      "部屋が見えなくなった（非公開で外された・アーカイブ・削除）",
      { kind: "none" },
      "NOT_FOUND",
    ],
    [
      "参加を外れた（公開チャンネル）",
      { kind: "channel", row: channelRow({ joinedAt: null }) },
      "FORBIDDEN",
    ],
  ])(
    "#237 AC-2: 書き込みの間に %s なら、読み直して %s（メッセージの確認には進まない）",
    async (_label, after, code) => {
      const { service, readPositions } = setup({
        room: [{ kind: "channel", row: channelRow() }, after],
        advance: async () => 0,
      });
      expect(
        codeOf(await failure(service.markRead(actor, ROOM_ID, MESSAGE_ID))),
      ).toBe(code);
      expect(readPositions.messageExistsInRoom).not.toHaveBeenCalled();
    },
  );

  it("#237 AC-2: 未知の DB エラーは、そのまま伝わる（AppError に変えない）", async () => {
    const dbError = new Error("D1_ERROR: テスト用の失敗");
    const { service } = setup({
      advance: async () => {
        throw dbError;
      },
    });
    expect(await failure(service.markRead(actor, ROOM_ID, MESSAGE_ID))).toBe(
      dbError,
    );
  });
});
