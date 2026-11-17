// チャンネルの「⋯」メニュー（#143。C-131。S-05 のヘッダー、のちに S-39 の行でも使う）。
// 出せる操作（manage）だけを項目にする。表示の制御だけで、管理してよいかはサーバーが毎回判定する。
// キーボード：ボタンの Enter・Space で開き、↑↓で項目を移り、Esc で閉じてフォーカスをボタンに戻す。ダイアログを閉じたときもボタンに戻す。
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import type { ChannelDetail } from "../api/channel-api";
import { ChannelArchiveDialog } from "./ChannelArchiveDialog";
import { ChannelEditDialog } from "./ChannelEditDialog";

type OpenDialog = "edit" | "archive" | null;

type MenuItem = { key: Exclude<OpenDialog, null>; label: string };

export function ChannelManageMenu({
  channel,
  onArchived,
}: {
  channel: Pick<
    ChannelDetail,
    "id" | "name" | "description" | "version" | "manage"
  >;
  onArchived: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [saved, setSaved] = useState(false);
  // メニュー・ダイアログを閉じた後に、フォーカスを「⋯」へ戻す（閉じた後の描画で戻す）
  const returnFocusRef = useRef(false);

  const { canRename, canEditDescription, canArchive } = channel.manage;
  const items: MenuItem[] = [
    ...(canRename || canEditDescription
      ? [{ key: "edit" as const, label: "名前・説明を編集" }]
      : []),
    ...(canArchive ? [{ key: "archive" as const, label: "アーカイブ" }] : []),
  ];

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
              <button
                type="button"
                role="menuitem"
                className="w-full rounded px-3 py-2 text-left hover:bg-bg"
                onClick={() => {
                  setMenuOpen(false);
                  setSaved(false);
                  setDialog(item.key);
                }}
              >
                {item.label}
              </button>
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
          onClose={closeDialog}
          onSaved={() => {
            setSaved(true);
            closeDialog();
          }}
        />
      )}
      {dialog === "archive" && (
        <ChannelArchiveDialog
          channelId={channel.id}
          channelName={channel.name}
          version={channel.version}
          onClose={closeDialog}
          onArchived={onArchived}
        />
      )}
    </div>
  );
}
