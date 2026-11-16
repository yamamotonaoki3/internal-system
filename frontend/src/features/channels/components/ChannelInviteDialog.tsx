// チャンネルへの招待（S-12）。社員を検索して選ぶ → 再認証 → 確定画面（相手とチャンネル名）→「確定」で送る。
// 再認証が済んでも、確定画面で「確定」を押すまで招待の API は呼ばない。確定の前に閉じれば何も送らない。
// 認可はサーバーが判定する（見えないチャンネル・相手が見つからないは 404、参加済み・部署が無効は 409）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { useSession } from "../../auth";
import { MemberSearchField, useMembers, type Member } from "../../members";
import { describeError, isApiError } from "../describe-error";
import { useInviteToChannel } from "../hooks/useInviteToChannel";

type ChannelInviteDialogProps = {
  channelId: string;
  channelName: string;
  onClose: () => void;
};

const REAUTH_NOT_DONE_MESSAGE = "再認証が完了しなかったため、招待していません";

/** 招待の失敗を、code で分けて文にする */
function describeInviteError(error: unknown): string {
  if (!isApiError(error)) return describeError(error);
  if (error.code === "NOT_FOUND")
    return "招待する社員またはチャンネルが見つかりません";
  if (error.code === "REAUTH_REQUIRED")
    return "再認証の有効期間が切れました。もう一度操作してください";
  // CONFLICT（参加済み・部署が無効など）はサーバーの文言をそのまま出す
  return error.message;
}

function ModalDialog({
  label,
  onCancel,
  children,
}: {
  label: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">{label}</h2>
        {children}
      </section>
    </dialog>
  );
}

export function ChannelInviteDialog({
  channelId,
  channelName,
  onClose,
}: ChannelInviteDialogProps) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Member | null>(null);
  const members = useMembers("", q);
  const session = useSession();
  const selfId = session.data?.user.id;
  const { confirmReauth, invite } = useInviteToChannel(channelId);

  // セッションが届くまでは、自分を除けないため候補を出さない
  const candidates =
    selfId === undefined
      ? []
      : (members.data?.pages ?? [])
          .flatMap((page) => page.items)
          .filter((member) => member.id !== selfId);

  function select(member: Member) {
    confirmReauth.mutate(undefined, { onSuccess: () => setSelected(member) });
  }

  if (selected !== null)
    return (
      <ModalDialog
        label="招待の確認"
        onCancel={() => {
          if (!invite.isPending) onClose();
        }}
      >
        <p className="mb-4">
          {selected.displayName} さんを「{channelName}」に追加します。
        </p>
        {invite.isError && (
          <Alert tone="error" role="alert">
            {describeInviteError(invite.error)}
          </Alert>
        )}
        <div className="flex gap-2">
          <Button
            disabled={invite.isPending}
            onClick={() =>
              invite.mutate(selected.id, { onSuccess: () => onClose() })
            }
          >
            確定
          </Button>
          <Button
            variant="secondary"
            disabled={invite.isPending}
            onClick={onClose}
          >
            キャンセル
          </Button>
        </div>
      </ModalDialog>
    );

  return (
    <ModalDialog
      label="チャンネルに招待"
      onCancel={() => {
        if (!confirmReauth.isPending) onClose();
      }}
    >
      <MemberSearchField onSearch={setQ} />
      {confirmReauth.isError && (
        <Alert tone="error" role="alert">
          {REAUTH_NOT_DONE_MESSAGE}
        </Alert>
      )}
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
            <Button
              variant="secondary"
              disabled={confirmReauth.isPending}
              onClick={() => select(member)}
            >
              {member.displayName} さんを招待
            </Button>
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
      <div className="mt-4">
        <Button
          variant="secondary"
          disabled={confirmReauth.isPending}
          onClick={onClose}
        >
          閉じる
        </Button>
      </div>
    </ModalDialog>
  );
}
