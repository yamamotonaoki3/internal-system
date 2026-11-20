// TODO の人の名前と担当の出し分け（#149）。TODO の行・履歴・削除済みの一覧（149-C）で共用する（決まりを1か所にする）。
// 有効な人の名前はプロフィールカード（S-27）を開くボタンにし、カードに「DMを送る」を足す（自分には出さない）。
// 無効な人は「（退職者）」を付けた文字だけにし、カードも DM も出さない（5-4 AC-6・C-75）。
import { StartDmButton } from "../../dms";
import { ProfileCardTrigger } from "../../profile";
import type { CaseTodo, TodoPerson } from "../api/case-todo-api";
import { CASE_TODO_NO_ASSIGNEE_TEXT, retiredName } from "../labels";

/** 名前：有効な人はプロフィールカードを開くボタン、無効な人は「（退職者）」つきの文字（履歴・削除済みの一覧でも使う） */
export function PersonName({
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

/** 担当の出し分け（削除済みの一覧でも使う） */
export function Assignee({
  todo,
  selfId,
}: {
  todo: Pick<
    CaseTodo,
    "completed" | "assignee" | "previousAssignee" | "completedAssignee"
  >;
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
