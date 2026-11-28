// 読み込み直しを待つ間と、読み込み直しを呼んでから文書が替わるまでの間（#338 AC-2）、子（ルーター全体）を描画から外し、全画面の覆いだけを出す。
// hidden（display:none）で、子のモーダル・popover（最上位の層）も、後から開いたものも描かれない。inert で、フォーカス・クリックも届かない。
// 読み込み直しの覆いは包みの外の dialog（showModal）。Esc（cancel）を止め、閉じられたら開き直す。
// 文書が丸ごと戻る場合（bfcache。#342）は、守り（page-restore-guard）が pagehide の処理の中で包みを直接隠す。描画を待つと、戻った直後に中身が見えるため。
// 包みの hidden・inert は、毎回の描画の後に、その時点の状態から両方向に付け直す（直接付けた属性を、古い描画の値で残さない・取り消さない）。
// 復元の覆いは、原則として dialog の showModal にしない（開くと、開いている popover が閉じ、戻ったときに画面の状態が変わるため）。中身は inert で操作を止める。
// ただし、子のモーダルが開いたままの失敗では、モーダルにする（FailedModal）。
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import {
  attachPageRestoreSurface,
  getPageRestoreState,
  reloadWhenRetryUnreachable,
  retryPageRestoreVerification,
  subscribePageRestoreState,
  type PageRestoreState,
} from "../page-restore-guard";
import {
  getAccessLossReloadState,
  subscribeAccessLossReloadState,
} from "../reload-after-access-loss";

const OVERLAY_TITLE = "画面を読み込み直しています";
const VERIFYING_TITLE = "画面を確認しています";
const RESTORE_FAILED_TEXT = "画面を確認できませんでした。再試行してください";

function openModal(dialog: HTMLDialogElement): void {
  if (!dialog.open) dialog.showModal();
}

function ReloadingOverlay() {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (ref.current !== null) openModal(ref.current);
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => event.preventDefault()}
      onClose={(event) => openModal(event.currentTarget)}
      className="m-0 h-full max-h-none w-full max-w-none bg-bg p-6 text-text backdrop:bg-bg"
    >
      <h2 id={titleId} className="text-xl font-bold">
        {OVERLAY_TITLE}
      </h2>
    </dialog>
  );
}

/** Esc の閉じる要求を止める（キーの既定の動きを取り消すと、ブラウザは閉じる要求を出さない） */
function stopEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") event.preventDefault();
}

function FailedContent() {
  return (
    <>
      <Alert tone="error" role="alert" as="p">
        {RESTORE_FAILED_TEXT}
      </Alert>
      <Button onClick={retryPageRestoreVerification}>再試行</Button>
    </>
  );
}

/** 子のモーダルが開いている（祖先を hidden にしても、文書のほかの所は操作できないまま） */
function hasOpenModal(): boolean {
  return document.querySelector("dialog:modal") !== null;
}

/**
 * 子のモーダルが開いたままの失敗の覆い。それより後に開いたモーダルが一番上になるので、覆いをモーダルにして再試行を押せるようにする。
 * 子のモーダルは、この下で操作できなくなる。外れたら閉じ、子のモーダルが再び一番上になる（開いている auto の popover は、開くときに閉じる）
 */
function FailedModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch (error) {
        reportError(error);
        // 子のモーダルの下では再試行に届かないので、中身を隠したまま読み込み直す
        reloadWhenRetryUnreachable();
      }
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={RESTORE_FAILED_TEXT}
      onCancel={(event) => event.preventDefault()}
      className="m-0 h-full max-h-none w-full max-w-none bg-bg p-6 text-text backdrop:bg-bg"
    >
      <FailedContent />
    </dialog>
  );
}

/** 失敗の覆い。子のモーダルが無ければ、開いている popover を閉じないよう、モーダルでない通常の要素にする */
function FailedOverlay() {
  // 失敗になったときに1回だけ見る（覆いの間は、中身が新しくモーダルを開けない）
  const [overModal] = useState(hasOpenModal);
  if (overModal) return <FailedModal />;
  return (
    <div className="fixed inset-0 bg-bg p-6 text-text">
      <FailedContent />
    </div>
  );
}

/** 復元の確かめの間・引き渡しの後・失敗の覆い（包みの外） */
function RestoreOverlay({ state }: { state: PageRestoreState }) {
  // 隠した中身のモーダル・popover は最上位の層に残り、モーダルでない覆いの下でも Esc の閉じる要求を受けるので、覆いの間は止める
  useEffect(() => {
    window.addEventListener("keydown", stopEscape, true);
    return () => window.removeEventListener("keydown", stopEscape, true);
  }, []);
  if (state === "failed") return <FailedOverlay />;
  return (
    <div className="fixed inset-0 bg-bg p-6 text-text">
      <h2 className="text-xl font-bold">
        {state === "handedOff" ? OVERLAY_TITLE : VERIFYING_TITLE}
      </h2>
    </div>
  );
}

