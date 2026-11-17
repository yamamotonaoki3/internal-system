// 共通のファイル選択欄。ラベルを結び付け、選んだファイルを配列で渡す。className は受け取らない。
// 選んだ後に値を空に戻す（同じファイルを続けて選び直せるようにする）。形式の確認は使う側が行う（accept には頼らない）。
import { useId, type ChangeEvent } from "react";

type FileInputProps = {
  label: string;
  multiple?: boolean;
  disabled?: boolean;
  onSelect: (files: File[]) => void;
};

export function FileInput({
  label,
  multiple = false,
  disabled,
  onSelect,
}: FileInputProps) {
  const id = useId();
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) onSelect(files);
  };
  return (
    <div className="mb-2">
      <label htmlFor={id} className="mb-1 block text-sm font-bold">
        {label}
      </label>
      <input
        id={id}
        type="file"
        multiple={multiple}
        disabled={disabled}
        onChange={handleChange}
        className="text-sm"
      />
    </div>
  );
}
