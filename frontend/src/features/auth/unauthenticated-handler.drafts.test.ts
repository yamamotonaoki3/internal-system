// #239 AC-4（U-7・C-82）：401 の自動ログアウト（無操作・期限切れ・失効など）では、端末の下書きを消さない（離席後も書きかけを戻すため）。
// 消すのは、ログアウトのボタンを押して成功したときだけ（useLogout.drafts.test.tsx）。データは架空。
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { TEST_USER } from "../../test/auth-handlers";
import { authKeys } from "./api/query-keys";
import { createUnauthenticatedHandler } from "./unauthenticated-handler";

const keyOf = (userId: string, roomId: string) =>
  `internal-system:draft:v1:${userId}:room:${roomId}`;

describe("#239 AC-4 401 の自動ログアウトと下書き", () => {
  it("#239 AC-4（U-7）: UNAUTHENTICATED で /login へ移っても、端末の下書きはすべて残る", () => {
    const draft = JSON.stringify({
      body: "[E2E_TEST]離席前の書きかけ",
      updatedAt: Date.now(),
    });
    window.localStorage.setItem(keyOf(TEST_USER.id, "R1"), draft);
    window.localStorage.setItem(keyOf(TEST_USER.id, "R2"), draft);
    const queryClient = new QueryClient();
    queryClient.setQueryData(authKeys.session, {
      user: TEST_USER,
      mustChangePassword: false,
    });
    const navigate = vi.fn();
    const handler = createUnauthenticatedHandler({
      queryClient,
      navigate,
      currentPath: () => "/channels/R1",
    });
    handler({ status: 401, code: "UNAUTHENTICATED", message: "x" });
    expect(navigate).toHaveBeenCalledWith("/login");
    expect(window.localStorage.getItem(keyOf(TEST_USER.id, "R1"))).toBe(draft);
    expect(window.localStorage.getItem(keyOf(TEST_USER.id, "R2"))).toBe(draft);
    expect(window.localStorage.length).toBe(2);
  });
});
