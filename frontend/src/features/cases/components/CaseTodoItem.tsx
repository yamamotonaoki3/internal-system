// TODO の1行：題名・担当・完了の印と、完了・取り消しのボタン（ボタンの名前に題名を含める）。
// 担当の表示：完了した行は完了した時の担当、未完了の行は現在の担当。無効な人は「（退職者）」を付け、リンクを出さない（5-4 AC-6・C-75）。
// 現在の担当がなく以前の担当が残っていれば「担当なし（以前の担当：名前）」。
import { Button } from "../../../components/Button";
import type { CaseTodo, TodoPerson } from "../api/case-todo-api";
import {
  CASE_TODO_DONE_TEXT,
  CASE_TODO_NO_ASSIGNEE_TEXT,
  retiredName,
} from "../labels";

const personName = (person: TodoPerson) =>
  person.isActive ? person.displayName : retiredName(person.displayName);

function assigneeText(todo: CaseTodo): string {
  const shown = todo.completed ? todo.completedAssignee : todo.assignee;
  if (shown !== null) return personName(shown);
  if (!todo.completed && todo.previousAssignee !== null)
    return `${CASE_TODO_NO_ASSIGNEE_TEXT}（以前の担当：${todo.previousAssignee.displayName}）`;
  return CASE_TODO_NO_ASSIGNEE_TEXT;
}

type Props = {
  todo: CaseTodo;
  /** 終了した案件では操作を出さない */
  readOnly: boolean;
  busy: boolean;
  onToggle: (todo: CaseTodo) => void;
};

export function CaseTodoItem({ todo, readOnly, busy, onToggle }: Props) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2">
      {todo.completed && (
        <span className="rounded-md bg-info-bg px-2 text-sm font-bold text-info-text">
          {CASE_TODO_DONE_TEXT}
        </span>
      )}
      <span className="font-bold">{todo.title}</span>
      <span className="text-sm text-text-muted">
        担当：{assigneeText(todo)}
      </span>
      {!readOnly && (
        <Button
          variant="secondary"
          disabled={busy}
          aria-label={`${todo.title}を${todo.completed ? "未完了に戻す" : "完了にする"}`}
          onClick={() => onToggle(todo)}
        >
          {todo.completed ? "未完了に戻す" : "完了にする"}
        </Button>
      )}
    </li>
  );
}
