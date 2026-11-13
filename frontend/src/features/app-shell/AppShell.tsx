// ログイン後の全画面が使う枠（レイアウトルート）。スキップリンク・ヘッダー・サイドバー・本文・下部メニュー・ドロワー・アバターメニュー。
// 各画面は <Outlet /> に入る。ログイン済みかの確認は、この外側の RequireAuth が行う。
import { useCallback, useId, useRef, useState } from "react";
import { Outlet } from "react-router";
import { LogoutFailureNotice } from "../auth";
import { AvatarMenuProvider } from "./AvatarMenu";
import { Drawer } from "./Drawer";
import { Header } from "./Header";
import { MAIN_CONTENT_ID } from "./main-content";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const drawerId = useId();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpenerRef = useRef<HTMLButtonElement>(null);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);

  return (
    // body の左右の余白（ログイン前の画面用）を打ち消して、画面いっぱいに広げる
    <div className="-mx-4 flex min-h-screen flex-col">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:bg-surface focus:p-3 focus:text-primary focus:underline"
      >
        本文へ移動
      </a>
      <AvatarMenuProvider>
        <Header
          drawerId={drawerId}
          drawerOpen={drawerOpen}
          onOpenDrawer={openDrawer}
          drawerOpenerRef={drawerOpenerRef}
        />
        <LogoutFailureNotice />
        <div className="flex flex-1">
          <Sidebar />
          <main
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            className="min-w-0 flex-1 p-4 md:p-6"
          >
            <Outlet />
          </main>
        </div>
        <MobileNav />
      </AvatarMenuProvider>
      <Drawer
        id={drawerId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        openerRef={drawerOpenerRef}
      />
    </div>
  );
}
