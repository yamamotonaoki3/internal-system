// #239 AC-4・AC-5（1-1 AC-4・C-82）：画面を離れる前の確認（LeaveGuardProvider・LeaveConfirmDialog）と、手動ログアウトの前の確認。
// main.tsx と同じく、データルーター（createMemoryRouter）の根の要素を LeaveGuardProvider で包み、その中を <Routes> で振り分ける。
// 契約（実装前の仮置き。計画 plan-239 と改訂1〜5）：
//   features/leave-guard/index.ts から LeaveGuardProvider を公開する。ブロッカーは1つ。止めないのは、pathname が同じ遷移と /login への遷移。
//   確認ダイアログは <dialog>（role=dialog）で、名前に「入力した内容は失われます」を含み、ボタンは「編集を続ける」「破棄して離れる」。
//   開いたときのフォーカスは「編集を続ける」。Esc は「編集を続ける」と同じ。
//   ブロッカーの確認：「編集を続ける」で留まり、遷移を始めた要素がまだあればそこへ（なければ入力欄へ）フォーカスを戻す。
//                     「破棄して離れる」でその部屋の下書きを消して移る。
//   ログアウトの確認（LogoutButton が mutate の前に confirmLeave() を呼ぶ）：変更があるときだけ確認を出し、API を呼ぶ前に止まる。
//     「編集を続ける」：API を呼ばず、入力欄へフォーカスを戻す。「破棄して離れる」：見張りの onDiscard は呼ばずに API を呼び、
//     成功したらその利用者の下書きをすべて消して /login へ。失敗したら下書きも本文も残す。
//     待っている間に場所が変わったら（401 の /login を含む）false で閉じる。見張りがなくなったら true（ただしセッションがなければ mutate しない）。
//     待っている間にもう一度呼ばれたら、すぐ false（確認は1つ・API は1回）。ブロッカーの確認中に呼ばれたら、すぐ false。
//     ログアウトの確認中にブロッカーが止めた遷移（戻る等）は取り消して重ねない。
// データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { useState } from "react";
import {
  createMemoryRouter,
  Link,
  Outlet,
  Route,
  RouterProvider,
  Routes,
  useLocation,
  useOutletContext,
  useParams,
} from "react-router";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { respondMessages } from "../../test/message-handlers";
import { server } from "../../test/server";
import { authKeys } from "../auth";
import { LogoutButton } from "../auth/components/LogoutButton";
import { RoomMessages } from "../messages";
import { LeaveGuardProvider } from "./index";

const ROOM_1 = "01JTESTROOM00000000000LG01";
const ROOM_2 = "01JTESTROOM00000000000LG02";
const USER_A = {
  id: "01JTESTUSER00000000000DA01",
  displayName: "testuser_draft_a",
  loginId: "testuser_draft_a",
};
const USER_B_ID = "01JTESTUSER00000000000DB01";
const SESSION_A = {
  user: USER_A,
  permissions: [],
  mustChangePassword: false,
  reauthenticatedAt: null,
};
const DIALOG_NAME = /入力した内容は失われます/;
// React Router が、unblocked などの止めていないブロッカーへの proceed()・reset() で投げる例外の文言
const INVALID_BLOCKER_TRANSITION = "Invalid blocker state transition";

// #239 AC-5：確認の表示中の 401（/login への移動）など、遷移の完了と確認の後始末が競合しても、ルーターの例外を出さない。
// 例外はルーターの ErrorBoundary に受け止められて画面が戻るため、表示の確認だけでは見逃す。console.error の出力で確かめる
let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error");
});
afterEach(async () => {
  // 次のタスクに遅らせた処理まで終えてから確かめる
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const invalidTransitions = consoleError.mock.calls.filter((args) =>
    args.some((arg) =>
      (arg instanceof Error ? arg.message : String(arg)).includes(
        INVALID_BLOCKER_TRANSITION,
      ),
    ),
  );
  consoleError.mockRestore();
  expect(invalidTransitions).toEqual([]);
});

const keyOf = (userId: string, roomId: string) =>
  `internal-system:draft:v1:${userId}:room:${roomId}`;
const putDraft = (userId: string, roomId: string, body: string) =>
  window.localStorage.setItem(
    keyOf(userId, roomId),
    JSON.stringify({ body, updatedAt: Date.now() }),
  );
const savedBody = (userId: string, roomId: string): string | null => {
  const raw = window.localStorage.getItem(keyOf(userId, roomId));
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null && "body" in parsed
    ? String(parsed.body)
    : null;
};

function CurrentPath() {
  const location = useLocation();
  return (
    <output data-testid="path">{location.pathname + location.search}</output>
  );
}

