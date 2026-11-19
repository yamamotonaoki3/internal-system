// TODO の進捗：「完了数/全体数」とバー（5-4 AC-4。パーセントは出さない）。0件（null）は「項目なし」。S-16 の行・S-17 のヘッダー・TODO の区画で使う。
import { ProgressBar } from "../../../components/ProgressBar";
import type { TodoProgress } from "../api/case-api";
import { CASE_TODO_EMPTY_TEXT, todoProgressLabel } from "../labels";

export function CaseTodoProgress({ progress }: { progress: TodoProgress }) {
  if (progress === null) return <span>{CASE_TODO_EMPTY_TEXT}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span>{`${progress.done}/${progress.total}`}</span>
      <ProgressBar
        value={progress.done}
        max={progress.total}
        label={todoProgressLabel(progress)}
      />
    </span>
  );
}
