// ヘッダー。左にメニューボタン（スマホ幅のみ）とロゴ、右にアバター（パソコン幅のみ）。
// 後続のIssueが足す場所：右側に 検索 → 通知 → ステータス → アバター の順で1行ずつ足す。スマホでは検索・通知はアイコン、ステータスは色つきの丸、アバターは出さず下部メニューの「自分」から開く。
import type { RefObject } from "react";
import { Link } from "react-router";
import { Button } from "../../components/Button";
import { AvatarMenuTrigger } from "./AvatarMenu";
import { homeNavItem } from "./navigation";

type HeaderProps = {
  drawerId: string;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
  drawerOpenerRef: RefObject<HTMLButtonElement | null>;
};

export function Header({
  drawerId,
  drawerOpen,
  onOpenDrawer,
  drawerOpenerRef,
}: HeaderProps) {
  return (
    <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-surface px-4">
      <div className="flex items-center gap-2">
        <div className="md:hidden">
          <Button
            ref={drawerOpenerRef}
            variant="ghost"
            aria-expanded={drawerOpen}
            aria-controls={drawerId}
            onClick={onOpenDrawer}
          >
            メニューを開く
          </Button>
        </div>
        <Link to={homeNavItem.to} className="font-bold text-primary underline">
          internal-system
        </Link>
      </div>
      <div className="hidden md:block">
        <AvatarMenuTrigger variant="avatar" />
      </div>
    </header>
  );
}
