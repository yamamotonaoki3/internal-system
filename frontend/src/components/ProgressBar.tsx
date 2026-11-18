// 共通の進捗バー。素の progress 要素を包む（読み上げは role=progressbar と、呼び出し側が渡す名前）。
// className・style は受け取らない（見た目は呼び出し側で上書きさせない。style 属性は CSP のため使わない）。
type ProgressBarProps = {
  value: number;
  max: number;
  /** 読み上げの名前（例：「3項目中1項目が完了」） */
  label: string;
};

export function ProgressBar({ value, max, label }: ProgressBarProps) {
  return (
    <progress
      value={value}
      max={max}
      aria-label={label}
      className="h-2 w-24 align-middle accent-primary"
    />
  );
}
