// S-38（#143-b）の「アーカイブしたチャンネル」の表。パソコンは表、狭い画面はカード形式（CSS で切り替える）。
// 並びはサーバーの順（アーカイブした日時の新しい順）。復元はページへ知らせ、ダイアログはページが持つ。物理削除は置かない（#143-c）。
import { Button } from "../../../components/Button";
import type { ArchivedChannel } from "../api/channel-api";
import { departmentLabel, formatJstDateTime } from "../labels";
import { CELL, CellLabel, ROW, ResponsiveTable } from "./AdminChannelTable";

const COLUMNS = [
  "名前",
  "部署",
  "アーカイブした人",
  "日時",
  "理由",
  "操作",
] as const;

export function ArchivedChannelTable({
  items,
  onRestore,
}: {
  items: readonly ArchivedChannel[];
  onRestore: (channel: ArchivedChannel) => void;
}) {
  return (
    <ResponsiveTable columns={COLUMNS}>
      {items.map((channel) => (
        <tr key={channel.id} className={ROW}>
          <td className={CELL}>
            <CellLabel>名前</CellLabel>
            {channel.name}
          </td>
          <td className={CELL}>
            <CellLabel>部署</CellLabel>
            {departmentLabel(channel.department)}
          </td>
          <td className={CELL}>
            <CellLabel>アーカイブした人</CellLabel>
            {channel.deletedBy.displayName}
          </td>
          <td className={CELL}>
            <CellLabel>日時</CellLabel>
            {formatJstDateTime(channel.deletedAt)}
          </td>
          <td className={CELL}>
            <CellLabel>理由</CellLabel>
            {channel.reason ?? "（なし）"}
          </td>
          <td className={CELL}>
            {channel.canRestore && (
              <Button variant="secondary" onClick={() => onRestore(channel)}>
                復元
              </Button>
            )}
          </td>
        </tr>
      ))}
    </ResponsiveTable>
  );
}
