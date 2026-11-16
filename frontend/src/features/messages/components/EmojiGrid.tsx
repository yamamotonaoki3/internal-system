// 1分類の絵文字を、1行 COLUMNS 個の role="grid" で並べる（WAI-ARIA の Grid のパターン）。
// Tab で止まるのは1セルだけ（ローヴィング tabindex）。←→↑↓ で移動（端で止まる・折り返さない）、Home・End は行の最初・最後、Ctrl+Home・Ctrl+End は最初・最後のセル。
// Enter・Space は Button の既定の動き（click）で選ぶ。
import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../../../components/Button";
import type { Reaction } from "../api/message-api";

// 1行の個数。行の区切り・上下キーの移動の幅・aria-colcount がすべてこの値を使う。
// ピッカーの内側は w-80（320px）−p-2（左右16px）−border（左右2px）＝302px。セルは Button の ghost（px-3＝左右24px）＋絵文字1つ（約16〜20px）で40〜44px、間は gap-1（4px）。
// 付けた状態も寸法を変えない（variant は ghost のまま、外側の gridcell の背景と ring（レイアウトに影響しない）で示す。aria-pressed も付く）。
// 6列なら 6×44＋5×4＝284px 以下で収まる（8列は 8×40＋7×4＝348px 以上で収まらない）
const COLUMNS = 6;

type EmojiGridProps = {
  emojis: readonly { readonly char: string; readonly name: string }[];
  reactions: readonly Reaction[];
  /** 20種類に達している（まだ付いていない種類は選べない） */
  limitReached: boolean;
  onSelect: (char: string) => void;
};

function nextIndex(event: KeyboardEvent, index: number, count: number) {
  const rowStart = index - (index % COLUMNS);
  switch (event.key) {
    case "ArrowRight":
      return Math.min(index + 1, count - 1);
    case "ArrowLeft":
      return Math.max(index - 1, 0);
    case "ArrowDown":
      return index + COLUMNS < count ? index + COLUMNS : index;
    case "ArrowUp":
      return index - COLUMNS >= 0 ? index - COLUMNS : index;
    case "Home":
      return event.ctrlKey ? 0 : rowStart;
    case "End":
      return event.ctrlKey
        ? count - 1
        : Math.min(rowStart + COLUMNS - 1, count - 1);
    default:
      return null;
  }
}

export function EmojiGrid({
  emojis,
  reactions,
  limitReached,
  onSelect,
}: EmojiGridProps) {
  const [active, setActive] = useState(0);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const rows = Array.from(
    { length: Math.ceil(emojis.length / COLUMNS) },
    (_, row) => emojis.slice(row * COLUMNS, (row + 1) * COLUMNS),
  );
  const move = (event: KeyboardEvent, index: number) => {
    const next = nextIndex(event, index, emojis.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    cells.current[next]?.focus();
  };
  return (
    <div role="grid" aria-label="絵文字" aria-colcount={COLUMNS}>
      {rows.map((row, rowIndex) => (
        <div key={row[0]?.char} role="row" className="flex gap-1">
          {row.map((emoji, column) => {
            const index = rowIndex * COLUMNS + column;
            const current = reactions.find(
              (reaction) =>
                reaction.kind === "emoji" && reaction.value === emoji.char,
            );
            const blocked = limitReached && current === undefined;
            return (
              <div
                key={emoji.char}
                role="gridcell"
                className={
                  current?.reactedByMe
                    ? "rounded-md bg-info-bg ring-2 ring-primary"
                    : "rounded-md"
                }
              >
                <Button
                  ref={(element) => {
                    cells.current[index] = element;
                  }}
                  variant="ghost"
                  tabIndex={index === active ? 0 : -1}
                  aria-label={emoji.name}
                  aria-pressed={current?.reactedByMe ?? false}
                  aria-disabled={blocked ? true : undefined}
                  onFocus={() => setActive(index)}
                  onKeyDown={(event) => move(event, index)}
                  onClick={() => {
                    if (!blocked) onSelect(emoji.char);
                  }}
                >
                  {emoji.char}
                </Button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
