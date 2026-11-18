// #135 AC-1（2-5 AC-1・AC-2・AC-5）・#132 AC-2（2-4 AC-2・AC-3）: チャンネルへの招待の画面（S-12。ChannelDetailView の「招待」と ChannelInviteDialog）。API は MSW。データは架空。
// 画面の分岐は部品のテストで足りる（計画 10節「画面 S-12」）。認可はサーバーが判定し、ボタンの表示は補助。
// 契約（実装前の仮置き。報告に明記）：
//   ChannelDetailView は、参加中（joined）で読み取り専用でない（!readOnly）ときだけ、ボタン「招待」を出す。
//   「招待」でダイアログ（role=dialog、名前「チャンネルに招待」）を開く。社員の検索は既存の GET /api/users（検索欄のラベル「表示名で検索」と「検索」ボタン）。
//     候補の1件は li か tr で、表示名と、ボタン「<表示名> さんを招待」を持つ。検索の4状態：読み込み中 role=status、失敗 role=alert、0件「該当する社員がいません」、あり。
//   候補を選ぶ → 再認証（useReauth().withReauth。再認証のダイアログ「再認証」）→ 再認証の成功では確定画面（role=dialog、名前「招待の確認」）を開くだけで、API は呼ばない。
//   確定画面に相手の表示名とチャンネル名を出し、「確定」を押したときだけ POST /api/channels/:channelId/invitations { userId } を送る。「キャンセル」で閉じれば送らない。
//   成功したら、チャンネルの詳細を取り直し（再読み込みなしで）参加者に相手が出る。
//   失敗：CONFLICT はサーバーの文言（参加済み・部署が無効）を role=alert に出す。NOT_FOUND は「見つかりません」を含む文を role=alert に出す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { SHELL_USER, respondShellUser } from "../../test/app-shell-harness";
import { TEST_PASSWORD } from "../../test/auth-handlers";
import { respondMessages } from "../../test/message-handlers";
import { member } from "../../test/profile-handlers";
import { server } from "../../test/server";
import { ReauthProvider } from "../auth/ReauthProvider";
import { ChannelDetailView } from "./components/ChannelDetailView";

const ID = "01JTESTROOM00000000000R001";
const CHANNEL_NAME = "E2E_TEST_invite_画面";
const CANDIDATE = member(2);
const CANDIDATE_BUTTON = `${CANDIDATE.displayName} さんを招待`;

type World = {
  members: { id: string; displayName: string }[];
  invitations: unknown[];
  reauths: number;
};

function respondWorld(
  options: {
    joined?: boolean;
    readOnly?: boolean;
    candidates?: unknown[];
    invite?: () => Response | Promise<Response>;
  } = {},
): World {
  const world: World = {
    members: [{ id: SHELL_USER.id, displayName: SHELL_USER.displayName }],
    invitations: [],
    reauths: 0,
  };
  const joined = options.joined ?? true;
  server.use(
    http.get("/api/channels/:channelId", () =>
      HttpResponse.json({
        id: ID,
        roomId: ID,
        name: CHANNEL_NAME,
        description: "[E2E_TEST]",
        visibility: "private",
        departmentId: "01JTESTDEPT000000000000S01",
        isCaseChannel: false,
        caseId: null,
        // #143：詳細の応答に version・manage（必須）が加わった
        version: 1,
        manage: {
          canRename: false,
          canEditDescription: false,
          canArchive: false,
        },
        joined,
        canPost: joined,
        readOnly: options.readOnly ?? false,
        ...(joined
          ? { memberCount: world.members.length, members: world.members }
          : {}),
      }),
    ),
    http.get("/api/users", () =>
      HttpResponse.json({
        items: options.candidates ?? [CANDIDATE],
        nextCursor: null,
      }),
    ),
    http.post("/api/auth/reauthenticate", () => {
      world.reauths += 1;
      return HttpResponse.json({ reauthenticatedAt: new Date().toISOString() });
    }),
    http.post(
      "/api/channels/:channelId/invitations",
      async ({ request, params }) => {
        const body = (await request.json()) as { userId: string };
        world.invitations.push({ channelId: params.channelId, ...body });
        if (options.invite) return options.invite();
        world.members = [
          ...world.members,
          { id: CANDIDATE.id, displayName: CANDIDATE.displayName },
        ];
        return HttpResponse.json(
          {
            channelId: ID,
            userId: body.userId,
            joinedAt: "2026-11-16T00:00:00.000Z",
          },
          { status: 201 },
        );
      },
    ),
  );
  respondMessages([]);
  return world;
}

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ReauthProvider>
          <ChannelDetailView channelId={ID} />
        </ReauthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { user, client };
}

