// リアクション1種類のチップ。押すと付け外し（判断は呼び出し側）。
// 書き込めないとき・送信中は disabled にせず aria-disabled にする（フォーカスは残り、読み上げで付けた人を聞ける）。
import { Button } from "../../../components/Button";
import type { Reaction } from "../api/message-api";
import { describeReaction, reactionLabel } from "../reaction-label";

type ReactionChipProps = {
  reaction: Reaction;
  /** 付け外しできる状態か（偽なら読み取り専用の表示） */
  canReact: boolean;
  /** 送信中（二度押しを受け付けない） */
  pending: boolean;
  onToggle: (reaction: Reaction) => void;
};

export function ReactionChip({
  reaction,
  canReact,
  pending,
  onToggle,
}: ReactionChipProps) {
  const blocked = !canReact || pending;
  const description = describeReaction(reaction);
  return (
    <Button
      variant={reaction.reactedByMe ? "secondary" : "ghost"}
      aria-pressed={reaction.reactedByMe}
      aria-disabled={blocked ? true : undefined}
      aria-label={description}
      title={description}
      onClick={() => {
        if (!blocked) onToggle(reaction);
      }}
    >
      {reactionLabel(reaction)} {reaction.count}
    </Button>
  );
}
