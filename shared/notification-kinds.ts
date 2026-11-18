// 通知の種類の定義元（#124）。種類は後続の Issue が、ここに 1 件ずつ足す。
// 通知の表（notifications.kind）には CHECK を付けない：SQLite は CHECK の値を増やすのに表の作り直しが要るため。値はこの定義と isNotificationKind で守る。

/**
 * 種類ごとの属性。
 * containsRoomContent：部屋の内容を含むか。true の種類は、閲覧権限を失った部屋の分を一覧・未読数から除く。
 * アーカイブ・復元のように、権限を失っても残したい通知は false にする。
 */
export type NotificationKindDefinition = {
  readonly containsRoomContent: boolean;
};

export type NotificationKindDefinitions = Readonly<
  Record<string, NotificationKindDefinition>
>;

// 後続の Issue は、種類をこの一覧に 1 件足す（NotificationKind の型もここから決まる）
// チャンネルの作成申請（#131）：3 種類とも部屋の内容を含まない（閲覧権限を失っても一覧から消さない）
const KINDS = {
  "channel_request.submitted": { containsRoomContent: false },
  "channel_request.approved": { containsRoomContent: false },
  "channel_request.rejected": { containsRoomContent: false },
  "message.mentioned": { containsRoomContent: true },
  // チャンネルへの招待（#135）：招待された人がのちにチャンネルを見られなくなれば、一覧・未読数から除く
  "channel.invited": { containsRoomContent: true },
  // 案件の作成申請（#146）：3 種類とも部屋の内容を含まない
  "case_request.submitted": { containsRoomContent: false },
  // 退職処理の申請（#128）：3 種類とも部屋の内容を含まない。取り下げは通知しない
  "retirement_request.submitted": { containsRoomContent: false },
  "retirement_request.approved": { containsRoomContent: false },
  "retirement_request.rejected": { containsRoomContent: false },
  "case_request.approved": { containsRoomContent: false },
  "case_request.rejected": { containsRoomContent: false },
  // チャンネルのアーカイブ・復元（#143）：権限を失っても残す（3-4 AC-5）。target_id はその回のアーカイブの記録
  "channel.archived": { containsRoomContent: false },
  "channel.restored": { containsRoomContent: false },
  // 案件の終了・再開（#150）：部屋の内容を含まない（概要は全員に見えるため、参加から外された後も残す）。target_id は案件
  "case.closed": { containsRoomContent: false },
  "case.reopened": { containsRoomContent: false },
} as const satisfies NotificationKindDefinitions;

export type NotificationKind = keyof typeof KINDS;

// 種類の名前で引ける型で公開する（NotificationKind は上の一覧から決まる）
export const NOTIFICATION_KIND_DEFINITIONS: NotificationKindDefinitions = KINDS;

export function isNotificationKind(
  value: unknown,
  definitions: NotificationKindDefinitions = NOTIFICATION_KIND_DEFINITIONS,
): value is NotificationKind {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(definitions, value)
  );
}

/** 部屋の内容を含む種類の一覧 */
export function roomContentKinds(
  definitions: NotificationKindDefinitions = NOTIFICATION_KIND_DEFINITIONS,
): string[] {
  return Object.entries(definitions)
    .filter(([, definition]) => definition.containsRoomContent)
    .map(([kind]) => kind);
}
