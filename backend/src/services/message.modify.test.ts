// #134 AC-1（1-3 AC-1〜AC-6）: メッセージの編集・削除の Service（message.service.ts の edit・remove）の判定の順と再認証を、
// 偽の Repository（DB を使わない）と偽の authorizer（dm-fixtures の fakeAuthorizer）で確かめる。
// 判定の順（計画「計画で決めた点」2・3、改訂1 指摘4。この順を変えない）：
//   ① メッセージがあり部屋が見えるか（チャンネルは canViewChannel、DM は当事者と perm.dm.message.view。見えなければ 404。存在しない場合と区別しない）
//   ② 本人の投稿か（違えば 403。logger.audit に拒否を記録）
//   ③ authorize（編集は perm.message.edit.own、削除は perm.message.delete.own）
//   ④ 削除済みなら 409
//   ⑤ 部屋の状態（チャンネルの未参加は 403、部署が無効は 409、DM の相手が無効は 409）。アーカイブは①で 404
//   ⑥ （削除だけ）再認証（なし・5分以上前は 403 REAUTH_REQUIRED）
//   ⑦ 条件付きの書き込み。0 行なら①〜⑤を読み直して 404・403・409 に分け、原因が分からなければ 409
//
// 実装が前提とする約束（このテストが固定する。計画「変更するファイル」）：
//   createMessageService(repository, { authorizer, now?: () => Date })  … now は省略時 new Date()
//   MessageActor に reauthenticatedAt?: string | null を足す（Route は principal.reauthenticatedAt を渡す）
//   service.edit(actor, messageId, body): Promise<{ id: string; body: string; editedAt: string }>  … editedAt は now() の ISO 文字列
//   service.remove(actor, messageId): Promise<void>
//   repository.findForModification(messageId): Promise<{ id; roomId; senderId; deletedAt: string | null } | null>
//   repository.isDepartmentActive(departmentId): Promise<boolean>
//   repository.updateBodyIfModifiable({ messageId, userId, body, editedAt }): Promise<number>  … 更新した行数（1 か 0）
//   repository.deleteIfModifiable({ messageId, userId, roomId, deletedAt, traceId }): Promise<number>  … 削除（と監査）の batch。削除した行数
//   既存の findRoomForViewer・findDirectForParticipant で部屋を読む。
// データは架空（testuser_ を名乗る ID、[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import {
  REAUTH_WINDOW_MS,
  failureAuditLines,
} from "../../test/message-modify-fixtures";
import type { MessageRepository } from "../db/message.repository";
import type { Permission } from "../lib/permissions";
import { createMessageService } from "./message.service";

const NOW = new Date("2026-11-14T03:00:00.000Z");
const AUTHOR = "01JTESTUSERAUTHOR000000000";
const OTHER = "01JTESTUSEROTHER0000000000";
const ROOM = "01JTESTROOM000000000000000";
const DEPT = "01JTESTDEPT000000000000000";
const MESSAGE = "01JTESTMESSAGE000000000000";
const BODY = "[UNIT_TEST]直した本文";
const TRACE = "unit-134-modify";

type ChannelState = {
  roomId: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  departmentId: string | null;
  purpose: "normal" | "department" | "announcement" | "company_general";
  deletedAt: string | null;
  joinedAt: string | null;
};

type State = {
  message: {
    id: string;
    roomId: string;
    senderId: string;
    deletedAt: string | null;
  } | null;
  channel: ChannelState | null;
  direct: { partnerIsActive: boolean } | null;
  departmentActive: boolean;
  /** 書き込みが返す行数 */
  writeResult: number;
  /** 書き込みの直前に状態を変える（確認から書き込みまでの間の変化） */
  beforeWrite?: (state: State) => void;
};

