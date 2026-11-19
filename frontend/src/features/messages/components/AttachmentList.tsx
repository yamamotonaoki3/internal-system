// 送信前の添付の一覧（#140）。元の名前・サイズ（MB＝10^6バイト）と、取り消しのボタンを出す。
import { Button } from "../../../components/Button";
import { formatAttachmentSize } from "../format-size";

type AttachmentListProps = {
  files: readonly File[];
  disabled?: boolean;
  onRemove: (index: number) => void;
};

export function AttachmentList({
  files,
  disabled,
  onRemove,
}: AttachmentListProps) {
  if (files.length === 0) return null;
  return (
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
        </li>
      ))}
    </ul>
  );
}
