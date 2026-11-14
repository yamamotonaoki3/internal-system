// #136 AC-1（1-2 AC-4）: チャンネルの詳細（S-05）の参加者一覧から DM を始める。API は MSW。データは架空。
// 契約（実装前の仮置き。引き継ぎに明記）：
//   参加者一覧（見出し「参加者（n人）」の下の list）の各行に、「DMを送る」のボタン（features/dms の StartDmButton。名前は「<表示名> さんに DMを送る」）を出す。
//   自分の行には出さない。セッションの読み込み中（自分が未定）は、どの行にも出さない。
//   押すと POST /api/dms { partnerUserId } で始め、/dms/:roomId へ移る。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { SHELL_USER, respondShellUser } from "../../test/app-shell-harness";
import {
  ANY_DM_BUTTON,
  dmButtonName,
  holdSession,
  respondDms,
} from "../../test/dm-handlers";
import { respondMessages } from "../../test/message-handlers";
import { server } from "../../test/server";
import { ChannelDetailView } from "./index";

const ID = "01JTESTROOM00000000000R001";
const OTHER = { id: "01JTESTUSER000000000000002", displayName: "テスト花子" };

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function respondDetail() {
  server.use(
    http.get("/api/channels/:channelId", () =>
      HttpResponse.json({
        id: ID,
        roomId: ID,
        name: "[E2E_TEST]詳細チャンネル",
        description: "",
        visibility: "public",
        departmentId: null,
        isCaseChannel: false,
        joined: true,
        canPost: true,
        // #134：詳細の応答に readOnly（部署が無効）が加わった
        readOnly: false,
        memberCount: 2,
        members: [
          { id: SHELL_USER.id, displayName: SHELL_USER.displayName },
          OTHER,
        ],
      }),
    ),
  );
}

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/channels/${ID}`]}>
        <Routes>
          <Route
            path="/channels/:channelId"
            element={<ChannelDetailView channelId={ID} />}
          />
          <Route path="/dms/:roomId" element={<p>DMの画面</p>} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user };
}

async function participantRow(name: string) {
  const heading = await screen.findByRole("heading", { name: /参加者/ });
  const section = heading.parentElement;
  if (section === null) throw new Error("参加者の欄がありません");
  const label = await within(section).findByText(name);
  const row = label.closest("li");
  if (row === null) throw new Error(`${name} の行がありません`);
  return row as HTMLElement;
}

describe("#136 AC-1（1-2 AC-4）S-05 参加者からの DM の開始", () => {
  it("#136 AC-1（1-2 AC-4）: 他の参加者の行には「DMを送る」が出て、自分の行には出ない", async () => {
    respondShellUser();
    respondMessages([]);
    respondDetail();
    renderDetail();
    const other = await participantRow(OTHER.displayName);
    await waitFor(() =>
      expect(
        within(other).getByRole("button", {
          name: dmButtonName(OTHER.displayName),
        }),
      ).toBeDefined(),
    );
    const self = await participantRow(SHELL_USER.displayName);
    expect(
      within(self).queryByRole("button", { name: ANY_DM_BUTTON }),
    ).toBeNull();
  });

  it("#136 AC-1（1-2 AC-4）: セッションの読み込み中は、どの参加者の行にも「DMを送る」を出さない。届いたら他の参加者の行にだけ出す", async () => {
    respondShellUser();
    respondMessages([]);
    respondDetail();
    const session = holdSession(SHELL_USER);
    renderDetail();
    const other = await participantRow(OTHER.displayName);
    await participantRow(SHELL_USER.displayName);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryAllByRole("button", { name: ANY_DM_BUTTON })).toEqual(
      [],
    );
    session.release();
    await waitFor(() =>
      expect(
        within(other).getByRole("button", {
          name: dmButtonName(OTHER.displayName),
        }),
      ).toBeDefined(),
    );
    const self = await participantRow(SHELL_USER.displayName);
    expect(
      within(self).queryByRole("button", { name: ANY_DM_BUTTON }),
    ).toBeNull();
  });

  it("#136 AC-1（1-2 AC-4）: 参加者の「DMを送る」を押すと、その相手と DM を始めて /dms/:roomId へ移る", async () => {
    respondShellUser();
    respondMessages([]);
    respondDetail();
    const dms = respondDms({ names: { [OTHER.id]: OTHER.displayName } });
    const { user } = renderDetail();
    const other = await participantRow(OTHER.displayName);
    const button = await within(other).findByRole("button", {
      name: dmButtonName(OTHER.displayName),
    });
    await user.click(button);
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(
        `/dms/${dms.items[0]?.roomId}`,
      ),
    );
    expect(dms.startBodies).toEqual([{ partnerUserId: OTHER.id }]);
  });
});