const inviteDialog = () =>
  screen.findByRole("dialog", { name: "チャンネルに招待" });
const confirmDialog = () => screen.findByRole("dialog", { name: "招待の確認" });

async function openInvite(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "招待" }));
  return inviteDialog();
}

async function reauthenticate(user: ReturnType<typeof userEvent.setup>) {
  const reauth = await screen.findByRole("dialog", { name: "再認証" });
  await user.type(within(reauth).getByLabelText("パスワード"), TEST_PASSWORD);
  await user.click(within(reauth).getByRole("button", { name: "再認証" }));
}

/** 候補を選び、再認証して、確定画面を開く */
async function selectAndReauth(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await openInvite(user);
  await user.click(
    await within(dialog).findByRole("button", { name: CANDIDATE_BUTTON }),
  );
  await reauthenticate(user);
  return confirmDialog();
}

beforeEach(() => {
  respondShellUser();
});

describe("#135 AC-1（S-12）招待ボタンの表示", () => {
  it("#135 AC-1（2-5 AC-1）: 参加中で読み取り専用でなければ「招待」を出す", async () => {
    respondWorld();
    renderDetail();
    expect(await screen.findByRole("button", { name: "招待" })).toBeDefined();
  });

  it("#135 AC-1: 参加していなければ「招待」を出さない", async () => {
    respondWorld({ joined: false });
    renderDetail();
    await screen.findByRole("heading", { name: CHANNEL_NAME });
    expect(screen.queryByRole("button", { name: "招待" })).toBeNull();
  });

  it("#135 AC-1（読み取り専用）: 部署が無効（readOnly）なら「招待」を出さない", async () => {
    respondWorld({ readOnly: true });
    renderDetail();
    await screen.findByRole("heading", { name: CHANNEL_NAME });
    expect(screen.queryByRole("button", { name: "招待" })).toBeNull();
  });
});

describe("#135 AC-1（S-12）選択 → 再認証 → 確定画面 → 確定", () => {
  it("#135 AC-1（2-5 AC-5）・#132 AC-2（2-4 AC-3）: 候補を選ぶと再認証を求め、再認証が成功しただけでは招待の API を呼ばない", async () => {
    const world = respondWorld();
    const { user } = renderDetail();
    const dialog = await selectAndReauth(user);
    expect(dialog).toBeDefined();
    expect(world.reauths).toBe(1);
    expect(world.invitations).toEqual([]);
  });

  it("#135 AC-1（2-5 AC-1）: 確定画面に相手の表示名とチャンネル名を出す", async () => {
    respondWorld();
    const { user } = renderDetail();
    const dialog = await selectAndReauth(user);
    expect(dialog.textContent).toContain(CANDIDATE.displayName);
    expect(dialog.textContent).toContain(CHANNEL_NAME);
  });

  it("#135 AC-1（2-5 AC-1）・#132 AC-2（2-4 AC-2）: 「確定」で招待を1回だけ送り、再読み込みなしで参加者に相手が出る", async () => {
    const world = respondWorld();
    const { user } = renderDetail();
    const dialog = await selectAndReauth(user);
    await user.click(within(dialog).getByRole("button", { name: "確定" }));
    await waitFor(() =>
      expect(world.invitations).toEqual([
        { channelId: ID, userId: CANDIDATE.id },
      ]),
    );
    expect(
      await screen.findByRole("heading", { name: /参加者（2人）/ }),
    ).toBeDefined();
    expect(screen.getAllByText(CANDIDATE.displayName).length).toBeGreaterThan(
      0,
    );
  });

  it("#135 AC-1: 確定画面を「キャンセル」で閉じると、招待の API を呼ばない", async () => {
    const world = respondWorld();
    const { user } = renderDetail();
    const dialog = await selectAndReauth(user);
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "招待の確認" })).toBeNull(),
    );
    expect(world.invitations).toEqual([]);
  });

  it("#135 AC-1（2-5 AC-5）: 再認証をキャンセルすると、確定画面を開かず、招待の API を呼ばない", async () => {
    const world = respondWorld();
    const { user } = renderDetail();
    const dialog = await openInvite(user);
    await user.click(
      await within(dialog).findByRole("button", { name: CANDIDATE_BUTTON }),
    );
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    await user.click(
      within(reauth).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull(),
    );
    expect(screen.queryByRole("dialog", { name: "招待の確認" })).toBeNull();
    expect(world.invitations).toEqual([]);
  });
});

