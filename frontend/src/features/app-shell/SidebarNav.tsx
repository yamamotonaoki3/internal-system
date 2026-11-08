// サイドバーとドロワーが共用する、メニューの中身。
// 後続のIssueが足す場所：データを取るセクションは、下の「ここに差し込む」の位置に機能の部品を1行で足す。固定のリンクは navigation.ts に足す。
import { NavLink } from "react-router";
import { useSession } from "../auth/hooks/useSession";
import { AdminMenu } from "./AdminMenu";
import { NAV_LINK_CLASSES } from "./nav-link-classes";
import { adminNavGroups, primaryNavItems } from "./navigation";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const session = useSession();
  const permissions: ReadonlySet<string> = new Set(
    session.data?.permissions ?? [],
  );
  return (
    <div>
      {/* ここに差し込む：データを取るセクション（会社・自部署・他部署 → DM → 案件） */}
      <ul>
        {primaryNavItems.map((item) => (
          <li key={item.id}>
            <NavLink
              to={item.to}
              end
              onClick={onNavigate}
              className={({ isActive }) =>
                isActive ? NAV_LINK_CLASSES.active : NAV_LINK_CLASSES.idle
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <AdminMenu
        groups={adminNavGroups}
        permissions={permissions}
        onNavigate={onNavigate}
      />
    </div>
  );
}
