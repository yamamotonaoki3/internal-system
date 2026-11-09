// 部屋のメッセージ（一覧と入力欄）。チャンネルの詳細（S-05）から使う。DM・スレッドも同じ部品を使えるよう、channels の外に置く。
// 入力欄は、参加していて（joined）投稿できる（canPost）ときだけ出す。
import { Alert } from "../../../components/Alert";
import { isApiError } from "../describe-error";
import { useRoomMessages } from "../hooks/useRoomMessages";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";

type RoomMessagesProps = {
  roomId: string;
  canPost: boolean;
  joined: boolean;
};

export function RoomMessages({ roomId, canPost, joined }: RoomMessagesProps) {
  const messages = useRoomMessages(roomId);
  // 見えなくなった（非公開にされた・アーカイブされた等）。一覧も入力欄も出さない
  if (isApiError(messages.error) && messages.error.status === 404)
    return <p>このチャンネルは表示できません</p>;
  return (
    <div className="mb-6">
      <MessageList
        messages={messages.data}
        isPending={messages.isPending}
        error={messages.error}
      />
      {joined &&
        (canPost ? (
          <MessageComposer roomId={roomId} />
        ) : (
          <Alert tone="info">
            このチャンネルに投稿できるのは、部署のオーナーと全体管理者だけです
          </Alert>
        ))}
    </div>
  );
}
