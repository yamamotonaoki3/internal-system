// #298 AC-4（計画 plan-298 改訂3 の 2-8「呼ぶ時」）：見張り（installUserSwitchGuard）は、セッションのキャッシュの利用者が
// 文書の利用者と違う値になったときに、渡された関数（main.tsx が切り替えの読み込み直しの入口を渡す）を呼ぶ。
// 文書の利用者がまだ無い（最初のログイン）・同じ利用者（再ログイン）では呼ばない。キャッシュの破棄（ADR-0030）は二重の守りとして残る。
// 前提にした口（実装の担当へ）：installUserSwitchGuard(queryClient, onOtherUser?: () => void)。文書の利用者は installDocumentUser で持つ。
// 見張りが文書の利用者をどちらで判断しても確かめられるよう、main.tsx と同じく、文書の利用者 → 見張りの順で登録する。
// データはすべて架空（testuser_298_・[UNIT_TEST]）。
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const USER_A = "01JTESTUSER298A00000000004";
const USER_B = "01JTESTUSER298B00000000004";
const SESSION_KEY = ["auth", "session"] as const;
const OTHER_KEY = ["channels", "[UNIT_TEST]298"] as const;

function sessionOf(id: string) {
  return {
    user: { id, displayName: `testuser_298_${id.slice(-3)}`, loginId: id },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

async function setUp() {
  vi.resetModules();
  const auth = await import("./index");
  const client = new QueryClient();
  const onOtherUser = vi.fn();
  const disposeDocument = auth.installDocumentUser(client);
  const disposeGuard = auth.installUserSwitchGuard(client, onOtherUser);
  return {
    client,
    onOtherUser,
    dispose: () => {
      disposeGuard();
      disposeDocument();
    },
  };
}

describe("#298 AC-4 見張りが切り替えの入口を呼ぶ時", () => {
  it("#298 AC-4: 最初のログイン（文書の利用者がまだ無い → A）では呼ばない", async () => {
    const t = await setUp();
    t.client.setQueryData(SESSION_KEY, sessionOf(USER_A));
    expect(t.onOtherUser).not.toHaveBeenCalled();
    t.dispose();
  });

  it("#298 AC-4: A → B に替わると1回呼ぶ。セッション以外のキャッシュは今どおり捨てる（二重の守り）", async () => {
    const t = await setUp();
    t.client.setQueryData(SESSION_KEY, sessionOf(USER_A));
    t.client.setQueryData(OTHER_KEY, { secret: "[UNIT_TEST]298A" });
    t.client.setQueryData(SESSION_KEY, sessionOf(USER_B));
    expect(t.onOtherUser).toHaveBeenCalledTimes(1);
    expect(t.client.getQueryData(OTHER_KEY)).toBeUndefined();
    t.dispose();
  });

  it("#298 AC-4: A → 401（セッションの破棄）→ B でも1回呼ぶ", async () => {
    const t = await setUp();
    t.client.setQueryData(SESSION_KEY, sessionOf(USER_A));
    t.client.removeQueries({ queryKey: SESSION_KEY });
    expect(t.onOtherUser).not.toHaveBeenCalled();
    t.client.setQueryData(SESSION_KEY, sessionOf(USER_B));
    expect(t.onOtherUser).toHaveBeenCalledTimes(1);
    t.dispose();
  });

  it("#298 AC-4（0-2 AC-8）: A → 401 → A（同じ利用者の再ログイン）では呼ばない", async () => {
    const t = await setUp();
    t.client.setQueryData(SESSION_KEY, sessionOf(USER_A));
    t.client.removeQueries({ queryKey: SESSION_KEY });
    t.client.setQueryData(SESSION_KEY, sessionOf(USER_A));
    t.client.setQueryData(SESSION_KEY, {
      ...sessionOf(USER_A),
      mustChangePassword: true,
    });
    expect(t.onOtherUser).not.toHaveBeenCalled();
    t.dispose();
  });

  it("#298 AC-4: 関数を渡さない登録（これまでの呼び方）でも、A → B で例外にならず、キャッシュを捨てる", async () => {
    vi.resetModules();
    const auth = await import("./index");
    const client = new QueryClient();
    const dispose = auth.installUserSwitchGuard(client);
    client.setQueryData(SESSION_KEY, sessionOf(USER_A));
    client.setQueryData(OTHER_KEY, { secret: "[UNIT_TEST]298A" });
    expect(() =>
      client.setQueryData(SESSION_KEY, sessionOf(USER_B)),
    ).not.toThrow();
    expect(client.getQueryData(OTHER_KEY)).toBeUndefined();
    dispose();
  });
});
