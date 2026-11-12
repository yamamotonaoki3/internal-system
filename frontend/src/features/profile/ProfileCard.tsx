// プロフィールカード S-27。表示名のボタン（ProfileCardTrigger）を押すと、ネイティブ popover でカードを開く。
// 本名はこのカードと自分のプロフィールだけに出す。カードの内容は開いたときに取り、閉じたら起動ボタンにフォーカスを戻す（ブラウザの既定だけに頼らない）。
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type ReactNode, type ToggleEvent } from "react";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { getProfileCard } from "./api/profile-api";
import { profileKeys } from "./api/query-keys";
import { describeError } from "./describe-error";
import { StatusBadge } from "./StatusBadge";

function ProfileCardBody({ userId }: { userId: string }) {
  const card = useQuery({
    queryKey: profileKeys.card(userId),
    queryFn: () => getProfileCard(userId),
    retry: false,
  });
  if (card.isPending) return <p role="status">読み込み中です</p>;
  if (card.isError)
    return (
      <Alert tone="error" role="alert">
        {describeError(card.error)}
      </Alert>
    );
  const { data } = card;
  return (
    <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt className="text-text-muted">表示名</dt>
      <dd>{data.displayName}</dd>
      <dt className="text-text-muted">本名</dt>
      <dd>{data.legalName}</dd>
      <dt className="text-text-muted">部署</dt>
      <dd>{data.department?.name ?? "所属なし"}</dd>
      <dt className="text-text-muted">ステータス</dt>
      <dd>
        <StatusBadge status={data.status} />
      </dd>
      {data.status.message !== null && (
        <>
          <dt className="text-text-muted">一言</dt>
          <dd>{data.status.message}</dd>
        </>
      )}
    </dl>
  );
}

export function ProfileCardTrigger({
  userId,
  displayName,
  actions,
}: {
  userId: string;
  displayName: string;
  /** カードの中に足す操作（社員一覧の「DMを送る」等。呼び出し側から差し込む） */
  actions?: ReactNode;
}) {
  const panelId = `profile-card-${userId}`;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function handleToggle(event: ToggleEvent<HTMLDivElement>) {
    const nowOpen = event.nativeEvent.newState === "open";
    setOpen(nowOpen);
    if (!nowOpen) triggerRef.current?.focus();
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        popoverTarget={panelId}
        aria-controls={panelId}
        aria-expanded={open}
      >
        {displayName}
      </Button>
      <div
        id={panelId}
        popover="auto"
        onToggle={handleToggle}
        className="inset-auto left-2 top-24 w-80 max-w-full rounded-md border border-border bg-surface p-4 text-text shadow-float"
      >
        {open && (
          <>
            <ProfileCardBody userId={userId} />
            {actions}
          </>
        )}
        <Button
          variant="secondary"
          popoverTarget={panelId}
          popoverTargetAction="hide"
        >
          閉じる
        </Button>
      </div>
    </>
  );
}
