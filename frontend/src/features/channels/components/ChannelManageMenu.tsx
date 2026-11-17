// チャンネルの「⋯」メニュー（#143。C-131。S-05 のヘッダー、のちに S-39 の行でも使う）。
// 出せる操作（manage）だけを項目にする。表示の制御だけで、管理してよいかはサーバーが毎回判定する。
// キーボード：ボタンの Enter・Space で開き、↑↓で項目を移り、Esc で閉じてフォーカスをボタンに戻す。ダイアログを閉じたときもボタンに戻す。
// S-39（#143-b）は onSelect を渡し、アーカイブ・復元のダイアログをページに持たせる（一覧の取り直しで行が消えても、完了の表示が出るように）。
// onSelect がなければ（S-05）、これまでどおりメニューの中でダイアログを開く。
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import type { ChannelDetail } from "../api/channel-api";
import { ChannelArchiveDialog } from "./ChannelArchiveDialog";
import { ChannelEditDialog, type LatestChannel } from "./ChannelEditDialog";
import { ChannelRestoreDialog } from "./ChannelRestoreDialog";

type OpenDialog = "edit" | "archive" | "restore" | null;

/** ページへ知らせる操作（ダイアログをページが開く） */
export type ChannelManageAction = "archive" | "restore";

type MenuItem = { key: Exclude<OpenDialog, null>; label: string };

type ChannelManageMenuProps = {
  channel: Pick<ChannelDetail, "id" | "name" | "description" | "version"> & {
    manage: ChannelDetail["manage"] & { canRestore?: boolean };
  };
  /** 編集の「最新の内容を読み込む」の読み方（省略時はチャンネルの詳細） */
  loadLatest?: () => Promise<LatestChannel>;
} & (
  | {
      /** アーカイブ・復元のダイアログを開かず、選んだ操作をページへ知らせる */
      onSelect: (action: ChannelManageAction) => void;
      onArchived?: never;
      onRestored?: never;
    }
  | { onSelect?: never; onArchived: () => void; onRestored?: () => void }
);

/** 出せる操作（manage）だけを項目にする */
function menuItems(
  manage: ChannelManageMenuProps["channel"]["manage"],
): MenuItem[] {
  return [
    ...(manage.canRename || manage.canEditDescription
      ? [{ key: "edit" as const, label: "名前・説明を編集" }]
      : []),
    ...(manage.canArchive
      ? [{ key: "archive" as const, label: "アーカイブ" }]
      : []),
    ...(manage.canRestore === true
      ? [{ key: "restore" as const, label: "復元" }]
      : []),
  ];
}

export function ChannelManageMenu(props: ChannelManageMenuProps) {
  const { channel, loadLatest, onSelect } = props;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [saved, setSaved] = useState(false);
  // メニュー・ダイアログを閉じた後に、フォーカスを「⋯」へ戻す（閉じた後の描画で戻す）
  const returnFocusRef = useRef(false);

  const items = menuItems(channel.manage);

  useEffect(() => {
    if (menuOpen)
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!returnFocusRef.current || dialog !== null || menuOpen) return;
    returnFocusRef.current = false;
    buttonRef.current?.focus();
  }, [dialog, menuOpen]);

  if (items.length === 0) return null;

  function closeMenu() {
    setMenuOpen(false);
    returnFocusRef.current = true;
  }

  function closeDialog() {
    setDialog(null);
    returnFocusRef.current = true;
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ];
    const current = buttons.findIndex((b) => b === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(current + step + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="ghost"
        aria-label={`${channel.name}の操作`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
      >
        ⋯
      </Button>
      {menuOpen && (
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`${channel.name}の操作`}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-10 mt-1 min-w-48 rounded-md border border-border bg-surface p-1 shadow-float"
        >
          {items.map((item) => (
            <li key={item.key} role="none">
              <Button
                variant="ghost"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setSaved(false);
                  if (item.key !== "edit" && onSelect !== undefined) {
                    onSelect(item.key);
                    return;
                  }
                  setDialog(item.key);
                }}
              >
                {item.label}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {saved && (
        <Alert tone="info" role="status">
          チャンネルの名前・説明を変更しました
        </Alert>
      )}
      {dialog === "edit" && (
        <ChannelEditDialog
          channel={channel}
          {...(loadLatest === undefined ? {} : { loadLatest })}
          onClose={closeDialog}
          onSaved={() => {
            setSaved(true);
            closeDialog();
          }}
        />
      )}
      {dialog === "archive" && props.onSelect === undefined && (
        <ChannelArchiveDialog
          channelId={channel.id}
          channelName={channel.name}
          version={channel.version}
          onClose={closeDialog}
          onArchived={props.onArchived}
        />
      )}
      {dialog === "restore" && props.onSelect === undefined && (
        <ChannelRestoreDialog
          channelId={channel.id}
          channelName={channel.name}
          version={channel.version}
          onClose={closeDialog}
          {...(props.onRestored === undefined
            ? {}
            : { onRestored: props.onRestored })}
        />
      )}
    </div>
  );
}
