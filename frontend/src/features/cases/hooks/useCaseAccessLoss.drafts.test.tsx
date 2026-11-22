// #340 AC-1〜AC-5（計画 plan-340 改訂1 のテストケースの表の「フック」の行と D-3・D-4、利用者の決定 Q2・Q3）：
// S-17 で資格の喪失が「確定」したら、持ち主の、その案件の部屋の下書き（部屋への投稿と、その部屋のスレッドの返信すべて）を端末から消す。
//   消す：(b) この画面で参加者として見た後に、概要が非参加・404 になった／(a) 拒否の後の確かめで非参加・404 が確定した（表示中・画面を離れた後）。
//   消さない：(a) の確かめが 5xx・通信の失敗（Q2）／参加者のままの 403／この画面で参加者だったことを見ていない非参加（最初から非参加・古い非参加の概要）。
//   部屋の ID：詳細の channelId（roomId）が先に消えても、参加者として分かった部屋の ID（roomId か participantRoomId）で消す（計画「部屋の ID の求め方」）。
//   消せなかった（保存先を開けない・SecurityError）とき：読み込み直しの入口は先に呼ばれていて、noteDraftsRemain(持ち主の ID) を呼ぶ（Q3 の (ア)）。
//   それ以外の例外は、もみ消さない。
// 前提にした口（実装の担当へ）：
//   useCaseAccessLoss({ ..., roomId, participantRoomId }) の新しい引数 participantRoomId: string | null（参加者の概要の channelId）。
//   features/access-loss/reload-after-access-loss.ts の noteDraftsRemain(ownerId: string)（このファイルで vi.fn に差し替える）。
// キーは本番の関数を使わず、リテラルで独立に書く。データは架空（testuser_340_・[UNIT_TEST]）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  noteDraftsRemain,
  requestAccessLossReload,
} from "../../access-loss/reload-after-access-loss";
import { useCaseAccessLoss } from "./useCaseAccessLoss";

vi.mock(
  "../../access-loss/reload-after-access-loss",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    requestAccessLossReload: vi.fn(() => Promise.resolve()),
    noteDraftsRemain: vi.fn(),
  }),
);

const USER = "01JTESTUSER340000000000HK1";
const OTHER_USER = "01JTESTUSER340000000000HK2";
const CASE = "01JTESTCASE340000000000HK1";
const ROOM = "01JTESTROOM340000000000HK1";
// 部屋の ID の前方一致になるだけの別の部屋
const SIMILAR_ROOM = `${ROOM}0`;
const OTHER_ROOM = "01JTESTROOM340000000000HK2";
const P1 = "01JTESTMSG3400000000000HP1";
const P2 = "01JTESTMSG3400000000000HP2";

const SUMMARY = ["cases", "summary", USER, CASE] as const;
const TODOS = ["cases", "todos", USER, CASE] as const;

const keyOf = (userId: string, scope: string) =>
  `internal-system:draft:v1:${userId}:${scope}`;

/** 消すもの：持ち主の、この案件の部屋の投稿と、その部屋のスレッドの返信（2つ） */
const ERASED = [
  keyOf(USER, `room:${ROOM}`),
  keyOf(USER, `thread:${ROOM}:${P1}`),
  keyOf(USER, `thread:${ROOM}:${P2}`),
];
/** 残すもの：ほかの部屋・前方一致の部屋・申請・ほかの利用者の同じ部屋 */
const KEPT = [
  keyOf(USER, `room:${OTHER_ROOM}`),
  keyOf(USER, `room:${SIMILAR_ROOM}`),
  keyOf(USER, `thread:${SIMILAR_ROOM}:${P1}`),
  keyOf(USER, "case-request:new"),
  keyOf(OTHER_USER, `room:${ROOM}`),
  keyOf(OTHER_USER, `thread:${ROOM}:${P1}`),
];

function seedDrafts() {
  for (const key of [...ERASED, ...KEPT])
    window.localStorage.setItem(
      key,
      JSON.stringify({
        body: `[UNIT_TEST]340書きかけ ${key.slice(-6)}`,
        updatedAt: Date.now(),
      }),
    );
}

const present = (list: string[]) =>
  list.filter((key) => window.localStorage.getItem(key) !== null);

function expectErased() {
  expect(present(ERASED)).toEqual([]);
  expect(present(KEPT)).toEqual(KEPT);
}

function expectAllKept() {
  expect(present(ERASED)).toEqual(ERASED);
  expect(present(KEPT)).toEqual(KEPT);
}

function summary(isParticipant: boolean) {
  return {
    id: CASE,
    title: "[UNIT_TEST]340件名",
    isParticipant,
    canManage: false,
    canEditDueDate: false,
    participantCount: 2,
    lastActivityAt: isParticipant ? "2026-11-22T00:00:00.000Z" : null,
    channelId: isParticipant ? ROOM : null,
  };
}

