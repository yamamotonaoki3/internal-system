// ULID（ADR-0006）。時刻48bit＋乱数80bitを、Crockford Base32の26文字で表す。文字列の辞書順が、生成順になる。
// 単調性の保証範囲：同じファクトリ（newUlid は共通の1つ）から生成した値の間だけ。
// Workersでは要求の中で Date.now() が進まないことがあるため、同時刻・時計が戻った場合は、直前の乱数に1を足して昇順を保つ。
// 別のWorkerのインスタンス間の順序は保証しない（時刻順になるだけ）。
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const TIME_LENGTH = 10;
const RANDOM_BYTES = 10;
/** ULID の時刻部分の最大（48bit） */
export const MAX_TIME = 2 ** 48 - 1;

/** ULIDの文字列（形式の確認は isUlid） */
export type Ulid = string;

export type UlidDeps = {
  now?: () => number;
  random?: (length: number) => Uint8Array;
};

export function isUlid(value: unknown): value is Ulid {
  return typeof value === "string" && ULID_PATTERN.test(value);
}

function encodeTime(time: number): string {
  let rest = time;
  let out = "";
  for (let i = 0; i < TIME_LENGTH; i++) {
    out = ALPHABET[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/** ULID の時刻部分（先頭10文字）。参加の時刻など、ID の範囲の下限を作るのに使う。0〜2^48−1 の整数 */
export function ulidTimePrefix(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIME)
    throw new Error("ULIDの時刻が範囲外です");
  return encodeTime(ms);
}

function encodeRandom(bytes: Uint8Array): string {
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out = ALPHABET[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

// 乱数部（ビッグエンディアン）に1を足す。最大値であふれる場合は false
function increment(bytes: Uint8Array): boolean {
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] !== 0xff) {
      bytes[i] = (bytes[i] ?? 0) + 1;
      return true;
    }
    bytes[i] = 0;
  }
  return false;
}

function decodeTime(id: Ulid): number {
  let time = 0;
  for (const char of id.slice(0, TIME_LENGTH))
    time = time * 32 + ALPHABET.indexOf(char);
  return time;
}

function decodeRandom(id: Ulid): Uint8Array {
  let value = 0n;
  for (const char of id.slice(TIME_LENGTH))
    value = (value << 5n) | BigInt(ALPHABET.indexOf(char));
  const bytes = new Uint8Array(RANDOM_BYTES);
  for (let i = RANDOM_BYTES - 1; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

export function createUlidFactory(deps: UlidDeps = {}): () => Ulid {
  const now = deps.now ?? Date.now;
  const random =
    deps.random ?? ((length) => crypto.getRandomValues(new Uint8Array(length)));
  let lastTime = -1;
  let lastRandom = new Uint8Array(RANDOM_BYTES);

  return () => {
    const time = now();
    if (!Number.isInteger(time) || time < 0 || time > MAX_TIME)
      throw new Error("ULIDの時刻が範囲外です");
    if (time <= lastTime) {
      // 同時刻、または時計が戻った。直前の時刻のまま乱数を増やす
      const next = lastRandom.slice();
      if (!increment(next)) throw new Error("ULIDの乱数部があふれました");
      lastRandom = next;
    } else {
      lastTime = time;
      lastRandom = random(RANDOM_BYTES).slice(0, RANDOM_BYTES);
    }
    return encodeTime(lastTime) + encodeRandom(lastRandom);
  };
}

export const newUlid = createUlidFactory();

/**
 * 指定したIDより必ず大きいULIDを返す（部屋の最大IDより小さいIDしか作れなかったときの作り直し用）。
 * 時刻部は max(now, 前のIDの時刻)。前のIDと同じ時刻になるときは、乱数部に1を足して昇順を保つ。
 */
export function ulidAfter(previous: Ulid, now: number = Date.now()): Ulid {
  if (!isUlid(previous)) throw new Error("ULIDの形式が不正です");
  if (!Number.isInteger(now) || now < 0 || now > MAX_TIME)
    throw new Error("ULIDの時刻が範囲外です");
  const previousTime = decodeTime(previous);
  if (now > previousTime) return createUlidFactory({ now: () => now })();
  const next = decodeRandom(previous);
  if (!increment(next)) throw new Error("ULIDの乱数部があふれました");
  return encodeTime(previousTime) + encodeRandom(next);
}
