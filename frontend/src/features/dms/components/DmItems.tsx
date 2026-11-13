// DM の一覧の中身（サイドバーの DmSection と、一覧の画面 DmList で共用）。4つの状態（読み込み中・エラー・0件・あり）を出し分ける。
// 取得に失敗しても、この部品の中にエラーを出す（0件とは出さない）。相手が無効な DM は「退職者」を併記する。
import { NavLink } from "react-router";
import { Button } from "../../../components/Button";
import { describeError } from "../describe-error";
import {
  RoomLinkLabel,
  UnreadCountsError,
  useUnreadCounts,
} from "../../unread";
import { uniqueDms, useDms } from "../hooks/useDms";

type DmItemsProps = {
  linkClassName: (state: { isActive: boolean }) => string;
  onNavigate?: () => void;
};

export function DmItems({ linkClassName, onNavigate }: DmItemsProps) {
  const dms = useDms();
  const items = uniqueDms(dms.data?.pages);
  const unread = useUnreadCounts();
  // 取得に失敗している間は、件数を出さない（古い件数を出し続けない）
  const counts = unread.isError ? undefined : unread.data;
  return (
    <>
      {unread.isError && <UnreadCountsError />}
      {dms.isPending && (
        <p role="status" className="px-3 text-sm">
          読み込み中です
        </p>
      )}
      {dms.isError && (
        <p role="alert" className="px-3 text-sm text-danger">
          {describeError(dms.error)}
        </p>
      )}
      {dms.isSuccess && items.length === 0 && (
        <p className="px-3 text-sm">ダイレクトメッセージはありません</p>
      )}
      <ul>
        {items.map((dm) => (
          <li key={dm.roomId}>
            <NavLink
              to={`/dms/${dm.roomId}`}
              onClick={onNavigate}
              className={linkClassName}
            >
              <RoomLinkLabel
                name={
                  dm.partner.isActive
                    ? dm.partner.displayName
                    : `${dm.partner.displayName}（退職者）`
                }
                count={counts?.get(dm.roomId)}
              />
            </NavLink>
          </li>
        ))}
      </ul>
      {dms.hasNextPage && (
        <Button
          variant="ghost"
          disabled={dms.isFetchingNextPage}
          onClick={() => void dms.fetchNextPage()}
        >
          さらに表示
        </Button>
      )}
    </>
  );
}
