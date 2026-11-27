// #284 AC-1・AC-2（計画 plan-284 の 10 の画面 T10〜T15・T22〜T25）：同じタブで利用者が A から B に替わっても、A の本人・参加者限定のデータ・入力を、
// どの描画の確定でも出さない。同じ利用者（A）の再ログインでは、キャッシュ・入力を残す（0-2 AC-8 の #120 の読み方）。
// 枠：test/user-switch-harness.tsx（main.tsx と同じ組み立て。データルーター・離脱の確認・401 の処理・切り替えの見張り）。
// 描画の確かめ方：App 全体を Profiler で包み、確定ごとに本文・入力欄の値・aria-label に A の識別の文字列がないかを記録する（test/render-watch.tsx）。
// 切り替えの経路：(i) セッションを直接 B で上書き／(ii) セッションを捨ててから B を入れる／(iii) 実際の取り直し（GET /auth/session が B を返す）。
// B の応答は手で解決する Promise で保留する（固定の時間の待ちは使わない）。範囲外：進行中の操作（#300）・別のタブ（#298）。
// データはすべて架空。A・B の識別の文字列は互いに部分一致しない。
// 【#298（C-209・ADR-0035）の追記】同じタブで別の利用者に替わったら、ページごと読み込み直す（その場の作り直しを置き換える）。
// 枠（user-switch-harness）は main.tsx と同じく、切り替えの読み込み直しの入口 requestUserSwitchReload（test/setup.ts で vi.fn に差し替え）を見張りに渡す。
// T11・T13・T22・T25 に「別の利用者に替わった時点で、読み込み直しが1回求められる」を足した（計画 plan-298 の 8-2・既定の方針2）。
// 「A の内容がどの確定にも出ない」の確かめは、読み込み直すまでの二重の守りとして、そのまま残す。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse, type HttpResponseResolver } from "msw";
import { useState, useSyncExternalStore, memo } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUserSwitchReload } from "./features/access-loss/reload-after-access-loss";
import { authKeys } from "./features/auth";
import { fetchSession } from "./features/auth/api/auth-api";
import { installDomStubs, type DomStubs } from "./test/app-shell-harness";
import { TEST_PASSWORD, respondPublicStatus } from "./test/auth-handlers";
import { dmDetail, dmItem, dmRoomId } from "./test/dm-handlers";
import { message, reply, type TestMessage } from "./test/message-handlers";
import { createRenderWatch } from "./test/render-watch";
import { server } from "./test/server";
import { threadItem } from "./test/thread-handlers";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "./test/user-switch-harness";

const USER_A = {
  id: "01JTEST284SESSA00000000001",
  displayName: "testuser_284_a",
  loginId: "testuser_284_a",
};
const USER_B = {
  id: "01JTEST284SESSB00000000001",
  displayName: "testuser_284_b",
  loginId: "testuser_284_b",
};
type TestUser = typeof USER_A;

const A_MARK = "[E2E_TEST]284A";
const B_MARK = "[E2E_TEST]284B";
const markOf = (user: TestUser) => (user === USER_A ? A_MARK : B_MARK);

const CHANNEL_ID = "01JTEST284CHANA00000000001";
const PARENT_ID = message(1).id;
const DM_ROOM_ID = dmRoomId(1);
/** 未読の件数（A と B で違う値。読み上げの名前・本文の「未読 n件」で探す） */
const UNREAD = {
  notifications: { a: 73, b: 5 },
  room: { a: 74, b: 2 },
} as const;

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function sessionOf(user: TestUser, mustChangePassword = false) {
  return {
    user,
    permissions: [],
    mustChangePassword,
    reauthenticatedAt: null,
  };
}

/**
 * 模擬のサーバー。いまの利用者（user）に合わせて、その利用者のデータを返す（user が null なら 401）。
 * hold を置くと、セッション以外の応答をその Promise が解けるまで保留する。sessionHold はセッションの取得だけを保留する。
 * セッションの取得は、要求を受けた時点の利用者（その時点の Cookie に当たる）を覚え、保留が解けたときにその利用者を返す（sessionServed に記録する）。
 */
