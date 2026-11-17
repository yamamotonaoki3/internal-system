// 添付の選択（#140）。選んだ直後に shared/attachment-rules の規則で確かめ、受け付けたものだけを onAdd に渡す。
// 受け付けなかったファイルは、名前と理由を出す（一覧には入れない）。画面の確認はサーバーの検査の代わりではない。
import { useState } from "react";
import {
  validateAttachmentCandidate,
  type AttachmentRejection,
} from "../../../../../shared/attachment-rules";
import { Alert } from "../../../components/Alert";
import { FileInput } from "../../../components/FileInput";

const REJECTION_TEXT = {
  type: "この形式のファイルは添付できません",
  name: "このファイル名は添付できません",
  size: "サイズの上限を超えています",
  count: "添付は10ファイルまでです",
  total: "添付の合計は200MBまでです",
} as const satisfies Record<AttachmentRejection, string>;

type AttachmentPickerProps = {
  /** 送信前の一覧（選んだ順） */
  files: readonly File[];
  disabled?: boolean;
  onAdd: (files: File[]) => void;
};

export function AttachmentPicker({
  files,
  disabled,
  onAdd,
}: AttachmentPickerProps) {
  const [rejected, setRejected] = useState<
    { name: string; reason: AttachmentRejection }[]
  >([]);

  const select = (selected: File[]) => {
    const accepted: File[] = [];
    const nextRejected: typeof rejected = [];
    for (const file of selected) {
      const reason = validateAttachmentCandidate([...files, ...accepted], file);
      if (reason === null) accepted.push(file);
      else nextRejected.push({ name: file.name, reason });
    }
    setRejected(nextRejected);
    if (accepted.length > 0) onAdd(accepted);
  };

  return (
    <>
      {rejected.length > 0 && (
        <Alert tone="error" role="alert">
          <ul>
            {rejected.map((item, index) => (
              <li key={`${index}:${item.name}`}>
                {item.name}：{REJECTION_TEXT[item.reason]}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <FileInput
        label="ファイルを添付"
        multiple
        disabled={disabled}
        onSelect={select}
      />
    </>
  );
}
