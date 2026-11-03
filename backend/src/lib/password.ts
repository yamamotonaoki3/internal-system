// パスワードの生成とハッシュ（ADR-0007。scrypt N=2^16・r=8・p=2、PHC形式）。ログインの機能（#120）も、このファイルを使う。
// パラメータはこのファイルの定数1か所に置く。保存した文字列にパラメータを含めるため、後から変えても古いハッシュを検証できる。
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const LOG_N = 16;
const R = 8;
const P = 2;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
// scrypt が使う作業領域（128 * N * r）の2倍＋余裕。ライブラリの上限（既定32MiB）を超えるため明示する
const maxmem = (n: number, r: number) => 128 * n * r * 2 + 1024 * 1024;

function derive(
  password: string,
  salt: Uint8Array,
  logN: number,
  r: number,
  p: number,
  length: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      length,
      { N: 2 ** logN, r, p, maxmem: maxmem(2 ** logN, r) },
      (error, key) => (error === null ? resolve(key) : reject(error)),
    );
  });
}

const toBase64 = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64").replace(/=+$/, "");
const fromBase64 = (text: string) => Buffer.from(text, "base64");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, LOG_N, R, P, KEY_LENGTH);
  return `$scrypt$ln=${LOG_N},r=${R},p=${P}$${toBase64(salt)}$${toBase64(key)}`;
}

const PHC =
  /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** 形式が壊れたハッシュ・別方式のハッシュは、一致しない（false）。例外にもしない */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parseStored(stored);
  if (parsed === null) return false;
  const actual = await derive(
    password,
    parsed.salt,
    parsed.logN,
    parsed.r,
    parsed.p,
    parsed.expected.length,
  );
  return timingSafeEqual(actual, parsed.expected);
}

type ParsedHash = {
  logN: number;
  r: number;
  p: number;
  salt: Buffer;
  expected: Buffer;
};

/** 保存した文字列を読む。形式が壊れている・別方式・上限を超えるパラメータは null */
function parseStored(stored: string): ParsedHash | null {
  const match = PHC.exec(stored);
  if (match === null) return null;
  const logN = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  // 保存された値が重い計算を強いないよう、現在のパラメータを上限にする
  if (logN < 1 || logN > LOG_N || r < 1 || r > R || p < 1 || p > P) return null;
  const salt = fromBase64(match[4] ?? "");
  const expected = fromBase64(match[5] ?? "");
  if (salt.length === 0 || expected.length === 0) return null;
  return { logN, r, p, salt, expected };
}

/** 保存したハッシュのパラメータが現行と違うか（ログインの成功後に、現行のパラメータで作り直すかの判定。ADR-0007） */
export function needsRehash(stored: string): boolean {
  const match = PHC.exec(stored);
  if (match === null) return false;
  return (
    Number(match[1]) !== LOG_N ||
    Number(match[2]) !== R ||
    Number(match[3]) !== P
  );
}

export type ScryptParams = {
  logN: number;
  r: number;
  p: number;
  keyLength: number;
};

/** 計算の関数。テストが、計算の内容（パラメータ）を記録するために差し替える */
export type Derive = (
  password: string,
  salt: Uint8Array,
  params: ScryptParams,
) => Promise<Uint8Array>;

const defaultDerive: Derive = (password, salt, params) =>
  derive(password, salt, params.logN, params.r, params.p, params.keyLength);

// 利用者がいない・無効・形式不正のときに計算する、現行のパラメータのダミー（結果は使わない）
const DUMMY_SALT = new Uint8Array(SALT_LENGTH);

/**
 * ログインの検証。保存値がない（null）・形式不正・上限を超えるパラメータのときは、現行のパラメータで1回計算して false を返す
 * （存在しない社員IDと、誤ったパスワードで、処理時間に差を作らない。ADR-0008）。
 * 旧パラメータのハッシュは、そのパラメータで検証する（現行より軽いため、時間差は既知の限界。ADR-0007）。
 */
export async function verifyPasswordConstantCost(
  password: string,
  stored: string | null,
  deps: { derive?: Derive } = {},
): Promise<boolean> {
  const run = deps.derive ?? defaultDerive;
  const parsed = stored === null ? null : parseStored(stored);
  if (parsed === null) {
    await run(password, DUMMY_SALT, {
      logN: LOG_N,
      r: R,
      p: P,
      keyLength: KEY_LENGTH,
    });
    return false;
  }
  const actual = await run(password, parsed.salt, {
    logN: parsed.logN,
    r: parsed.r,
    p: parsed.p,
    keyLength: parsed.expected.length,
  });
  return timingSafeEqual(actual, parsed.expected);
}

// 初期パスワード（C-40）：16文字、大文字・小文字・数字・記号を各1文字以上。伝達時に読み間違えやすい文字（0 O o 1 l I）と空白は使わない
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!#$%&*+-=?@^_";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;
const PASSWORD_LENGTH = 16;

/** 0以上 max 未満の一様な乱数。範囲の端数を捨てて（棄却サンプリング）、偏りを作らない */
function randomIndex(max: number): number {
  const limit = 256 - (256 % max);
  const buffer = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] ?? 0;
    if (value < limit) return value % max;
  }
}

const pick = (chars: string) => chars.charAt(randomIndex(chars.length));

export function generateInitialPassword(): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < PASSWORD_LENGTH) chars.push(pick(ALL));
  // 先頭の4文字が文字種で固定されないよう、フィッシャー–イェーツでかき混ぜる
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join("");
}
