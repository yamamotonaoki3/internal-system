// 設定の読み込みは、このファイルの1か所にまとめる（C-40）。ほかのファイルは process.env・env を直接読まない。
// 起動経路で選んだ APP_ENV を必須にし、欠落を既定値で隠さない。
import { createLogger } from "./lib/logger/logger";
import { isValidPiiKey } from "./lib/pii-crypto";

// 32バイトの乱数の base64url（パディングなし）は、ちょうど43文字
const SETUP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AppConfig = {
  /** 環境の名前（development・test・production） */
  appEnv: string;
  /** 状態を変える要求を許可する送信元（C-28） */
  allowedOrigins: string[];
  /** 初回セットアップ用のトークン。未設定・形式不正は null（セットアップだけを 503 にし、アプリ全体は止めない） */
  setupToken: string | null;
  /** 本名の暗号鍵（32バイトの base64url）。未設定・形式不正は null（セットアップだけを 503 にする） */
  piiEncryptionKey: string | null;
};

type RawEnv = Record<string, unknown>;

function text(env: RawEnv, name: string): string {
  const value = env[name];
  return typeof value === "string" ? value : "";
}

/** 任意のシークレット。未設定は null、形式が不正なときは null にして、値を出さずに記録する */
function optionalSecret(
  raw: RawEnv,
  name: string,
  isValid: (value: string) => boolean,
): string | null {
  const value = text(raw, name);
  if (value === "") return null;
  if (isValid(value)) return value;
  createLogger().error(
    "シークレットの形式が正しくありません（値は表示しません）",
    {
      name,
    },
  );
  return null;
}

/** Workers の環境（c.env）から、アプリの設定を作る */
export function loadConfig(env: unknown): AppConfig {
  const raw = (typeof env === "object" && env !== null ? env : {}) as RawEnv;
  const appEnv = text(raw, "APP_ENV");
  if (!["development", "test", "production"].includes(appEnv)) {
    throw new Error("APP_ENV を設定してください（値は表示しません）。");
  }
  return {
    appEnv,
    allowedOrigins: text(raw, "ALLOWED_ORIGINS")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ""),
    setupToken: optionalSecret(raw, "SETUP_TOKEN", (v) =>
      SETUP_TOKEN_PATTERN.test(v),
    ),
    piiEncryptionKey: optionalSecret(raw, "PII_ENCRYPTION_KEY", isValidPiiKey),
  };
}
