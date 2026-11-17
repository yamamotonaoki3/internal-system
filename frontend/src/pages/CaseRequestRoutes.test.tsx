// #146（146-A）計画 A-7（frontend-build）：画面のルート /case-requests（S-18）は、ログイン後の全員が開ける（R-60。perm.case.request.create は全員が持つ）。
// App.tsx のレイアウトルートの子に足す。データは架空。
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { renderApp, SHELL_USER } from "../test/app-shell-harness";
import {
  respondChoices,
  respondProfileDepartment,
} from "../test/case-request-handlers";
import { server } from "../test/server";

describe("#146 S-18 のルート", () => {
  it("#146 5-3 AC-1（R-60）: /case-requests は権限のない一般社員でも開ける", async () => {
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json({
          user: SHELL_USER,
          permissions: [],
          mustChangePassword: false,
          reauthenticatedAt: null,
        }),
      ),
      http.get("/api/case-requests/mine", () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    respondProfileDepartment({
      id: "01JTESTCASEREQDEPTSALES01",
      name: "[UNIT_TEST]営業",
    });
    respondChoices();
    renderApp("/case-requests");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "案件の作成の申請",
      }),
    ).toBeTruthy();
  });
});
