import { defineConfig } from "@playwright/test";

// 本番形の確認（#171）。ビルド済みの成果物を、CSP（public/_headers）のかかった状態で配信して確かめる。
// 開発サーバーは CSS を <style> で注入するため、CSP の下で外部 CSS だけが使われることは、ここでしか確かめられない。
// 許可するオリジン（.env.test の ALLOWED_ORIGINS）が http://localhost:5173 だけなので、ポートは 5173 にする。
// 開発サーバー用の E2E（playwright.config.ts）と同じポートなので、同時に動かさず、順に実行する。
// DB の準備は package.json の test:e2e:prod の前処理が行う（既存の playwright.config.ts とは別の設定）
export default defineConfig({
  testDir: "e2e-prod",
  retries: 0, // 自動で再試行しない（C-25）
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command:
      "npm run build && npm run preview:test -- --port 5173 --strictPort",
    url: "http://localhost:5173/api/health",
    reuseExistingServer: false, // すでに動いているサーバーに、検証を向けない
    timeout: 240_000,
  },
});
