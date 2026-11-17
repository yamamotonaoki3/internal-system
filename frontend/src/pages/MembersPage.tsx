// S-20 社員一覧（部署での絞り込み・表示名の検索・プロフィールカード・ステータスの代理設定・DM の開始・退職処理の申請）。
import { useState } from "react";
import { Link } from "react-router";
import { useSession } from "../features/auth";
import { StartDmButton } from "../features/dms";
import {
  DepartmentFilter,
  MemberSearchField,
  MembersList,
  type Member,
} from "../features/members";
import { useRetirementRequestAction } from "../features/retirement-requests";

export function MembersPage() {
  const [departmentId, setDepartmentId] = useState("");
  const [q, setQ] = useState("");
  const session = useSession();
  const retirement = useRetirementRequestAction();
  const selfId = session.data?.user.id;
  // DM は自分には送れない（表示の制御。認可はサーバーが行う）
  // セッションが届くまでは、自分の行かを判別できないため出さない
  const dmButton = (member: { id: string; displayName: string }) =>
    selfId === undefined || member.id === selfId ? null : (
      <StartDmButton
        partnerUserId={member.id}
        partnerDisplayName={member.displayName}
      />
    );
  return (
    <section className="mx-auto max-w-5xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">社員一覧</h1>
      <MemberSearchField onSearch={setQ} />
      <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
      {session.data?.permissions?.includes("perm.workspace.manage") && (
        // いずれかの部署のオーナーにだけ出す入口（表示の制御。認可は API が行う）
        <p className="mb-4">
          <Link
            to="/retirement-requests/mine"
            className="text-primary underline"
          >
            自分の退職処理の申請
          </Link>
        </p>
      )}
      {retirement.element}
      <MembersList
        departmentId={departmentId}
        q={q}
        renderMemberAction={(member: Member) => (
          <>
            {dmButton(member)}
            {retirement.renderButton(member)}
          </>
        )}
        renderProfileActions={dmButton}
      />
    </section>
  );
}
