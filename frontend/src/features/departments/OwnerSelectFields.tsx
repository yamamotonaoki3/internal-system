// オーナーの選択欄と、必要なときだけ出す元部署の後任の選択欄（部署作成とオーナー変更で共通）。
import { SelectField } from "../../components/SelectField";
import type { OwnerCandidate } from "./department-api";
import { needsSuccessor, successorCandidates } from "./owner-selection";

type Props = {
  ownerLabel: string;
  /** 先頭に出す「指名しない」の選択肢の文。省略すると、必ず誰かを選ぶ */
  noneLabel?: string;
  candidates: readonly OwnerCandidate[];
  ownerUserId: string;
  successorUserId: string;
  ownerError?: string;
  successorError?: string;
  onOwnerChange: (userId: string) => void;
  onSuccessorChange: (userId: string) => void;
};

export function OwnerSelectFields({
  ownerLabel,
  noneLabel,
  candidates,
  ownerUserId,
  successorUserId,
  ownerError,
  successorError,
  onOwnerChange,
  onSuccessorChange,
}: Props) {
  const owner = candidates.find((candidate) => candidate.id === ownerUserId);
  const successors = successorCandidates(owner, candidates);
  return (
    <>
      <SelectField
        label={ownerLabel}
        value={ownerUserId}
        error={ownerError}
        onChange={(event) => {
          onOwnerChange(event.target.value);
          onSuccessorChange("");
        }}
      >
        {noneLabel === undefined ? (
          <option value="">選択してください</option>
        ) : (
          <option value="">{noneLabel}</option>
        )}
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.displayName}
          </option>
        ))}
      </SelectField>
      {needsSuccessor(owner) && (
        <SelectField
          label="元部署の後任"
          value={successorUserId}
          error={successorError}
          onChange={(event) => onSuccessorChange(event.target.value)}
        >
          <option value="">選択してください</option>
          {successors.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.displayName}
            </option>
          ))}
        </SelectField>
      )}
    </>
  );
}
