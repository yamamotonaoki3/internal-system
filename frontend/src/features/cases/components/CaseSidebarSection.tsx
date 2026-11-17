// サイドバーの「案件」の見出しと、その下の参加している進行中の案件（最初の1ページ）。押すと S-17 に移る。
// リンクの見た目は、枠（app-shell）が決める。機能から枠を参照しないよう、呼び出し側から受け取る。
// 取得に失敗しても、この部品の中にエラーを出す（0件とは出さず、枠全体は壊さない）。
import { NavLink } from "react-router";
import { describeError } from "../describe-error";
import { useCases } from "../hooks/useCases";

type CaseSidebarSectionProps = {
  linkClassName: (state: { isActive: boolean }) => string;
  onNavigate?: () => void;
};

export function CaseSidebarSection({
  linkClassName,
  onNavigate,
}: CaseSidebarSectionProps) {
  const cases = useCases("joined", "active");
  const items = cases.data?.pages[0]?.items ?? [];
  return (
    <div className="mb-4">
      <p className="mb-2 px-3 text-xs font-bold text-text-muted">案件</p>
      {cases.isPending && (
        <p role="status" className="px-3 text-sm">
          案件を読み込み中です
        </p>
      )}
      {cases.isError && (
        <p role="alert" className="px-3 text-sm text-danger">
          {describeError(cases.error)}
        </p>
      )}
      {cases.isSuccess && items.length === 0 && (
        <p className="px-3 text-sm">参加中の案件はありません</p>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <NavLink
              to={`/cases/${item.id}`}
              onClick={onNavigate}
              className={linkClassName}
            >
              {item.title}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
