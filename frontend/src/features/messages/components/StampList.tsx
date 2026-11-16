// スタンプ（文字）の一覧。名前の Button を並べる。
import { STAMPS } from "../../../../../shared/reaction-rules";
import { Button } from "../../../components/Button";
import type { Reaction } from "../api/message-api";

type StampListProps = {
  reactions: readonly Reaction[];
  /** 20種類に達している（まだ付いていない種類は選べない） */
  limitReached: boolean;
  onSelect: (value: string) => void;
};

export function StampList({
  reactions,
  limitReached,
  onSelect,
}: StampListProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {STAMPS.map((stamp) => {
        const current = reactions.find(
          (reaction) =>
            reaction.kind === "stamp" && reaction.value === stamp.id,
        );
        const blocked = limitReached && current === undefined;
        return (
          <Button
            key={stamp.id}
            variant={current?.reactedByMe ? "secondary" : "ghost"}
            aria-pressed={current?.reactedByMe ?? false}
            aria-disabled={blocked ? true : undefined}
            onClick={() => {
              if (!blocked) onSelect(stamp.id);
            }}
          >
            {stamp.label}
          </Button>
        );
      })}
    </div>
  );
}
