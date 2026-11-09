// サイドバーの「参加中のチャンネル」。取得に失敗しても、枠全体は壊さず、このセクションの中にエラーを出す。
import { NavLink } from "react-router";
import { describeError } from "../describe-error";
import { useJoinedChannels } from "../hooks/useJoinedChannels";

// リンクの見た目は、枠（app-shell）が決める。機能から枠を参照しないよう、呼び出し側から受け取る
type JoinedChannelsSectionProps = {
  linkClassName: (state: { isActive: boolean }) => string;
  onNavigate?: () => void;
};

export function JoinedChannelsSection({
  linkClassName,
  onNavigate,
}: JoinedChannelsSectionProps) {
  const joined = useJoinedChannels();
  const items = joined.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="mb-4">
      <p className="mb-2 px-3 text-xs font-bold text-text-muted">
        参加中のチャンネル
      </p>
      {joined.isPending && <p className="px-3 text-sm">読み込み中です</p>}
      {joined.isError && (
        <p role="alert" className="px-3 text-sm text-danger">
          {describeError(joined.error)}
        </p>
      )}
      {joined.isSuccess && items.length === 0 && (
        <p className="px-3 text-sm">参加中のチャンネルはありません</p>
      )}
      <ul>
        {items.map((channel) => (
          <li key={channel.id}>
            <NavLink
              to={`/channels/${channel.id}`}
              onClick={onNavigate}
              className={linkClassName}
            >
              {channel.name}
            </NavLink>
          </li>
        ))}
      </ul>
      {joined.hasNextPage && (
        <button
          type="button"
          className="px-3 text-sm text-primary underline"
          disabled={joined.isFetchingNextPage}
          onClick={() => void joined.fetchNextPage()}
        >
          さらに表示
        </button>
      )}
    </div>
  );
}
