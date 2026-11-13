// #239 AC-4・AC-5（1-1 AC-4・C-82）：画面を離れる前の確認の提供元（LeaveGuardProvider）を、見張り（useLeaveGuard）と
// 確認の入口（useLeaveConfirmation）だけで組んだ最小の画面で確かめる。部屋の入力欄・ログアウトの部品を通した確認は leave-guard.test.tsx。
// 契約（計画 plan-239 と改訂1〜5）：
//   confirmLeave()：変更のある入力欄（見張り）がなければ、確認を出さずにすぐ true。あれば確認を出し、
//     「破棄して離れる」で true（見張りの onDiscard は呼ばない）、「編集を続ける」で false（入力欄へフォーカスを戻す）。
//     待っている間にもう一度呼ばれたら、すぐ false（確認は1つ）。離脱の確認（ブロッカー）の表示中に呼ばれたら、すぐ false。
//     待っている間に場所が変わったら false で閉じる。見張りがすべてなくなったら true（一部が残る間は待つ）。
//     ログアウトの確認中にブロッカーが止めた遷移（戻る等）は取り消して重ねない。
//   hasChanges()：変更のある入力欄があるか。
//   ブロッカーの確認：「編集を続ける」で留まり、遷移を始めた要素へフォーカスを戻す。ただし、その要素が文書から外れた・
//     見えない（checkVisibility が false）・body のときは、入力欄へ戻す（フォーカスを body に落とさない）。
//     「破棄して離れる」で各見張りの onDiscard を呼んで移る。確認の表示中に見張りがなくなったら、確認を閉じて遷移を進める。
//   ルーターのエラー（Invalid blocker state transition 等）を出さない（全テストの後で console.error を確かめる）。
// データは架空。
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import {
  createBrowserRouter,
  createMemoryRouter,
  Link,
  Route,
  RouterProvider,
  Routes,
  useLocation,
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
import {
  LeaveGuardProvider,
  useLeaveConfirmation,
  useLeaveGuard,
} from "./index";

const DIALOG_NAME = /入力した内容は失われます/;

let discarded: string[] = [];
let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  discarded = [];
  consoleError = vi.spyOn(console, "error");
});

afterEach(async () => {
  // 遅らせた処理（次のタスク）まで終えてから確かめる
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const messages = consoleError.mock.calls.map((args) =>
    args
      .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
      .join(" "),
  );
  vi.restoreAllMocks();
  expect(messages).toEqual([]);
});

function Field({ name }: { name: string }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useLeaveGuard({
    isDirty: value.trim() !== "",
    onDiscard: () => discarded.push(name),
    focus: () => ref.current?.focus(),
  });
  return (
    <input
      ref={ref}
      aria-label={name}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

function Probe() {
  const confirmation = useLeaveConfirmation();
  const [results, setResults] = useState<string[]>([]);
  const [changes, setChanges] = useState("");
  const { pathname, search } = useLocation();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (confirmation === null) throw new Error("提供元がありません");
          void confirmation
            .confirmLeave()
            .then((leave) => setResults((prev) => [...prev, String(leave)]));
        }}
      >
        離れてよいか確かめる
      </button>
      <button
        type="button"
        onClick={() => setChanges(String(confirmation?.hasChanges()))}
      >
        変更の有無を確かめる
      </button>
      <output data-testid="results">{results.join(",")}</output>
      <output data-testid="changes">{changes}</output>
      <output data-testid="path">{pathname + search}</output>
    </div>
  );
}

function Page() {
  const [showA, setShowA] = useState(true);
  const [showB, setShowB] = useState(true);
  return (
    <div>
      <nav aria-label="テストのメニュー">
        <Link to="/b">別の画面</Link>
      </nav>
      <button type="button" onClick={() => setShowA(false)}>
        入力欄Aを閉じる
      </button>
      <button type="button" onClick={() => setShowB(false)}>
        入力欄Bを閉じる
      </button>
      {showA && <Field name="入力欄A" />}
      {showB && <Field name="入力欄B" />}
    </div>
  );
}

type Options = { initialEntries?: string[]; initialIndex?: number };

function renderProvider({
  initialEntries = ["/a"],
  initialIndex,
}: Options = {}) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <LeaveGuardProvider>
            <Routes>
              <Route path="/a" element={<Page />} />
              <Route path="/b" element={<p>別の画面です</p>} />
            </Routes>
            <Probe />
          </LeaveGuardProvider>
        ),
      },
    ],
    { initialEntries, initialIndex },
  );
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  return { router, user };
}

