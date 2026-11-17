// 監査ログの画面で使う、操作の種類と対象の種類の日本語の名前。
// 操作の一覧の定義元はバックエンドの AUDIT_ACTIONS（フロントエンドからは読まない）。足りない操作がないことは、画面のテストが AUDIT_ACTIONS と照らして確かめる。
// 名前が未登録の操作は、操作の ID をそのまま出す（空にしない）。

export const ACTION_LABELS: ReadonlyMap<string, string> = new Map([
  ["setup.initial_admin.create", "初期管理者の作成"],
  ["setup.rate_limited", "初期セットアップの試行制限"],
  ["auth.login", "ログイン"],
  ["auth.logout", "ログアウト"],
  ["auth.password_change", "パスワード変更"],
  ["auth.reauthenticate", "再認証"],
  ["auth.rate_limited", "ログインの試行制限"],
  ["client.create", "取引先の登録"],
  ["client.rename", "取引先の改名"],
  ["client.deactivate", "取引先の無効化"],
  ["department.create", "部署の作成"],
  ["department.rename", "部署の改名"],
  ["department.owner_change", "部署のオーナー交代"],
  ["department.channel_backfill", "部署のチャンネルの補完"],
  ["account.create", "アカウント登録"],
  ["account.deactivate", "アカウント無効化"],
  ["account.reactivate", "アカウント再有効化"],
  ["account.transfer", "部署異動"],
  ["channel.join", "チャンネル参加"],
  ["channel.invite", "チャンネルへの招待"],
  ["channel.company_general_backfill", "全社連絡チャンネルの補完"],
  ["channel.update", "チャンネルの名前・説明の変更"],
  ["channel.archive", "チャンネルのアーカイブ"],
  ["channel.restore", "チャンネルの復元"],
  ["status.proxy_set", "ステータスの代理設定"],
  ["profile.display_name_change", "表示名の変更"],
  ["channel_request.create", "チャンネル作成の申請"],
  ["channel_request.approve", "チャンネル作成の承認"],
  ["channel_request.reject", "チャンネル作成の却下"],
  ["channel_request.withdraw", "チャンネル作成の取り下げ"],
  ["case_request.create", "案件の作成の申請"],
  ["case_request.withdraw", "案件の作成の申請の取り下げ"],
  ["case_request.approve", "案件の作成の申請の承認"],
  ["case_request.reject", "案件の作成の申請の却下"],
  ["retirement_request.create", "退職処理の申請"],
  ["retirement_request.reject", "退職処理の申請の却下"],
  ["retirement_request.withdraw", "退職処理の申請の取り下げ"],
  ["message.delete", "メッセージの削除"],
  ["audit_log.view", "監査ログの閲覧"],
]);

/** 対象の種類の名前。名前（label）を解決しない種類（メッセージなど）は、この名前だけを出す */
export const TARGET_TYPE_LABELS: ReadonlyMap<string, string> = new Map([
  ["user", "社員"],
  ["department", "部署"],
  ["client", "取引先"],
  ["channel", "チャンネル"],
  ["channel_request", "チャンネル作成の申請"],
  ["case_request", "案件の作成の申請"],
  ["retirement_request", "退職処理の申請"],
  ["message", "メッセージ"],
  ["source", "接続元"],
  ["audit_log", "監査ログ"],
]);

export const actionLabel = (action: string): string =>
  ACTION_LABELS.get(action) ?? action;

export const targetTypeLabel = (type: string): string =>
  TARGET_TYPE_LABELS.get(type) ?? type;
