// 「DMを送る」ボタン。S-05・S-20・S-27・相手の選択から、その相手との DM（S-06）を始める（なければ作り、あればそれを開く）。
// 送信中は押せない。失敗したら移らず、API のメッセージを出す。
import { useNavigate } from "react-router";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { describeError } from "../describe-error";
import { useStartDm } from "../hooks/useStartDm";

export function StartDmButton({
  partnerUserId,
  partnerDisplayName,
}: {
  partnerUserId: string;
  partnerDisplayName: string;
}) {
  const start = useStartDm();
  const navigate = useNavigate();

  function onClick() {
    // 失敗は start.error として下の Alert に出す
    start.mutate(partnerUserId, {
      onSuccess: (started) => void navigate(`/dms/${started.roomId}`),
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        disabled={start.isPending}
        onClick={onClick}
        aria-label={`${partnerDisplayName} さんに DMを送る`}
      >
        DMを送る
      </Button>
      {start.isError && (
        <Alert tone="error" role="alert">
          {describeError(start.error)}
        </Alert>
      )}
    </>
  );
}
