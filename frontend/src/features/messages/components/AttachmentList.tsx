// 送信前の添付の一覧（#140）。元の名前・サイズ（MB＝10^6バイト）と、取り消しのボタンを出す。
// 公開範囲の選択（#148）は、使う側が設定を渡したときだけ、ファイルごとの選択欄と案内（1つ）を出す。選択肢・案内の中身は使う側が決める。
import type { PublicationVisibility } from "../../../../../shared/attachment-rules";
import { Button } from "../../../components/Button";
import { SelectField } from "../../../components/SelectField";
import { formatAttachmentSize } from "../format-size";

/** 添付ごとの公開範囲の選択の設定（業務の文言は使う側が渡す） */
export type AttachmentPublicationConfig = {
  options: readonly { value: PublicationVisibility; label: string }[];
  defaultValue: PublicationVisibility;
  hint: string;
};

type AttachmentListProps = {
  files: readonly File[];
  disabled?: boolean;
  onRemove: (index: number) => void;
  /** 公開範囲の選択（files と同じ順の値と、変更の通知） */
  publication?: {
    config: AttachmentPublicationConfig;
    values: readonly PublicationVisibility[];
    onChange: (index: number, value: PublicationVisibility) => void;
  };
};

export function AttachmentList({
  files,
  disabled,
  onRemove,
  publication,
}: AttachmentListProps) {
  if (files.length === 0) return null;
  return (
    <>
      <ul aria-label="送信前の添付" className="mb-2">
        {files.map((file, index) => (
          // 同じ名前のファイルを複数選べるため、位置も key に含める
          <li key={`${index}:${file.name}`} className="text-sm">
            {file.name}（{formatAttachmentSize(file.size)}）{" "}
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => onRemove(index)}
            >
              {file.name} を取り消す
            </Button>
            {publication !== undefined && (
              <SelectField
                label={`${file.name} の公開範囲`}
                disabled={disabled}
                value={
                  publication.values[index] ?? publication.config.defaultValue
                }
                onChange={(event) => {
                  const chosen = publication.config.options.find(
                    (option) => option.value === event.target.value,
                  );
                  if (chosen !== undefined)
                    publication.onChange(index, chosen.value);
                }}
              >
                {publication.config.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            )}
          </li>
        ))}
      </ul>
      {publication !== undefined && (
        <p className="mb-2 text-sm text-text-muted">
          {publication.config.hint}
        </p>
      )}
    </>
  );
}
