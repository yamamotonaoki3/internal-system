// #120：認証まわりのテストで使う MSW の応答（架空のデータのみ）。
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { http, HttpResponse } from "msw";
import { server } from "./server";

export const TEST_USER = {
  id: "01JTESTUSER000000000000001",
  displayName: "テスト太郎",
  loginId: "testuser_001",
} as const;

export const TEST_LOGIN_ID = "testuser_001";
export const TEST_PASSWORD = "TestPass123!";

/** GET /api/auth/session：ログイン済み（mustChangePassword を選べる） */
export function respondLoggedIn(
  mustChangePassword = false,
  reauthenticatedAt: string | null = null,
) {
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user: TEST_USER,
        permissions: [],
        mustChangePassword,
        reauthenticatedAt,
      }),
    ),
  );
}

/** GET /api/auth/session：未ログイン（401 UNAUTHENTICATED） */
export function respondLoggedOut() {
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json(
        { code: "UNAUTHENTICATED", message: "ログインしてください" },
        { status: 401 },
      ),
    ),
  );
}

/** ログイン画面に出す部品（HealthStatus・SetupEntryLink）の応答 */
export function respondPublicStatus(setupRequired = false) {
  server.use(
    http.get("/api/health", () =>
      HttpResponse.json({ status: "ok", appEnv: "test" }),
    ),
    http.get("/api/setup/status", () => HttpResponse.json({ setupRequired })),
  );
}
