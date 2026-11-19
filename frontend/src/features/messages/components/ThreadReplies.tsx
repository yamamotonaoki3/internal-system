// スレッドの中身（S-07）：親の投稿・返信の一覧・返信の入力欄。枠（見出し・閉じる・既読）は features/threads の ThreadPane が持つ。
// 4つの状態：読み込み中・取得に失敗（404 は「スレッドが見つかりません」）・0件・あり。取得に失敗しても、取得済みの返信は残して上にエラーを出す。
// 返信できない理由（replyBlockedReason）があるときは、入力欄の代わりに案内を出す。表示の制御だけで、認可は投稿のときにサーバーが行う。
// 親は表示だけ（編集・削除は出さない）。自分の返信の編集・削除は、参加していて（joined）部屋に書き込めるとき（roomWritable）だけ出す。返信できない理由（replyBlockedReason）には頼らない（優先順で部屋の理由が隠れるため）。
import { useEffect, useState } from "react";
import { Alert } from "../../../components/Alert";
import {
  REPLY_BLOCKED_REASONS,
  type ReplyBlockedReason,
} from "../../../../../shared/message-rules";
import { useSignedInUserId } from "../../auth";
import { describeError, isApiError } from "../describe-error";
import {
  useThreadReplies,
  type ThreadRepliesData,
} from "../hooks/useThreadReplies";
import type { RoomMessage } from "../api/message-api";
import { isRetiredAuthor } from "../retired-author";
import { MessageComposer } from "./MessageComposer";
import { MessageItem } from "./MessageItem";
import { MessageList } from "./MessageList";

const BLOCKED_TEXT = {
  [REPLY_BLOCKED_REASONS.deletedParent]:
    "元のメッセージが削除されたため、返信できません",
  [REPLY_BLOCKED_REASONS.notJoined]: "このチャンネルに参加すると、返信できます",
  [REPLY_BLOCKED_REASONS.caseClosed]: "終了した案件のため、返信できません",
  [REPLY_BLOCKED_REASONS.readOnly]:
    "このチャンネルは読み取り専用のため、返信できません",
  [REPLY_BLOCKED_REASONS.partnerInactive]:
    "相手のアカウントが無効になっているため、返信できません",
} as const satisfies Record<ReplyBlockedReason, string>;

type ThreadRepliesProps = {
  parentMessageId: string;
  /** 今開いている部屋。親がこの部屋のものでなければ、見つからないスレッドとして扱う（別の部屋のスレッドを、この部屋のものとして開かない） */
  roomId?: string;
  /** 表示名に「退職者」を併記する投稿者の利用者ID */
  retiredAuthorIds?: readonly string[];
  /** 表示している最新の返信の ID が変わったときに呼ぶ（既読のため）。0件・取得失敗・参加していないとき・見つからないときは呼ばない */
  onLatestReplyIdChange?: (replyId: string) => void;
  /** 返信の投稿が成功したあとに呼ぶ（使う側の一覧の取り直しなど） */
  onReplied?: () => void;
  /** 返信の削除が成功したあとに呼ぶ（画面ごとの取り直しのため。省略できる） */
  onDeleted?: () => void;
};

function ReplyArea({
  parent,
  reason,
  userId,
  onReplied,
}: {
  parent: RoomMessage;
  reason: ReplyBlockedReason | null;
  userId: string | undefined;
  onReplied?: () => void;
}) {
  if (reason !== null) return <Alert tone="info">{BLOCKED_TEXT[reason]}</Alert>;
  return (
    // スレッドや利用者が替わったら作り直す（入力と下書きを持ち越さない）
    <MessageComposer
      key={`${userId ?? "anonymous"}:thread:${parent.roomId}:${parent.id}`}
      roomId={parent.roomId}
      parentMessageId={parent.id}
      userId={userId}
      onPosted={onReplied}
    />
  );
}

function isNotFound(
  error: unknown,
  data: ThreadRepliesData | undefined,
  roomId: string | undefined,
): boolean {
  if (isApiError(error) && error.status === 404) return true;
  return (
    data !== undefined && roomId !== undefined && data.parent.roomId !== roomId
  );
}

export function ThreadReplies({
  parentMessageId,
  roomId,
  retiredAuthorIds = [],
  onLatestReplyIdChange,
  onReplied,
  onDeleted,
}: ThreadRepliesProps) {
  const thread = useThreadReplies(parentMessageId);
  // リアクションのピッカーは、親と返信を通して同時に1つだけ開く
  const [pickerOpenId, setPickerOpenId] = useState<string | null>(null);
  const userId = useSignedInUserId();
  const data = thread.data;
  const notFound = isNotFound(thread.error, data, roomId);
  const reason = data?.replyBlockedReason ?? null;
  // 見つからない・参加していない（公開チャンネルを読んでいるだけ。親が削除済みでも同じ）ときは、既読の対象にしない
  const readable = !notFound && data?.joined === true;
  const latestId = readable ? data?.replies.at(-1)?.id : undefined;
  // 表示している最新の返信の ID を、外部（既読の送信）へ知らせる同期
  useEffect(() => {
    if (latestId !== undefined) onLatestReplyIdChange?.(latestId);
  }, [latestId, onLatestReplyIdChange]);

  if (thread.isPending) return <p role="status">読み込み中です</p>;
  if (notFound) return <p>スレッドが見つかりません</p>;
  // 取得済みのスレッドがないまま失敗したときは、0件と出さない
  if (data === undefined)
    return (
      <Alert tone="error" role="alert">
        {describeError(thread.error)}
      </Alert>
    );
  // 自分の返信の編集・削除は、参加していて、部屋に書き込めるときだけ。入力欄の可否（reason）とは別に決める
  const canModifyOwn = data.joined && data.roomWritable;
  // リアクションの付け外しも同じ条件（親が削除済みでも、書き込める部屋なら未削除の返信には付けられる）
  return (
    <div>
      <ul className="mb-4">
        <MessageItem
          message={data.parent}
          retired={isRetiredAuthor(data.parent.author, retiredAuthorIds)}
          canModify={false}
          canReact={canModifyOwn}
          pickerOpen={pickerOpenId === data.parent.id}
          onPickerOpenChange={(open) =>
            setPickerOpenId(open ? data.parent.id : null)
          }
        />
      </ul>
      <MessageList
        messages={data.replies}
        isPending={false}
        error={thread.error}
        emptyText="まだ返信はありません"
        label="返信一覧"
        retiredAuthorIds={retiredAuthorIds}
        currentUserId={userId}
        canModifyOwn={canModifyOwn}
        canReact={canModifyOwn}
        pickerOpenId={pickerOpenId}
        onPickerOpenIdChange={setPickerOpenId}
        onDeleted={onDeleted}
      />
      <ReplyArea
        parent={data.parent}
        reason={reason}
        userId={userId}
        onReplied={onReplied}
      />
    </div>
  );
}
