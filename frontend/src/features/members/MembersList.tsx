// S-20 の一覧。読み込み中・エラー・なし・ありの4つの状態を出し分ける。
// 他の機能の操作（DM を送る等）は、renderMemberAction（行）・renderProfileActions（カード）で呼び出し側から差し込む（members から他の機能を参照しない）。
// 代理設定の操作は、サーバーが canSetStatus を true にした他人の行にだけ出す（表示の制御。認可は PUT でサーバーが行う）。
import { useState, type ReactNode } from "react";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { useSession } from "../auth";
import { describeError, ProfileCardTrigger, StatusBadge } from "../profile";
import type { Member } from "./api/member-api";
import { useMembers } from "./hooks/useMembers";
import { ProxyStatusDialog } from "./ProxyStatusDialog";

type MembersListProps = {
  departmentId: string;
  /** 表示名の検索語（空なら絞り込まない） */
  q: string;
  /** 行の操作の欄に足す操作 */
  renderMemberAction?: (member: Member) => ReactNode;
  /** プロフィールカードに足す操作 */
  renderProfileActions?: (member: Member) => ReactNode;
};

export function MembersList({
  departmentId,
  q,
  renderMemberAction,
  renderProfileActions,
}: MembersListProps) {
  const members = useMembers(departmentId, q);
  const session = useSession();
  const [target, setTarget] = useState<Member | null>(null);
  const selfId = session.data?.user.id;

  if (members.isPending) return <p role="status">読み込み中です</p>;
  if (members.isError)
    return (
      <Alert tone="error" role="alert">
        {describeError(members.error)}
      </Alert>
    );

  const items = members.data.pages.flatMap((page) => page.items);
  if (items.length === 0) return <p>該当する社員がいません</p>;

  return (
    <>
      <div className="mb-4 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th scope="col" className="p-2">
                表示名
              </th>
              <th scope="col" className="p-2">
                部署
              </th>
              <th scope="col" className="p-2">
                内線
              </th>
              <th scope="col" className="p-2">
                メール
              </th>
              <th scope="col" className="p-2">
                ステータス
              </th>
              <th scope="col" className="p-2">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((member) => (
              <tr key={member.id} className="border-t border-border">
                <td className="p-2">
                  <ProfileCardTrigger
                    userId={member.id}
                    displayName={member.displayName}
                    actions={renderProfileActions?.(member)}
                  />
                </td>
                <td className="p-2">{member.department.name}</td>
                <td className="p-2">{member.extension ?? "未設定"}</td>
                <td className="p-2">
                  <a
                    href={`mailto:${member.email}`}
                    className="text-primary underline"
                  >
                    {member.email}
                  </a>
                </td>
                <td className="p-2">
                  <StatusBadge status={member.status} />
                </td>
                <td className="p-2">
                  {renderMemberAction?.(member)}
                  {member.canSetStatus && member.id !== selfId && (
                    <Button
                      variant="secondary"
                      onClick={() => setTarget(member)}
                    >
                      ステータスを代理設定
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {members.hasNextPage && (
        <Button
          variant="secondary"
          disabled={members.isFetchingNextPage}
          onClick={() => void members.fetchNextPage()}
        >
          さらに表示
        </Button>
      )}
      {target !== null && (
        <ProxyStatusDialog member={target} onClose={() => setTarget(null)} />
      )}
    </>
  );
}