type Answer = "participant" | "lost" | 404 | 500 | "network";

function answerOf(answer: Answer) {
  if (answer === "participant") return Promise.resolve(summary(true));
  if (answer === "lost") return Promise.resolve(summary(false));
  if (answer === "network")
    return Promise.reject(new TypeError("fetch failed"));
  return Promise.reject({ status: answer, code: "ERROR", message: "error" });
}

type Props = {
  isParticipant: boolean;
  outsider: boolean;
  roomId: string | null;
  participantRoomId: string | null;
};

class Boundary extends Component<
  { children: ReactNode; onError: (error: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function setup(
  initial: Props = {
    isParticipant: true,
    outsider: false,
    roomId: ROOM,
    participantRoomId: ROOM,
  },
) {
  const server: { answer: Answer; gate: Promise<void> | null } = {
    answer: "participant",
    gate: null,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryDefaults([...SUMMARY], {
    queryFn: async () => {
      if (server.gate !== null) await server.gate;
      return answerOf(server.answer);
    },
  });
  client.setQueryData([...SUMMARY], summary(initial.isParticipant));
  const caught: unknown[] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Boundary onError={(error) => caught.push(error)}>{children}</Boundary>
    </QueryClientProvider>
  );
  const onLost = () => undefined;
  const view = renderHook(
    (props: Props) =>
      useCaseAccessLoss({
        caseId: CASE,
        userId: USER,
        roomId: props.roomId,
        participantRoomId: props.participantRoomId,
        isParticipant: props.isParticipant,
        outsider: props.outsider,
        onLost,
      }),
    { wrapper, initialProps: initial },
  );
  return { client, server, caught, ...view };
}

/** (a) 中身（TODO の一覧）の取り直しが 403 で拒否される → 概要の確かめが始まる */
async function rejectTodos(client: QueryClient) {
  await client
    .fetchQuery({
      queryKey: [...TODOS],
      queryFn: () =>
        Promise.reject({
          status: 403,
          code: "FORBIDDEN",
          message: "forbidden",
        }),
      staleTime: 0,
    })
    .catch(() => undefined);
}

/** 確かめの結果が出るまで（概要の取得が終わるまで）待つ */
async function settleVerification(client: QueryClient) {
  await waitFor(() =>
    expect(client.isFetching({ queryKey: [...SUMMARY] })).toBe(0),
  );
  await act(async () => {
    await Promise.resolve();
  });
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

beforeEach(() => {
  seedDrafts();
  vi.mocked(requestAccessLossReload).mockClear();
  vi.mocked(noteDraftsRemain).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("#340 AC-1 (b) この画面で参加者として見た後に、概要が非参加・404 になったら、その部屋の下書きを消す", () => {
  it("#340 AC-1 (b): 概要が成功して非参加になると、持ち主の、その部屋の投稿とスレッドの返信の下書きが消える。ほかの部屋・前方一致の部屋・申請・ほかの利用者の下書きは残る", () => {
    const { rerender } = setup();
    expectAllKept();
    rerender({
      isParticipant: false,
      outsider: true,
      roomId: ROOM,
      participantRoomId: null,
    });
    expectErased();
    expect(noteDraftsRemain).not.toHaveBeenCalled();
  });

  it("#340 AC-1 (b) D-1: 詳細の部屋の ID（roomId）が一度も分からず、参加者の概要の部屋の ID（participantRoomId）だけを見ていた場合も、非参加（404 相当）で消える", () => {
    const { rerender } = setup({
      isParticipant: true,
      outsider: false,
      roomId: null,
      participantRoomId: ROOM,
    });
    rerender({
      isParticipant: false,
      outsider: true,
      roomId: null,
      participantRoomId: null,
    });
    expectErased();
  });

  it("#340 AC-1 (b) リスク2: 喪失を見る描画で、詳細の部屋の ID が先に消えていても（roomId が null）、前に分かった部屋の ID で消える", () => {
    const { rerender } = setup();
    // 詳細が先に取り除かれた描画（まだ参加者の表示）
    rerender({
      isParticipant: true,
      outsider: false,
      roomId: null,
      participantRoomId: ROOM,
    });
    expectAllKept();
    rerender({
      isParticipant: false,
      outsider: true,
      roomId: null,
      participantRoomId: null,
    });
    expectErased();
  });

  it("#340 AC-1・AC-5: 読み込み直しの入口は、下書きを消す処理より先に、持ち主の ID で呼ばれる（消した結果に関わらず、読み込み直しは止まらない）", () => {
    const { rerender } = setup();
    rerender({
      isParticipant: false,
      outsider: true,
      roomId: ROOM,
      participantRoomId: null,
    });
    expect(requestAccessLossReload).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestAccessLossReload).mock.calls[0]?.[1]).toEqual({
      ownerId: USER,
      reason: "lost",
    });
  });
});

describe("#340 AC-1 (a) 拒否の後の確かめで、非参加・404 が確定したら消す（表示中・画面を離れた後）", () => {
  it.each([
    ["非参加", "lost"],
    ["404", 404],
  ] as const)(
    "#340 AC-1 (a) 表示中: 拒否の後の確かめが%sなら、その部屋の下書きが消える",
    async (_name, answer) => {
      const { client, server } = setup();
      server.answer = answer;
      await rejectTodos(client);
      await waitFor(() => expectErased());
    },
  );

  it.each([
    ["非参加", "lost"],
    ["404", 404],
  ] as const)(
    "#340 AC-1 (a) 画面を離れた後: 確かめの途中に画面を離れ、その後に%sが届いても、その部屋の下書きが消える",
    async (_name, answer) => {
      const { client, server, unmount } = setup();
      const gate = deferred();
      server.gate = gate.promise;
      server.answer = answer;
      await rejectTodos(client);
      await waitFor(() =>
        expect(client.isFetching({ queryKey: [...SUMMARY] })).toBe(1),
      );
      unmount();
      expectAllKept();
      gate.release();
      await waitFor(() => expectErased());
    },
  );

  it("#340 AC-1 (a) 画面を離れた後 D-1: 詳細の部屋の ID が分からないまま（roomId が null）離れても、参加者の概要の部屋の ID で消える", async () => {
    const { client, server, unmount } = setup({
      isParticipant: true,
      outsider: false,
      roomId: null,
      participantRoomId: ROOM,
    });
    const gate = deferred();
    server.gate = gate.promise;
    server.answer = "lost";
    await rejectTodos(client);
    await waitFor(() =>
      expect(client.isFetching({ queryKey: [...SUMMARY] })).toBe(1),
    );
    unmount();
    gate.release();
    await waitFor(() => expectErased());
  });
});

describe("#340 AC-3 確定していない場合は消さない", () => {
  it.each([
    ["500", 500],
    ["通信の失敗", "network"],
  ] as const)(
    "#340 AC-3 Q2: 確かめが%s（確かめられない）なら、読み込み直しは求めても、下書きは残る",
    async (_name, answer) => {
      const { client, server } = setup();
      server.answer = answer;
      await rejectTodos(client);
      await settleVerification(client);
      await waitFor(() => expect(requestAccessLossReload).toHaveBeenCalled());
      expectAllKept();
    },
  );

  it.each([
    ["500", 500],
    ["通信の失敗", "network"],
  ] as const)(
    "#340 AC-3 Q2 画面を離れた後: 確かめの途中に離れ、%sが届いても、下書きは残る",
    async (_name, answer) => {
      const { client, server, unmount } = setup();
      const gate = deferred();
      server.gate = gate.promise;
      server.answer = answer;
      await rejectTodos(client);
      await waitFor(() =>
        expect(client.isFetching({ queryKey: [...SUMMARY] })).toBe(1),
      );
      unmount();
      gate.release();
      await settleVerification(client);
      await waitFor(() => expect(requestAccessLossReload).toHaveBeenCalled());
      expectAllKept();
    },
  );

  it("#340 AC-1・AC-3 Q2: 確かめが 500 で残した後、再試行で非参加が確定したら消える（読み込み直しの印とは独立）", async () => {
    const { client, server, result } = setup();
    server.answer = 500;
    await rejectTodos(client);
    await settleVerification(client);
    expectAllKept();
    server.answer = "lost";
    act(() => result.current.retry());
    await waitFor(() => expectErased());
  });

  it("#340 AC-3: 参加者のままの 403（確かめが参加者）なら、下書きは残る", async () => {
    const { client, server } = setup();
    server.answer = "participant";
    await rejectTodos(client);
    await settleVerification(client);
    expectAllKept();
  });

  it("#340 AC-3: 最初から非参加で描く（この画面で参加者だったことを見ていない）と、下書きは残る", () => {
    setup({
      isParticipant: false,
      outsider: true,
      roomId: null,
      participantRoomId: null,
    });
    expectAllKept();
  });

  it("#340 AC-3: 古い非参加の概要で描く（詳細のキャッシュから部屋の ID は分かる）と、下書きは残る。その後に参加者の概要へ戻っても残る", () => {
    const { rerender } = setup({
      isParticipant: false,
      outsider: true,
      roomId: ROOM,
      participantRoomId: null,
    });
    expectAllKept();
    rerender({
      isParticipant: true,
      outsider: false,
      roomId: ROOM,
      participantRoomId: ROOM,
    });
    expectAllKept();
  });

  it("#340 AC-3: 部屋の ID が一度も分からないまま非参加になっても、例外にならず、何も消さない", () => {
    const { rerender, caught } = setup({
      isParticipant: true,
      outsider: false,
      roomId: null,
      participantRoomId: null,
    });
    rerender({
      isParticipant: false,
      outsider: true,
      roomId: null,
      participantRoomId: null,
    });
    expect(caught).toEqual([]);
    expectAllKept();
  });
});

describe("#340 AC-2 利用者が替わっても、前の利用者の処理は、ほかの利用者の下書きに触れない", () => {
  it("#340 AC-2: 持ち主で確かめを始め、応答の前に画面を離れて（別の利用者に替わる経路）非参加が確定しても、消えるのは持ち主の下書きだけ。ほかの利用者の同じ部屋の下書きは残る", async () => {
    const { client, server, unmount } = setup();
    const gate = deferred();
    server.gate = gate.promise;
    server.answer = "lost";
    await rejectTodos(client);
    await waitFor(() =>
      expect(client.isFetching({ queryKey: [...SUMMARY] })).toBe(1),
    );
    unmount();
    // 別の利用者がログインして、同じ部屋に書いた
    window.localStorage.setItem(
      keyOf(OTHER_USER, `thread:${ROOM}:${P2}`),
      JSON.stringify({
        body: "[UNIT_TEST]340後の利用者",
        updatedAt: Date.now(),
      }),
    );
    gate.release();
    await waitFor(() => expectErased());
    expect(
      window.localStorage.getItem(keyOf(OTHER_USER, `thread:${ROOM}:${P2}`)),
    ).not.toBeNull();
  });
});

describe("#340 AC-5 消せなかった場合（D-3・D-4、Q3 の (ア)）", () => {
  function failDraftRemoval(error: unknown) {
    const original = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (
        this === window.localStorage &&
        key.startsWith("internal-system:draft:")
      )
        throw error;
      original.call(this, key);
    });
  }

  it("#340 AC-5 D-3 (b): 保存した後、削除だけが SecurityError になると、例外にならず、入口が先に呼ばれ、noteDraftsRemain が持ち主の ID で呼ばれる。下書きは残っている", () => {
    const { rerender, caught } = setup();
    failDraftRemoval(new DOMException("denied", "SecurityError"));
    rerender({
      isParticipant: false,
      outsider: true,
      roomId: ROOM,
      participantRoomId: null,
    });
    expect(caught).toEqual([]);
    expect(requestAccessLossReload).toHaveBeenCalledTimes(1);
    expect(noteDraftsRemain).toHaveBeenCalledWith(USER);
    const requestOrder =
      vi.mocked(requestAccessLossReload).mock.invocationCallOrder[0] ?? 0;
    const noteOrder =
      vi.mocked(noteDraftsRemain).mock.invocationCallOrder[0] ?? 0;
    expect(requestOrder).toBeLessThan(noteOrder);
    expect(present(ERASED).length).toBeGreaterThan(0);
  });

  it("#340 AC-5 D-3 (a) 画面を離れた後: 削除が SecurityError でも、入口は呼ばれ、noteDraftsRemain が持ち主の ID で呼ばれる", async () => {
    const { client, server, unmount } = setup();
    const gate = deferred();
    server.gate = gate.promise;
    server.answer = "lost";
    await rejectTodos(client);
    await waitFor(() =>
      expect(client.isFetching({ queryKey: [...SUMMARY] })).toBe(1),
    );
    unmount();
    failDraftRemoval(new DOMException("denied", "SecurityError"));
    gate.release();
    await waitFor(() => expect(noteDraftsRemain).toHaveBeenCalledWith(USER));
    expect(requestAccessLossReload).toHaveBeenCalled();
  });

  it("#340 AC-5 D-4: 保存先を開けない（localStorage の参照が SecurityError）環境で喪失が確定しても、例外にならず、入口が呼ばれ、noteDraftsRemain が持ち主の ID で呼ばれる", () => {
    const { rerender, caught } = setup();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    rerender({
      isParticipant: false,
      outsider: true,
      roomId: ROOM,
      participantRoomId: null,
    });
    expect(caught).toEqual([]);
    expect(requestAccessLossReload).toHaveBeenCalledTimes(1);
    expect(noteDraftsRemain).toHaveBeenCalledWith(USER);
  });

  it("#340 AC-5: 想定外の例外（TypeError）は、もみ消されずに伝わる。そのときも、入口は先に呼ばれている", () => {
    const { rerender, caught } = setup();
    const unexpected = new TypeError("[UNIT_TEST]340想定外");
    failDraftRemoval(unexpected);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rerender({
      isParticipant: false,
      outsider: true,
      roomId: ROOM,
      participantRoomId: null,
    });
    expect(caught).toContain(unexpected);
    expect(requestAccessLossReload).toHaveBeenCalledTimes(1);
    expect(noteDraftsRemain).not.toHaveBeenCalled();
  });
});
