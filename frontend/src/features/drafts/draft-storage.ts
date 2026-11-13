// 下書きの保存・読み込み・消去（端末の Web Storage）。保存先と現在時刻は引数で受ける。
// 受け止める例外は「保存先が使えない」ことを表す SecurityError・QuotaExceededError だけ。画面側が案内を出せるよう DraftStorageUnavailableError に変えて投げる。それ以外は変えずに投げ直す。
import { z } from "zod";
import {
  DRAFT_KEY_PREFIX,
  draftKey,
  isBlankDraft,
  isDraftExpired,
  userDraftKeyPrefix,
} from "./draft-policy";

export class DraftStorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super("下書きの保存先を使えません", { cause });
    this.name = "DraftStorageUnavailableError";
  }
}

const UNAVAILABLE_NAMES: readonly string[] = [
  "SecurityError",
  "QuotaExceededError",
];

function isUnavailable(error: unknown): error is DOMException {
  return (
    error instanceof DOMException && UNAVAILABLE_NAMES.includes(error.name)
  );
}

function guard<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (isUnavailable(error)) throw new DraftStorageUnavailableError(error);
    throw error;
  }
}

// 読むときに検証する。小数・負・無限大の日時は壊れた値
const storedDraftSchema = z.object({
  body: z.string(),
  updatedAt: z.number().int().nonnegative(),
});

type StoredDraft = z.infer<typeof storedDraftSchema>;

/** 保存された文字列を下書きにする。JSON でない・形の違う値は null（壊れた値） */
function parseStored(raw: string): StoredDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // 壊れた値は呼び出し元がキーごと消す。JSON の構文エラー以外は想定外なので投げ直す
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const result = storedDraftSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/** 保存先を開く。参照そのものが SecurityError のとき（Cookie の拒否など）は、保存先なし（null） */
export function openDraftStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError")
      return null;
    throw error;
  }
}

/** 先にキーを配列に集めてから使う（消しながら番号で数えると取りこぼす） */
function collectKeys(storage: Storage, prefix: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && key.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

export function readDraft(
  storage: Storage,
  userId: string,
  scope: string,
  now: number,
): string | null {
  return guard(() => {
    const key = draftKey(userId, scope);
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const stored = parseStored(raw);
    if (stored === null || isDraftExpired(stored.updatedAt, now)) {
      storage.removeItem(key);
      return null;
    }
    return stored.body;
  });
}

export function writeDraft(
  storage: Storage,
  userId: string,
  scope: string,
  body: string,
  now: number,
): void {
  guard(() => {
    const key = draftKey(userId, scope);
    if (isBlankDraft(body)) {
      storage.removeItem(key);
      return;
    }
    const stored: StoredDraft = { body, updatedAt: now };
    storage.setItem(key, JSON.stringify(stored));
  });
}

export function removeDraft(
  storage: Storage,
  userId: string,
  scope: string,
): void {
  guard(() => storage.removeItem(draftKey(userId, scope)));
}

export function removeUserDrafts(storage: Storage, userId: string): void {
  guard(() => {
    for (const key of collectKeys(storage, userDraftKeyPrefix(userId)))
      storage.removeItem(key);
  });
}

/** 全利用者の、期限切れ・壊れた値の下書きを消す。期限内と、接頭辞の違うキーは触らない */
export function purgeExpiredDrafts(storage: Storage, now: number): void {
  guard(() => {
    for (const key of collectKeys(storage, DRAFT_KEY_PREFIX)) {
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const stored = parseStored(raw);
      if (stored === null || isDraftExpired(stored.updatedAt, now))
        storage.removeItem(key);
    }
  });
}

/**
 * アプリを開いたときの掃除。保存先が使えないときは起動を止めない。
 * 使えないなら入力欄の読み書きでも同じ例外になり、そこで案内が出る。期限切れは読むときにも消す。
 */
export function purgeExpiredDraftsOnStartup(
  storage: Storage | null,
  now: number,
): void {
  if (storage === null) return;
  try {
    purgeExpiredDrafts(storage, now);
  } catch (error) {
    if (error instanceof DraftStorageUnavailableError) return;
    throw error;
  }
}
