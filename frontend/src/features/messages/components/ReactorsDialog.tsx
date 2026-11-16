// スマートフォン用の「付けた人」の一覧（パソコンはチップの title・aria-label で示す）。DeleteMessageDialog と同じ <dialog> の書き方。
// 種類ごとに表示と件数、付けた人の表示名を並べる。無効な社員には「（退職者）」を付け、50人を超える分は「ほか n 人」と出す。
import { useEffect, useRef } from "react";
import { Button } from "../../../components/Button";
import type { Reaction } from "../api/message-api";
import { reactionLabel } from "../reaction-label";

type ReactorsDialogProps = {
  reactions: readonly Reaction[];
  onClose: () => void;
};

export function ReactorsDialog({ reactions, onClose }: ReactorsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    // 外れるときに閉じる
    return () => dialog?.close();
  }, []);

  // 外す前に <dialog> 自身を閉じる（モーダルでなくなる）。呼び出し側がこの後にフォーカスを戻せる。
  // 外れた後の close()（下の後始末）では、モーダルのままフォーカスを戻そうとして失敗し、フォーカスが body に落ちる
  const requestClose = () => {
    dialogRef.current?.close();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="付けた人"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">付けた人</h2>
        {reactions.map((reaction) => (
          <section key={`${reaction.kind}:${reaction.value}`} className="mb-3">
            <h3 className="font-bold">
              {reactionLabel(reaction)} {reaction.count}人
            </h3>
            <ul>
              {reaction.users.map((user) => (
                <li key={user.id}>
                  {user.isActive
                    ? user.displayName
                    : `${user.displayName}（退職者）`}
                </li>
              ))}
              {reaction.count > reaction.users.length && (
                <li>ほか {reaction.count - reaction.users.length} 人</li>
              )}
            </ul>
          </section>
        ))}
        <Button variant="secondary" onClick={requestClose}>
          閉じる
        </Button>
      </section>
    </dialog>
  );
}
