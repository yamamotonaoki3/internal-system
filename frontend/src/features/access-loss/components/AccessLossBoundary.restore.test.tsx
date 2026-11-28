// #342 AC-1・AC-4・AC-6（計画 plan342a2 の 3-3・3-4・4 節、7 節の U4・U5・V1 の部品の側、計画レビュー3回目の軽微3）：
// 境界 AccessLossBoundary と、復元の守り（page-restore-guard）。対象を持つ文書を、pagehide の同じ処理の中で hidden・inert で隠し、
// 復元の後の確かめが全件で通ったときだけ外す。子は外さず（入力・ダイアログ・部品の状態を保つ）、外したときに、フォーカス・選択範囲・要素のスクロールを戻す。
// 合成した pagehide・pageshow は、実際の bfcache の保存・復元の証拠ではない（実ブラウザの描画・配置・ウィンドウのスクロールは E2E と通常のブラウザでの確かめ）。
// jsdom は、hidden にした要素からフォーカスを外さず、display:none で要素のスクロールを戻さない。ブラウザで起きるこの2つは、テストの中で手で起こす。
// 入口（requestAccessLossReload・requestUserSwitchReload）は test/setup.ts の vi.fn。読み込み直しの状態は本物（このファイルでは idle のまま）。
// 前提にした口（実装の担当へ）：page-restore-guard.ts の getPageRestoreState()・subscribePageRestoreState(listener)・retryPageRestoreVerification()、
//   失敗の案内「画面を確認できませんでした。再試行してください」と共通の Button「再試行」（包みの外）。そのほかは test/page-restore-harness.tsx の冒頭
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { FakeBroadcastChannel } from "../../../test/fake-broadcast-channel";
import {
  RESTORE_FAILED_TEXT,
  RETRY_BUTTON,
  afterLaterRoundTrip,
  cacheParticipantSummary,
  firePageHide,
  firePageShow,
  gate,
  installRestoreGuardLikeMain,
  isCovered,
  isUncovered,
  newRestoreClient,
  renderInBoundary,
  respondRestoreWorld,
  waitForSessionAnswered,
  watchWrapperOnPageHide,
  wrapperOf,
  type RestoreWorld,
} from "../../../test/page-restore-harness";
import {
  getPageRestoreState,
  retryPageRestoreVerification,
  subscribePageRestoreState,
} from "../page-restore-guard";

const N = 342;
const CHILD_TEXT = "[UNIT_TEST]342境界の中の画面";
const INPUT_LABEL = "[UNIT_TEST]342入力欄";
const DIALOG_LABEL = "[UNIT_TEST]342子のダイアログ";
const TYPED = "abcdef";

let reportError: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  reportError = vi.fn();
  vi.stubGlobal("reportError", reportError);
  FakeBroadcastChannel.clearSent();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** 子：入力（部品の状態）・開いたダイアログ・スクロールする要素を持つ。作られた回数を数える（子を外していないことの確かめ） */
function RestorableScreen({ onMount }: { onMount: () => void }) {
  const [text, setText] = useState("");
  useEffect(() => {
    onMount();
  }, [onMount]);
  return (
    <section>
      <p>{CHILD_TEXT}</p>
      <label>
        {INPUT_LABEL}
        <input value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <div data-testid="scroller">
        <p>[UNIT_TEST]342長い一覧</p>
      </div>
      <dialog open aria-label={DIALOG_LABEL}>
        <p>[UNIT_TEST]342ダイアログの中身</p>
      </dialog>
    </section>
  );
}

type Screen = {
  world: RestoreWorld;
  wrapper: () => HTMLElement;
  mounts: () => number;
};

/** 参加者の案件を1件持つ文書。守り・境界・子を描画する（beforeRender は、境界の購読より前に呼ぶ） */
function arrangeScreen(
  options: Parameters<typeof installRestoreGuardLikeMain>[1] = {},
  beforeRender: () => void = () => undefined,
  strict = false,
): Screen {
  const world = respondRestoreWorld();
  world.addCase(N);
  const client = newRestoreClient();
  cacheParticipantSummary(client, N);
  installRestoreGuardLikeMain(client, options);
  beforeRender();
  let mounted = 0;
  const onMount = () => {
    mounted += 1;
  };
  renderInBoundary(client, <RestorableScreen onMount={onMount} />, { strict });
  const wrapper = () =>
    wrapperOf(screen.getByText(CHILD_TEXT).closest("section") as HTMLElement);
  return { world, wrapper, mounts: () => mounted };
}