function channel(overrides: Partial<ChannelState> = {}): ChannelState {
  return {
    roomId: ROOM,
    name: "[UNIT_TEST]チャンネル",
    description: "",
    visibility: "public",
    departmentId: DEPT,
    purpose: "department",
    deletedAt: null,
    joinedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseState(overrides: Partial<State> = {}): State {
  return {
    message: { id: MESSAGE, roomId: ROOM, senderId: AUTHOR, deletedAt: null },
    channel: channel(),
    direct: null,
    departmentActive: true,
    writeResult: 1,
    ...overrides,
  };
}

/** DM の部屋（チャンネルとしては見つからず、当事者として見つかる） */
function directState(partnerIsActive = true): Partial<State> {
  return { channel: null, direct: { partnerIsActive } };
}

/** 偽の Repository。呼ばれた操作を順に記録する */
function fakeRepository(state: State) {
  const calls: string[] = [];
  const writes: Record<string, unknown>[] = [];
  const write = (name: string) => async (input: Record<string, unknown>) => {
    calls.push(name);
    state.beforeWrite?.(state);
    writes.push(input);
    return state.writeResult;
  };
  const repository = {
    findForModification: async (messageId: string) => {
      calls.push("findForModification");
      return state.message !== null && state.message.id === messageId
        ? { ...state.message }
        : null;
    },
    findRoomForViewer: async () => {
      calls.push("findRoomForViewer");
      return state.channel === null ? null : { ...state.channel };
    },
    findDirectForParticipant: async () => {
      calls.push("findDirectForParticipant");
      return state.direct === null ? null : { ...state.direct };
    },
    isDepartmentActive: async () => {
      calls.push("isDepartmentActive");
      return state.departmentActive;
    },
    updateBodyIfModifiable: write("updateBodyIfModifiable"),
    deleteIfModifiable: write("deleteIfModifiable"),
  };
  return {
    repository: repository as unknown as MessageRepository,
    calls,
    writes,
  };
}

const reauthAgo = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

type Outcome = {
  value: unknown;
  error: unknown;
  calls: string[];
  writes: Record<string, unknown>[];
  permissions: Permission[];
};

async function run(
  operation: "edit" | "remove",
  state: State,
  options: {
    userId?: string;
    reauthenticatedAt?: string | null;
    denied?: readonly Permission[];
    messageId?: string;
  } = {},
): Promise<Outcome> {
  const { repository, calls, writes } = fakeRepository(state);
  const authorizer = fakeAuthorizer(options.denied ?? []);
  const service = createMessageService(repository, {
    authorizer,
    now: () => NOW,
  });
  const actor = {
    userId: options.userId ?? AUTHOR,
    traceId: TRACE,
    reauthenticatedAt:
      options.reauthenticatedAt === undefined
        ? reauthAgo(60_000)
        : options.reauthenticatedAt,
  };
  const messageId = options.messageId ?? MESSAGE;
  const promise =
    operation === "edit"
      ? service.edit(actor, messageId, BODY)
      : service.remove(actor, messageId);
  const settled = await promise.then(
    (value: unknown) => ({ value, error: null as unknown }),
    (error: unknown) => ({ value: null, error }),
  );
  return {
    ...settled,
    calls,
    writes,
    permissions: authorizer.calls.map((call) => call.permission),
  };
}

const wrote = (outcome: Outcome) =>
  outcome.calls.some(
    (name) =>
      name === "updateBodyIfModifiable" || name === "deleteIfModifiable",
  );

let logLines: string[];

beforeEach(() => {
  logLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const OPERATIONS = ["edit", "remove"] as const;

describe("#134 AC-1 成功（⑦の書き込みまで進む）", () => {
  it("#134 AC-1（1-3 AC-1）: 本人の編集は perm.message.edit.own を判定し、{ messageId, userId, body, editedAt } で書き込み、{ id, body, editedAt } を返す", async () => {
    const outcome = await run("edit", baseState());
    expect(outcome.error).toBeNull();
    expect(outcome.value).toEqual({
      id: MESSAGE,
      body: BODY,
      editedAt: NOW.toISOString(),
    });
    expect(outcome.permissions).toContain("perm.message.edit.own");
    expect(outcome.writes).toEqual([
      expect.objectContaining({
        messageId: MESSAGE,
        userId: AUTHOR,
        body: BODY,
        editedAt: NOW.toISOString(),
      }),
    ]);
  });

  it("#134 AC-1（1-3 AC-1・AC-4）: 本人の削除は perm.message.delete.own を判定し、{ messageId, userId, roomId, deletedAt, traceId } で書き込み、値を返さない", async () => {
    const outcome = await run("remove", baseState());
    expect(outcome.error).toBeNull();
    expect(outcome.value).toBeUndefined();
    expect(outcome.permissions).toContain("perm.message.delete.own");
    expect(outcome.writes).toEqual([
      expect.objectContaining({
        messageId: MESSAGE,
        userId: AUTHOR,
        roomId: ROOM,
        deletedAt: NOW.toISOString(),
        traceId: TRACE,
      }),
    ]);
  });

  it.each(OPERATIONS)(
    "#134 AC-1（1-3 AC-1）: DM の当事者の %s は perm.dm.message.view を判定して進み、書き込む",
    async (operation) => {
      const outcome = await run(operation, baseState(directState()));
      expect(outcome.error).toBeNull();
      expect(outcome.permissions).toContain("perm.dm.message.view");
      expect(wrote(outcome)).toBe(true);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（U-9）: 部署のない会社直属のチャンネルの %s は、部署の有効・無効を問わずに進む",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({
          channel: channel({ departmentId: null, purpose: "company_general" }),
          departmentActive: false,
        }),
      );
      expect(outcome.error).toBeNull();
      expect(wrote(outcome)).toBe(true);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（1-3 AC-5・U-3）: お知らせ専用の %s は、perm.announcement.post を求めない（拒否されていても本人の投稿なら進む）",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({ channel: channel({ purpose: "announcement" }) }),
        { denied: ["perm.announcement.post"] },
      );
      expect(outcome.error).toBeNull();
      expect(wrote(outcome)).toBe(true);
    },
  );
});

