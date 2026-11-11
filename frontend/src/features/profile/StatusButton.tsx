// ヘッダーのステータスボタン（C-136）。押すと popover（AvatarMenu と同じ方式。role="menu" は使わない）で5種類を選べる。
// パソコン幅は色つきの丸＋文字、767px 以下は丸だけ（文字は読み上げ用に残す）。開閉・Esc・外側クリックは popover="auto" に任せる。
import { useState, type ToggleEvent } from "react";
import { Button } from "../../components/Button";
import { useMyProfile } from "./hooks/useMyProfile";
import { StatusPicker } from "./StatusPicker";
import {
  STATUS_DOT_CLASSES,
  STATUS_LABELS,
  STATUS_UNKNOWN_DOT_CLASS,
} from "./status-labels";

const STATUS_MENU_ID = "status-menu";

export function StatusButton() {
  const profile = useMyProfile();
  const [expanded, setExpanded] = useState(false);

  function handleToggle(event: ToggleEvent<HTMLDivElement>) {
    setExpanded(event.nativeEvent.newState === "open");
  }

  const kind = profile.data?.status.kind;
  const label =
    kind !== undefined
      ? STATUS_LABELS[kind]
      : profile.isError
        ? "取得できません"
        : "確認中";
  return (
    <>
      <Button
        variant="ghost"
        popoverTarget={STATUS_MENU_ID}
        aria-controls={STATUS_MENU_ID}
        aria-expanded={expanded}
      >
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className={
              kind === undefined
                ? STATUS_UNKNOWN_DOT_CLASS
                : STATUS_DOT_CLASSES[kind]
            }
          />
          <span className="sr-only">ステータス：</span>
          <span className="sr-only md:not-sr-only">{label}</span>
        </span>
      </Button>
      <div
        id={STATUS_MENU_ID}
        popover="auto"
        onToggle={handleToggle}
        className="inset-auto right-2 top-12 w-72 rounded-md border border-border bg-surface p-3 text-text shadow-float"
      >
        <StatusPicker />
      </div>
    </>
  );
}
