// DM の相手の選択（/dms/new）。表示名の検索と部署の絞り込みで候補を出し、「DMを送る」で始める。
// 候補には、部署とステータス（文字つき）を出す。自分は出さない。読み込み中・エラー・0件・ありの4つの状態を出し分ける。
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { useSession } from "../../auth";
import { DepartmentFilter, MemberSearchField, useMembers } from "../../members";
import { StatusBadge } from "../../profile";
import { describeError } from "../describe-error";
import { StartDmButton } from "./StartDmButton";

export function DmPartnerPicker() {
  const [departmentId, setDepartmentId] = useState("");
  const [q, setQ] = useState("");
  const members = useMembers(departmentId, q);
  const session = useSession();
  const selfId = session.data?.user.id;

  // セッションが届くまでは、自分を除けないため候補を出さない
  const candidates =
    selfId === undefined
      ? []
      : (members.data?.pages ?? [])
          .flatMap((page) => page.items)
          .filter((member) => member.id !== selfId);

  return (
    <div>
      <MemberSearchField onSearch={setQ} />
      <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
      {(members.isPending || session.isPending) && (
        <p role="status">読み込み中です</p>
      )}
      {members.isError && (
        <Alert tone="error" role="alert">
          {describeError(members.error)}
        </Alert>
      )}
      {members.isSuccess && selfId !== undefined && candidates.length === 0 && (
        <p>該当する社員がいません</p>
      )}
      <ul>
        {candidates.map((member) => (
          <li
            key={member.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border py-2"
          >
            <span className="font-bold">{member.displayName}</span>
            <span>{member.department.name}</span>
            <StatusBadge status={member.status} />
            <StartDmButton
              partnerUserId={member.id}
              partnerDisplayName={member.displayName}
            />
          </li>
        ))}
      </ul>
      {members.hasNextPage && (
        <Button
          variant="secondary"
          disabled={members.isFetchingNextPage}
          onClick={() => void members.fetchNextPage()}
        >
          さらに表示
        </Button>
      )}
    </div>
  );
}
