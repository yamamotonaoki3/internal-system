// 管理メニュー。権限のある項目があるまとまりだけを出し、1件もなければ「管理」の見出しごと何も出さない。
// これは表示の制御であり、認可ではない。操作の可否は、サーバーが毎回確かめる。
import { NavLink } from "react-router";
import {
  visibleAdminGroups,
  type AdminNavGroup,
  type Permission,
} from "./navigation";
import { NAV_LINK_CLASSES } from "./nav-link-classes";

type AdminMenuProps = {
  groups: readonly AdminNavGroup[];
  permissions: ReadonlySet<Permission>;
  onNavigate?: () => void;
};

export function AdminMenu({ groups, permissions, onNavigate }: AdminMenuProps) {
  const visible = visibleAdminGroups(groups, permissions);
  if (visible.length === 0) return null;
  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="mb-2 px-3 text-xs font-bold text-text-muted">管理</p>
      {visible.map((group) => (
        <details key={group.id}>
          <summary className="min-h-11 cursor-pointer px-3 py-2 font-bold md:min-h-10">
            {group.label}
          </summary>
          <ul>
            {group.items.map((item) => (
              <li key={item.id}>
                <NavLink
                  to={item.to}
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
        </details>
      ))}
    </div>
  );
}