function RoomRoute() {
  const { roomId } = useParams();
  const { showInput } = useOutletContext<{ showInput: boolean }>();
  if (!showInput) return <p>入力欄は閉じています</p>;
  return <RoomMessages roomId={roomId ?? ""} canPost joined />;
}

function Layout() {
  const { pathname } = useLocation();
  const [showInput, setShowInput] = useState(true);
  return (
    <div>
      <nav aria-label="テストのメニュー">
        <Link to={`/rooms/${ROOM_2}`}>別の部屋</Link>
        <Link to="/other">別の画面</Link>
        <Link to="/login">ログイン画面へ</Link>
        <Link to={`${pathname}?tab=1`}>同じ画面</Link>
      </nav>
      <LogoutButton />
      <button type="button" onClick={() => setShowInput(false)}>
        入力欄を閉じる
      </button>
      <Outlet context={{ showInput }} />
    </div>
  );
}

type Options = { initialEntries?: string[]; initialIndex?: number };

function renderGuarded({
  initialEntries = [`/rooms/${ROOM_1}`],
  initialIndex,
}: Options = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  client.setQueryData(authKeys.session, SESSION_A);
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <LeaveGuardProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/rooms/:roomId" element={<RoomRoute />} />
                <Route path="/other" element={<p>別の画面です</p>} />
              </Route>
              <Route path="/login" element={<p>ログイン画面です</p>} />
            </Routes>
            <CurrentPath />
          </LeaveGuardProvider>
        ),
      },
    ],
    { initialEntries, initialIndex },
  );
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router, user };
}

/** POST /api/auth/logout。status を返すまで止めておけるようにする */
function respondLogout(status = 204, wait?: Promise<void>) {
  const state = { calls: 0 };
  server.use(
    http.post("/api/auth/logout", async () => {
      state.calls += 1;
      if (wait !== undefined) await wait;
      else await delay(10);
      if (status === 204) return new HttpResponse(null, { status: 204 });
      return HttpResponse.json(
        { code: "INTERNAL", message: "エラーが発生しました" },
        { status },
      );
    }),
  );
  return state;
}

const path = () => screen.getByTestId("path").textContent;
const box = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: "メッセージ" });
const dialog = () => screen.queryByRole("dialog", { name: DIALOG_NAME });
const dialogs = () => screen.queryAllByRole("dialog", { name: DIALOG_NAME });
const button = (name: string) => screen.getByRole("button", { name });
const link = (name: string) => screen.getByRole("link", { name });

/** ブラウザの Esc の既定の動き：cancel を出し、止められなければ閉じる */
function pressEscape(target: HTMLElement) {
  if (!(target instanceof HTMLDialogElement))
    throw new Error("dialog 要素ではありません");
  act(() => {
    const cancel = new Event("cancel", { cancelable: true });
    target.dispatchEvent(cancel);
    if (!cancel.defaultPrevented) target.close();
  });
}

async function typeDirty(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    await screen.findByRole("textbox", { name: "メッセージ" }),
    "[[E2E_TEST]書きかけ",
  );
}

