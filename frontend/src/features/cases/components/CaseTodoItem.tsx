// TODO の1行：題名・担当・完了の印と、完了・取り消し・編集・削除のボタン（ボタンの名前に題名を含める）。
// 担当の表示：完了した行は完了した時の担当、未完了の行は現在の担当。現在の担当がなく以前の担当が残っていれば「担当なし（以前の担当：名前）」。
// 有効な人の名前はプロフィールカード（S-27）を開くボタンにし、カードに「DMを送る」を足す（自分には出さない）。
// 無効な人は「（退職者）」を付けた文字だけにし、カードも DM も出さない（5-4 AC-6・C-75）。
import { Button } from "../../../components/Button";
import { StartDmButton } from "../../dms";
import { ProfileCardTrigger } from "../../profile";
import type { CaseTodo, TodoPerson } from "../api/case-todo-api";
import {
  CASE_TODO_DONE_TEXT,
  CASE_TODO_EDIT_TEXTS,
  CASE_TODO_NO_ASSIGNEE_TEXT,
  retiredName,
} from "../labels";

function PersonName({
  person,
  selfId,
}: {
  person: TodoPerson;
  selfId: string | undefined;
}) {
  if (!person.isActive) return <>{retiredName(person.displayName)}</>;
  return (
    <ProfileCardTrigger
      userId={person.userId}
      displayName={person.displayName}
      actions={
        // セッションが届くまでは、自分かを判別できないため出さない
        selfId === undefined || person.userId === selfId ? null : (
          <StartDmButton
            partnerUserId={person.userId}
            partnerDisplayName={person.displayName}
          />
        )
      }
    />
  );
}

function Assignee({
  todo,
  selfId,
}: {
  todo: CaseTodo;
  selfId: string | undefined;
}) {
  const shown = todo.completed ? todo.completedAssignee : todo.assignee;
  if (shown !== null) return <PersonName person={shown} selfId={selfId} />;
  if (!todo.completed && todo.previousAssignee !== null)
    return (
      <>
        {CASE_TODO_NO_ASSIGNEE_TEXT}（以前の担当：
        <PersonName person={todo.previousAssignee} selfId={selfId} />）
      </>
    );
  return <>{CASE_TODO_NO_ASSIGNEE_TEXT}</>;
}

type Props = {
  todo: CaseTodo;
  /** 終了した案件では操作を出さない */
  readOnly: boolean;
  busy: boolean;
  selfId: string | undefined;
  onToggle: (todo: CaseTodo) => void;
  onEdit: (todo: CaseTodo) => void;
  onDelete: (todo: CaseTodo) => void;
};

export function CaseTodoItem({
  todo,
  readOnly,
  busy,
  selfId,
  onToggle,
  onEdit,
  onDelete,
}: Props) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2">
      {todo.completed && (
        <span className="rounded-md bg-info-bg px-2 text-sm font-bold text-info-text">
          {CASE_TODO_DONE_TEXT}
        </span>
      )}
      <span className="font-bold">{todo.title}</span>
      <span className="text-sm text-text-muted">
        担当：
        <Assignee todo={todo} selfId={selfId} />
      </span>
      {!readOnly && (
        <>
          <Button
            variant="secondary"
            disabled={busy}
            aria-label={`${todo.title}を${todo.completed ? "未完了に戻す" : "完了にする"}`}
            onClick={() => onToggle(todo)}
          >
            {todo.completed ? "未完了に戻す" : "完了にする"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            aria-label={`${todo.title}を${CASE_TODO_EDIT_TEXTS.edit}`}
            onClick={() => onEdit(todo)}
          >
            {CASE_TODO_EDIT_TEXTS.edit}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            aria-label={`${todo.title}を${CASE_TODO_EDIT_TEXTS.delete}`}
            onClick={() => onDelete(todo)}
          >
            {CASE_TODO_EDIT_TEXTS.delete}
          </Button>
        </>
      )}
    </li>
  );
}