describe("#135 AC-1（S-12）失敗の表示", () => {
  async function confirmWith(
    invite: () => Response,
  ): Promise<{ world: World }> {
    const world = respondWorld({ invite });
    const { user } = renderDetail();
    const dialog = await selectAndReauth(user);
    await user.click(within(dialog).getByRole("button", { name: "確定" }));
    return { world };
  }

  it("#135 AC-1（2-5 AC-2）: 409（参加済み）では「参加済み」を role=alert で出す", async () => {
    await confirmWith(() =>
      HttpResponse.json(
        {
          code: "CONFLICT",
          message: "この社員はすでにチャンネルに参加済みです",
        },
        { status: 409 },
      ),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "参加済み",
    );
  });

  it("#135 AC-1（読み取り専用）: 409（部署が無効）では、その文言を role=alert で出す", async () => {
    await confirmWith(() =>
      HttpResponse.json(
        {
          code: "CONFLICT",
          message: "部署が無効になっているため、招待できません",
        },
        { status: 409 },
      ),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "部署が無効になっているため、招待できません",
    );
  });

  it("#135 AC-1（2-5 AC-3）: 404 では「見つかりません」を含む文を role=alert で出す", async () => {
    await confirmWith(() =>
      HttpResponse.json(
        { code: "NOT_FOUND", message: "見つかりませんでした" },
        { status: 404 },
      ),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "見つかりません",
    );
  });
});

describe("#135 AC-1（S-12）社員の検索の4つの状態", () => {
  it("#135 AC-1: 読み込み中は role=status を出す", async () => {
    respondWorld();
    server.use(http.get("/api/users", () => new Promise<Response>(() => {})));
    const { user } = renderDetail();
    const dialog = await openInvite(user);
    expect((await within(dialog).findByRole("status")).textContent).toContain(
      "読み込み中",
    );
  });

  it("#135 AC-1: 取得に失敗したら role=alert を出し、0件とは出さない", async () => {
    respondWorld();
    server.use(
      http.get("/api/users", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    const { user } = renderDetail();
    const dialog = await openInvite(user);
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "一時的なエラーが発生しました",
    );
    expect(within(dialog).queryByText("該当する社員がいません")).toBeNull();
  });

  it("#135 AC-1: 0件なら「該当する社員がいません」を出す", async () => {
    respondWorld({ candidates: [] });
    const { user } = renderDetail();
    const dialog = await openInvite(user);
    expect(
      await within(dialog).findByText("該当する社員がいません"),
    ).toBeDefined();
  });

  it("#135 AC-1: 候補があれば、表示名と「<表示名> さんを招待」を出す", async () => {
    respondWorld();
    const { user } = renderDetail();
    const dialog = await openInvite(user);
    expect(
      await within(dialog).findByRole("button", { name: CANDIDATE_BUTTON }),
    ).toBeDefined();
    expect(within(dialog).getByText(CANDIDATE.displayName)).toBeDefined();
  });

  it("#135 AC-1: 「表示名で検索」に入れて「検索」を押すと、q を付けて社員を検索する", async () => {
    respondWorld();
    const urls: URL[] = [];
    server.use(
      http.get("/api/users", ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json({ items: [CANDIDATE], nextCursor: null });
      }),
    );
    const { user } = renderDetail();
    const dialog = await openInvite(user);
    await user.type(within(dialog).getByLabelText("表示名で検索"), "テスト");
    await user.click(within(dialog).getByRole("button", { name: "検索" }));
    await waitFor(() =>
      expect(urls.some((url) => url.searchParams.get("q") === "テスト")).toBe(
        true,
      ),
    );
  });
});
