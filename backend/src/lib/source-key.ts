// 試行制限のキー（ADR-0008・C-150）。保存するのは HMAC-SHA256(LOGIN_THROTTLE_KEY, 値) の16進だけで、生のIP・社員IDは残さない。
// 接続元は Cloudflare が付ける CF-Connecting-IP だけを使う（X-Forwarded-For は利用者が偽れるため使わない）。IPv6 は /64 に丸める。
import { AppError } from "./app-error";
import type { Logger } from "./logger/logger";

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/i;

/** 先頭が 0 の数字（01 など）は、読み方が分かれるため受け付けない */
function parseIpv4(text: string): number[] | null {
  const match = IPV4.exec(text);
  if (match === null) return null;
  const parts = match.slice(1, 5).map((part) => {
    if (part.length > 1 && part.startsWith("0")) return Number.NaN;
    return Number(part);
  });
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/** 8個の16ビットの組に展開する。省略（::）・末尾の IPv4 に対応する */
function parseIpv6(text: string): number[] | null {
  if (!/^[0-9a-f:.]+$/i.test(text)) return null;
  let head = text;
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".")) {
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    const hex = (hi: number, lo: number) => ((hi << 8) | lo).toString(16);
    head = `${text.slice(0, lastColon + 1)}${hex(v4[0] ?? 0, v4[1] ?? 0)}:${hex(v4[2] ?? 0, v4[3] ?? 0)}`;
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part === "" ? [] : part.split(":"));
  const left = toGroups(halves[0] ?? "");
  const right = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  const groups = [...left, ...right];
  if (!groups.every((g) => HEX_GROUP.test(g))) return null;
  if (halves.length === 1 ? groups.length !== 8 : groups.length > 7)
    return null;
  const zeros = Array.from<string>({ length: 8 - groups.length }).fill("0");
  return [...left, ...zeros, ...right].map((g) => parseInt(g, 16));
}

/**
 * 接続元の値を、数える単位の文字列にそろえる。IPv4 はそのまま、IPv6 は /64 に丸める（先頭の4組）。
 * IPv4 を埋め込んだ IPv6（::ffff:a.b.c.d）は IPv4 として扱う。不正な値は null。
 */
export function normalizeSourceIp(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  if (!value.includes(":")) return parseIpv4(value)?.join(".") ?? null;
  const groups = parseIpv6(value);
  if (groups === null) return null;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi = 0, lo = 0] = [groups[6], groups[7]];
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16).padStart(4, "0"))
    .join(":")}::/64`;
}

/** HMAC-SHA256(鍵, 値) の16進。鍵は base64url を復号したバイト列として使う */
export async function hmacKey(
  throttleKey: string,
  value: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(throttleKey, "base64url"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Buffer.from(signature).toString("hex");
}

/** 社員IDのキー。大文字・小文字を区別しない（users.login_id_normalized と同じ小文字） */
export function accountBucketKey(
  loginId: string,
  throttleKey: string,
): Promise<string> {
  return hmacKey(throttleKey, loginId.toLowerCase());
}

// 開発・テストで接続元のヘッダーが無いときに使う固定の値（D-5）
const LOCAL_SOURCE = "local";

/**
 * 接続元のキー。ヘッダーが無い・不正なときは、本番は 503（接続元ごとの制限を回避させない）と logger.error、
 * 開発・テストは固定の値 local で数える。ログに、ヘッダーの値・鍵は出さない。
 */
export async function sourceBucketKey(
  header: string | undefined,
  context: { appEnv: string; throttleKey: string; logger: Logger },
): Promise<string> {
  const normalized = normalizeSourceIp(header);
  if (normalized !== null) return hmacKey(context.throttleKey, normalized);
  if (context.appEnv === "development" || context.appEnv === "test")
    return hmacKey(context.throttleKey, LOCAL_SOURCE);
  context.logger.error("接続元を特定できないため、要求を受け付けない", {
    reason: header === undefined ? "header_missing" : "header_invalid",
  });
  throw new AppError(
    "SERVICE_UNAVAILABLE",
    "現在ご利用いただけません。しばらくしてから、もう一度お試しください",
  );
}
