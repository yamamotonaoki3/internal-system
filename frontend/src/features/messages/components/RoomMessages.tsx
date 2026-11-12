// 部屋のメッセージ（一覧と入力欄）。チャンネルの詳細（S-05）から使う。DM・スレッドも同じ部品を使えるよう、channels の外に置く。
// 入力欄は、参加していて（joined）投稿できる（canPost）ときだけ出す。
// 文言・退職者の併記・投稿の通知は任意の props で差し替える（既定はチャンネルの動き。DM は features/dms から渡す）。
import { Alert } from "../../../components/Alert";
import { isApiError } from "../describe-error";
import { useRoomMessages } from "../hooks/useRoomMessages";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";

type RoomMessagesProps = {
  roomId: string;
  canPost: boolean;
  joined: boolean;
  /** 一覧の取得が 404 のときの文 */
  notFoundText?: string;
  /** 0件のときの文 */
  emptyText?: string;
  /** 参加中で投稿できないときの案内 */
  cannotPostText?: string;
  /** 表示名に「退職者」を併記する投稿者の利用者ID */
  retiredAuthorIds?: readonly string[];
  /** 投稿が成功したあとに呼ぶ */
  onPosted?: () => void;
  /** 投稿が失敗したときに、エラーのまま呼ぶ */
  onPostError?: (error: unknown) => void;
};

export function RoomMessages({
  roomId,
  canPost,
  joined,
  notFoundText = "このチャンネルは表示できません",
  emptyText,
  cannotPostText = "このチャンネルに投稿できるのは、部署のオーナーと全体管理者だけです",
  retiredAuthorIds,
  onPosted,
  onPostError,
}: RoomMessagesProps) {
  const messages = useRoomMessages(roomId);
  // 見えなくなった（非公開にされた・アーカイブされた等）。一覧も入力欄も出さない
  if (isApiError(messages.error) && messages.error.status === 404)
    return <p>{notFoundText}</p>;
  return (
    <div className="mb-6">
      <MessageList
        messages={messages.data}
        isPending={messages.isPending}
        error={messages.error}
        emptyText={emptyText}
        retiredAuthorIds={retiredAuthorIds}
      />
      {joined &&
        (canPost ? (
          <MessageComposer
            roomId={roomId}
            onPosted={onPosted}
            onPostError={onPostError}
          />
        ) : (
          <Alert tone="info">{cannotPostText}</Alert>
        ))}
    </div>
  );
}