describe("#134 AC-1 ① 見えなければ 404（存在しない場合と区別しない）", () => {
  it.each(OPERATIONS)(
    "#134 AC-1: 存在しないメッセージの %s は 404 で、権限の判定・書き込みに進まない",
    async (operation) => {
      const outcome = await run(operation, baseState({ message: null }), {
        reauthenticatedAt: null,
      });
      expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(outcome.permissions).toEqual([]);
      expect(wrote(outcome)).toBe(false);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（判定の順 ①→②）: 非公開で未参加のチャンネルの他人の投稿の %s は、403 ではなく 404",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({
          channel: channel({ visibility: "private", joinedAt: null }),
        }),
        { userId: OTHER },
      );
      expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(failureAuditLines(logLines)).toEqual([]);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（改訂1 指摘4）: アーカイブ済みのチャンネルの本人の投稿の %s は、409 ではなく 404",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({
          channel: channel({ deletedAt: "2026-11-10T00:00:00.000Z" }),
        }),
      );
      expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(wrote(outcome)).toBe(false);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1: 当事者でない DM の %s は 404 で、権限の判定に進まない",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({ channel: null, direct: null }),
      );
      expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(outcome.permissions).toEqual([]);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1: DM の perm.dm.message.view が拒否されれば、本人の投稿の %s も 403 で書き込まない",
    async (operation) => {
      const outcome = await run(operation, baseState(directState()), {
        denied: ["perm.dm.message.view"],
      });
      expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(wrote(outcome)).toBe(false);
    },
  );
});

