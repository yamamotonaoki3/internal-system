// ステータスの代理設定（EP-0-15）。種類と戻り予定を選んで設定する。一言メッセージは変えない。
// 失敗したときは入力を残してエラーを知らせる。成功したら閉じる（一覧は取り直される）。
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { UserStatusKind } from "../../../../shared/profile-rules";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import {
  describeError,
  isoToLocal,
  localToIso,
  returnAtBounds,
  StatusKindRadios,
} from "../profile";
import type { Member } from "./api/member-api";
import { useSetMemberStatus } from "./hooks/useSetMemberStatus";

type Props = { member: Member; onClose: () => void };

export function ProxyStatusDialog({ member, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const setStatus = useSetMemberStatus(member.id);
  const [kind, setKind] = useState<UserStatusKind>(member.status.kind);
  const [returnAt, setReturnAt] = useState(isoToLocal(member.status.returnAt));
  const [bounds] = useState(() => returnAtBounds(new Date()));
  const [error, setError] = useState<string>();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    try {
      await setStatus.mutateAsync({
        status: kind,
        ...(kind === "available" || returnAt === ""
          ? {}
          : { returnAt: localToIso(returnAt) }),
      });
    } catch (e) {
      setError(describeError(e));
      return;
    }
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="ステータスの代理設定"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">
          {member.displayName}さんのステータス
        </h2>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <StatusKindRadios
            value={kind}
            onChange={(next) => {
              setKind(next);
              if (next === "available") setReturnAt("");
            }}
            disabled={setStatus.isPending}
          />
          <TextField
            label="戻り予定"
            type="datetime-local"
            min={bounds.min}
            max={bounds.max}
            value={returnAt}
            onChange={(event) => setReturnAt(event.target.value)}
            disabled={kind === "available" || setStatus.isPending}
          />
          {error !== undefined && (
            <Alert tone="error" role="alert">
              {error}
            </Alert>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={setStatus.isPending}>
              {setStatus.isPending ? "設定中" : "設定する"}
            </Button>
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={setStatus.isPending}
            >
              キャンセル
            </Button>
          </div>
        </form>
      </section>
    </dialog>
  );
}
