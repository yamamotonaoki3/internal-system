// TODO の担当者の選択肢（追加・編集で共用。5-4 AC-6）：「担当なし」と、有効な参加者だけ。
// 編集では、いまの担当がもう選べない人（外れた・無効）でも、変えていないことが分かるよう、その人を選択肢に残す。
import type { CaseParticipant } from "../api/case-api";
import type { TodoPerson } from "../api/case-todo-api";
import { CASE_TODO_NO_ASSIGNEE_TEXT, retiredName } from "../labels";

type Props = {
  participants: CaseParticipant[];
  /** いまの担当（編集のとき）。選択肢にいなければ足す */
  current?: TodoPerson | null;
};

export function CaseTodoAssigneeOptions({ participants, current }: Props) {
  const candidates = participants.filter((p) => p.isActive);
  const keepCurrent =
    current != null && !candidates.some((p) => p.userId === current.userId);
  return (
    <>
      <option value="">{CASE_TODO_NO_ASSIGNEE_TEXT}</option>
      {candidates.map((p) => (
        <option key={p.userId} value={p.userId}>
          {p.departmentName === null
            ? p.displayName
            : `${p.displayName}（${p.departmentName}）`}
        </option>
      ))}
      {keepCurrent && (
        <option value={current.userId}>
          {current.isActive
            ? current.displayName
            : retiredName(current.displayName)}
        </option>
      )}
    </>
  );
}
