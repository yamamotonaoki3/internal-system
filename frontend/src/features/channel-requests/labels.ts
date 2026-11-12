// 申請の状態・公開範囲・作る場所の表示名。一覧（S-10・S-11）で共通に使う。
import type {
  RequestStatus,
  RequestVisibility,
} from "./api/channel-request-api";

export const STATUS_LABELS: Readonly<Record<RequestStatus, string>> = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
  withdrawn: "取り下げ済み",
};

export const VISIBILITY_LABELS: Readonly<Record<RequestVisibility, string>> = {
  public: "公開",
  private: "非公開",
};