type World = {
  user: TestUser | null;
  mustChangePassword: boolean;
  hold: Promise<void> | null;
  sessionHold: Promise<void> | null;
  /** 返したセッションの応答（保留したかどうかと、返した利用者） */
  sessionServed: { held: boolean; userId: string | null }[];
  /** 保留中のセッションの取得の数 */
  sessionHeld: number;
  /** 届いた要求のパス（セッションを除く） */
  requests: string[];
};

function unauthenticated() {
  return HttpResponse.json(
    { code: "UNAUTHENTICATED", message: "ログインしてください" },
    { status: 401 },
  );
}

function roomMessage(user: TestUser): TestMessage {
  return message(1, {
    body: `${markOf(user)}の本文`,
    roomId: CHANNEL_ID,
    replyCount: 1,
    author: { id: user.id, displayName: user.displayName },
  });
}

function respondWorld(initialUser: TestUser | null): World {
  const world: World = {
    user: initialUser,
    mustChangePassword: false,
    hold: null,
    sessionHold: null,
    sessionServed: [],
    sessionHeld: 0,
    requests: [],
  };
  // ログイン画面の部品（サーバーの状態・初回セットアップへのリンク）の応答
  respondPublicStatus();
  /** セッション以外の応答の共通：記録し、保留があれば待ち、いまの利用者のデータを作る */
  const serve =
    (
      make: (user: TestUser, params: Record<string, string>) => unknown,
    ): HttpResponseResolver =>
    async ({ request, params }) => {
      world.requests.push(new URL(request.url).pathname);
      const hold = world.hold;
      if (hold !== null) await hold;
      const user = world.user;
      if (user === null) return unauthenticated();
      const plain = Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      );
      const body = make(user, plain);
      if (body === null) return new HttpResponse(null, { status: 204 });
      return HttpResponse.json(body);
    };

  server.use(
    http.get("/api/auth/session", async () => {
      // 要求を受けた時点の利用者と保留を覚える（後から world を替えても、この要求の応答は変わらない）
      const user = world.user;
      const hold = world.sessionHold;
      if (hold !== null) {
        world.sessionHeld += 1;
        await hold;
        world.sessionHeld -= 1;
      }
      world.sessionServed.push({
        held: hold !== null,
        userId: user?.id ?? null,
      });
      if (user === null) return unauthenticated();
      return HttpResponse.json(sessionOf(user, world.mustChangePassword));
    }),
    http.get(
      "/api/channels",
      serve((user) => ({
        items: [
          {
            id: CHANNEL_ID,
            roomId: CHANNEL_ID,
            name: `${markOf(user)}の部屋`,
            visibility: "public",
            departmentId: null,
            departmentName: null,
            joined: true,
          },
        ],
        nextCursor: null,
      })),
    ),
    http.get(
      "/api/channels/:channelId",
      serve((user, params) => ({
        id: params.channelId,
        roomId: params.channelId,
        name: `${markOf(user)}の部屋`,
        description: `${markOf(user)}の説明`,
        visibility: "public",
        departmentId: null,
        isCaseChannel: false,
        caseId: null,
        version: 1,
        manage: {
          canRename: false,
          canEditDescription: false,
          canArchive: false,
        },
        readOnly: false,
        joined: true,
        canPost: true,
        memberCount: 1,
        members: [{ id: user.id, displayName: user.displayName }],
      })),
    ),
    http.get("/api/rooms/:roomId/messages", async (info) => {
      const after = new URL(info.request.url).searchParams.get("after");
      return serve((user) =>
        after === null
          ? { items: [roomMessage(user)], nextCursor: null, hasMore: false }
          : { items: [], nextCursor: null, hasMore: false },
      )(info);
    }),
    http.put(
      "/api/rooms/:roomId/read-position",
      serve(() => null),
    ),
    http.get("/api/messages/:messageId/replies", async (info) => {
      const after = new URL(info.request.url).searchParams.get("after");
      return serve((user) => {
        const parent = roomMessage(user);
        const replies =
          after === null
            ? [
                reply(parent, 1, {
                  body: `${markOf(user)}の返信`,
                  author: { id: user.id, displayName: user.displayName },
                }),
              ]
            : [];
        return {
          items: replies,
          nextCursor: null,
          hasMore: false,
          parent,
          replyBlockedReason: null,
          caseRoom: false,
          caseId: null,
          joined: true,
          roomWritable: true,
        };
      })(info);
    }),
    http.put(
      "/api/messages/:messageId/thread-read-position",
      serve(() => null),
    ),
    http.get(
      "/api/me/threads",
      serve((user) => ({
        items: [
          threadItem(1, {
            parent: { body: `${markOf(user)}の親` },
            room: {
              kind: "channel",
              id: CHANNEL_ID,
              name: `${markOf(user)}の部屋`,
            },
          }),
        ],
        nextCursor: null,
      })),
    ),
    http.get(
      "/api/me/notifications/unread-count",
      serve((user) => ({
        count:
          user === USER_A ? UNREAD.notifications.a : UNREAD.notifications.b,
      })),
    ),
    http.get(
      "/api/me/notifications",
      serve(() => ({ items: [], nextCursor: null })),
    ),
    http.get(
      "/api/me/unread",
      serve((user) => ({
        items: [
          {
            roomId: CHANNEL_ID,
            count: user === USER_A ? UNREAD.room.a : UNREAD.room.b,
          },
        ],
        nextCursor: null,
      })),
    ),
    http.get(
      "/api/dms",
      serve((user) => ({
        items: [
          dmItem(1, {
            partner: {
              id: "01JTEST284DMPARTNER0000001",
              displayName: `${markOf(user)}の相手`,
              isActive: true,
              status: { kind: "available", returnAt: null },
            },
          }),
        ],
        nextCursor: null,
      })),
    ),
    http.get(
      "/api/dms/:roomId",
      serve((user) =>
        dmDetail(1, { partner: { displayName: `${markOf(user)}の相手` } }),
      ),
    ),
    http.get(
      "/api/me/profile",
      serve((user) => ({
        id: user.id,
        loginId: user.loginId,
        displayName: user.displayName,
        legalName: `${markOf(user)}の氏名`,
        email: `${user.loginId}@example.com`,
        extension: null,
        jobTitle: `${markOf(user)}の役職`,
        department: null,
        status: { kind: "available", returnAt: null, message: null },
      })),
    ),
    http.get(
      "/api/channel-requests/mine",
      serve((user) => ({
        items: [
          {
            id: "01JTEST284CHREQ00000000001",
            departmentId: null,
            name: `${markOf(user)}の申請`,
            visibility: "public",
            status: "pending",
            rejectReason: null,
            createdAt: "2026-11-12T00:00:00.000Z",
            decidedAt: null,
            channelId: null,
          },
        ],
        nextCursor: null,
      })),
    ),
    http.post("/api/auth/login", async ({ request }) => {
      const { loginId } = (await request.json()) as { loginId: string };
      const user = [USER_A, USER_B].find((u) => u.loginId === loginId);
      if (user === undefined)
        return HttpResponse.json(
          {
            code: "INVALID_CREDENTIALS",
            message: "ユーザーIDまたはパスワードが違います",
          },
          { status: 401 },
        );
      world.user = user;
      return HttpResponse.json(sessionOf(user, world.mustChangePassword));
    }),
  );
  return world;
}

