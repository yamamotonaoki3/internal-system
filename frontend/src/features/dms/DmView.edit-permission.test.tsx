// #134 AC-1（1-3 AC-1）: DM の画面（S-06。DmView）で、自分の投稿の「編集」「削除」を出す条件。API は MSW。データは架空。
// 契約（実装前の仮置き。計画 plan-134 の「変更するファイル」・利用者の決定 U-3）：
//   DmView は RoomMessages に canModifyOwn = canPost（GET /api/dms/:roomId の canPost。相手が有効な当事者のとき真）を渡す。
//   相手が無効（canPost が偽）なら、自分の投稿にも「編集」「削除」を出さない（サーバーは 409）。相手の投稿には出さない。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  dmDetail,
  dmRoomId,
  partnerId,
  partnerName,
  respondDms,
} from "../../test/dm-handlers";
import { message, respondMessages } from "../../test/message-handlers";
import { authKeys } from "../auth";
import { ReauthProvider } from "../auth/ReauthProvider";
import { DmView } from "./index";

const ROOM = dmRoomId(1);
const ME = {
  id: "01JTESTUSER000000000000001",
  displayName: "testuser_001",
  loginId: "testuser_001",
};

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, {
    user: ME,
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/dms/${ROOM}`]}>
        <ReauthProvider>
          <DmView roomId={ROOM} />
        </ReauthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function respondRoomMessages() {
  respondMessages([
    message(1, {
      roomId: ROOM,
      author: { id: ME.id, displayName: ME.displayName },
      body: "[E2E_TEST]自分の DM",
    }),
    message(2, {
      roomId: ROOM,
      author: { id: partnerId(1), displayName: partnerName(1) },
      body: "[E2E_TEST]相手の DM",
    }),
  ]);
}

async function buttonsOf(text: string) {
  const log = await screen.findByRole("log");
  const row = await waitFor(() => {
    const found = within(log)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement?.closest("li") === null)
      .find((li) => (li.textContent ?? "").includes(text));
    if (found === undefined) throw new Error(`「${text}」の行がありません`);
    return found;
  });
  return {
    edit: within(row).queryByRole("button", { name: "編集" }),
    remove: within(row).queryByRole("button", { name: "削除" }),
  };
}

describe("#134 AC-1（1-3 AC-1）S-06 の「編集」「削除」の出し分け", () => {
  it("#134 AC-1（1-3 AC-1）: 送信できる DM では、自分の投稿にだけ「編集」「削除」を出し、相手の投稿には出さない", async () => {
    respondRoomMessages();
    respondDms({ details: [dmDetail(1)] });
    renderView();
    const own = await buttonsOf("[E2E_TEST]自分の DM");
    expect(own.edit).not.toBeNull();
    expect(own.remove).not.toBeNull();
    const partner = await buttonsOf("[E2E_TEST]相手の DM");
    expect(partner.edit).toBeNull();
    expect(partner.remove).toBeNull();
  });

  it("#134 AC-1（U-3）: 相手が無効で送信できない DM（canPost が偽）では、自分の投稿にも「編集」「削除」を出さない", async () => {
    respondRoomMessages();
    respondDms({
      details: [
        dmDetail(1, {
          canPost: false,
          partner: { isActive: false, status: null },
        }),
      ],
    });
    renderView();
    await screen.findByText(/送信できません/);
    const own = await buttonsOf("[E2E_TEST]自分の DM");
    expect(own.edit).toBeNull();
    expect(own.remove).toBeNull();
  });
});
