// オーナーの変更（EP-0-21）。別部署の現オーナーを選んだときは、元部署の後任も選ぶ。
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { fetchOwnerCandidates, type Department } from "./department-api";
import { needsSuccessor } from "./owner-selection";
import { OwnerSelectFields } from "./OwnerSelectFields";
import { departmentKeys } from "./query-keys";
import { useDepartmentMutations } from "./useDepartmentMutations";
import { describeWriteError } from "./write-errors";

type Props = { department: Department; onClose: () => void };

export function OwnerChangeDialog({ department, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { changeOwner } = useDepartmentMutations();
  const candidates = useQuery({
    queryKey: departmentKeys.ownerCandidates,
    queryFn: fetchOwnerCandidates,
    retry: false,
  });
  const [ownerUserId, setOwnerUserId] = useState("");
  const [successorUserId, setSuccessorUserId] = useState("");
  const [ownerError, setOwnerError] = useState<string>();
  const [successorError, setSuccessorError] = useState<string>();
  const [serverError, setServerError] = useState<string>();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // 今のオーナーは、新しいオーナーの候補に出さない
  const selectable = (candidates.data ?? []).filter(
    (candidate) => candidate.id !== department.ownerUserId,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(undefined);
    setOwnerError(undefined);
    setSuccessorError(undefined);
    const owner = selectable.find((candidate) => candidate.id === ownerUserId);
    if (owner === undefined) {
      setOwnerError("新しいオーナーを選んでください");
      return;
    }
    if (needsSuccessor(owner) && successorUserId === "") {
      setSuccessorError("元部署の後任を選んでください");
      return;
    }
    try {
      await changeOwner.mutateAsync({
        department,
        assignment: {
          ownerUserId,
          ...(successorUserId === ""
            ? {}
            : { previousDepartmentSuccessorUserId: successorUserId }),
        },
      });
    } catch (error) {
      const message = describeWriteError(error);
      if (message === null) throw error;
      setServerError(message);
      return;
    }
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="オーナーの変更"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">オーナーの変更</h2>
        {candidates.isError && (
          <Alert tone="error" role="alert">
            オーナーの候補を取得できませんでした。閉じて、もう一度お試しください。
          </Alert>
        )}
        <form onSubmit={(event) => void submit(event)} noValidate>
          <OwnerSelectFields
            ownerLabel="新しいオーナー"
            candidates={selectable}
            ownerUserId={ownerUserId}
            successorUserId={successorUserId}
            ownerError={ownerError}
            successorError={successorError}
            onOwnerChange={setOwnerUserId}
            onSuccessorChange={setSuccessorUserId}
          />
          {serverError && (
            <Alert tone="error" role="alert">
              {serverError}
            </Alert>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={changeOwner.isPending}>
              {changeOwner.isPending ? "変更中" : "変更する"}
            </Button>
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={changeOwner.isPending}
            >
              キャンセル
            </Button>
          </div>
        </form>
      </section>
    </dialog>
  );
}
