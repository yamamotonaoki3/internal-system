// 登録の成功直後に、社員IDと初期パスワードを一度だけ文字で示す。
// 初期パスワードは入力欄に入れない。保持と消去は呼び出し側（SetupFlow）が行う。
import { useEffect, useRef } from "react";
import { Button } from "../../../components/Button";

type InitialPasswordNoticeProps = {
  loginId: string;
  initialPassword: string;
  onProceed: () => void;
  // 進むボタンの文言。省略すると、初回セットアップの「ログイン画面へ進む」
  proceedLabel?: string;
};

export function InitialPasswordNotice({
  loginId,
  initialPassword,
  onProceed,
  proceedLabel = "ログイン画面へ進む",
}: InitialPasswordNoticeProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 表示が切り替わったことを、キーボード・読み上げの利用者に伝える
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="initial-password-heading">
      <h2
        id="initial-password-heading"
        ref={headingRef}
        tabIndex={-1}
        className="mb-3 text-lg font-bold"
      >
        登録が完了しました
      </h2>
      <dl className="mb-4">
        <dt className="text-xs text-text-muted">社員ID</dt>
        <dd className="mb-3">
          <code className="font-mono break-all">{loginId}</code>
        </dd>
        <dt className="text-xs text-text-muted">初期パスワード</dt>
        <dd className="mb-3">
          <code className="font-mono break-all">{initialPassword}</code>
        </dd>
      </dl>
      <p className="mb-4">
        初期パスワードは、この画面で一度だけ表示します。別の連絡手段で本人へ伝え、初回ログインで変更してください。表示前に失ったときは、全体管理者が再発行します。
      </p>
      <Button onClick={onProceed}>{proceedLabel}</Button>
    </section>
  );
}