async function waitForState(state: ReturnType<typeof getPageRestoreState>) {
  await waitFor(() => expect(getPageRestoreState()).toBe(state));
}

function failedNotice(): HTMLElement {
  return screen.getByText(RESTORE_FAILED_TEXT);
}

describe("#342 AC-1 U4 pagehide の同じ処理の中で、対象を持つ文書を隠す", () => {
  it.each([true, false])(
    "#342 AC-1 U4: 対象を持つ文書は、pagehide（persisted=%s）の同じ処理の中で、包みに hidden と inert が付く（後から登録したリスナーが見る。act の後の反映ではない）",
    (persisted) => {
      const { wrapper } = arrangeScreen();
      const seen = watchWrapperOnPageHide(wrapper);
      expect(isUncovered(wrapper())).toBe(true);
      firePageHide(persisted);
      expect(seen).toEqual([{ hidden: true, inert: true }]);
      expect(isCovered(wrapper())).toBe(true);
      expect(getPageRestoreState()).toBe("prepared");
    },
  );

  it("#342 AC-1・AC-4 U4: main.tsx と同じ StrictMode（効果の登録 → 解除 → 再登録）でも、pagehide の同じ処理の中で隠れ、確かめが通れば外れる", async () => {
    const { wrapper } = arrangeScreen({}, () => undefined, true);
    const seen = watchWrapperOnPageHide(wrapper);
    firePageHide(true);
    expect(seen).toEqual([{ hidden: true, inert: true }]);
    firePageShow(true);
    await waitForState("idle");
    await waitFor(() => expect(isUncovered(wrapper())).toBe(true));
  });

  it("#342 AC-1・AC-10 U4: 対象が0件で、読み込み直しが idle の文書は、pagehide で隠さず、守りは idle のまま", () => {
    respondRestoreWorld();
    const client = newRestoreClient();
    installRestoreGuardLikeMain(client);
    renderInBoundary(client, <p>{CHILD_TEXT}</p>);
    const wrapper = () => wrapperOf(screen.getByText(CHILD_TEXT));
    const seen = watchWrapperOnPageHide(wrapper);
    firePageHide(true);
    expect(seen).toEqual([{ hidden: false, inert: false }]);
    expect(getPageRestoreState()).toBe("idle");
  });
});