const path = () => screen.getByTestId("path").textContent;
const results = () => screen.getByTestId("results").textContent;
const dialog = () => screen.queryByRole("dialog", { name: DIALOG_NAME });
const dialogs = () => screen.queryAllByRole("dialog", { name: DIALOG_NAME });
const button = (name: string) => screen.getByRole("button", { name });
const field = (name: string) =>
  screen.getByRole<HTMLInputElement>("textbox", { name });

/** 確認ダイアログが一度でも文書に入ったかを記録する（すぐ閉じる確認も見逃さない） */
function watchDialogs() {
  const seen = { count: 0 };
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (
          node instanceof Element &&
          (node.matches("dialog") || node.querySelector("dialog") !== null)
        )
          seen.count += 1;
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return { seen, stop: () => observer.disconnect() };
}

async function askLeave() {
  fireEvent.click(button("離れてよいか確かめる"));
  await act(async () => {
    await Promise.resolve();
  });
}

describe("#239 AC-5 confirmLeave と hasChanges（提供元）", () => {
  it("#239 AC-4: 変更のある入力欄がないときは、確認を出さずに、すぐ離れてよい（true）を返す", async () => {
    renderProvider();
    const watch = watchDialogs();
    await askLeave();
    await waitFor(() => expect(results()).toBe("true"));
    watch.stop();
    expect(watch.seen.count).toBe(0);
    expect(dialog()).toBeNull();
  });

  it("#239 AC-5: hasChanges は、変更のある入力欄がなければ false、あれば true、空に戻せば false", async () => {
    const { user } = renderProvider();
    await user.click(button("変更の有無を確かめる"));
    expect(screen.getByTestId("changes").textContent).toBe("false");
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    await user.click(button("変更の有無を確かめる"));
    expect(screen.getByTestId("changes").textContent).toBe("true");
    await user.clear(field("入力欄A"));
    await user.click(button("変更の有無を確かめる"));
    expect(screen.getByTestId("changes").textContent).toBe("false");
  });

  it("#239 AC-5: 確認の待ち中にもう一度呼ぶと、確認を重ねずにすぐ false。「編集を続ける」で最初の呼び出しも false", async () => {
    const { user } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    await askLeave();
    expect(
      await screen.findByRole("dialog", { name: DIALOG_NAME }),
    ).toBeTruthy();
    expect(results()).toBe("");
    await askLeave();
    await waitFor(() => expect(results()).toBe("false"));
    expect(dialogs()).toHaveLength(1);
    await user.click(button("編集を続ける"));
    await waitFor(() => expect(results()).toBe("false,false"));
    expect(dialog()).toBeNull();
    expect(field("入力欄A").value).toBe("[E2E_TEST]書きかけ");
    expect(document.activeElement).toBe(field("入力欄A"));
    // 閉じた後は、また確認を出せる（待ちを残さない）
    await askLeave();
    expect(
      await screen.findByRole("dialog", { name: DIALOG_NAME }),
    ).toBeTruthy();
  });

  it("#239 AC-4: 確認で「破棄して離れる」なら true を返し、見張りの onDiscard は呼ばない", async () => {
    const { user } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    await askLeave();
    await user.click(
      await screen.findByRole("button", { name: "破棄して離れる" }),
    );
    await waitFor(() => expect(results()).toBe("true"));
    expect(discarded).toEqual([]);
    expect(dialog()).toBeNull();
  });

  it("#239 AC-5: 離脱の確認（ブロッカー）の表示中に呼ぶと、確認を重ねずにすぐ false。「編集を続ける」で閉じて留まる", async () => {
    const { user } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    await user.click(screen.getByRole("link", { name: "別の画面" }));
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    await askLeave();
    await waitFor(() => expect(results()).toBe("false"));
    expect(dialogs()).toHaveLength(1);
    expect(path()).toBe("/a");
    await user.click(button("編集を続ける"));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(path()).toBe("/a");
    expect(results()).toBe("false");
  });

  it("#239 AC-5: 確認の待ち中に場所が変わったら（同じ画面の中の移動でも）、確認を閉じて false を返し、入力は残す", async () => {
    const { user, router } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    await askLeave();
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    await act(async () => {
      await router.navigate("/a?tab=1");
    });
    await waitFor(() => expect(path()).toBe("/a?tab=1"));
    await waitFor(() => expect(results()).toBe("false"));
    expect(dialog()).toBeNull();
    expect(field("入力欄A").value).toBe("[E2E_TEST]書きかけ");
    expect(discarded).toEqual([]);
  });

  it("#239 AC-4: 確認の待ち中に、変更のある入力欄が一部なくなっても待ち続け、すべてなくなったら true を返す", async () => {
    const { user } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]A");
    await user.type(field("入力欄B"), "[[E2E_TEST]B");
    await askLeave();
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    fireEvent.click(button("入力欄Bを閉じる"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(results()).toBe("");
    expect(dialogs()).toHaveLength(1);
    fireEvent.click(button("入力欄Aを閉じる"));
    await waitFor(() => expect(results()).toBe("true"));
    expect(dialog()).toBeNull();
    expect(discarded).toEqual([]);
  });

  it("#239 AC-5: 確認の待ち中に戻る（POP）と、その遷移は取り消して確認は1つのまま。「編集を続ける」で閉じて留まり、フォーカスは入力欄", async () => {
    const { user, router } = renderProvider({
      initialEntries: ["/b", "/a"],
      initialIndex: 1,
    });
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    await askLeave();
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    await act(async () => {
      await router.navigate(-1);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(dialogs()).toHaveLength(1);
    expect(path()).toBe("/a");
    await user.click(button("編集を続ける"));
    await waitFor(() => expect(results()).toBe("false"));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(path()).toBe("/a");
    expect(document.activeElement).toBe(field("入力欄A"));
  });
});

describe("#239 AC-5 ブロッカーの確認（提供元）", () => {
  it("#239 AC-5: 変更のある入力欄がないときは、リンクで移っても確認を一度も出さない", async () => {
    const { user } = renderProvider();
    const watch = watchDialogs();
    await user.click(screen.getByRole("link", { name: "別の画面" }));
    await waitFor(() => expect(path()).toBe("/b"));
    watch.stop();
    expect(watch.seen.count).toBe(0);
  });

  it("#239 AC-4・AC-5: 「破棄して離れる」で、変更のある入力欄それぞれの onDiscard を呼んで移る", async () => {
    const { user } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]A");
    await user.type(field("入力欄B"), "[[E2E_TEST]B");
    await user.click(screen.getByRole("link", { name: "別の画面" }));
    await user.click(
      await screen.findByRole("button", { name: "破棄して離れる" }),
    );
    await waitFor(() => expect(path()).toBe("/b"));
    expect([...discarded].sort()).toEqual(["入力欄A", "入力欄B"]);
    expect(dialog()).toBeNull();
  });

  it("#239 AC-5: フォーカスがどこにもない（body）ときに止めた遷移は、「編集を続ける」で入力欄へフォーカスを戻す（body に落とさない）", async () => {
    const { user, router } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    field("入力欄A").blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      await router.navigate("/b");
    });
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    await user.click(button("編集を続ける"));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(path()).toBe("/a");
    expect(document.activeElement).toBe(field("入力欄A"));
  });

  it("#239 AC-5: 遷移を始めた要素が確認の間に文書から外れたら、「編集を続ける」で入力欄へフォーカスを戻す", async () => {
    const { user, router } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    const opener = document.createElement("button");
    opener.textContent = "外から移る";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);
    await act(async () => {
      await router.navigate("/b");
    });
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    opener.remove();
    await user.click(button("編集を続ける"));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(field("入力欄A"));
  });

  it("#239 AC-5: 遷移を始めた要素が見えなくなっていたら（checkVisibility が false）、「編集を続ける」で入力欄へフォーカスを戻す", async () => {
    const { user } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    const link = screen.getByRole("link", { name: "別の画面" });
    Object.defineProperty(link, "checkVisibility", {
      configurable: true,
      value: () => false,
    });
    await user.click(link);
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    await user.click(button("編集を続ける"));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(field("入力欄A"));
  });

  it("#239 AC-5: 遷移を始めた要素が見えている（checkVisibility が true）なら、「編集を続ける」でその要素へフォーカスを戻す", async () => {
    const { user } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    const link = screen.getByRole("link", { name: "別の画面" });
    const checkVisibility = vi.fn(() => true);
    Object.defineProperty(link, "checkVisibility", {
      configurable: true,
      value: checkVisibility,
    });
    await user.click(link);
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    await user.click(button("編集を続ける"));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(link);
    expect(checkVisibility).toHaveBeenCalled();
  });

  it("#239 AC-5: 確認の表示中に変更のある入力欄がすべてなくなったら、戻す先の入力欄がなくても、エラーを出さずに遷移を進める", async () => {
    const { user, router } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    field("入力欄A").blur();
    await act(async () => {
      await router.navigate("/b");
    });
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    fireEvent.click(button("入力欄Aを閉じる"));
    await waitFor(() => expect(path()).toBe("/b"));
    expect(screen.getByText("別の画面です")).toBeTruthy();
    expect(dialog()).toBeNull();
    expect(discarded).toEqual([]);
  });
});