/** userEvent.type は [ をキーの指定として読むため、文字として入力するときは [[ に逃がす */
const literal = (text: string) => text.replaceAll("[", "[[");

/** 本文か読み上げの名前（aria-label）に出ているか */
function shows(text: string): boolean {
  if (document.body.textContent?.includes(text)) return true;
  return [...document.querySelectorAll("[aria-label]")].some((element) =>
    element.getAttribute("aria-label")?.includes(text),
  );
}

type App = ReturnType<typeof renderUserSwitchApp>;
type Route = "direct" | "remove-then-set" | "refetch";

/** world を B にし、B の応答を gate で保留してから、指定の経路でセッションを B に替える */
async function switchToB(
  app: App,
  world: World,
  route: Route,
  gate: ReturnType<typeof deferred>,
) {
  world.user = USER_B;
  world.hold = gate.promise;
  if (route === "direct") {
    act(() => {
      app.client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
  } else if (route === "remove-then-set") {
    act(() => {
      app.client.removeQueries({ queryKey: authKeys.session, exact: true });
      app.client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
  } else {
    await act(async () => {
      await app.client.refetchQueries({
        queryKey: authKeys.session,
        exact: true,
      });
    });
  }
}

/** 枠（main）が出て、A のデータが出るまで待つ */
async function findMainWith(text: string) {
  await waitFor(() => expect(shows(text)).toBe(true));
  return screen.getByRole("main");
}

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
beforeEach(() => {
  // #298：差し替えの vi.fn の呼び出しの記録を、前のテストから持ち越さない
  vi.mocked(requestUserSwitchReload).mockClear();
});
afterEach(() => {
  disposeUserSwitchApps();
  stubs.restore();
});

describe("#284 T24: 描画の見張り（render-watch）の検出力", () => {
  it("#284（T24）: A の文字列を一度だけ描画し、次の描画で消す誤った部品は、記録が1件以上になる（最後の画面には A がない）", () => {
    const watch = createRenderWatch([A_MARK]);
    let setShow!: (show: boolean) => void;
    function Wrong() {
      const [show, set] = useState(false);
      setShow = set;
      return <p>{show ? `${A_MARK}の本文` : `${B_MARK}の本文`}</p>;
    }
    render(
      <watch.Watch>
        <Wrong />
      </watch.Watch>,
    );
    watch.arm();
    act(() => setShow(true));
    act(() => setShow(false));
    expect(shows(A_MARK)).toBe(false);
    expect(watch.hits.length).toBeGreaterThanOrEqual(1);
  });

  it("#284（T24）: 入力欄の value に A の文字列を一度だけ入れる誤った部品も、記録が1件以上になる", () => {
    const watch = createRenderWatch([A_MARK]);
    let setValue!: (value: string) => void;
    function WrongInput() {
      const [value, set] = useState("");
      setValue = set;
      return (
        <input aria-label="返信" value={value} onChange={() => undefined} />
      );
    }
    render(
      <watch.Watch>
        <WrongInput />
      </watch.Watch>,
    );
    watch.arm();
    act(() => setValue(`${A_MARK}の下書き`));
    act(() => setValue(""));
    expect(watch.hits.some((hit) => hit.where === "input")).toBe(true);
  });

  it("#284（T24）: 見張りに近い部品は再描画されず、深い子の部品だけが一度 A を表示する誤った見本も、記録が1件以上になる", () => {
    const watch = createRenderWatch([A_MARK]);
    let current = `${B_MARK}の本文`;
    const listeners = new Set<() => void>();
    const store = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      get: () => current,
      set: (next: string) => {
        current = next;
        for (const listener of listeners) listener();
      },
    };
    let shallowRenders = 0;
    function DeepChild() {
      const text = useSyncExternalStore(store.subscribe, store.get);
      return <p>{text}</p>;
    }
    const Shallow = memo(function Shallow() {
      shallowRenders += 1;
      return (
        <section>
          <div>
            <DeepChild />
          </div>
        </section>
      );
    });
    render(
      <watch.Watch>
        <Shallow />
      </watch.Watch>,
    );
    const shallowBefore = shallowRenders;
    watch.arm();
    act(() => store.set(`${A_MARK}の本文`));
    act(() => store.set(`${B_MARK}の本文`));
    expect(shallowRenders).toBe(shallowBefore);
    expect(watch.hits.length).toBeGreaterThanOrEqual(1);
  });

  it("#284（T24）: B の内容だけを描画する部品では、確定があっても記録は0件", () => {
    const watch = createRenderWatch([A_MARK]);
    let setCount!: (count: number) => void;
    function Right() {
      const [count, set] = useState(0);
      setCount = set;
      return <p>{`${B_MARK}の本文${count}`}</p>;
    }
    render(
      <watch.Watch>
        <Right />
      </watch.Watch>,
    );
    watch.arm();
    act(() => setCount(1));
    expect(watch.commits()).toBeGreaterThanOrEqual(1);
    expect(watch.hits).toEqual([]);
  });
});

describe("#284 AC-1（T10）: スレッドを開いたチャンネルで、A から B に替わる", () => {
  it.each([
    { route: "direct" as const, label: "(i) 直接の上書き" },
    { route: "remove-then-set" as const, label: "(ii) 捨ててから入れる" },
    { route: "refetch" as const, label: "(iii) 実際の取り直し" },
  ])(
    "#284 AC-1（T10）$label: URL の ?thread= は保たれ、B の応答の保留の間と後に、A の本文・返信・返信の入力がどの確定にも出ない",
    async ({ route }) => {
      const world = respondWorld(USER_A);
      const gate = deferred();
      const app = renderUserSwitchApp(
        `/channels/${CHANNEL_ID}?thread=${PARENT_ID}`,
        { needles: [A_MARK] },
      );
      const main = await findMainWith(`${A_MARK}の返信`);
      const pane = within(main).getByRole("region", { name: "スレッド" });
      await app.user.type(
        await within(pane).findByRole("textbox", { name: "返信" }),
        literal(`${A_MARK}の返信の下書き`),
      );

      app.watch.arm();
      const before = world.requests.length;
      await switchToB(app, world, route, gate);
      expect(app.watch.hits).toEqual([]);
      await waitFor(() =>
        expect(world.requests.length).toBeGreaterThan(before),
      );
      expect(app.watch.hits).toEqual([]);

      gate.release();
      await waitFor(() => expect(shows(`${B_MARK}の返信`)).toBe(true));
      expect(app.router.state.location.search).toContain(`thread=${PARENT_ID}`);
      expect(app.watch.commits()).toBeGreaterThan(0);
      expect(app.watch.hits).toEqual([]);
    },
  );
});

describe("#284 AC-1（T25）: 遅れた通知が届く前の描画", () => {
  it("#284 AC-1（T25）: セッションを B で上書きした同じ同期の区間の確定で、A の枠（A の名前）のまま子だけが B になる確定がなく、A の表示もない", async () => {
    const world = respondWorld(USER_A);
    const gate = deferred();
    const app = renderUserSwitchApp(`/channels/${CHANNEL_ID}`, {
      needles: [A_MARK, USER_A.displayName],
    });
    await findMainWith(`${A_MARK}の本文`);
    // 見張りの文字列が、切り替えの前には実際に出ていること（検出の前提）
    await waitFor(() => expect(shows(USER_A.displayName)).toBe(true));

    world.user = USER_B;
    world.hold = gate.promise;
    app.watch.arm();
    const commitsBefore = app.watch.commits();
    act(() => {
      app.client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    // 同期の区間（act の中）で、少なくとも1回は確定している
    expect(app.watch.commits()).toBeGreaterThan(commitsBefore);
    expect(app.watch.hits).toEqual([]);
    // #298：別の利用者に替わった時点で、読み込み直しが1回求められる
    expect(requestUserSwitchReload).toHaveBeenCalledTimes(1);

    gate.release();
    await waitFor(() => expect(shows(`${B_MARK}の本文`)).toBe(true));
    expect(app.watch.hits).toEqual([]);
  });
});

describe("#284 AC-1（T11）: 入力中・離れる前の確認が有効なまま、A から B に替わる", () => {
  it("#284 AC-1（T11）: 切り替えの前は確認が出る。B に替えた後は、A の下書きが入力欄に出ず、離れるときの確認も残らない", async () => {
    const world = respondWorld(USER_A);
    const gate = deferred();
    const app = renderUserSwitchApp(`/channels/${CHANNEL_ID}`, {
      needles: [A_MARK],
    });
    const main = await findMainWith(`${A_MARK}の本文`);
    await app.user.type(
      within(main).getByRole("textbox", { name: "メッセージ" }),
      literal(`${A_MARK}の下書き`),
    );
    // 枠の働きの確認：離れようとすると確認が出る
    await app.user.click(
      within(
        screen.getByRole("navigation", { name: "メインメニュー" }),
      ).getByRole("link", { name: "チャンネルを探す" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "入力した内容は失われます",
    });
    await app.user.click(
      within(confirm).getByRole("button", { name: "編集を続ける" }),
    );
    expect(app.router.state.location.pathname).toBe(`/channels/${CHANNEL_ID}`);

    app.watch.arm();
    await switchToB(app, world, "direct", gate);
    expect(app.watch.hits).toEqual([]);
    // #298：別の利用者に替わった時点で、読み込み直しが1回求められる
    expect(requestUserSwitchReload).toHaveBeenCalledTimes(1);
    gate.release();
    await waitFor(() => expect(shows(`${B_MARK}の本文`)).toBe(true));
    expect(app.watch.hits).toEqual([]);

    // A の確認が残っていない：離れても確認を出さずに移る
    await app.user.click(
      within(
        screen.getByRole("navigation", { name: "メインメニュー" }),
      ).getByRole("link", { name: "チャンネルを探す" }),
    );
    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe("/channels"),
    );
    expect(
      screen.queryByRole("dialog", { name: "入力した内容は失われます" }),
    ).toBeNull();
    expect(app.watch.hits).toEqual([]);
  });
});

describe("#284 AC-1（T12）: 各画面で A から B に替わる", () => {
  it.each([
    {
      name: "スレッド一覧",
      path: "/threads",
      aText: `${A_MARK}の親`,
      bText: `${B_MARK}の親`,
      extra: [] as string[],
    },
    {
      name: "通知（ヘッダーの未読数）",
      path: "/notifications",
      aText: `未読 ${UNREAD.notifications.a}件`,
      bText: `未読 ${UNREAD.notifications.b}件`,
      extra: [`未読 ${UNREAD.notifications.a}件`],
    },
    {
      name: "チャンネル一覧（サイドバーの未読数）",
      path: "/channels",
      aText: `未読 ${UNREAD.room.a}件`,
      bText: `未読 ${UNREAD.room.b}件`,
      extra: [`未読 ${UNREAD.room.a}件`],
    },
    {
      name: "DM の一覧",
      path: "/dms",
      aText: `${A_MARK}の相手`,
      bText: `${B_MARK}の相手`,
      extra: [] as string[],
    },
    {
      name: "DM",
      path: `/dms/${DM_ROOM_ID}`,
      aText: `${A_MARK}の相手`,
      bText: `${B_MARK}の相手`,
      extra: [] as string[],
    },
    {
      name: "プロフィール",
      path: "/profile",
      aText: `${A_MARK}の氏名`,
      bText: `${B_MARK}の氏名`,
      extra: [] as string[],
    },
    {
      name: "チャンネル作成の申請",
      path: "/channel-requests",
      aText: `${A_MARK}の申請`,
      bText: `${B_MARK}の申請`,
      extra: [] as string[],
    },
  ])(
    "#284 AC-1（T12）$name（$path）: B の応答を待つ間も後も、A の内容がどの確定にも出ず、応答の後は B だけを出す",
    async ({ path, aText, bText, extra }) => {
      const world = respondWorld(USER_A);
      const gate = deferred();
      const app = renderUserSwitchApp(path, { needles: [A_MARK, ...extra] });
      await findMainWith(aText);

      app.watch.arm();
      const before = world.requests.length;
      await switchToB(app, world, "direct", gate);
      expect(app.watch.hits).toEqual([]);
      await waitFor(() =>
        expect(world.requests.length).toBeGreaterThan(before),
      );
      expect(app.watch.hits).toEqual([]);

      gate.release();
      await waitFor(() => expect(shows(bText)).toBe(true));
      expect(shows(aText)).toBe(false);
      expect(app.watch.hits).toEqual([]);
    },
  );
});

/** 通常の API を 401 にして、401 の共通の処理で /login へ移す */
async function expireSession(app: App, world: World) {
  world.user = null;
  await act(async () => {
    await app.client.invalidateQueries({
      predicate: (query) => query.queryKey[0] !== authKeys.session[0],
    });
  });
  await waitFor(() =>
    expect(app.router.state.location.pathname).toBe("/login"),
  );
  await screen.findByLabelText("ユーザーID");
}

async function logIn(app: App, user: TestUser) {
  await app.user.type(screen.getByLabelText("ユーザーID"), user.loginId);
  await app.user.type(screen.getByLabelText("パスワード"), TEST_PASSWORD);
  await app.user.click(screen.getByRole("button", { name: "ログイン" }));
}

describe("#284 AC-1（T13）: 401 の後に、別の利用者がログインする", () => {
  it("#284 AC-1（T13）: A の画面で通常の API が 401 になり /login へ移った後、B でログインしても、A の内容がどの確定にも出ない", async () => {
    const world = respondWorld(USER_A);
    const gate = deferred();
    const app = renderUserSwitchApp(`/channels/${CHANNEL_ID}`, {
      needles: [A_MARK],
    });
    await findMainWith(`${A_MARK}の本文`);

    await expireSession(app, world);
    world.hold = gate.promise;
    app.watch.arm();
    await logIn(app, USER_B);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    expect(app.watch.hits).toEqual([]);
    // #298：401 の後でも、文書の利用者 A と違う B がログインしたら、読み込み直しが1回求められる（ログインの後の移動と重なっても1回）
    expect(requestUserSwitchReload).toHaveBeenCalledTimes(1);

    gate.release();
    await waitFor(() => expect(shows(`${B_MARK}の部屋`)).toBe(true));
    expect(app.watch.hits).toEqual([]);
  });
});

describe("#284 AC-1（T22）: 初回のパスワード変更の画面で、A から B に替わる", () => {
  it("#284 AC-1（T22）: A が全欄に入力して表示に切り替えた後、変更が必要な B に替わると、パスワードの欄が全部空で、表示の切り替えも初期に戻る", async () => {
    const world = respondWorld(USER_A);
    world.mustChangePassword = true;
    const A_PASSWORD = "TestPass284A!";
    const app = renderUserSwitchApp("/", { needles: [A_PASSWORD] });
    const current = await screen.findByLabelText("現在のパスワード");
    await app.user.type(current, A_PASSWORD);
    await app.user.type(
      screen.getByLabelText("新しいパスワード"),
      `${A_PASSWORD}new`,
    );
    await app.user.type(
      screen.getByLabelText("新しいパスワード（確認）"),
      `${A_PASSWORD}new`,
    );
    for (const toggle of screen.getAllByRole("button", {
      name: "パスワードを表示",
    }))
      await app.user.click(toggle);
    expect(
      screen.getAllByRole("button", { name: "パスワードを隠す" }),
    ).toHaveLength(3);

    world.user = USER_B;
    app.watch.arm();
    act(() => {
      app.client.setQueryData(authKeys.session, sessionOf(USER_B, true));
    });
    // #298：別の利用者に替わった時点で、読み込み直しが1回求められる
    expect(requestUserSwitchReload).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(
        (screen.getByLabelText("現在のパスワード") as HTMLInputElement).value,
      ).toBe(""),
    );
    for (const label of [
      "現在のパスワード",
      "新しいパスワード",
      "新しいパスワード（確認）",
    ]) {
      const field = screen.getByLabelText(label);
      if (!(field instanceof HTMLInputElement))
        throw new Error(`${label}の欄が input ではありません`);
      expect(field.value).toBe("");
      expect(field.type).toBe("password");
    }
    expect(
      screen.getAllByRole("button", { name: "パスワードを表示" }),
    ).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "パスワードを隠す" }),
    ).toBeNull();
    expect(app.watch.hits).toEqual([]);
  });
});

describe("#284 AC-1（T23）: ログイン画面で、A のセッションの取得が遅れて返る", () => {
  it("#284 AC-1（T23）: /login で A の GET /auth/session を保留したまま B でログインし、A の応答を後から返しても、B のまま。A の内容がどの確定にも出ない", async () => {
    const world = respondWorld(null);
    // 最初の取得（未ログインの確認）を返してから、A のセッションの取得を保留する
    const app = renderUserSwitchApp("/login", {
      needles: [A_MARK, USER_A.displayName],
    });
    await screen.findByLabelText("ユーザーID");
    const sessionGate = deferred();
    world.user = USER_A;
    world.sessionHold = sessionGate.promise;
    let aFetch: Promise<unknown> = Promise.resolve();
    act(() => {
      // 401 の処理でセッションのクエリは捨てられているため、取得そのものを始める（useSession と同じ取得の関数）
      aFetch = app.client
        .fetchQuery({ queryKey: authKeys.session, queryFn: fetchSession })
        .then(
          () => "settled",
          () => "settled",
        );
    });

    // 保留するのは、B のログインの前に出た A の取得だけ。ログインの後に出る取得は B を返す
    await waitFor(() => expect(world.sessionHeld).toBe(1));
    world.sessionHold = null;

    app.watch.arm();
    // ログインの応答（POST /auth/login）は保留しない。world.user は B になる
    await logIn(app, USER_B);
    await waitFor(() => expect(shows(USER_B.displayName)).toBe(true));

    // 保留した A の取得を解放する。この要求は B のログインの前に出たので、A を返す
    sessionGate.release();
    await act(async () => {
      await aFetch;
    });
    // 古い取得の応答が、実際に A を返して解放されたこと（取り消さない誤った実装なら、この A がキャッシュに入る）
    await waitFor(() =>
      expect(world.sessionServed).toContainEqual({
        held: true,
        userId: USER_A.id,
      }),
    );

    await waitFor(() =>
      expect(
        app.client
          .getQueryCache()
          .find({ queryKey: authKeys.session, exact: true })?.state.fetchStatus,
      ).toBe("idle"),
    );
    expect(
      (
        app.client.getQueryData(authKeys.session) as ReturnType<
          typeof sessionOf
        >
      ).user.id,
    ).toBe(USER_B.id);
    expect(shows(USER_B.displayName)).toBe(true);
    expect(app.watch.hits).toEqual([]);
  });
});

describe("#284 AC-2（T14・T15）: 同じ利用者（A）の再ログイン", () => {
  it("#284 AC-2（T14）: 401 の後に A で再ログインすると、取り直しを保留している間も、前の一覧（サイドバーの参加中のチャンネル）が出る", async () => {
    const world = respondWorld(USER_A);
    const gate = deferred();
    const app = renderUserSwitchApp(`/channels/${CHANNEL_ID}`, {
      needles: [],
    });
    await findMainWith(`${A_MARK}の部屋`);

    await expireSession(app, world);
    world.hold = gate.promise;
    const before = world.requests.length;
    await logIn(app, USER_A);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    await waitFor(() => expect(world.requests.length).toBeGreaterThan(before));
    const menu = await screen.findByRole("navigation", {
      name: "メインメニュー",
    });
    expect(
      within(menu).getByRole("link", {
        name: (name) => name.includes(`${A_MARK}の部屋`),
      }),
    ).toBeTruthy();
    gate.release();
  });

  it("#284 AC-2（T15）: /channels/:id で A が入力した後、401 → A で再ログインして同じチャンネルへ戻ると、端末の下書きが戻る", async () => {
    const world = respondWorld(USER_A);
    const app = renderUserSwitchApp(`/channels/${CHANNEL_ID}`, {
      needles: [],
    });
    const main = await findMainWith(`${A_MARK}の本文`);
    await app.user.type(
      within(main).getByRole("textbox", { name: "メッセージ" }),
      literal(`${A_MARK}の下書き`),
    );

    await expireSession(app, world);
    await logIn(app, USER_A);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    await act(async () => {
      await app.router.navigate(`/channels/${CHANNEL_ID}`);
    });

    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", { name: "メッセージ" }) as
            HTMLTextAreaElement | HTMLInputElement
        ).value,
      ).toBe(`${A_MARK}の下書き`),
    );
  });
});