describe("#342 AC-1 U5 捕捉・通知・描画・覆いの例外の後も、隠したまま", () => {
  it("#342 AC-1 U5: 対象の捕捉が例外を投げても、pagehide の中で隠れ、例外は reportError に渡る。捕捉の例外を対象0件として扱わない（戻っても、確かめずに外さない）", async () => {
    const failure = new Error("[UNIT_TEST]342捕捉の失敗");
    const { world, wrapper } = arrangeScreen({
      overrides: {
        listTargets: () => {
          throw failure;
        },
      },
    });
    const seen = watchWrapperOnPageHide(wrapper);
    firePageHide(true);
    expect(seen).toEqual([{ hidden: true, inert: true }]);
    expect(reportError).toHaveBeenCalledWith(failure);
    firePageShow(true);
    // 戻った後の処理が終わったこと（セッションの応答が届いた、または確かめが終わった）を待つ。
    // セッションは同じ利用者のまま答えるが、捕捉できなかった対象を、確かめたことにはしない
    // 統括の判断（2026-11-28）：捕まえた対象が無いので、案件を確かめずに failed になる。その後の続きの終わりは、後からの1往復で待つ
    await waitForState("failed");
    await afterLaterRoundTrip();
    expect(getPageRestoreState()).not.toBe("idle");
    expect(world.summaryCalls).toEqual([]);
    expect(isCovered(wrapper())).toBe(true);
  });

  it("#342 AC-1 U5: 状態の通知（購読者）が例外を投げても、pagehide の中で隠れ、例外は reportError に渡る", () => {
    const { wrapper } = arrangeScreen();
    const failure = new Error("[UNIT_TEST]342通知の失敗");
    const stop = subscribePageRestoreState(() => {
      throw failure;
    });
    const seen = watchWrapperOnPageHide(wrapper);
    firePageHide(true);
    stop();
    expect(seen).toEqual([{ hidden: true, inert: true }]);
    expect(isCovered(wrapper())).toBe(true);
    expect(reportError).toHaveBeenCalledWith(failure);
  });

  // 統括の判断（2026-11-28）：復元の覆いは showModal で開かない（開くと、開いている auto の popover が閉じ、決定1「資格があれば、画面の状態を保つ」に反する）。
  // 覆いは、包みの外の通常の全画面の要素。覆いの表示のどこかで例外が起きても、pagehide で付けた hidden・inert は外れない
  it("#342 AC-1・AC-4 U5: 復元の覆いの間（確かめの間・失敗の間）は showModal を呼ばない。覆いを開く処理（dialog の show・popover の showPopover）が例外を投げても、hidden・inert は外れず、投げた例外は reportError に届く。子の開いたダイアログは開いたまま", async () => {
    const { world, wrapper } = arrangeScreen();
    const failure = new DOMException(
      "[UNIT_TEST]342開けない",
      "InvalidStateError",
    );
    const showModal = vi
      .spyOn(HTMLDialogElement.prototype, "showModal")
      .mockImplementation(() => {
        throw failure;
      });
    const opening = [
      vi.spyOn(HTMLDialogElement.prototype, "show").mockImplementation(() => {
        throw failure;
      }),
      vi.spyOn(HTMLElement.prototype, "showPopover").mockImplementation(() => {
        throw failure;
      }),
    ];
    const childDialog = screen.getByRole("dialog", { name: DIALOG_LABEL });
    const held = gate();
    world.session.gates.push(held.promise);
    world.session.answers.push({ kind: "network" });
    firePageHide(true);
    firePageShow(true);
    await waitForState("verifying");
    expect(isCovered(wrapper())).toBe(true);
    // 保留した要求を解いて（通信の失敗）、失敗の覆いまで進める（未処理の要求を残さない）
    held.release();
    await waitForState("failed");
    await waitForSessionAnswered(world, 1);
    await afterLaterRoundTrip();
    expect(isCovered(wrapper())).toBe(true);
    expect(showModal).not.toHaveBeenCalled();
    expect(childDialog.hasAttribute("open")).toBe(true);
    // 覆いを開く処理を使う作りなら、その例外は、もみ消さず reportError に届く
    if (opening.some((spy) => spy.mock.calls.length > 0))
      expect(reportError).toHaveBeenCalledWith(failure);
  });

  it("#342 AC-1・AC-6 U5: 描画への反映（React の購読）が届かないまま失敗しても、再試行が全件で通れば、包みの hidden・inert と覆いが外れる（直接付けた属性を残さない）", async () => {
    const failure = new Error("[UNIT_TEST]342描画への反映の失敗");
    let stop: () => void = () => undefined;
    // 境界の購読より先に登録した購読者が、idle 以外の通知で投げる（後の購読者に通知が届かない作りでも、外れることを確かめる）
    const { world, wrapper } = arrangeScreen({}, () => {
      stop = subscribePageRestoreState(() => {
        if (getPageRestoreState() !== "idle") throw failure;
      });
    });
    world.session.answers.push({ kind: "network" });
    firePageHide(true);
    firePageShow(true);
    await waitForState("failed");
    expect(isCovered(wrapper())).toBe(true);
    await act(async () => {
      retryPageRestoreVerification();
    });
    await waitForState("idle");
    await waitFor(() => expect(isUncovered(wrapper())).toBe(true));
    stop();
    expect(screen.queryByText(RESTORE_FAILED_TEXT)).toBeNull();
    expect(screen.queryByRole("button", { name: RETRY_BUTTON })).toBeNull();
    expect(reportError).toHaveBeenCalledWith(failure);
  });
});

