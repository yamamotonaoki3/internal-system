// S-17 のやり取り（#148）。案件専用チャンネルの部屋（詳細の channelId）のメッセージを、チャンネル・DM と同じ部品で出す（5-2 AC-4）。
// 終了した案件では、帯を出し、投稿・編集・リアクションの操作を出さない（読み取り専用。5-1 AC-11）。閲覧と既読はできる。
// 開いている間にほかの人が案件を終了すると、投稿が 409 になる。理由を出し続け、概要・詳細を取り直して読み取り専用に切り替える。
// 利用者・案件が替われば、ページごと作り直す（pages/CaseDetailPage.tsx の key）。下書きは RoomMessages が部屋×利用者で持つ。
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { RoomMessages } from "../../messages";
import { ThreadLayout, useThreadParam } from "../../threads";
import { useMarkRoomRead } from "../../unread";
import { caseKeys } from "../api/query-keys";
import { describeError, isApiError } from "../describe-error";
import {
  CASE_CANNOT_POST_TEXT,
  CASE_CLOSED_BANNER_TEXT,
  CONVERSATION_EMPTY_TEXT,
  PARTICIPANTS_ONLY_TEXT,
} from "../labels";

export function CaseConversation({
  caseId,
  selfId,
  roomId,
  closed,
}: {
  caseId: string;
  selfId: string;
  roomId: string;
  closed: boolean;
}) {
  const queryClient = useQueryClient();
  const read = useMarkRoomRead(roomId);
  const thread = useThreadParam();
  const [conflict, setConflict] = useState<string | null>(null);

  function handlePostError(error: unknown) {
    if (!isApiError(error) || error.status !== 409) return;
    setConflict(describeError(error));
    void queryClient.invalidateQueries({
      queryKey: caseKeys.summary(selfId, caseId),
    });
    void queryClient.invalidateQueries({
      queryKey: caseKeys.detail(selfId, caseId),
    });
  }

  return (
    <ThreadLayout roomId={roomId}>
      <section className="mt-6 min-w-0 flex-1">
        <h2 className="mb-2 text-lg font-bold">やり取り</h2>
        {closed && <Alert tone="warning">{CASE_CLOSED_BANNER_TEXT}</Alert>}
        {/* 入力欄が出ている間は、入力欄が自分でエラーを出す。読み取り専用に切り替わった後も、投稿できなかった理由を残す */}
        {closed && conflict !== null && (
          <Alert tone="error" role="alert">
            {conflict}
          </Alert>
        )}
        <RoomMessages
          roomId={roomId}
          joined
          canPost={!closed}
          canModifyOwn={!closed}
          notFoundText={PARTICIPANTS_ONLY_TEXT}
          emptyText={CONVERSATION_EMPTY_TEXT}
          cannotPostText={CASE_CANNOT_POST_TEXT}
          onPostError={handlePostError}
          onLatestMessageIdChange={read.markRead}
          onOpenThread={thread.open}
        />
        {read.error !== null && (
          <Alert tone="error" role="alert">
            既読の状態を更新できませんでした。{describeError(read.error)}
          </Alert>
        )}
      </section>
    </ThreadLayout>
  );
}