describe("#298 AC-4（計画 8-1 の AC-4 (ii)・(iii)）: 401 の後のログインと、切り替えの読み込み直しの回数", () => {
  it("#298 AC-4 (ii)（0-2 AC-8）: 401 → A で再ログイン：読み込み直しは求めない（0回）", async () => {
    const world = respondWorld(USER_A);
    const app = renderUserSwitchApp(`/channels/${CHANNEL_ID}`, {
      needles: [],
    });
    await findMainWith(`${A_MARK}の部屋`);
    await expireSession(app, world);
    world.user = USER_A;
    await logIn(app, USER_A);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    await waitFor(() =>
      expect(
        app.client.getQueryState(authKeys.session)?.fetchStatus ?? "idle",
      ).toBe("idle"),
    );
    expect(requestUserSwitchReload).not.toHaveBeenCalled();
  });

  it("#298 AC-4 (iii): 401 → B でログイン：読み込み直しを1回求める（同じ画面で続けて取り直しが起きても1回）", async () => {
    const world = respondWorld(USER_A);
    const app = renderUserSwitchApp(`/channels/${CHANNEL_ID}`, {
      needles: [],
    });
    await findMainWith(`${A_MARK}の部屋`);
    await expireSession(app, world);
    await logIn(app, USER_B);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    await waitFor(() => expect(shows(`${B_MARK}の部屋`)).toBe(true));
    await act(async () => {
      await app.client.refetchQueries({ queryKey: authKeys.session });
    });
    expect(requestUserSwitchReload).toHaveBeenCalledTimes(1);
  });
});
