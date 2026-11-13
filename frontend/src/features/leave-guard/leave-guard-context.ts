// 離脱の確認の提供元（LeaveGuardProvider）と、見張り・ログアウトの確認の呼び出し側をつなぐ Context。
import { createContext } from "react";

/** 変更のある入力欄が登録する見張り */
export type Guard = {
  /** 「破棄して離れる」を選んだときに呼ぶ（保存した下書きの削除など） */
  discard: () => void;
  /** 確認を閉じて留まるとき、入力欄へフォーカスを戻す */
  focus: () => void;
};

export type LeaveGuardContextValue = {
  /** 見張りを登録する。返す関数で外す */
  register: (guard: Guard) => () => void;
  /** 変更のある入力欄があるか */
  hasChanges: () => boolean;
  /** 確認を出し、離れてよいか（破棄して離れる）を返す。確認の待ち中・離脱の確認の表示中は、すぐ false */
  confirmLeave: () => Promise<boolean>;
};

// 提供元がないとき（ルーターなしのテストなど）は null。離脱の確認だけが働かない
export const LeaveGuardContext = createContext<LeaveGuardContextValue | null>(
  null,
);
