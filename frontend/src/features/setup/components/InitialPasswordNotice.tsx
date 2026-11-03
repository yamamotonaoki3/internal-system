// 登録の成功直後に、社員IDと初期パスワードを一度だけ文字で示す。
// 初期パスワードは入力欄に入れない。保持と消去は呼び出し側（SetupFlow）が行う。
import { useEffect, useRef } from "react";

type InitialPasswordNoticeProps = {
  loginId: string;
  initialPassword: string;
  onProceed: () => void;
};

export function InitialPasswordNotice({
  loginId,
  initialPassword,
  onProceed,
}: InitialPasswordNoticeProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 表示が切り替わったことを、キーボード・読み上げの利用者に伝える
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="initial-password-heading">
      <h2 id="initial-password-heading" ref={headingRef} tabIndex={-1}>
        登録が完了しました
      </h2>
      <dl>
        <dt>社員ID</dt>
        <dd>
          <code>{loginId}</code>
        </dd>
        <dt>初期パスワード</dt>
        <dd>
          <code>{initialPassword}</code>
        </dd>
      </dl>
      <p>
        初期パスワードは、この画面で一度だけ表示します。別の連絡手段で本人へ伝え、初回ログインで変更してください。表示前に失ったときは、全体管理者が再発行します。
      </p>
      <button type="button" onClick={onProceed}>
        ログイン画面へ進む
      </button>
    </section>
  );
}
