// 自前の小さなリアクションのピッカー（固定の絵文字の一覧＋分類のタブ＋スタンプ）。ポップオーバーの枠で、開閉の管理（閉じる・フォーカスを戻す）は呼び出し側（ReactionBar）が行う。
// タブは WAI-ARIA の Tabs のパターン：Tab で止まるのは選ばれたタブだけ、←→ で移動と同時に選ぶ、Home・End で最初・最後。開いたら選ばれたタブにフォーカスを移す。
// Esc と枠の外のクリックで onClose を呼ぶ。20種類に達しているときは、まだ付いていない種類を選べなくし、理由を role="status" に出す。
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  EMOJI_CATEGORIES,
  MAX_REACTION_TYPES,
} from "../../../../../shared/reaction-rules";
import { Button } from "../../../components/Button";
import type { Reaction } from "../api/message-api";
import { EmojiGrid } from "./EmojiGrid";
import { StampList } from "./StampList";

type ReactionPickerProps = {
  /** その投稿の今の集計（上限と「自分が付けている」の表示に使う） */
  reactions: readonly Reaction[];
  onSelect: (kind: Reaction["kind"], value: string) => void;
  onClose: () => void;
  /** 開いたボタン。これを押したときは「外のクリック」として閉じない（ボタン自身が開閉を切り替える） */
  triggerRef?: RefObject<HTMLElement | null>;
};

const TABS = [
  ...EMOJI_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
  })),
  { id: "stamp", label: "スタンプ" },
];

function nextTab(key: string, selected: number): number | null {
  const last = TABS.length - 1;
  switch (key) {
    case "ArrowRight":
      return selected === last ? 0 : selected + 1;
    case "ArrowLeft":
      return selected === 0 ? last : selected - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

export function ReactionPicker({
  reactions,
  onSelect,
  onClose,
  triggerRef,
}: ReactionPickerProps) {
  const [selected, setSelected] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelId = useId();
  const limitReached = reactions.length >= MAX_REACTION_TYPES;

  // 開いたら、選ばれたタブにフォーカスを移す
  useEffect(() => {
    tabRefs.current[0]?.focus();
  }, []);

  // 枠の外のクリックで閉じる（外部のイベントとの同期）
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (triggerRef?.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose, triggerRef]);

  const onTabKeyDown = (event: KeyboardEvent) => {
    const next = nextTab(event.key, selected);
    if (next === null) return;
    event.preventDefault();
    setSelected(next);
    tabRefs.current[next]?.focus();
  };

  const category = EMOJI_CATEGORIES[selected];
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="リアクションを選ぶ"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className="absolute z-10 mt-1 w-80 max-w-full rounded-lg border border-border bg-surface p-2 shadow-float"
    >
      <div
        role="tablist"
        aria-label="分類"
        onKeyDown={onTabKeyDown}
        className="mb-2 flex flex-wrap gap-1"
      >
        {TABS.map((tab, index) => (
          <Button
            key={tab.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role="tab"
            variant={index === selected ? "secondary" : "ghost"}
            aria-selected={index === selected}
            aria-controls={panelId}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => setSelected(index)}
          >
            {tab.label}
          </Button>
        ))}
      </div>
      {limitReached && (
        <p role="status" className="mb-2 text-sm text-text-muted">
          リアクションは{MAX_REACTION_TYPES}種類までです
        </p>
      )}
      <div role="tabpanel" id={panelId}>
        {category === undefined ? (
          <StampList
            reactions={reactions}
            limitReached={limitReached}
            onSelect={(value) => onSelect("stamp", value)}
          />
        ) : (
          <EmojiGrid
            key={category.id}
            emojis={category.emojis}
            reactions={reactions}
            limitReached={limitReached}
            onSelect={(char) => onSelect("emoji", char)}
          />
        )}
      </div>
    </div>
  );
}