describe("#342 AC-1・AC-6 V1 確かめの間と失敗の間は隠し、再試行が通った後だけ外す", () => {
  it("#342 AC-1・AC-6 V1: 確かめの間は隠れ、通信の失敗で failed になると、包みの外に案内と再試行のボタンが出る。再試行の確かめの間はボタンを押せず、通れば外れる", async () => {
    const { world, wrapper } = arrangeScreen();
    world.session.answers.push({ kind: "network" });
    firePageHide(true);
    firePageShow(true);
    await waitForState("failed");
    expect(isCovered(wrapper())).toBe(true);
    const notice = failedNotice();
    const retry = screen.getByRole("button", { name: RETRY_BUTTON });
    expect(wrapper().contains(notice)).toBe(false);
    expect(wrapper().contains(retry)).toBe(false);

    const held = gate();
    world.session.gates.push(held.promise);
    await userEvent.setup().click(retry);
    await waitForState("verifying");
    // 確かめの間は、二重に押せない（ボタンが無いか、押せない）
    const during = screen.queryByRole("button", { name: RETRY_BUTTON });
    if (during !== null)
      expect((during as HTMLButtonElement).disabled).toBe(true);
    expect(isCovered(wrapper())).toBe(true);
    held.release();
    await waitForState("idle");
    await waitFor(() => expect(isUncovered(wrapper())).toBe(true));
    expect(screen.queryByText(RESTORE_FAILED_TEXT)).toBeNull();
    expect(world.session.calls).toBe(2);
  });
});

describe("#342 AC-4 資格があれば、子を外さず、入力・ダイアログ・フォーカス・選択範囲・要素のスクロールを戻す", () => {
  async function typeAndPlace(): Promise<{
    input: HTMLInputElement;
    scroller: HTMLElement;
    dialog: HTMLElement;
  }> {
    const input = screen.getByLabelText(INPUT_LABEL) as HTMLInputElement;
    await userEvent.setup().type(input, TYPED);
    input.focus();
    input.setSelectionRange(1, 4, "backward");
    const scroller = screen.getByTestId("scroller");
    scroller.scrollTop = 120;
    scroller.scrollLeft = 30;
    const dialog = screen.getByRole("dialog", { name: DIALOG_LABEL });
    return { input, scroller, dialog };
  }

  /** 包みの外にボタンを置き、そこへフォーカスを移す（テストの終わりに外す） */
  function focusOutside(): HTMLElement {
    const outside = document.createElement("button");
    outside.textContent = "[UNIT_TEST]342包みの外";
    document.body.appendChild(outside);
    onTestFinished(() => {
      outside.remove();
    });
    outside.focus();
    return outside;
  }

  /**
   * 隠れている間に、ブラウザで起きること（隠れた要素からフォーカスが外れ、要素のスクロールが戻る）を手で起こす。
   * jsdom の blur は、hidden の祖先を持つ要素では何もしないので、包みの外の要素へフォーカスを移す（隠すとフォーカスが外れる動きは E2E の E1）
   */
  function loseWhileHidden(input: HTMLInputElement, scroller: HTMLElement) {
    input.setSelectionRange(0, 0);
    const outside = focusOutside();
    expect(document.activeElement).toBe(outside);
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
  }

  it("#342 AC-4 V1: 全件の資格を確かめて外したとき、同じ入力欄（同じ値）・開いたダイアログ・部品の状態が残り、フォーカス・選択範囲・要素のスクロールが戻る", async () => {
    const { world, wrapper, mounts } = arrangeScreen();
    const { input, scroller, dialog } = await typeAndPlace();
    firePageHide(true);
    expect(isCovered(wrapper())).toBe(true);
    loseWhileHidden(input, scroller);
    firePageShow(true);
    await waitForState("idle");
    await waitFor(() => expect(isUncovered(wrapper())).toBe(true));
    expect(world.summaryCalls).toHaveLength(1);
    expect(screen.getByLabelText(INPUT_LABEL)).toBe(input);
    expect(input.value).toBe(TYPED);
    expect(screen.getByRole("dialog", { name: DIALOG_LABEL })).toBe(dialog);
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(mounts()).toBe(1);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect([
      input.selectionStart,
      input.selectionEnd,
      input.selectionDirection,
    ]).toEqual([1, 4, "backward"]);
    expect([scroller.scrollTop, scroller.scrollLeft]).toEqual([120, 30]);
  });

  it("#342 AC-4・AC-6: 確かめに失敗した間は、フォーカスを戻さない。失敗中にもう一度離れても、最初に捕捉した表示の状態を上書きせず、次の確かめが通ったときに、最初の状態へ戻す", async () => {
    const { world, wrapper } = arrangeScreen();
    const { input, scroller } = await typeAndPlace();
    world.session.answers.push({ kind: "network" });
    firePageHide(true);
    // jsdom の blur は、hidden の祖先を持つ要素では何もしないので、隠れた後のフォーカスの移動は、包みの外の要素へのフォーカスで起こす
    // （ブラウザで「隠すとフォーカスが外れる」動きは、E2E の E1 に任せる）
    const outside = focusOutside();
    input.setSelectionRange(0, 0);
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    // 失敗の間に、守りが入力欄へ focus() しないことを見張る
    const focusCalls: Element[] = [];
    const focusSpy = vi
      .spyOn(HTMLElement.prototype, "focus")
      .mockImplementation(function (this: HTMLElement) {
        focusCalls.push(this);
      });
    firePageShow(true);
    await waitForState("failed");
    await waitForSessionAnswered(world, 1);
    await afterLaterRoundTrip();
    expect(focusCalls).not.toContain(input);
    expect(document.activeElement).toBe(outside);
    focusSpy.mockRestore();
    expect(input.value).toBe(TYPED);
    // 失敗中（フォーカスは body、スクロールは 0）に、もう一度離れて戻る
    firePageHide(true);
    expect(isCovered(wrapper())).toBe(true);
    firePageShow(true);
    await waitForState("idle");
    await waitFor(() => expect(isUncovered(wrapper())).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 4]);
    expect([scroller.scrollTop, scroller.scrollLeft]).toEqual([120, 30]);
    await waitForSessionAnswered(world, 2);
  });
});

