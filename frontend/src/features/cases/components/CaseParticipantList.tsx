// S-17 の参加者の一覧（参加者だけに出す）。表示名・部署名と、作成者・役割の名前（Q8）・退職者の印。並びはサーバーの順（参加した順）。
import type { CaseParticipant } from "../api/case-api";
import { AUTO_ROLE_LABELS } from "../labels";

export function CaseParticipantList({
  participants,
}: {
  participants: CaseParticipant[];
}) {
  return (
    <section className="mt-4">
      <h2 className="mb-2 text-lg font-bold">参加者</h2>
      <ul aria-label="参加者">
        {participants.map((p) => (
          <li
            key={p.userId}
            className="flex flex-wrap gap-x-3 border-t border-border-strong p-2"
          >
            <span className="font-bold">{p.displayName}</span>
            {p.departmentName !== null && (
              <span className="text-sm text-text-muted">
                {p.departmentName}
              </span>
            )}
            {p.isCreator && <span className="text-sm">作成者</span>}
            {p.autoRole !== null && (
              <span className="text-sm">{AUTO_ROLE_LABELS[p.autoRole]}</span>
            )}
            {!p.isActive && <span className="text-sm">退職者</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
