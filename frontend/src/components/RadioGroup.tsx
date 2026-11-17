// 共通のラジオのグループ。見出し（radiogroup の名前）と、選択肢ごとのラベル付きのラジオを出す。
// 同じ name の素のラジオなので、矢印キーで選択を移せる。値は呼び出し側が持つ。className は受け取らない。
import { useId } from "react";

type RadioOption<T extends string> = { value: T; label: string };

type RadioGroupProps<T extends string> = {
  label: string;
  options: readonly RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
};

export function RadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: RadioGroupProps<T>) {
  const labelId = useId();
  const name = useId();
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="mb-4">
      <p id={labelId} className="mb-1 text-sm font-bold">
        {label}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 items-center gap-2 md:min-h-10"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="size-5"
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}
