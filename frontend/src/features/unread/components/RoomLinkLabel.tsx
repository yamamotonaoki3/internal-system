// サイドバー・一覧の部屋のリンクの中身。未読があれば、名前を太字にして件数の印を添える（色だけに頼らない）。
// 未読がなければ名前だけ。太字は固定のクラスだけを使う（クラス名を組み立てない。ADR-0015）。
import { UnreadCountBadge } from "./UnreadCountBadge";

export function RoomLinkLabel({
  name,
  count,
}: {
  name: string;
  count: number | undefined;
}) {
  if (count === undefined || count < 1) return <>{name}</>;
  return (
    <>
      <span className="font-bold">{name}</span>
      {/* 読み上げの名前で、名前と件数の間を区切る */}{" "}
      <UnreadCountBadge count={count} />
    </>
  );
}
