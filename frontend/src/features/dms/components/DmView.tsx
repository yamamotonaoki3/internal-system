// DM の画面（S-06）。上部に相手（表示名・部署・ステータス）、本体は部屋のメッセージ（一覧と入力欄）。
// 相手が無効なら、表示名に「退職者」を添えて入力欄を閉じる。当事者でない・存在しない DM は、区別せず「見つかりません」を出す。
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { RoomMessages } from "../../messages";
import { ProfileCardTrigger, StatusBadge } from "../../profile";
import { dmKeys } from "../api/query-keys";
import { describeError, isApiError } from "../describe-error";
import { useDm } from "../hooks/useDm";

export function DmView({ roomId }: { roomId: string }) {
  const dm = useDm(roomId);
  const queryClient = useQueryClient();
  const [postNotice, setPostNotice] = useState<string | null>(null);

  if (dm.isPending) return <p role="status">読み込み中です</p>;
  if (dm.isError) {
    if (isApiError(dm.error) && dm.error.status === 404)
      return <p>この DM は見つかりません</p>;
    return (
      <Alert tone="error" role="alert">
        {describeError(dm.error)}
      </Alert>
    );
  }

  const { partner, canPost } = dm.data;

  // 開いている間に相手が無効になると、投稿が 409 になる。知らせて詳細を取り直し、入力欄を閉じる
  function handlePostError(error: unknown) {
    if (!isApiError(error) || error.status !== 409) return;
    setPostNotice("相手のアカウントが無効になったため、送信できませんでした");
    // 詳細（入力欄を閉じる）と一覧（サイドバーの相手の表示）を取り直す
    void queryClient.invalidateQueries({ queryKey: dmKeys.all });
  }

  function handlePosted() {
    setPostNotice(null);
    void queryClient.invalidateQueries({ queryKey: dmKeys.list });
  }

  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="text-xl font-bold">
          {partner.isActive ? (
            <ProfileCardTrigger
              userId={partner.id}
              displayName={`@${partner.displayName}`}
            />
          ) : (
            <span>
              @{partner.displayName}
              <span className="text-text-muted">（退職者）</span>
            </span>
          )}
        </h1>
        <span>{partner.department?.name ?? "所属なし"}</span>
        {partner.status !== null && <StatusBadge status={partner.status} />}
      </header>
      {postNotice !== null && (
        <Alert tone="error" role="alert">
          {postNotice}
        </Alert>
      )}
      <RoomMessages
        roomId={roomId}
        canPost={canPost}
        joined
        notFoundText="この DM は見つかりません"
        emptyText={`${partner.displayName} さんへの最初のメッセージを送りましょう。相手が不在でも、ログインしたときに読まれます`}
        cannotPostText="相手のアカウントが無効になっているため、送信できません"
        retiredAuthorIds={partner.isActive ? [] : [partner.id]}
        onPosted={handlePosted}
        onPostError={handlePostError}
      />
    </section>
  );
}
