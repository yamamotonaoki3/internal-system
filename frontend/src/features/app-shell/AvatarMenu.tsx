// アバターメニュー（ネイティブ popover）。
// ヘッダーのアバター（768px以上）と下部メニューの「自分」（768px未満）が、同じ1つの popover を開く。
// 開閉・Esc・外側クリック・最前面は popover="auto" とボタンの popoverTarget に任せる。role="menu" は使わない（中身はボタン1つで、矢印キーの約束を作らないため）。
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ToggleEvent,
} from "react";
import { Button } from "../../components/Button";
import { Link, useLocation } from "react-router";
import { LogoutButton } from "../auth/components/LogoutButton";
import { useSession } from "../auth/hooks/useSession";
import { DESKTOP_QUERY, focusMainContent } from "./main-content";

const AVATAR_MENU_ID = "avatar-menu";

const AvatarMenuContext = createContext<{ expanded: boolean } | null>(null);

export function AvatarMenuProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // :popover-open には頼らず、toggle イベントの newState で開閉を追う
  const openRef = useRef(false);

  function handleToggle(event: ToggleEvent<HTMLDivElement>) {
    const open = event.nativeEvent.newState === "open";
    openRef.current = open;
    setExpanded(open);
  }

  // 開いたまま 768px の境界を越える（どちらの向きでも）と、起動したボタンが非表示になる。メニューを閉じ、フォーカスが失われないよう本文へ移す。
  // 非表示になったボタンのフォーカスは、ブラウザが先に body へ外すため、開閉は newState の追跡で判定する
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    function handleChange() {
      const panel = panelRef.current;
      // toggle イベントは非同期で届くため、開いた直後に幅が変わると追跡が遅れる。その分は :popover-open で補う
      if (panel === null) return;
      if (!openRef.current && !panel.matches(":popover-open")) return;
      panel.hidePopover();
      const active = document.activeElement;
      const focusLost =
        active === null ||
        active === document.body ||
        (active instanceof HTMLElement &&
          (panel.contains(active) ||
            active.getAttribute("popovertarget") === AVATAR_MENU_ID));
      // 他の有効な要素にフォーカスがあるときは奪わない
      if (focusLost) focusMainContent();
    }
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return (
    <AvatarMenuContext value={{ expanded }}>
      {children}
      <div
        id={AVATAR_MENU_ID}
        ref={panelRef}
        popover="auto"
        onToggle={handleToggle}
        className="inset-auto bottom-16 right-2 rounded-md border border-border bg-surface p-3 text-text shadow-float md:bottom-auto md:top-12"
      >
        <Link
          to="/password"
          state={{ from: location.pathname + location.search + location.hash }}
          className="mb-2 block text-primary underline"
        >
          パスワードを変更
        </Link>
        <LogoutButton />
      </div>
    </AvatarMenuContext>
  );
}

/** アバターメニューを開くボタン。variant="avatar" はヘッダー用、"self" は下部メニューの「自分」 */
export function AvatarMenuTrigger({ variant }: { variant: "avatar" | "self" }) {
  const context = useContext(AvatarMenuContext);
  const { data } = useSession();
  if (context === null) {
    throw new Error("AvatarMenuTrigger は AvatarMenuProvider の中で使う");
  }
  if (data === undefined) return null;
  const common = {
    popoverTarget: AVATAR_MENU_ID,
    "aria-controls": AVATAR_MENU_ID,
    "aria-expanded": context.expanded,
    variant: "ghost",
  } as const;
  if (variant === "self") return <Button {...common}>自分</Button>;
  const name = data.user.displayName;
  return (
    <Button {...common} aria-label={`アカウントメニュー（${name}）`}>
      {Array.from(name)[0]}
    </Button>
  );
}
