// #120：未ログインの画面では、セッションの確認（GET /api/auth/session）が仕様どおり 401 を返し、ブラウザがコンソールのエラーとして出す。
// その意図した 401 だけを許す（許可はここ1か所にまとめる）。
import type { Page } from "@playwright/test";
import { allowConsoleError } from "./console-guard";

export function allowSessionCheck401(page: Page): void {
  allowConsoleError(
    page,
    /Failed to load resource: the server responded with a status of 401/,
    "未ログインのときのセッションの確認と、誤ったパスワードでのログインは、仕様どおり 401 を返すため",
  );
}
