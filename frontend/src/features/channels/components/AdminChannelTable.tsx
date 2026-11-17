// S-39（#143-b）の一覧の表。パソコンは表、狭い画面はカード形式（CSS で切り替える）。
// 名前はリンクにしない（参加していない非公開・アーカイブ中は開けないため）。メッセージの中身は出さない。
// アーカイブ・復元は行の「⋯」から選んだ操作をページへ知らせるだけにし、ダイアログはページが持つ（行が消えても完了の表示が出るように）。
import type { ReactNode } from "react";
import { fetchAdminChannel, type AdminChannel } from "../api/channel-api";
import {
  CHANNEL_PURPOSE_LABELS,
  CHANNEL_STATE_LABELS,
  CHANNEL_VISIBILITY_LABELS,
  departmentLabel,
} from "../labels";
import {
  ChannelManageMenu,
  type ChannelManageAction,
} from "./ChannelManageMenu";

const COLUMNS = [
  "名前",
  "種類",
  "公開／非公開",
  "部署",
  "状態",
  "参加者数",
  "操作",
] as const;

/** 狭い画面のカードで、値の前に出す列の名前 */
export function CellLabel({ children }: { children: string }) {
  return <span className="mr-1 font-bold md:hidden">{children}：</span>;
}

export const CELL = "p-2 align-top max-md:block";

/** パソコンは表、狭い画面はカード形式の枠（S-39・S-38 で共用） */
export function ResponsiveTable({
  columns,
  children,
}: {
  columns: readonly string[];
  children: ReactNode;
}) {
  return (
    <div className="mb-4 md:overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead className="max-md:sr-only">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="p-2">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const ROW =
  "border-t border-border-strong max-md:mb-3 max-md:block max-md:rounded-md max-md:border";

export function AdminChannelTable({
  items,
  onSelect,
}: {
  items: readonly AdminChannel[];
  onSelect: (channel: AdminChannel, action: ChannelManageAction) => void;
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
            <CellLabel>種類</CellLabel>
            {CHANNEL_PURPOSE_LABELS[channel.purpose]}
          </td>
          <td className={CELL}>
            <CellLabel>公開／非公開</CellLabel>
            {CHANNEL_VISIBILITY_LABELS[channel.visibility]}
          </td>
          <td className={CELL}>
            <CellLabel>部署</CellLabel>
            {departmentLabel(channel.department)}
          </td>
          <td className={CELL}>
            <CellLabel>状態</CellLabel>
            {CHANNEL_STATE_LABELS[channel.state]}
          </td>
          <td className={CELL}>
            <CellLabel>参加者数</CellLabel>
            {channel.memberCount}
          </td>
          <td className={CELL}>
            <ChannelManageMenu
              channel={channel}
              onSelect={(action) => onSelect(channel, action)}
              // 参加していない非公開も読めるよう、管理者用の1件（EP-2-43）で読み直す
              loadLatest={() => fetchAdminChannel(channel.id)}
            />
          </td>
        </tr>
      ))}
    </ResponsiveTable>
  );
}
