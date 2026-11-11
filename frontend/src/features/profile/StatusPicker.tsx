// ステータスの切り替え（5種類のボタン＋戻り予定）。ヘッダーのステータスボタンの popover とアバターメニューが共用する。
// 選ぶとすぐ PATCH /api/me/profile を送る。失敗したときは表示を変えず、その場でエラーを知らせる。
import { useState } from "react";
import { USER_STATUS_KINDS } from "../../../../shared/profile-rules";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { describeError } from "./describe-error";
import { useMyProfile } from "./hooks/useMyProfile";
import { useUpdateMyProfile } from "./hooks/useUpdateMyProfile";
import { localToIso, returnAtBounds } from "./return-at";
import { STATUS_LABELS } from "./status-labels";

export function StatusPicker() {
  const profile = useMyProfile();
  const update = useUpdateMyProfile();
  const [returnAt, setReturnAt] = useState("");
  // 入力の目安（min=現在・max=1年後）。開いている間は固定し、最終的な判定はサーバーが行う
  const [bounds] = useState(() => returnAtBounds(new Date()));
  const current = profile.data?.status.kind;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {USER_STATUS_KINDS.map((kind) => (
          <Button
            key={kind}
            variant={current === kind ? "primary" : "secondary"}
            aria-pressed={current === kind}
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                status: kind,
                ...(kind === "available" || returnAt === ""
                  ? {}
                  : { returnAt: localToIso(returnAt) }),
              })
            }
          >
            {STATUS_LABELS[kind]}
          </Button>
        ))}
      </div>
      <TextField
        label="戻り予定"
        type="datetime-local"
        min={bounds.min}
        max={bounds.max}
        value={returnAt}
        onChange={(event) => setReturnAt(event.target.value)}
        hint="入力してから種類を押すと、一緒に送ります。同じ種類をもう一度押すと、戻り予定だけを変えられます。在席を選ぶと、戻り予定は消えます"
      />
      {update.isError && (
        <Alert tone="error" role="alert">
          {describeError(update.error)}
        </Alert>
      )}
    </div>
  );
}