describe("#134 AC-1（1-3 AC-2・AC-4）② 本人の投稿でなければ 403", () => {
  it.each(OPERATIONS)(
    "#134 AC-1: 他人の投稿の %s は 403 FORBIDDEN で、拒否を logger.audit に記録し（対象はメッセージ、本文は出さない）、書き込まない",
    async (operation) => {
      const outcome = await run(operation, baseState(), { userId: OTHER });
      expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(wrote(outcome)).toBe(false);
      const denied = failureAuditLines(logLines);
      expect(
        denied.some((line) => line.attributes?.target === MESSAGE),
        JSON.stringify(denied),
      ).toBe(true);
      expect(JSON.stringify(denied)).not.toContain(BODY);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（判定の順 ②→③）: 他人の投稿の %s では、本人の投稿の権限（*.own）の判定に進まない",
    async (operation) => {
      const outcome = await run(operation, baseState(), { userId: OTHER });
      expect(outcome.permissions).not.toContain("perm.message.edit.own");
      expect(outcome.permissions).not.toContain("perm.message.delete.own");
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（判定の順 ②→④）: 他人の削除済みの投稿の %s は、409 ではなく 403",
    async (operation) => {
      const state = baseState();
      if (state.message !== null)
        state.message.deletedAt = "2026-11-13T00:00:00.000Z";
      const outcome = await run(operation, state, { userId: OTHER });
      expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（判定の順 ②→⑤）: 部署が無効のチャンネルの他人の投稿の %s は、409 ではなく 403",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({ departmentActive: false }),
        { userId: OTHER },
      );
      expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    },
  );

  it("#134 AC-1（判定の順 ②→⑥・1-3 AC-4）: 他人の投稿の削除は、再認証がなくても REAUTH_REQUIRED ではなく FORBIDDEN（断られる操作でパスワードを入力させない）", async () => {
    const outcome = await run("remove", baseState(), {
      userId: OTHER,
      reauthenticatedAt: null,
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});

describe("#134 AC-1 ③ 権限（perm.message.edit.own／perm.message.delete.own）", () => {
  it("#134 AC-1（R-26）: perm.message.edit.own が拒否されれば、本人の編集も 403 で書き込まない", async () => {
    const outcome = await run("edit", baseState(), {
      denied: ["perm.message.edit.own"],
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(wrote(outcome)).toBe(false);
  });

  it("#134 AC-1（R-28・判定の順 ③→⑥）: perm.message.delete.own が拒否されれば、再認証がなくても REAUTH_REQUIRED ではなく 403 FORBIDDEN（未認可なら再認証を求めない）", async () => {
    const outcome = await run("remove", baseState(), {
      denied: ["perm.message.delete.own"],
      reauthenticatedAt: null,
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(wrote(outcome)).toBe(false);
  });

  it("#134 AC-1（判定の順 ③→④）: perm.message.edit.own が拒否されれば、削除済みの本人の投稿でも 409 ではなく 403", async () => {
    const state = baseState();
    if (state.message !== null)
      state.message.deletedAt = "2026-11-13T00:00:00.000Z";
    const outcome = await run("edit", state, {
      denied: ["perm.message.edit.own"],
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});

describe("#134 AC-1 ④ 削除済みなら 409", () => {
  it.each(OPERATIONS)(
    "#134 AC-1（計画 5）: 削除済みの本人の投稿の %s は 409 CONFLICT で書き込まない",
    async (operation) => {
      const state = baseState();
      if (state.message !== null)
        state.message.deletedAt = "2026-11-13T00:00:00.000Z";
      const outcome = await run(operation, state);
      expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
      expect(wrote(outcome)).toBe(false);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（判定の順 ④→⑤）: 削除済みの本人の投稿の %s は、公開チャンネルを抜けていても 403 ではなく 409",
    async (operation) => {
      const state = baseState({ channel: channel({ joinedAt: null }) });
      if (state.message !== null)
        state.message.deletedAt = "2026-11-13T00:00:00.000Z";
      const outcome = await run(operation, state);
      expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
    },
  );

  it("#134 AC-1（判定の順 ④→⑥）: 削除済みの本人の投稿の削除は、再認証がなくても REAUTH_REQUIRED ではなく 409", async () => {
    const state = baseState();
    if (state.message !== null)
      state.message.deletedAt = "2026-11-13T00:00:00.000Z";
    const outcome = await run("remove", state, { reauthenticatedAt: null });
    expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
  });
});

describe("#134 AC-1（1-3 AC-6・U-3・U-9）⑤ 部屋の状態", () => {
  it.each(OPERATIONS)(
    "#134 AC-1（U-3）: 公開チャンネルを抜けた本人の %s は 403 FORBIDDEN で書き込まない",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({ channel: channel({ joinedAt: null }) }),
      );
      expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(wrote(outcome)).toBe(false);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（1-3 AC-6・U-9）: 部署が無効のチャンネルの本人の %s は 409 CONFLICT で書き込まない",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({ departmentActive: false }),
      );
      expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
      expect(wrote(outcome)).toBe(false);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（U-3・C-168(2)）: DM の相手が無効なら、本人の %s は 409 CONFLICT で書き込まない",
    async (operation) => {
      const outcome = await run(operation, baseState(directState(false)));
      expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
      expect(wrote(outcome)).toBe(false);
    },
  );

  it("#134 AC-1（判定の順 ⑤→⑥）: 部署が無効のチャンネルの削除は、再認証がなくても REAUTH_REQUIRED ではなく 409", async () => {
    const outcome = await run(
      "remove",
      baseState({ departmentActive: false }),
      {
        reauthenticatedAt: null,
      },
    );
    expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("#134 AC-1（判定の順 ⑤→⑥）: 公開チャンネルを抜けた本人の削除は、再認証がなくても REAUTH_REQUIRED ではなく FORBIDDEN", async () => {
    const outcome = await run(
      "remove",
      baseState({ channel: channel({ joinedAt: null }) }),
      { reauthenticatedAt: null },
    );
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});

describe("#134 AC-1（1-3 AC-4）⑥ 削除の再認証（0-5。5分）", () => {
  it.each([
    ["再認証なし（null）", null],
    ["ちょうど5分前", reauthAgo(REAUTH_WINDOW_MS)],
    ["5分と1ミリ秒前", reauthAgo(REAUTH_WINDOW_MS + 1)],
    ["1時間前", reauthAgo(60 * 60 * 1000)],
    ["未来の時刻", reauthAgo(-60_000)],
    ["形の壊れた値", "2026-11-14"],
  ])(
    "#134 AC-1（1-3 AC-4）: 再認証が%sの削除は 403 REAUTH_REQUIRED で書き込まない",
    async (_label, reauthenticatedAt) => {
      const outcome = await run("remove", baseState(), { reauthenticatedAt });
      expect(outcome.error).toMatchObject({
        code: "REAUTH_REQUIRED",
        status: 403,
      });
      expect(wrote(outcome)).toBe(false);
    },
  );

  it.each([
    ["4分59.999秒前", reauthAgo(REAUTH_WINDOW_MS - 1)],
    ["1分前", reauthAgo(60_000)],
    ["今", NOW.toISOString()],
  ])(
    "#134 AC-1（1-3 AC-4）: 再認証が%sなら削除は書き込みまで進む",
    async (_label, reauthenticatedAt) => {
      const outcome = await run("remove", baseState(), { reauthenticatedAt });
      expect(outcome.error).toBeNull();
      expect(wrote(outcome)).toBe(true);
    },
  );

  it("#134 AC-1（1-3 AC-1）: 編集は再認証を求めない（再認証なしでも書き込む）", async () => {
    const outcome = await run("edit", baseState(), { reauthenticatedAt: null });
    expect(outcome.error).toBeNull();
    expect(wrote(outcome)).toBe(true);
  });
});

describe("#134 共通 ⑦ 書き込みが 0 行のとき、読み直して原因に合う応答にする（計画 3）", () => {
  it.each(OPERATIONS)(
    "#134 AC-1: %s の書き込みの直前に削除された（別のタブ）なら 409 CONFLICT",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({
          writeResult: 0,
          beforeWrite: (state) => {
            if (state.message !== null)
              state.message.deletedAt = NOW.toISOString();
          },
        }),
      );
      expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（改訂1 指摘4）: %s の書き込みの直前にアーカイブされたら 404 NOT_FOUND",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({
          writeResult: 0,
          beforeWrite: (state) => {
            if (state.channel !== null)
              state.channel.deletedAt = NOW.toISOString();
          },
        }),
      );
      expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（U-3）: %s の書き込みの直前に公開チャンネルを抜けたら 403 FORBIDDEN",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({
          writeResult: 0,
          beforeWrite: (state) => {
            if (state.channel !== null) state.channel.joinedAt = null;
          },
        }),
      );
      expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1（U-9）: %s の書き込みの直前に部署が無効になったら 409 CONFLICT",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({
          writeResult: 0,
          beforeWrite: (state) => {
            state.departmentActive = false;
          },
        }),
      );
      expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1: %s の書き込みが 0 行で、読み直しても原因が分からなければ 409 CONFLICT（成功にしない）",
    async (operation) => {
      const outcome = await run(operation, baseState({ writeResult: 0 }));
      expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1: %s の書き込みが 0 行のとき、書き込みをやり直さない（1回だけ）",
    async (operation) => {
      const outcome = await run(operation, baseState({ writeResult: 0 }));
      expect(outcome.writes).toHaveLength(1);
    },
  );
});

describe("#134 AC-1（U-3）未参加の拒否を監査に残す（コードレビューの指摘）", () => {
  const ACTION = { edit: "message.edit", remove: "message.delete" } as const;

  /** このメッセージを対象にした、未参加による拒否の監査 */
  const notMemberAudits = () =>
    failureAuditLines(logLines).filter(
      (line) =>
        line.attributes?.target === MESSAGE &&
        line.attributes.reason === "not_member",
    );

  function expectNotMemberAudit(operation: "edit" | "remove") {
    const denied = notMemberAudits();
    expect(denied, JSON.stringify(failureAuditLines(logLines))).toHaveLength(1);
    const [line] = denied;
    expect(line?.body).toBe(ACTION[operation]);
    expect((line as { user_id?: string } | undefined)?.user_id).toBe(AUTHOR);
    expect(line?.attributes).toMatchObject({
      log_type: "audit",
      result: "failure",
      target: MESSAGE,
      reason: "not_member",
    });
    expect(JSON.stringify(denied)).not.toContain(BODY);
  }

  it.each(OPERATIONS)(
    "#134 AC-1（判定⑤）: 公開チャンネルを抜けた本人の %s の 403 は、logger.audit に拒否を1件記録する（操作・利用者・対象・理由。本文は出さない）",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({ channel: channel({ joinedAt: null }) }),
      );
      expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
      expectNotMemberAudit(operation);
    },
  );

  it("#134 AC-1（判定⑤→⑥）: 再認証のない削除でも、公開チャンネルを抜けた本人の 403 は監査に残る", async () => {
    const outcome = await run(
      "remove",
      baseState({ channel: channel({ joinedAt: null }) }),
      { reauthenticatedAt: null },
    );
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expectNotMemberAudit("remove");
  });

  it.each(OPERATIONS)(
    "#134 AC-1（判定⑦）: %s の書き込みが 0 行で、読み直して未参加と分かった 403 も、logger.audit に拒否を1件記録する",
    async (operation) => {
      const outcome = await run(
        operation,
        baseState({
          writeResult: 0,
          beforeWrite: (state) => {
            if (state.channel !== null) state.channel.joinedAt = null;
          },
        }),
      );
      expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
      expectNotMemberAudit(operation);
    },
  );

  it.each(OPERATIONS)(
    "#134 AC-1: 参加中の本人の %s が成功したときは、拒否の監査を残さない（対照）",
    async (operation) => {
      const outcome = await run(operation, baseState());
      expect(outcome.error).toBeNull();
      expect(failureAuditLines(logLines)).toEqual([]);
    },
  );
});
