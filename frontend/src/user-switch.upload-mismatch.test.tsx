// #298 AC-3（計画 plan-298 改訂3 の 8-1 の「AC-3（重大1）」の行。2-1 甲）：添付のアップロードを保留している間に、
// セッション（Cookie）が別の利用者 B に替わっても、続きの投稿は、操作を始めた文書の利用者 A のヘッダーで送られ、サーバーが 409 で断る。
// B の投稿は増えない。古い画面の非同期の続き（部品が外れても走る mutation）が、B として受け付けられないことを確かめる。
// 状態 × 出来事の表（1回目）のます：文書の利用者 A・セッション A → B（取り直し）× 進行中の書き込みの続きが送られる。
// 枠：test/user-switch-harness.tsx（main.tsx と同じつなぎ方。切り替えの入口は test/setup.ts の vi.fn）。
// 模擬のサーバー：test/session-mismatch-world.ts（ヘッダーなしは通す・一致は通す・違えば 409）。ヘッダーの値 A は、比べた結果と別に、記録で独立に確かめる。
// 保留は手で解く Promise。固定の時間の待ちは使わない。データはすべて架空（testuser_298_・[UNIT_TEST]）。
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUserSwitchReload } from "./features/access-loss/reload-after-access-loss";
import { authKeys } from "./features/auth";
import { installDomStubs, type DomStubs } from "./test/app-shell-harness";
import { sizedFile } from "./test/attachment-handlers";
import {
  MISMATCH_CHANNEL_ID,
  MISMATCH_USER_A,
  MISMATCH_USER_B,
  requestsTo,
  respondMismatchWorld,
} from "./test/session-mismatch-world";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "./test/user-switch-harness";

/** 文書の利用者 A の ID（ヘッダーの期待の値。本番の定義から取らない） */
const A_ID = "01JTESTUSER298WORLDA000001";
const BODY = "298本文の続き";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
  vi.mocked(requestUserSwitchReload).mockClear();
});
afterEach(() => {
  disposeUserSwitchApps();
  stubs.restore();
});

describe("#298 AC-3（重大1） アップロードの保留中の切り替え", () => {
  it("#298 AC-3: アップロードを保留している間にセッションが B になると、続きの投稿は A のヘッダーで送られて 409 になり、B の投稿は増えない", async () => {
    expect(MISMATCH_USER_A.id).toBe(A_ID);
    const world = respondMismatchWorld(MISMATCH_USER_A);
    const app = renderUserSwitchApp(`/channels/${MISMATCH_CHANNEL_ID}`, {
      needles: [],
    });
    // 「ログイン状態の確認中」の main が先に見つかるため、目的の入力欄が出るのを待ってから main を取る
    const box = await screen.findByRole("textbox", { name: "メッセージ" });
    const main = screen.getByRole("main");
    await app.user.type(box, BODY);
    await app.user.upload(
      within(main).getByLabelText("ファイルを添付"),
      sizedFile("298報告書.pdf", 1_000),
    );
    const gate = deferred();
    world.uploadHold = gate.promise;
    await app.user.click(within(main).getByRole("button", { name: "送信" }));
    // アップロードが届いた（A として受け付けられ、応答だけ保留中）
    await waitFor(() =>
      expect(
        requestsTo(world, "POST", /\/api\/rooms\/[^/]+\/attachments$/),
      ).toHaveLength(1),
    );
    expect(
      requestsTo(world, "POST", /\/api\/rooms\/[^/]+\/attachments$/)[0]?.header,
    ).toBe(A_ID);

    // 別のタブで B がログインした（Cookie が B に替わった）。この文書のセッションの取り直しが B を返す
    world.serverUser = MISMATCH_USER_B;
    await act(async () => {
      await app.client.refetchQueries({
        queryKey: authKeys.session,
        exact: true,
      });
    });
    expect(requestUserSwitchReload).toHaveBeenCalledTimes(1);

    // 保留を解く：続きの投稿が送られる
    gate.release();
    await waitFor(() =>
      expect(
        requestsTo(world, "POST", /\/api\/rooms\/[^/]+\/messages$/),
      ).toHaveLength(1),
    );
    const [post] = requestsTo(world, "POST", /\/api\/rooms\/[^/]+\/messages$/);
    expect(post?.header).toBe(A_ID);
    expect(post?.status).toBe(409);
    expect(world.acceptedPosts).toEqual([]);
    expect(
      world.acceptedPosts.filter((p) => p.userId === MISMATCH_USER_B.id),
    ).toHaveLength(0);
  });

  it("#298 AC-3（対照）: 切り替えが無ければ、同じ操作の続きの投稿は A のヘッダーで受け付けられる（模擬のサーバーと操作の組み立ての確かめ）", async () => {
    const world = respondMismatchWorld(MISMATCH_USER_A);
    const app = renderUserSwitchApp(`/channels/${MISMATCH_CHANNEL_ID}`, {
      needles: [],
    });
    // 「ログイン状態の確認中」の main が先に見つかるため、目的の入力欄が出るのを待ってから main を取る
    const box = await screen.findByRole("textbox", { name: "メッセージ" });
    const main = screen.getByRole("main");
    await app.user.type(box, BODY);
    await app.user.upload(
      within(main).getByLabelText("ファイルを添付"),
      sizedFile("298報告書.pdf", 1_000),
    );
    await app.user.click(within(main).getByRole("button", { name: "送信" }));
    await waitFor(() =>
      expect(world.acceptedPosts).toEqual([
        { userId: MISMATCH_USER_A.id, body: BODY },
      ]),
    );
    const [post] = requestsTo(world, "POST", /\/api\/rooms\/[^/]+\/messages$/);
    expect(post?.header).toBe(A_ID);
    expect(post?.status).toBe(201);
    expect(requestUserSwitchReload).not.toHaveBeenCalled();
  });
});
