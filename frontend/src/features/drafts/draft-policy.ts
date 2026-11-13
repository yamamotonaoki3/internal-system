// 端末に一時保存する下書きの規則の定義元（1-1 AC-4・C-82・C-117）。期限・キーの形・「空」の判定はここだけに書く。
// 保存の要否（空白だけは保存しない）は、送信の可否（shared/message-rules.ts の messageBodySchema）とは意味が違う定義として、ここに別に持つ。

/** 最終編集からこの時間たった下書きは期限切れ（ちょうどこの時間で期限切れ） */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 端末の時計のずれの余裕。最終編集がこれより未来なら壊れた値とみなす */
export const DRAFT_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** 下書きのキーの接頭辞。値の形を変えるときは版（v1）を上げる */
export const DRAFT_KEY_PREFIX = "internal-system:draft:v1:";

/** 部屋（チャンネル・DM）の入力欄の scope。部屋のIDで一意に決まる */
export function roomDraftScope(roomId: string): string {
  return `room:${roomId}`;
}

export function draftKey(userId: string, scope: string): string {
  return `${userDraftKeyPrefix(userId)}${scope}`;
}

/** 1人の利用者の下書きのキーの接頭辞（利用者IDの前方一致で別人を巻き込まないよう、区切りまで含める） */
export function userDraftKeyPrefix(userId: string): string {
  return `${DRAFT_KEY_PREFIX}${userId}:`;
}

/** 空白・改行だけの本文は、下書きとして保存しない */
export function isBlankDraft(body: string): boolean {
  return body.trim().length === 0;
}

export function isDraftExpired(updatedAt: number, now: number): boolean {
  return (
    now - updatedAt >= DRAFT_TTL_MS || updatedAt > now + DRAFT_CLOCK_SKEW_MS
  );
}
