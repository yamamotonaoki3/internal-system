// スマホ幅（768px未満）の下部メニュー。今はホーム・通知（#124）・「自分」だけ。「自分」はアバターメニューを開く。
// 後続のIssueが足す順：ホーム → DM → 案件 → 通知（通知は追加済み）。「自分」は最後に固定する。
import { NavLink } from "react-router";
import { AvatarMenuTrigger } from "./AvatarMenu";
import { NAV_LINK_CLASSES } from "./nav-link-classes";
import { homeNavItem, notificationsNavItem } from "./navigation";

export function MobileNav() {
  return (
    <nav
      aria-label="下部メニュー"
      className="sticky bottom-0 border-t border-border bg-surface md:hidden"
    >
      <ul className="flex">
        <li className="flex flex-1 justify-center">
          <NavLink
            to={homeNavItem.to}
            end
            className={({ isActive }) =>
              isActive
                ? NAV_LINK_CLASSES.bottomActive
                : NAV_LINK_CLASSES.bottomIdle
            }
          >
            {homeNavItem.label}
          </NavLink>
        </li>
        <li className="flex flex-1 justify-center">
          <NavLink
            to={notificationsNavItem.to}
            className={({ isActive }) =>
              isActive
                ? NAV_LINK_CLASSES.bottomActive
                : NAV_LINK_CLASSES.bottomIdle
            }
          >
            {notificationsNavItem.label}
          </NavLink>
        </li>
        <li className="flex flex-1 justify-center">
          <AvatarMenuTrigger variant="self" />
        </li>
      </ul>
    </nav>
  );
}
