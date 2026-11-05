// パソコン幅（768px以上）のサイドバー。768px未満では、同じ中身をドロワーに出す。
import { SidebarNav } from "./SidebarNav";

export function Sidebar() {
  return (
    <nav
      aria-label="メインメニュー"
      className="hidden w-60 shrink-0 border-r border-border bg-surface p-3 md:block"
    >
      <SidebarNav />
    </nav>
  );
}
