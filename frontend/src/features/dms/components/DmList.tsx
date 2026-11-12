// DM の一覧の画面（/dms）の中身。DM ごとのリンクと「新しいDM」。
import { Link } from "react-router";
import { DmItems } from "./DmItems";

const LINK_CLASS = "block px-3 py-2 text-primary underline";

export function DmList() {
  return (
    <div>
      <p className="mb-4">
        <Link to="/dms/new" className="font-bold text-primary underline">
          ＋ 新しいDM
        </Link>
      </p>
      <DmItems linkClassName={() => LINK_CLASS} />
    </div>
  );
}
