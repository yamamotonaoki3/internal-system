// ポーリングの設定（1-9 AC-1・ADR-0004）。画面だけで使う値のため shared/ には置かない。
/** 新着を取りに行く間隔 */
export const MESSAGE_POLL_INTERVAL_MS = 2000;
/** 1回のポーリングで、続きがある（hasMore）間に続けて取る最大の回数。残りは次の間隔で取る */
export const MESSAGE_POLL_MAX_CONSECUTIVE_FETCHES = 5;
