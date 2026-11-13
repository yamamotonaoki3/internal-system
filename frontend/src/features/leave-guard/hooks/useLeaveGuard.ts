// 入力欄に「変更あり」の見張りを付ける。再読み込み・タブを閉じる（beforeunload）は提供元がなくても止める。
// アプリ内の画面の切り替えとログアウトの確認は、LeaveGuardProvider がある場合だけ働く。
import { useContext, useEffect, useRef } from "react";
import { LeaveGuardContext } from "../leave-guard-context";

type Options = {
  /** 未送信の変更があるか */
  isDirty: boolean;
  onDiscard: () => void;
  focus: () => void;
};

export function useLeaveGuard({ isDirty, onDiscard, focus }: Options) {
  const context = useContext(LeaveGuardContext);
  const register = context?.register;
  // 登録は変更ありの間だけにして、最新の関数を呼べるようにする
  const latest = useRef({ onDiscard, focus });
  useEffect(() => {
    latest.current = { onDiscard, focus };
  });

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 古いブラウザは returnValue を設定しないと確認を出さない
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty || register === undefined) return;
    return register({
      discard: () => latest.current.onDiscard(),
      focus: () => latest.current.focus(),
    });
  }, [isDirty, register]);
}
