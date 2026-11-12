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
