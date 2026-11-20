// S-17 の「案件を再開」のダイアログ（#150 の 150-B。5-1 AC-16）。参加者を選ぶ段階 → 確かめる段階 → 再開。
// 候補はいまの有効な参加者（退職者は出さない。Q1）。本人と自動参加の人（担当部署のオーナー・全体管理者）は外せず、理由を添える（Q2）。
// 外す人は「チェックを外した人」で持つ：取り直しで候補が増えても、増えた人は残す側になる。送る participantIds は、表示している候補。
// 送信と結果（成功・失敗の表示、閉じること）は、ページの側（CaseDetailView）が持つ。送信中は、ダイアログの操作を全部無効にする。
import { useEffect, useId, useRef, useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { TextField } from "../../../components/TextField";
import { useSettledValue } from "../../../lib/useSettledValue";
import { useUserSearch } from "../../members";
import type { CaseParticipant, CaseReopenBody } from "../api/case-api";
import { describeError } from "../describe-error";
import {
  AUTO_ROLE_LABELS,
  CASE_REOPEN_TEXTS,
  CASE_STATUS_CHANGE_TEXTS,
} from "../labels";

const SEARCH_DELAY_MS = 300;

type Person = { userId: string; displayName: string };

type Props = {
  selfId: string;
  /** 詳細の参加者（読み込み中は undefined） */
  participants: CaseParticipant[] | undefined;
  /** 詳細の取得の失敗の文言（失敗していなければ undefined）。出ている間は選ぶ段階を出さず、再試行を出す */
  loadError?: string;
  onRetry: () => void;
  pending: boolean;
  /** 422 の、社員の検索の欄のエラー */
  searchError?: string;
  /** 422 の、ダイアログの全体のエラー */
  error?: string;
  /** invalid は、送った本文が 422 だったときに呼ぶ（選ぶ段階に戻す） */
  onConfirm: (body: CaseReopenBody, invalid: () => void) => void;
  onClose: () => void;
};

function PeopleRegion({ title, people }: { title: string; people: Person[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mb-3">
      <h3 id={headingId} className="font-bold">
        {title}
      </h3>
      {people.length === 0 ? (
        <p>{CASE_REOPEN_TEXTS.none}</p>
      ) : (
        <ul>
          {people.map((p) => (
            <li key={p.userId}>{p.displayName}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CaseReopenDialog({
  selfId,
  participants,
  loadError,
  onRetry,
  pending,
  searchError,
  error,
  onConfirm,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stage, setStage] = useState<"select" | "confirm">("select");
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  const search = useUserSearch(useSettledValue(q.trim(), SEARCH_DELAY_MS));
  const texts = CASE_STATUS_CHANGE_TEXTS.reopen;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const candidates = (participants ?? []).filter((p) => p.isActive);
  const fixedReasons = (p: CaseParticipant) => [
    ...(p.userId === selfId ? [CASE_REOPEN_TEXTS.self] : []),
    ...(p.autoRole === null ? [] : [AUTO_ROLE_LABELS[p.autoRole]]),
  ];
  const removable = (p: CaseParticipant) => fixedReasons(p).length === 0;
  const leaving = candidates.filter(
    (p) => removable(p) && unchecked.has(p.userId),
  );
  const staying = candidates.filter((p) => !leaving.includes(p));
  const excluded = new Set([
    ...candidates.map((p) => p.userId),
    ...added.map((p) => p.userId),
  ]);
  const results = (
    search.data?.pages.flatMap((page) => page.items) ?? []
  ).filter((user) => !excluded.has(user.id));

  function toggle(userId: string, keep: boolean) {
    setUnchecked((previous) => {
      const next = new Set(previous);
      if (keep) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function confirm() {
    onConfirm(
      {
        participantIds: candidates.map((p) => p.userId),
        addUserIds: added.map((p) => p.userId),
        removeUserIds: leaving.map((p) => p.userId),
      },
      () => setStage("select"),
    );
  }

  function renderSelect() {
    return (
      <>
        <ul aria-label={CASE_REOPEN_TEXTS.candidates} className="mb-4">
          {candidates.map((p) => {
            const reasons = fixedReasons(p);
            return (
              <li
                key={p.userId}
                className="flex flex-wrap items-center gap-x-3 border-t border-border-strong p-2"
              >
                <label className="inline-flex gap-1">
                  <input
                    type="checkbox"
                    checked={!leaving.includes(p)}
                    disabled={pending || reasons.length > 0}
                    onChange={(event) => toggle(p.userId, event.target.checked)}
                  />
                  {p.displayName}
                </label>
                {reasons.map((reason) => (
                  <span key={reason} className="text-sm">
                    {reason}
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
        <TextField
          label="社員の検索"
          hint={CASE_REOPEN_TEXTS.searchHint}
          autoComplete="off"
          value={q}
          disabled={pending}
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
                disabled={pending}
                onClick={() =>
                  setAdded((previous) => [
                    ...previous,
                    { userId: user.id, displayName: user.displayName },
                  ])
                }
              >
                {user.displayName}を追加
              </Button>
            ))}
          </div>
        )}
        {search.hasNextPage && (
          <Button
            variant="secondary"
            disabled={pending || search.isFetchingNextPage}
            onClick={() => void search.fetchNextPage()}
          >
            次のページ
          </Button>
        )}
        {added.length > 0 && (
          <ul aria-label={CASE_REOPEN_TEXTS.addedList} className="my-4">
            {added.map((p) => (
              <li
                key={p.userId}
                className="flex flex-wrap items-center gap-x-3 border-t border-border-strong p-2"
              >
                <span>{p.displayName}</span>
                <Button
                  variant="secondary"
                  disabled={pending}
                  aria-label={`${p.displayName}の追加を取り消す`}
                  onClick={() =>
                    setAdded((previous) =>
                      previous.filter((a) => a.userId !== p.userId),
                    )
                  }
                >
                  取り消す
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={pending || participants === undefined}
            onClick={() => setStage("confirm")}
          >
            {CASE_REOPEN_TEXTS.next}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            キャンセル
          </Button>
        </div>
      </>
    );
  }

  function renderConfirm() {
    return (
      <>
        <PeopleRegion title={CASE_REOPEN_TEXTS.stay} people={staying} />
        <PeopleRegion title={CASE_REOPEN_TEXTS.add} people={added} />
        <PeopleRegion title={CASE_REOPEN_TEXTS.leave} people={leaving} />
        <p className="mb-4">{texts.body}</p>
        <div className="flex gap-2">
          <Button variant="danger" disabled={pending} onClick={confirm}>
            {texts.confirm}
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => setStage("select")}
          >
            {CASE_REOPEN_TEXTS.back}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            キャンセル
          </Button>
        </div>
      </>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={texts.title}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      className="w-full max-w-lg rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <h2 className="mb-4 text-xl font-bold">{texts.title}</h2>
      {error !== undefined && (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      )}
      {participants === undefined ? (
        <>
          {loadError === undefined ? (
            <p role="status">読み込み中です</p>
          ) : (
            <Alert tone="error" role="alert">
              <p>{loadError}</p>
              <Button variant="secondary" onClick={onRetry}>
                {CASE_REOPEN_TEXTS.retry}
              </Button>
            </Alert>
          )}
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
        </>
      ) : stage === "select" ? (
        renderSelect()
      ) : (
        renderConfirm()
      )}
    </dialog>
  );
}
