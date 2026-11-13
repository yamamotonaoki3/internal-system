// #238 AC-1・AC-2・AC-3（画面 S-05）: チャンネルの詳細で、無効化された投稿者の投稿に「退職者」を併記し、その行にプロフィールカードの起動ボタン・「DMを送る」を出さない。
// 参加者の一覧（有効な参加者）の「DMを送る」は変えない。API は MSW。データは架空。
// 契約（実装前の仮置き）：メッセージ一覧の author.isActive が偽の投稿者は、一覧（role=log）の中で表示名（投稿時点）＋「（退職者）」の文字だけ。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { SHELL_USER, respondShellUser } from "../../test/app-shell-harness";
import { ANY_DM_BUTTON, dmButtonName } from "../../test/dm-handlers";
import { message, respondMessages } from "../../test/message-handlers";
import { server } from "../../test/server";
import { ChannelDetailView } from "./index";

const ID = "01JTESTROOM00000000000R001";
const OTHER = { id: "01JTESTUSER000000000000002", displayName: "テスト花子" };
const RETIRED = {
  id: "01JTESTUSER000000000000009",
  displayName: "テスト元社員",
  isActive: false,
};

beforeEach(() => {
  respondShellUser();
});

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
  return render(
    <MemoryRouter initialEntries={[`/channels/${ID}`]}>
      <QueryClientProvider client={client}>
        <ChannelDetailView channelId={ID} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function participantsSection() {
  const heading = await screen.findByRole("heading", { name: /参加者/ });
  const section = heading.parentElement;
  if (section === null) throw new Error("参加者の欄がありません");
  return section;
}

describe("#238 AC-1・AC-2 S-05 の一覧の退職者", () => {
  it("#238 AC-1: 退職者の投稿の行に、投稿時点の表示名と「退職者」が出る", async () => {
    respondMessages([
      message(1, { author: RETIRED, body: "[E2E_TEST]元社員の投稿" }),
    ]);
    respondDetail();
    renderDetail();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]元社員の投稿");
    const row = within(log).getByRole("listitem");
    expect(row.textContent).toContain(RETIRED.displayName);
    expect(row.textContent).toContain("退職者");
  });

  it("#238 AC-2: 退職者の投稿の行に、プロフィールカードの起動ボタンも「DMを送る」も出ない。参加者の一覧の有効な参加者には「DMを送る」が出たまま", async () => {
    respondMessages([
      message(1, { author: RETIRED, body: "[E2E_TEST]元社員の投稿" }),
      message(2, {
        author: { ...OTHER, isActive: true },
        body: "[E2E_TEST]在籍者の投稿",
      }),
    ]);
    respondDetail();
    renderDetail();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]在籍者の投稿");
    const retiredRow = within(log).getAllByRole("listitem")[0] as HTMLElement;
    expect(retiredRow.textContent).toContain("退職者");
    expect(within(retiredRow).queryAllByRole("button")).toEqual([]);
    expect(within(retiredRow).queryAllByRole("link")).toEqual([]);
    expect(retiredRow.textContent).not.toMatch(ANY_DM_BUTTON);
    expect(retiredRow.querySelector("[popover]")).toBeNull();
    expect(
      document.querySelector(`[aria-controls="profile-card-${RETIRED.id}"]`),
    ).toBeNull();
    // 参加者の一覧は変わらない（他の有効な参加者に「DMを送る」）
    const section = await participantsSection();
    await waitFor(() =>
      expect(
        within(section).getByRole("button", {
          name: dmButtonName(OTHER.displayName),
        }),
      ).toBeDefined(),
    );
  });
});

describe("#238 AC-3 S-05 の有効な投稿者", () => {
  it("#238 AC-3: 有効な投稿者の行に「退職者」を併記しない", async () => {
    respondMessages([
      message(1, {
        author: { ...OTHER, isActive: true },
        body: "[E2E_TEST]在籍者の投稿",
      }),
    ]);
    respondDetail();
    renderDetail();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]在籍者の投稿");
    expect(log.textContent).toContain(OTHER.displayName);
    expect(log.textContent).not.toContain("退職者");
  });
});