// #239 AC-4・AC-5：proceed・reset は、最新の描画の blocker・処理中の印・履歴のキー（描画中の location.key と同じか）を確かめてから呼ぶ。
// 履歴のキー（window.history.state.key）は memory router にはないため、これらは jsdom の createBrowserRouter で確かめる
type BrowserRouter = ReturnType<typeof createBrowserRouter>;
const browserRouters: BrowserRouter[] = [];
let goSpy: MockInstance<typeof window.history.go> | undefined;
afterEach(() => {
  for (const router of browserRouters.splice(0)) router.dispose();
  // LeaveGuardProvider は window.history.state のキーを見るので、次のテスト（memory router）に履歴を残さない
  window.history.replaceState(null, "", "/");
  goSpy?.mockRestore();
  goSpy = undefined;
});

async function renderBrowserProvider(initialEntries: string[]) {
  // 前のテストの履歴を引き継がない。最初の項目は push でなく置き換えなのでキーがないため、
  // 後ろの項目を push（router.navigate）で積んでキーを持たせる
  window.history.replaceState(null, "", "/start");
  const router = createBrowserRouter([
    {
      path: "*",
      element: (
        <LeaveGuardProvider>
          <Routes>
            <Route path="/start" element={<p>開始の画面です</p>} />
            <Route path="/a" element={<Page />} />
            <Route path="/b" element={<p>別の画面です</p>} />
          </Routes>
          <Probe />
        </LeaveGuardProvider>
      ),
    },
  ]);
  browserRouters.push(router);
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  for (const entry of initialEntries) {
    await act(async () => {
      await router.navigate(entry);
    });
  }
  return { router, user };
}

