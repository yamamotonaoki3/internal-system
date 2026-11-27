// #148（148-A）5-2 AC-6・計画「画面」：チャンネルの画面（/channels/:id。S-05）で案件専用チャンネルを開いたとき（通知・スレッドの一覧 S-35・未読のリンクなど、
// /channels/<部屋> を作るどの入口からでも）、チャンネルの詳細の応答（isCaseChannel・caseId）を見て、案件の画面（/cases/:caseId）へ置き換えて移る。
// 元の search（?thread=）は引き継ぐ。チャンネルの見出し・管理メニュー・参加者は一度も描画しない（取得の完了の前は「読み込み中」）。
// 枠：test/user-switch-harness.tsx（main.tsx と同じ組み立て・描画の確定ごとの見張り）。API は MSW。データはすべて架空。
// 画面の契約（実装の担当へ）：features/channels は features/cases を参照しない（caseId は API の応答の値として受け取る。循環の依存を作らない）。
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installDomStubs, type DomStubs } from "../test/app-shell-harness";
import {
  caseDetail,
  caseId,
  caseRoomId,
  caseSummary,
} from "../test/case-handlers";
import { message } from "../test/message-handlers";
import { server } from "../test/server";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "../test/user-switch-harness";

const USER = {
  id: "01JTESTUSER000000000000001",
  displayName: "testuser_case148_member",
  loginId: "testuser_case148_member",
};
const N = 77;
const CHANNEL_NAME = "QZA-261117-0077[E2E_TEST]チャンネル名";
const PARENT_ID = message(1).id;

function channelDetail(isCase: boolean) {
  return {
    id: caseRoomId(N),
    roomId: caseRoomId(N),
    name: CHANNEL_NAME,
    description: "",
    visibility: "private",
    departmentId: null,
    isCaseChannel: isCase,
    caseId: isCase ? caseId(N) : null,
    version: 1,
    manage: { canRename: true, canEditDescription: true, canArchive: true },
    readOnly: false,
    joined: true,
    canPost: true,
    memberCount: 1,
    members: [{ id: USER.id, displayName: USER.displayName }],
  };
}

function respondWorld(isCase: boolean) {
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user: USER,
        permissions: [],
        mustChangePassword: false,
        reauthenticatedAt: null,
      }),
    ),
    http.get("/api/channels/:channelId", () =>
      HttpResponse.json(channelDetail(isCase)),
    ),
    http.get("/api/cases", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
    http.get("/api/cases/:caseId/detail", () =>
      HttpResponse.json(caseDetail(N)),
    ),
    http.get("/api/cases/:caseId", () => HttpResponse.json(caseSummary(N))),
    http.get("/api/rooms/:roomId/messages", () =>
      HttpResponse.json({ items: [], nextCursor: null, hasMore: false }),
    ),
    http.put(
      "/api/rooms/:roomId/read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
    http.get("/api/messages/:messageId/replies", () =>
      HttpResponse.json({
        items: [],
        nextCursor: null,
        hasMore: false,
        parent: message(1, { roomId: caseRoomId(N), replyCount: 0 }),
        replyBlockedReason: null,
        caseRoom: true,
        caseId: caseId(N),
        joined: true,
        roomWritable: true,
      }),
    ),
    http.put(
      "/api/messages/:messageId/thread-read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
    http.get("/api/me/unread", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
    http.get("/api/me/notifications/unread-count", () =>
      HttpResponse.json({ count: 0 }),
    ),
    http.get("/api/channels", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
    http.get("/api/dms", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
  );
}

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  disposeUserSwitchApps();
  stubs.restore();
});

describe("#148 5-2 AC-6 チャンネルの画面から案件の画面へ移る", () => {
  it("#148 5-2 AC-6: /channels/<案件の部屋>?thread=X を開くと、/cases/<caseId>?thread=X に置き換わり、チャンネルの見出し・管理メニューが一度も描画されない", async () => {
    respondWorld(true);
    const app = renderUserSwitchApp(
      `/channels/${caseRoomId(N)}?thread=${PARENT_ID}`,
      { needles: [CHANNEL_NAME, "チャンネルの管理"] },
    );
    app.watch.arm();
    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe(`/cases/${caseId(N)}`),
    );
    expect(app.router.state.location.search).toBe(`?thread=${PARENT_ID}`);
    // 置き換え（replace）なので、戻る操作でチャンネルの画面に戻らない
    expect(app.router.state.historyAction).toBe("REPLACE");
    expect(app.watch.hits).toEqual([]);
  });

  it("#148 退行なし: 通常のチャンネル（isCaseChannel:false・caseId:null）は、チャンネルの画面のまま見出しを出す", async () => {
    respondWorld(false);
    const app = renderUserSwitchApp(`/channels/${caseRoomId(N)}`, {
      needles: [],
    });
    expect(
      await screen.findByRole("heading", { name: new RegExp("チャンネル名") }),
    ).toBeTruthy();
    expect(app.router.state.location.pathname).toBe(
      `/channels/${caseRoomId(N)}`,
    );
  });
});