function isCovering(): boolean {
  return (
    getAccessLossReloadState() !== "idle" || getPageRestoreState() !== "idle"
  );
}

function applyCover(wrapper: HTMLElement, covered: boolean): void {
  if (covered) {
    wrapper.setAttribute("hidden", "");
    wrapper.setAttribute("inert", "");
  } else {
    wrapper.removeAttribute("hidden");
    wrapper.removeAttribute("inert");
  }
}

type TextSelection = {
  element: HTMLInputElement | HTMLTextAreaElement;
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
};

/** 隠す前の表示の状態。隠すと、フォーカスは外れ、スクロールは戻るため、外したときに戻す */
type CapturedView = {
  windowX: number;
  windowY: number;
  scrolled: { element: Element; top: number; left: number }[];
  focused: HTMLElement | null;
  selection: TextSelection | null;
};

function selectionOf(element: HTMLElement | null): TextSelection | null {
  if (!(
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ))
    return null;
  // 選択範囲を持たない種類の入力欄は null を返す
  const { selectionStart, selectionEnd, selectionDirection } = element;
  if (selectionStart === null || selectionEnd === null) return null;
  return {
    element,
    start: selectionStart,
    end: selectionEnd,
    direction: selectionDirection ?? "none",
  };
}

function captureView(wrapper: HTMLElement): CapturedView {
  const scrolled = [...wrapper.querySelectorAll("*")]
    .filter((element) => element.scrollTop !== 0 || element.scrollLeft !== 0)
    .map((element) => ({
      element,
      top: element.scrollTop,
      left: element.scrollLeft,
    }));
  const active = document.activeElement;
  const focused =
    active instanceof HTMLElement && wrapper.contains(active) ? active : null;
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    scrolled,
    focused,
    selection: selectionOf(focused),
  };
}

/** 外した後に、フォーカス（スクロールさせずに）→ 選択範囲 → 要素のスクロール → ウィンドウのスクロールの順に戻す */
function restoreView(wrapper: HTMLElement, view: CapturedView): void {
  const { focused, selection } = view;
  if (focused !== null && focused.isConnected && wrapper.contains(focused)) {
    focused.focus({ preventScroll: true });
    if (selection !== null && selection.element === focused)
      selection.element.setSelectionRange(
        selection.start,
        selection.end,
        selection.direction,
      );
  }
  for (const { element, top, left } of view.scrolled)
    if (element.isConnected) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  if (window.scrollX !== view.windowX || window.scrollY !== view.windowY)
    window.scrollTo({
      left: view.windowX,
      top: view.windowY,
      behavior: "instant",
    });
}

export function AccessLossBoundary({ children }: { children: ReactNode }) {
  const reloadState = useSyncExternalStore(
    subscribeAccessLossReloadState,
    getAccessLossReloadState,
  );
  const restoreState = useSyncExternalStore(
    subscribePageRestoreState,
    getPageRestoreState,
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<CapturedView | null>(null);
  const restorePendingRef = useRef(false);

  // 毎回の描画の後：その時点の状態（描画したときの値ではない）から付け直す。資格を確かめて外れたときだけ、表示の状態を戻す
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const covered = isCovering();
    applyCover(wrapper, covered);
    if (covered || !restorePendingRef.current) return;
    restorePendingRef.current = false;
    const view = viewRef.current;
    viewRef.current = null;
    if (view !== null) restoreView(wrapper, view);
  });

  useLayoutEffect(
    () =>
      attachPageRestoreSurface({
        captureView: () => {
          const wrapper = wrapperRef.current;
          restorePendingRef.current = false;
          viewRef.current = wrapper === null ? null : captureView(wrapper);
        },
        cover: () => {
          const wrapper = wrapperRef.current;
          if (wrapper !== null) applyCover(wrapper, true);
        },
        release: (restore) => {
          const wrapper = wrapperRef.current;
          if (!restore) viewRef.current = null;
          restorePendingRef.current = restore;
          // 外す直前にも、読み込み直しが idle かを確かめる（読み込み直しの覆いの下で、中身を出さない）
          if (wrapper !== null) applyCover(wrapper, isCovering());
        },
      }),
    [],
  );

  return (
    <>
      <div ref={wrapperRef}>{children}</div>
      {reloadState !== "idle" ? (
        <ReloadingOverlay />
      ) : (
        restoreState !== "idle" && <RestoreOverlay state={restoreState} />
      )}
    </>
  );
}