describe("#239 AC-4・AC-5 確認の proceed・reset の判定（settleBlocker）", () => {
  it("#239 AC-4: 「破棄して離れる」を2回続けて押しても、見張りの onDiscard と遷移は1回だけ", async () => {
    const { user } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    await user.click(screen.getByRole("link", { name: "別の画面" }));
    const discard = await screen.findByRole("button", {
      name: "破棄して離れる",
    });
    act(() => {
      fireEvent.click(discard);
      fireEvent.click(discard);
    });
    await waitFor(() => expect(path()).toBe("/b"));
    expect(discarded).toEqual(["入力欄A"]);
  });

  it("#239 AC-4: 描画が追いつく前に別の遷移が済んで履歴のキーが変わっていたら、「破棄して離れる」を押しても proceed せず、下書きも消さない", async () => {
    const { user } = await renderBrowserProvider(["/a"]);
    expect(window.history.state?.key).toBeTruthy();
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    await user.click(screen.getByRole("link", { name: "別の画面" }));
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    // 別の遷移が履歴を進め、描画（location.key）がまだ追いついていない状態を再現する
    window.history.pushState(
      { usr: null, key: "key-of-another-navigation", idx: 99 },
      "",
    );
    await user.click(button("破棄して離れる"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(discarded).toEqual([]);
    expect(path()).toBe("/a");
    // Invalid blocker state transition が出ないことは、afterEach の console.error の確認で見る
  });

  it("#239 AC-5: 戻る（POP）で止めた直後、ルーターが履歴を戻し終える前でも、「編集を続ける」を1回押すだけで確認が閉じる", async () => {
    const { user } = await renderBrowserProvider(["/b", "/a"]);
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    act(() => {
      field("入力欄A").blur();
      field("入力欄A").focus();
    });
    // ルーターの history.go(-delta)（履歴を元の項目へ戻す）を止め、履歴が戻り先の項目のままの間を再現する
    goSpy = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    act(() => {
      window.history.back();
    });
    await screen.findByRole("dialog", { name: DIALOG_NAME });
    await user.click(button("編集を続ける"));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(path()).toBe("/a");
  });

  it("#239 AC-5: 「編集を続ける」の直後にもう一度止められて新しい確認になっても、その確認のボタンが効く（前の処理の印に引きずられない）", async () => {
    const { user } = renderProvider();
    await user.type(field("入力欄A"), "[[E2E_TEST]書きかけ");
    await user.click(screen.getByRole("link", { name: "別の画面" }));
    await user.click(
      await screen.findByRole("button", { name: "編集を続ける" }),
    );
    await waitFor(() => expect(dialog()).toBeNull());
    await user.click(screen.getByRole("link", { name: "別の画面" }));
    await user.click(
      await screen.findByRole("button", { name: "破棄して離れる" }),
    );
    await waitFor(() => expect(path()).toBe("/b"));
    expect(discarded).toEqual(["入力欄A"]);
    expect(dialog()).toBeNull();
  });
});