describe("#239 AC-5 アプリの中で画面を離れる前の確認", () => {
  it("#239 AC-5: 変更があるときにリンクで移ろうとすると、移らずに確認を出し、フォーカスは「編集を続ける」", async () => {
    respondMessages([]);
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(link("別の画面"));
    expect(
      await screen.findByRole("dialog", { name: DIALOG_NAME }),
    ).toBeTruthy();
    expect(button("破棄して離れる")).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(button("編集を続ける")),
    );
    expect(path()).toBe(`/rooms/${ROOM_1}`);
  });

  it("#239 AC-5: 「編集を続ける」で閉じて留まり、本文と下書きが残り、フォーカスは遷移を始めたリンクに戻る", async () => {
    respondMessages([]);
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(link("別の画面"));
    await user.click(
      await screen.findByRole("button", { name: "編集を続ける" }),
    );
    await waitFor(() => expect(dialog()).toBeNull());
    expect(path()).toBe(`/rooms/${ROOM_1}`);
    expect(box().value).toBe("[E2E_TEST]書きかけ");
    expect(savedBody(USER_A.id, ROOM_1)).toBe("[E2E_TEST]書きかけ");
    expect(document.activeElement).toBe(link("別の画面"));
  });

  it("#239 AC-5: Esc は「編集を続ける」と同じで、留まり本文が残る", async () => {
    respondMessages([]);
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(link("別の画面"));
    pressEscape(await screen.findByRole("dialog", { name: DIALOG_NAME }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(path()).toBe(`/rooms/${ROOM_1}`);
    expect(box().value).toBe("[E2E_TEST]書きかけ");
    // 閉じた後にもう一度移ろうとすると、また確認を出す（止めた状態を残さない）
    await user.click(link("別の画面"));
    expect(
      await screen.findByRole("dialog", { name: DIALOG_NAME }),
    ).toBeTruthy();
  });

  it("#239 AC-4・AC-5: 「破棄して離れる」で、その部屋の下書きを消して移る。戻っても復元しない", async () => {
    respondMessages([]);
    putDraft(USER_A.id, ROOM_2, "[E2E_TEST]別の部屋の下書き");
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(link("別の画面"));
    await user.click(
      await screen.findByRole("button", { name: "破棄して離れる" }),
    );
    await waitFor(() => expect(path()).toBe("/other"));
    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem(keyOf(USER_A.id, ROOM_1))).toBeNull();
    // 他の部屋の下書きは消さない
    expect(savedBody(USER_A.id, ROOM_2)).toBe("[E2E_TEST]別の部屋の下書き");
  });

  it("#239 AC-5: 変更がないときは確認を出さずに移る", async () => {
    respondMessages([]);
    const { user } = renderGuarded();
    await screen.findByRole("textbox", { name: "メッセージ" });
    await user.click(link("別の画面"));
    await waitFor(() => expect(path()).toBe("/other"));
    expect(dialog()).toBeNull();
  });

  it("#239 AC-5: 空白だけを入力したときは確認を出さない", async () => {
    respondMessages([]);
    const { user } = renderGuarded();
    await user.type(
      await screen.findByRole("textbox", { name: "メッセージ" }),
      "  \n ",
    );
    await user.click(link("別の画面"));
    await waitFor(() => expect(path()).toBe("/other"));
    expect(dialog()).toBeNull();
  });

  it("#239 AC-5: 入力して全部消した（空に戻した）ときは確認を出さない", async () => {
    respondMessages([]);
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.clear(box());
    await user.click(link("別の画面"));
    await waitFor(() => expect(path()).toBe("/other"));
    expect(dialog()).toBeNull();
  });

  it("#239 AC-5（U-1）: 復元しただけで変えていないときは確認を出さず、下書きも残す", async () => {
    respondMessages([]);
    putDraft(USER_A.id, ROOM_1, "[E2E_TEST]復元した");
    const { user } = renderGuarded();
    await waitFor(() => expect(box().value).toBe("[E2E_TEST]復元した"));
    await user.click(link("別の画面"));
    await waitFor(() => expect(path()).toBe("/other"));
    expect(dialog()).toBeNull();
    expect(savedBody(USER_A.id, ROOM_1)).toBe("[E2E_TEST]復元した");
  });

  it("#239 AC-5（U-1）: 復元した本文に書き足したときは確認を出す", async () => {
    respondMessages([]);
    putDraft(USER_A.id, ROOM_1, "[E2E_TEST]復元した");
    const { user } = renderGuarded();
    await waitFor(() => expect(box().value).toBe("[E2E_TEST]復元した"));
    await user.type(box(), "の続き");
    await user.click(link("別の画面"));
    expect(
      await screen.findByRole("dialog", { name: DIALOG_NAME }),
    ).toBeTruthy();
  });

  it("#239 AC-5: 部屋の切り替え（/rooms/1 → /rooms/2）でも確認を出す", async () => {
    respondMessages([]);
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(link("別の部屋"));
    expect(
      await screen.findByRole("dialog", { name: DIALOG_NAME }),
    ).toBeTruthy();
    expect(path()).toBe(`/rooms/${ROOM_1}`);
  });

  it("#239 AC-5: 同じ画面（pathname が同じ）の中の移動では確認を出さない", async () => {
    respondMessages([]);
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(link("同じ画面"));
    await waitFor(() => expect(path()).toBe(`/rooms/${ROOM_1}?tab=1`));
    expect(dialog()).toBeNull();
    expect(box().value).toBe("[E2E_TEST]書きかけ");
  });

  it("#239 AC-5: /login への移動（自動ログアウト・確認を済ませた手動ログアウト）では確認を出さず、下書きは残す", async () => {
    respondMessages([]);
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(link("ログイン画面へ"));
    await waitFor(() => expect(path()).toBe("/login"));
    expect(dialog()).toBeNull();
    expect(savedBody(USER_A.id, ROOM_1)).toBe("[E2E_TEST]書きかけ");
  });

  it("#239 AC-5: 401 の処理（セッションを捨てて router.navigate('/login')）では確認を出さず、下書きは残す（U-7）", async () => {
    respondMessages([]);
    const { user, client, router } = renderGuarded();
    await typeDirty(user);
    await act(async () => {
      client.removeQueries({ queryKey: authKeys.session });
      await router.navigate("/login");
    });
    await waitFor(() => expect(path()).toBe("/login"));
    expect(dialog()).toBeNull();
    expect(savedBody(USER_A.id, ROOM_1)).toBe("[E2E_TEST]書きかけ");
  });

  it("#239 AC-5: ブラウザの戻る（POP）でも確認を出し、「編集を続ける」で留まり、フォーカスは入力欄", async () => {
    respondMessages([]);
    const { user, router } = renderGuarded({
      initialEntries: ["/other", `/rooms/${ROOM_1}`],
      initialIndex: 1,
    });
    await typeDirty(user);
    // user-event は、入力して値を変えた欄からフォーカスが外れると、change を同期の act で送る。
    // 下の act では、確認ダイアログがフォーカスを移すのが act の後始末（React の描画の反映）の最中になり、その change が
    // 待たれない act になる（警告「A component suspended inside an `act` scope ...」）。先に act の中で入力を確定しておく。
    // フォーカスは入力欄に戻すので、遷移を始めた要素は変わらない
    act(() => {
      box().blur();
      box().focus();
    });
    await act(async () => {
      await router.navigate(-1);
    });
    expect(
      await screen.findByRole("dialog", { name: DIALOG_NAME }),
    ).toBeTruthy();
    await user.click(button("編集を続ける"));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(path()).toBe(`/rooms/${ROOM_1}`);
    expect(document.activeElement).toBe(box());
  });

  it("#239 AC-5: 確認を表示中に /login へ移ると（401）、確認を閉じる", async () => {
    respondMessages([]);
    const { user, client, router } = renderGuarded();
    await typeDirty(user);
    await user.click(link("別の画面"));
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    await act(async () => {
      client.removeQueries({ queryKey: authKeys.session });
      await router.navigate("/login");
    });
    await waitFor(() => expect(path()).toBe("/login"));
    expect(dialog()).toBeNull();
    expect(savedBody(USER_A.id, ROOM_1)).toBe("[E2E_TEST]書きかけ");
  });

  it("#239 AC-5: 確認を表示中に変更のある入力欄がなくなったら、失う入力がないので、確認を閉じて遷移を進める。フォーカスは body に落とさない", async () => {
    respondMessages([]);
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(link("別の画面"));
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    fireEvent.click(button("入力欄を閉じる"));
    await waitFor(() => expect(path()).toBe("/other"));
    expect(dialog()).toBeNull();
    expect(screen.getByText("別の画面です")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });

  it("#239 AC-5: 変更があるときは beforeunload も止め、移った後（入力欄がない画面）では止めない", async () => {
    respondMessages([]);
    const { user } = renderGuarded();
    await typeDirty(user);
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    await user.click(link("別の画面"));
    await user.click(
      await screen.findByRole("button", { name: "破棄して離れる" }),
    );
    await waitFor(() => expect(path()).toBe("/other"));
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});

describe("#239 AC-4・AC-5 手動ログアウトの前の確認", () => {
  it("#239 AC-5: 変更があるときにログアウトを押すと、API を呼ぶ前に確認を出す。「編集を続ける」なら API を呼ばず、本文が残り、フォーカスは入力欄", async () => {
    respondMessages([]);
    const logout = respondLogout();
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(button("ログアウト"));
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    expect(logout.calls).toBe(0);
    await user.click(button("編集を続ける"));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(logout.calls).toBe(0);
    expect(path()).toBe(`/rooms/${ROOM_1}`);
    expect(box().value).toBe("[E2E_TEST]書きかけ");
    expect(document.activeElement).toBe(box());
  });

  it("#239 AC-4: ログアウトの確認で「破棄して離れる」なら API を呼び、成功したらその利用者の下書きをすべて消して /login へ移る。他の利用者の下書きは残す", async () => {
    respondMessages([]);
    putDraft(USER_A.id, ROOM_2, "[E2E_TEST]Aの別の部屋");
    putDraft(USER_B_ID, ROOM_1, "[E2E_TEST]Bの下書き");
    const logout = respondLogout();
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(button("ログアウト"));
    await user.click(
      await screen.findByRole("button", { name: "破棄して離れる" }),
    );
    await waitFor(() => expect(path()).toBe("/login"));
    expect(logout.calls).toBe(1);
    expect(window.localStorage.getItem(keyOf(USER_A.id, ROOM_1))).toBeNull();
    expect(window.localStorage.getItem(keyOf(USER_A.id, ROOM_2))).toBeNull();
    expect(savedBody(USER_B_ID, ROOM_1)).toBe("[E2E_TEST]Bの下書き");
    expect(dialog()).toBeNull();
  });

  it("#239 AC-4（U-2）: 「破棄して離れる」の後にログアウトの API が失敗（500）したら、下書きも本文も残す", async () => {
    respondMessages([]);
    const logout = respondLogout(500);
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(button("ログアウト"));
    await user.click(
      await screen.findByRole("button", { name: "破棄して離れる" }),
    );
    await waitFor(() => expect(logout.calls).toBe(1));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(path()).toBe(`/rooms/${ROOM_1}`);
    expect(savedBody(USER_A.id, ROOM_1)).toBe("[E2E_TEST]書きかけ");
    expect(box().value).toBe("[E2E_TEST]書きかけ");
  });

  it("#239 AC-4: 変更がないときは、確認を出さずにすぐログアウトする", async () => {
    respondMessages([]);
    const logout = respondLogout();
    const { user } = renderGuarded();
    await screen.findByRole("textbox", { name: "メッセージ" });
    await user.click(button("ログアウト"));
    expect(dialog()).toBeNull();
    await waitFor(() => expect(path()).toBe("/login"));
    expect(logout.calls).toBe(1);
  });

  it("#239 AC-5: ログアウトの確認中にログアウトをもう一度押しても、確認は1つで、API は1回だけ", async () => {
    respondMessages([]);
    const logout = respondLogout();
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(button("ログアウト"));
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    fireEvent.click(button("ログアウト"));
    fireEvent.click(button("ログアウト"));
    expect(dialogs()).toHaveLength(1);
    await user.click(button("破棄して離れる"));
    await waitFor(() => expect(path()).toBe("/login"));
    expect(logout.calls).toBe(1);
  });

  it("#239 AC-5: 離脱の確認（ブロッカー）の表示中にログアウトを押しても、確認は重ならず API も呼ばない", async () => {
    respondMessages([]);
    const logout = respondLogout();
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(link("別の画面"));
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    fireEvent.click(button("ログアウト"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(dialogs()).toHaveLength(1);
    expect(logout.calls).toBe(0);
    expect(path()).toBe(`/rooms/${ROOM_1}`);
  });

  it("#239 AC-5: ログアウトの確認中に戻る（POP）と、確認は1つのままで、元の画面に留まる", async () => {
    respondMessages([]);
    const logout = respondLogout();
    const { user, router } = renderGuarded({
      initialEntries: ["/other", `/rooms/${ROOM_1}`],
      initialIndex: 1,
    });
    await typeDirty(user);
    await user.click(button("ログアウト"));
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    await act(async () => {
      await router.navigate(-1);
    });
    expect(dialogs()).toHaveLength(1);
    expect(path()).toBe(`/rooms/${ROOM_1}`);
    expect(logout.calls).toBe(0);
  });

  it.each([
    ["セッションを捨ててから /login へ移る", true],
    ["/login へ移ってからセッションを捨てる", false],
  ])(
    "#239 AC-4（U-7）: ログアウトの確認中に 401 の処理が走ると（%s）、確認を閉じ、ログアウトの API を呼ばず、下書きは残す",
    async (_l, removeFirst) => {
      respondMessages([]);
      const logout = respondLogout();
      const { user, client, router } = renderGuarded();
      await typeDirty(user);
      await user.click(button("ログアウト"));
      await screen.findByRole("dialog", { name: DIALOG_NAME });
      await act(async () => {
        if (removeFirst) {
          client.removeQueries({ queryKey: authKeys.session });
          await router.navigate("/login");
        } else {
          await router.navigate("/login");
          client.removeQueries({ queryKey: authKeys.session });
        }
      });
      await waitFor(() => expect(path()).toBe("/login"));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(dialog()).toBeNull();
      expect(logout.calls).toBe(0);
      expect(savedBody(USER_A.id, ROOM_1)).toBe("[E2E_TEST]書きかけ");
    },
  );

  it("#239 AC-4: ログアウトの確認中に変更のある入力欄がなくなったら、失う下書きはないので、そのままログアウトを進める", async () => {
    respondMessages([]);
    const logout = respondLogout();
    const { user } = renderGuarded();
    await typeDirty(user);
    await user.click(button("ログアウト"));
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    fireEvent.click(button("入力欄を閉じる"));
    await waitFor(() => expect(path()).toBe("/login"));
    expect(logout.calls).toBe(1);
    expect(dialog()).toBeNull();
  });
});
