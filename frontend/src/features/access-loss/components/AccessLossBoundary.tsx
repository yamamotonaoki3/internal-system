// 読み込み直しを待つ間と、読み込み直しを呼んでから文書が替わるまでの間（#338 AC-2）、子（ルーター全体）を描画から外し、全画面の覆いだけを出す。
// hidden（display:none）で、子のモーダル・popover（最上位の層）も、後から開いたものも描かれない。inert で、フォーカス・クリックも届かない。
// 覆いは包みの外の dialog（showModal）。Esc（cancel）を止め、閉じられたら開き直す。
import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  getAccessLossReloadState,
  subscribeAccessLossReloadState,
} from "../reload-after-access-loss";

const OVERLAY_TITLE = "画面を読み込み直しています";

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

export function AccessLossBoundary({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(
    subscribeAccessLossReloadState,
    getAccessLossReloadState,
  );
  const covering = state !== "idle";
  return (
    <>
      <div hidden={covering} inert={covering}>
        {children}
      </div>
      {covering && <ReloadingOverlay />}
    </>
  );
}
