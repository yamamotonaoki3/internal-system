// 1件のメッセージのリアクション：チップ、「リアクションを付ける」ボタン（ピッカー）、スマートフォン用の「付けた人」ボタン。
// 付け外しは useToggleReaction（応答の集計でこの投稿だけを書き換える）。拒否は文言だけを出し、取り直さない。
// ピッカーを開くのは同時に1つだけ（開閉の状態は呼び出し側が持つ）。閉じたら、フォーカスを開いたボタンに戻す。
import { useRef, useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import type { Reaction, RoomMessage } from "../api/message-api";
import { describeError } from "../describe-error";
import {
  useIsReactionPending,
  useToggleReaction,
} from "../hooks/useToggleReaction";
import { ReactionChip } from "./ReactionChip";
import { ReactionPicker } from "./ReactionPicker";
import { ReactorsDialog } from "./ReactorsDialog";

type ReactionBarProps = {
  message: RoomMessage;
  /** 付け外しできる状態か（部屋が許すとき）。偽ならチップは読み取り専用で、「リアクションを付ける」は出さない */
  canReact: boolean;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
};

export function ReactionBar({
  message,
  canReact,
  pickerOpen,
  onPickerOpenChange,
}: ReactionBarProps) {
  const toggle = useToggleReaction({
    roomId: message.roomId,
    parentMessageId: message.parentMessageId,
  });
  // 同じ投稿を別の場所（部屋の一覧とスレッド）にも出しているとき、送信中の状態を共有する
  const pending = useIsReactionPending(message.id);
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const reactorsRef = useRef<HTMLButtonElement>(null);
  const { reactions } = message;

  const send = (kind: Reaction["kind"], value: string) =>
    toggle.mutate({
      messageId: message.id,
      kind,
      value,
      reactedByMe:
        reactions.find((r) => r.kind === kind && r.value === value)
          ?.reactedByMe ?? false,
    });
  const closePicker = () => {
    onPickerOpenChange(false);
    addRef.current?.focus();
  };
  const closeReactors = () => {
    setReactorsOpen(false);
    reactorsRef.current?.focus();
  };

  if (reactions.length === 0 && !canReact) return null;
  return (
    <div className="relative mt-1">
      <div className="flex flex-wrap items-center gap-1">
        {reactions.map((reaction) => (
          <ReactionChip
            key={`${reaction.kind}:${reaction.value}`}
            reaction={reaction}
            canReact={canReact}
            pending={pending}
            onToggle={(target) => send(target.kind, target.value)}
          />
        ))}
        {canReact && (
          <Button
            ref={addRef}
            variant="ghost"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            aria-label={`リアクションを付ける（${message.author.displayName}の投稿）`}
            onClick={() => onPickerOpenChange(!pickerOpen)}
          >
            リアクション
          </Button>
        )}
        {reactions.length > 0 && (
          <span className="md:hidden">
            <Button
              ref={reactorsRef}
              variant="ghost"
              aria-haspopup="dialog"
              aria-label={`付けた人（${message.author.displayName}の投稿）`}
              onClick={() => setReactorsOpen(true)}
            >
              付けた人
            </Button>
          </span>
        )}
      </div>
      {pickerOpen && (
        <ReactionPicker
          reactions={reactions}
          triggerRef={addRef}
          onClose={closePicker}
          onSelect={(kind, value) => {
            closePicker();
            if (!pending) send(kind, value);
          }}
        />
      )}
      {reactorsOpen && (
        <ReactorsDialog reactions={reactions} onClose={closeReactors} />
      )}
      {toggle.isError && (
        <Alert tone="error" role="alert">
          {describeError(toggle.error)}
        </Alert>
      )}
    </div>
  );
}
