// 社員一覧のサーバーの状態のキー。プロフィールの機能のキーの下に置く（ステータスや表示名を変えたとき、profileKeys.all の取り直しで一覧も更新される）。
import { profileKeys } from "../profile";

export const memberKeys = {
  list: (departmentId: string, q: string) =>
    [...profileKeys.directory, "list", departmentId, q] as const,
  departments: profileKeys.departments,
};
