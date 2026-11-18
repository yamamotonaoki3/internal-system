// 案件の表示名（S-16・S-17）。
import type { CaseAutoRole, CaseStatus } from "./api/case-api";

export const STATUS_LABELS: Readonly<Record<CaseStatus, string>> = {
  active: "進行中",
  closed: "終了",
};

/** 非参加者に出す文（サーバーの 403 の文言と同じ） */
export const PARTICIPANTS_ONLY_TEXT = "参加者だけが見られます（非公開）";

const INACTIVE_MARK = "（無効）";

export const nameWithMark = (item: { name: string; isActive: boolean }) =>
  item.isActive ? item.name : `${item.name}${INACTIVE_MARK}`;

export const participantCountText = (count: number) => `参加者 ${count}人`;

/** 自動参加の人の役割の名前（Q8） */
export const AUTO_ROLE_LABELS: Readonly<Record<CaseAutoRole, string>> = {
  global_admin: "全体管理者",
  department_owner: "担当部署のオーナー",
};

/** 参加者の追加・削除・退出の成功の表示 */
export const PARTICIPANTS_UPDATED_TEXT = "参加者を更新しました";
