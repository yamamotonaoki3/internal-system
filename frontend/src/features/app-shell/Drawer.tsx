// スマホ幅（768px未満）のメニュー。ネイティブ <dialog> を showModal() で開く。
// フォーカスの閉じ込め・背面の無効化・Esc は <dialog> に任せる。ここで受け持つのは、開閉の状態との同期、backdrop のクリック、フォーカスの戻し先、画面幅の変更で閉じること。
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { Button } from "../../components/Button";
import { DESKTOP_QUERY, focusMainContent } from "./main-content";
import { SidebarNav } from "./SidebarNav";

type DrawerProps = {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 閉じたときにフォーカスを戻す、開いたボタン */
  openerRef: RefObject<HTMLButtonElement | null>;
};

export function Drawer({ id, open, onOpenChange, openerRef }: DrawerProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // 画面幅の変更で閉じるときは、非表示になる開いたボタンではなく本文へフォーカスを移す
  const closedByResizeRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = window.matchMedia(DESKTOP_QUERY);
    function handleChange(event: MediaQueryListEvent) {
      if (!event.matches) return;
      closedByResizeRef.current = true;
      onOpenChange(false);
    }
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [open, onOpenChange]);

  // 閉じた理由によらず、close イベントでフォーカスの戻し先を一度だけ決める。
  // ブラウザも閉じるときに開いたボタンへ戻すうえ、close イベントは遅れて届くため、フォーカスが失われているときだけ移し、利用者が移動した先は奪わない
  function handleClose() {
    onOpenChange(false);
    const dialog = dialogRef.current;
    const opener = openerRef.current;
    const active = document.activeElement;
    const focusLost =
      active === null ||
      active === document.body ||
      (dialog !== null && active instanceof Node && dialog.contains(active));
    if (closedByResizeRef.current) {
      closedByResizeRef.current = false;
      if (focusLost || (opener !== null && active === opener))
        focusMainContent();
      return;
    }
    if (focusLost) opener?.focus();
  }

  // backdrop は dialog 自身へのクリックになる。中身はラッパーで覆っているため、余白のクリックでは閉じない
  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) onOpenChange(false);
  }

  // Chrome のモーダル dialog は背面を inert にするだけで、端の部品で Tab を押すとフォーカスがブラウザ側へ抜ける。端で反対の端へ回す
  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
      "button:not(:disabled), a[href]",
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      id={id}
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={handleClose}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="fixed inset-y-0 left-0 h-full max-h-full w-4/5 max-w-xs bg-surface text-text shadow-float backdrop:bg-text/40"
    >
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
        <div className="flex items-center justify-between">
          <p id={titleId} className="px-3 text-lg font-bold">
            メニュー
          </p>
          <Button
            ref={closeRef}
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            メニューを閉じる
          </Button>
        </div>
        <nav aria-label="メインメニュー">
          <SidebarNav onNavigate={() => onOpenChange(false)} />
        </nav>
      </div>
    </dialog>
  );
}
