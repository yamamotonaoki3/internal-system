// S-17 の「参加者を管理」（S-18 の参加者の部分。#147 の 147-B）。社員を探して追加し、外せる人を外し、本人は退出できる。
// 自動参加の人（担当部署のオーナー・全体管理者）は役割の名前を出し、「削除」「退出する」を出さない（Q8・Q2）。外せるかはサーバーの removable に従う。
// 確認の対象・完了の表示・エラーは、行の外（この部品）で持つ：取り直しで行が消えても、完了の表示が残る。
// 422 は「社員の検索」の欄に、409・403 などは欄の外に出す。変更中は、追加・削除・退出のボタンを押せない。
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { TextField } from "../../../components/TextField";
import { useSettledValue } from "../../../lib/useSettledValue";
import { useUserSearch } from "../../members";
import type { CaseParticipant } from "../api/case-api";
import { describeError, isApiError } from "../describe-error";
import {
  useAddCaseParticipant,
  useRemoveCaseParticipant,
} from "../hooks/useCaseWrites";
import { AUTO_ROLE_LABELS, PARTICIPANTS_UPDATED_TEXT } from "../labels";
import { CaseConfirmDialog } from "./CaseConfirmDialog";

const SEARCH_DELAY_MS = 300;

type Props = {
  caseId: string;
  selfId: string;
  participants: CaseParticipant[];
  onClose: () => void;
};

type Pending = { participant: CaseParticipant; self: boolean };

export function CaseParticipantManager({
  caseId,
  selfId,
  participants,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const add = useAddCaseParticipant(caseId);
  const remove = useRemoveCaseParticipant(caseId);
  const [q, setQ] = useState("");
  const search = useUserSearch(useSettledValue(q.trim(), SEARCH_DELAY_MS));
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [updated, setUpdated] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [error, setError] = useState<string>();
  const busy = add.isPending || remove.isPending;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const joined = new Set(participants.map((p) => p.userId));
  const results = (
    search.data?.pages.flatMap((page) => page.items) ?? []
  ).filter((user) => !joined.has(user.id));

  function start() {
    setUpdated(false);
    setSearchError(undefined);
    setError(undefined);
  }

  /** 422 は欄に、それ以外は欄の外に出す */
  function showError(cause: unknown, field: "search" | "outside") {
    if (field === "search" && isApiError(cause) && cause.status === 422)
      setSearchError(cause.message);
    else setError(describeError(cause));
  }

  function addUser(userId: string) {
    start();
    add.mutate(userId, {
      onSuccess: () => setUpdated(true),
      onError: (cause) => showError(cause, "search"),
    });
  }

  function confirmRemove() {
    if (confirming === null) return;
    const { participant, self } = confirming;
    start();
    remove.mutate(
      { userId: participant.userId, self },
      {
        onSuccess: () => {
          if (self) {
            void navigate("/cases");
            return;
          }
          setUpdated(true);
        },
        onError: (cause) => showError(cause, "outside"),
        onSettled: () => setConfirming(null),
      },
    );
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="参加者を管理"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="w-full max-w-lg rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <h2 className="mb-4 text-xl font-bold">参加者を管理</h2>
      {updated && (
        <Alert tone="info" role="status" as="p">
          {PARTICIPANTS_UPDATED_TEXT}
        </Alert>
      )}
      {error !== undefined && (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      )}
      <TextField
        label="社員の検索"
        hint="名前で探して、参加者に追加できます"
        autoComplete="off"
        value={q}
        error={searchError}
        onChange={(event) => setQ(event.target.value)}
      />
      {search.isError && (
        <Alert tone="error" as="p">
          {describeError(search.error)}
        </Alert>
      )}
      {results.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {results.map((user) => (
            <Button
              key={user.id}
              variant="secondary"
              disabled={busy}
              onClick={() => addUser(user.id)}
            >
              {user.displayName}を追加
            </Button>
          ))}
        </div>
      )}
      {search.hasNextPage && (
        <Button
          variant="secondary"
          disabled={search.isFetchingNextPage}
          onClick={() => void search.fetchNextPage()}
        >
          次のページ
        </Button>
      )}
      <ul aria-label="参加者の一覧" className="my-4">
        {participants.map((p) => {
          const self = p.userId === selfId;
          return (
            <li
              key={p.userId}
              className="flex flex-wrap items-center gap-x-3 border-t border-border-strong p-2"
            >
              <span className="font-bold">{p.displayName}</span>
              {p.departmentName !== null && (
                <span className="text-sm text-text-muted">
                  {p.departmentName}
                </span>
              )}
              {p.isCreator && <span className="text-sm">作成者</span>}
              {p.autoRole !== null && (
                <span className="text-sm">{AUTO_ROLE_LABELS[p.autoRole]}</span>
              )}
              {!p.isActive && <span className="text-sm">退職者</span>}
              {p.removable && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  aria-label={self ? undefined : `${p.displayName}を削除`}
                  onClick={() => setConfirming({ participant: p, self })}
                >
                  {self ? "退出する" : "削除"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <Button variant="secondary" disabled={busy} onClick={onClose}>
        閉じる
      </Button>
      {confirming !== null && (
        <CaseConfirmDialog
          title={confirming.self ? "案件からの退出" : "参加者の削除"}
          confirmLabel={confirming.self ? "退出する" : "削除する"}
          pending={remove.isPending}
          onConfirm={confirmRemove}
          onClose={() => setConfirming(null)}
        >
          {confirming.self
            ? "この案件から退出します。退出すると、この案件の中身を見られなくなります。"
            : `${confirming.participant.displayName}を参加者から外します。外された人は、この案件の中身を見られなくなります。`}
        </CaseConfirmDialog>
      )}
    </dialog>
  );
}
