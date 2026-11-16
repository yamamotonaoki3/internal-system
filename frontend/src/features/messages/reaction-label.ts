// リアクション1種類の、読み上げ（aria-label）と title に使う文言。「<表示> <件数>人：<付けた人>」。
// 付けた人は最大50人までしか届かない（count は全数）ため、足りない人数は「ほか n 人」で示す。無効な社員には「（退職者）」を付ける。
import { STAMPS } from "../../../../shared/reaction-rules";
import type { Reaction } from "./api/message-api";

/** スタンプは日本語の名前、絵文字はその文字。一覧にないスタンプ id は id をそのまま出す（表示を隠さない） */
export function reactionLabel(reaction: Pick<Reaction, "kind" | "value">) {
  if (reaction.kind === "emoji") return reaction.value;
  return (
    STAMPS.find((stamp) => stamp.id === reaction.value)?.label ?? reaction.value
  );
}

export function describeReaction(reaction: Reaction): string {
  const names = reaction.users.map((user) =>
    user.isActive ? user.displayName : `${user.displayName}（退職者）`,
  );
  const hidden = reaction.count - reaction.users.length;
  if (hidden > 0) names.push(`ほか ${hidden} 人`);
  return `${reactionLabel(reaction)} ${reaction.count}人：${names.join("、")}`;
}
