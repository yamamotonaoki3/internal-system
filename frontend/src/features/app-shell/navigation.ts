// サイドバー・ドロワー・下部メニューの項目の定義。固定のリンクを足す場所は、この1か所だけ。
// データを取るセクション（チャンネル・DM・案件など）は、機能の部品を SidebarNav.tsx の決まった位置に差し込む（docs/design/app-shell.md）。

// 権限ID。セッションの応答に権限が入るまで、型は文字列として扱う（権限の一覧はバックエンドが持つ）
export type Permission = string;

export type NavItem = {
  id: string;
  label: string;
  to: string;
};

export type AdminNavItem = NavItem & { requires: Permission };

export type AdminNavGroup = {
  id: "approval" | "account" | "department" | "master-log";
  label: string;
  items: AdminNavItem[];
};

export const homeNavItem: NavItem = { id: "home", label: "ホーム", to: "/" };

export const primaryNavItems: NavItem[] = [homeNavItem];

// 管理メニューの4つのまとまり。項目は、画面を作る後続のIssueが items に足す
export const adminNavGroups: AdminNavGroup[] = [
  { id: "approval", label: "承認", items: [] },
  { id: "account", label: "アカウント", items: [] },
  { id: "department", label: "部署", items: [] },
  {
    id: "master-log",
    label: "マスタ・ログ",
    items: [
      {
        id: "clients",
        label: "取引先管理",
        to: "/clients",
        requires: "perm.client.manage",
      },
    ],
  },
];

/** 持っている権限の項目だけを残し、項目が0件のまとまりは除く。定義は書き換えない */
export function visibleAdminGroups(
  groups: readonly AdminNavGroup[],
  permissions: ReadonlySet<Permission>,
): AdminNavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => permissions.has(item.requires)),
    }))
    .filter((group) => group.items.length > 0);
}
