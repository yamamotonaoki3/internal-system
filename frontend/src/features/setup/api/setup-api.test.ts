// #119 AC-4：S-34 の API 層（fetchSetupStatus・submitSetup）。共通の apiClient を通し、エラーは共通の形で失敗にする。
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../../test/server";
import { fetchSetupStatus, submitSetup } from "./setup-api";

// 架空のトークン（43文字の base64url 形式。本物の値ではない）
const TEST_TOKEN = "TESTONLY_setup_token_aaaaaaaaaaaaaaaaaaaaaa";
const INPUT = {
  setupToken: TEST_TOKEN,
  companyName: "[E2E_TEST]テスト株式会社",
  departmentName: "[E2E_TEST]テスト部",
  loginId: "e2euser_001",
  legalName: "テスト太郎",
  email: "e2euser_001@example.com",
  emailConfirmed: true as const,
};

const SUCCESS = {
  user: {
    id: "01JTESTULID0000000000000000",
    loginId: "e2euser_001",
    displayName: "テスト太郎",
  },
  initialPassword: "Tq7#xZ9!mK2$pW4v",
};

describe("#119 AC-4 setup-api", () => {
  it("#119 AC-4: fetchSetupStatus は GET /api/setup/status の setupRequired を返す", async () => {
    server.use(
      http.get("/api/setup/status", () =>
        HttpResponse.json({ setupRequired: true }),
      ),
    );
    await expect(fetchSetupStatus()).resolves.toEqual({ setupRequired: true });
  });

  it("#119 AC-4: fetchSetupStatus は失敗を成功に見せず、共通のエラーで失敗する", async () => {
    server.use(
      http.get("/api/setup/status", () =>
        HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: 500 }),
      ),
    );
    await expect(fetchSetupStatus()).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL",
    });
  });

  it("#119 AC-4: submitSetup は POST /api/setup に入力をそのまま送り、社員と初期パスワードを返す", async () => {
    let body: unknown = null;
    server.use(
      http.post("/api/setup", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(SUCCESS, { status: 201 });
      }),
    );
    await expect(submitSetup(INPUT)).resolves.toEqual(SUCCESS);
    expect(body).toEqual(INPUT);
  });

  it.each([
    [403, "FORBIDDEN"],
    [409, "CONFLICT"],
    [503, "SERVICE_UNAVAILABLE"],
  ])(
    "#119 AC-4: submitSetup は %d（%s）を共通のエラーで失敗にする",
    async (status, code) => {
      server.use(
        http.post("/api/setup", () =>
          HttpResponse.json({ code, message: "x" }, { status }),
        ),
      );
      await expect(submitSetup(INPUT)).rejects.toMatchObject({ status, code });
    },
  );

  it("#119 AC-4: submitSetup は 422 の fields を共通のエラーに載せて失敗する", async () => {
    server.use(
      http.post("/api/setup", () =>
        HttpResponse.json(
          { code: "VALIDATION_ERROR", message: "x", fields: ["loginId"] },
          { status: 422 },
        ),
      ),
    );
    await expect(submitSetup(INPUT)).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      fields: ["loginId"],
    });
  });
});
