// サイドバーの「ダイレクトメッセージ」。見出し・「新しいDM」・DM の一覧・一覧の画面（/dms）へのリンク。
// リンクの見た目は、枠（app-shell）が決める。機能から枠を参照しないよう、呼び出し側から受け取る。
import { NavLink } from "react-router";
import { DmItems } from "./DmItems";

type DmSectionProps = {
  linkClassName: (state: { isActive: boolean }) => string;
  onNavigate?: () => void;
};

export function DmSection({ linkClassName, onNavigate }: DmSectionProps) {
  return (
    <div className="mb-4">
      <p className="mb-2 px-3 text-xs font-bold text-text-muted">
        ダイレクトメッセージ
      </p>
      <NavLink to="/dms/new" onClick={onNavigate} className={linkClassName}>
        ＋ 新しいDM
      </NavLink>
      <DmItems linkClassName={linkClassName} onNavigate={onNavigate} />
      <NavLink to="/dms" end onClick={onNavigate} className={linkClassName}>
        DMの一覧
      </NavLink>
    </div>
  );
}