// 軽微3：守りの状態は、ファイルの中で持ち越しうる（モジュールの状態）。後始末（page-restore-harness の afterEach）で、登録を解除して idle に戻す。
// 次の2件は、この順に並べる（1件目が failed のまま終わり、2件目が守りを登録しない既存の境界の描画で、前の状態が残っていないことを見る）
describe("#342 計画レビュー3回目の軽微3 守りの状態の既定は idle。登録の解除で初期に戻る", () => {
  it("#342 AC-1 軽微3: 登録を解除すると、守りの状態は idle に戻り、境界は子を隠さない", () => {
    const world = respondRestoreWorld();
    world.addCase(N);
    const client = newRestoreClient();
    cacheParticipantSummary(client, N);
    const wiring = installRestoreGuardLikeMain(client);
    renderInBoundary(client, <p>{CHILD_TEXT}</p>);
    const wrapper = () => wrapperOf(screen.getByText(CHILD_TEXT));
    firePageHide(true);
    expect(getPageRestoreState()).toBe("prepared");
    act(() => {
      wiring.dispose();
    });
    expect(getPageRestoreState()).toBe("idle");
    expect(isUncovered(wrapper())).toBe(true);
    // 解除の後の pageshow では、確かめない
    firePageShow(true);
    expect(world.session.calls).toBe(0);
  });

  it("#342 AC-6 軽微3（1件目）: 確かめに失敗した状態のまま、テストを終える（後始末で初期に戻る）", async () => {
    const { world } = arrangeScreen();
    world.session.answers.push({ kind: "network" });
    firePageHide(true);
    firePageShow(true);
    await waitForState("failed");
  });

  it("#342 軽微3（2件目）: 前のテストが failed で終わっても、守りを登録しない既存の境界の描画では、状態は idle で、子を隠さず、覆い・案内を出さない", () => {
    expect(getPageRestoreState()).toBe("idle");
    renderInBoundary(newRestoreClient(), <p>{CHILD_TEXT}</p>);
    expect(isUncovered(wrapperOf(screen.getByText(CHILD_TEXT)))).toBe(true);
    expect(screen.queryByText(RESTORE_FAILED_TEXT)).toBeNull();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });
});
