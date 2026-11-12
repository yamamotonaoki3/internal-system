// S-20 社員一覧（部署での絞り込み・表示名の検索・プロフィールカード・ステータスの代理設定・DM の開始）。
import { useState } from "react";
import { useSession } from "../features/auth";
import { StartDmButton } from "../features/dms";
import {
  DepartmentFilter,
  MemberSearchField,
  MembersList,
} from "../features/members";

export function MembersPage() {
  const [departmentId, setDepartmentId] = useState("");
  const [q, setQ] = useState("");
  const session = useSession();
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
      <MembersList
        departmentId={departmentId}
        q={q}
        renderMemberAction={dmButton}
        renderProfileActions={dmButton}
      />
    </section>
  );
}
