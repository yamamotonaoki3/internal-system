// #298 AC-3（計画 plan-298 改訂3 の 2-1 甲）：文書の利用者は「この文書で最初に確定したセッションの利用者」で、401・ログアウト・別の利用者への替わりでも変えない。
// 文書ごとの状態なので、各テストで vi.resetModules して新しい文書として読み込む。
// 前提にした口（実装の担当へ）：features/auth（index）の installDocumentUser(queryClient): () => void・getDocumentUserId(): string | undefined。
//   解除の関数は、見張りを止め、覚えた利用者を忘れる（テストの枠 user-switch-harness が、テストの間で前の利用者を持ち越さないため。本番では解除しない）。
// データはすべて架空（testuser_298_）。
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const USER_A = "01JTESTUSER298A00000000002";
const USER_B = "01JTESTUSER298B00000000002";
const SESSION_KEY = ["auth", "session"] as const;

function sessionOf(id: string) {
  return {
    user: { id, displayName: `testuser_298_${id.slice(-3)}`, loginId: id },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

async function freshDocument() {
  vi.resetModules();
  return import("./index");
}

describe("#298 AC-3 文書の利用者", () => {
  it("#298 AC-3: セッションが確定する前は undefined", async () => {
    const auth = await freshDocument();
    const dispose = auth.installDocumentUser(new QueryClient());
    expect(auth.getDocumentUserId()).toBeUndefined();
    dispose();
  });

  it("#298 AC-3: 登録の時点でセッションが確定していれば、その利用者になる", async () => {
    const auth = await freshDocument();
    const client = new QueryClient();
    client.setQueryData(SESSION_KEY, sessionOf(USER_A));
    const dispose = auth.installDocumentUser(client);
    expect(auth.getDocumentUserId()).toBe(USER_A);
    dispose();
  });

  it("#298 AC-3: 最初に確定した A のまま、B への替わり・401（セッションの破棄）・B の再確定でも変わらない", async () => {
    const auth = await freshDocument();
    const client = new QueryClient();
    const dispose = auth.installDocumentUser(client);
    client.setQueryData(SESSION_KEY, sessionOf(USER_A));
    expect(auth.getDocumentUserId()).toBe(USER_A);
    client.setQueryData(SESSION_KEY, sessionOf(USER_B));
    expect(auth.getDocumentUserId()).toBe(USER_A);
    client.removeQueries({ queryKey: SESSION_KEY });
    expect(auth.getDocumentUserId()).toBe(USER_A);
    client.setQueryData(SESSION_KEY, sessionOf(USER_B));
    expect(auth.getDocumentUserId()).toBe(USER_A);
    dispose();
  });

  it("#298 AC-3: 解除すると覚えた利用者を忘れ、次の登録は新しく最初の利用者を覚える（テストの枠のための口）", async () => {
    const auth = await freshDocument();
    const first = new QueryClient();
    first.setQueryData(SESSION_KEY, sessionOf(USER_A));
    auth.installDocumentUser(first)();
    expect(auth.getDocumentUserId()).toBeUndefined();
    const second = new QueryClient();
    const dispose = auth.installDocumentUser(second);
    second.setQueryData(SESSION_KEY, sessionOf(USER_B));
    expect(auth.getDocumentUserId()).toBe(USER_B);
    dispose();
  });
});
