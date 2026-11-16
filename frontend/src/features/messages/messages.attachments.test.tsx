// #140 AC-1（1-6 AC-1・AC-3・AC-7）: 投稿欄（S-05・S-06）の添付と、メッセージの添付の表示。API は MSW。データは架空。
// 契約（計画「画面」。このテストが固定する）：
//   - 投稿欄に「ファイルを添付」（ラベル付きの input type=file）。選んだ直後に件数（10件）・種類ごとの上限（画像10MB・文書25MB・動画100MB。MB＝10^6バイト）・
//     合計（200MB）・形式（拡張子）を確かめ、超えたファイルは一覧に入れず、role="alert" にファイル名と理由を出す。
//     理由の文言：形式「この形式のファイルは添付できません」／上限「サイズの上限を超えています」／件数「添付は10ファイルまでです」／合計「添付の合計は200MBまでです」
//   - 送信前の一覧は role="list"・名前「送信前の添付」。項目に元の名前とサイズ（MB＝10^6バイト、小数1桁。例：2,500,000バイト →「2.5 MB」）、
//     取り消しのボタン「<名前> を取り消す」。
//   - 送信：通常の投稿用の入口（POST /api/rooms/:roomId/attachments）に1件ずつアップロードし、全部成功してから、
//     POST /api/rooms/:roomId/messages に attachmentIds（選んだ順）を付けて投稿する。成功したら一覧を空にする。
//   - どれかが失敗したら投稿しない。role="alert" に失敗したファイル名と「アップロードできませんでした」を出し、一覧は残す。
//   - 送信中は「送信を取り消す」で取り消せる。取り消したら投稿しない。
//   - 添付の表示：画像は <img alt=名前 src=/api/attachments/:id>、動画は <video controls src=…>、そのほかは名前のリンク（href=/api/attachments/:id）。
//     削除済みの投稿には出さない。
// 形式の中身の検査はサーバーの単体（attachment-inspection）で確かめる。ここは選んだ直後の確認と画面の流れだけ（#271）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  respondAttachments,
  sizedFile,
  uploadedId,
} from "../../test/attachment-handlers";
import {
  ROOM_ID,
  message,
  respondMessages,
  type TestAttachment,
  type TestMessage,
} from "../../test/message-handlers";
import { authKeys } from "../auth";
import { RoomMessages } from "./index";

const MB = 1_000_000;

function renderRoom(initial: TestMessage[] = []) {
  respondMessages(initial);
  const api = respondAttachments();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, {
    user: {
      id: "01JTESTACCT000000000000001",
      displayName: "testuser_001",
      loginId: "testuser_001",
    },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  });
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RoomMessages roomId={ROOM_ID} canPost joined canModifyOwn />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, api, ...view };
}

const picker = () => screen.getByLabelText<HTMLInputElement>("ファイルを添付");
const pendingList = () => screen.queryByRole("list", { name: "送信前の添付" });
const pendingNames = () => {
  const list = pendingList();
  if (list === null) return [];
  return within(list)
    .queryAllByRole("listitem")
    .map((item) => item.textContent ?? "");
};
const box = () => screen.getByRole("textbox", { name: "メッセージ" });

describe("#140 AC-1（1-6 AC-1・AC-3）選んだ直後の確認と送信前の一覧", () => {
  it("#140 AC-1（1-6 AC-3）: 選んだファイルが、元の名前とサイズ付きで一覧に入り、取り消すと一覧から消える", async () => {
    const { user } = renderRoom();
    await user.upload(picker(), sizedFile("報告書.pdf", 2_500_000));
    await waitFor(() => expect(pendingNames()).toHaveLength(1));
    expect(pendingNames()[0]).toContain("報告書.pdf");
    expect(pendingNames()[0]).toContain("2.5 MB");
    await user.click(
      screen.getByRole("button", { name: "報告書.pdf を取り消す" }),
    );
    expect(pendingNames()).toEqual([]);
  });

  it.each([
    ["画像", "a.png", 10 * MB],
    ["文書", "a.pdf", 25 * MB],
    ["動画", "a.mp4", 100 * MB],
  ])(
    "#140 AC-1（1-6 AC-1）: %sは上限ちょうど（%s・%iバイト）なら一覧に入る",
    async (_label, name, size) => {
      const { user } = renderRoom();
      await user.upload(picker(), sizedFile(name, size));
      await waitFor(() => expect(pendingNames()).toHaveLength(1));
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it.each([
    ["画像", "a.png", 10 * MB + 1],
    ["文書", "a.pdf", 25 * MB + 1],
    ["動画", "a.mp4", 100 * MB + 1],
  ])(
    "#140 AC-1（1-6 AC-1）: %sは上限より1バイト多いと一覧に入れず、名前と理由を出す",
    async (_label, name, size) => {
      const { user } = renderRoom();
      await user.upload(picker(), sizedFile(name, size));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(name);
      expect(alert.textContent).toContain("サイズの上限を超えています");
      expect(pendingNames()).toEqual([]);
    },
  );

  it("#140 AC-1（1-6 AC-5）: 許可しない拡張子（.svg）は一覧に入れず、理由を出す", async () => {
    const { user } = renderRoom();
    await user.upload(picker(), sizedFile("vector.svg", 100));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("vector.svg");
    expect(alert.textContent).toContain("この形式のファイルは添付できません");
    expect(pendingNames()).toEqual([]);
  });

  it("#140 AC-1（1-6 AC-1）: 10件までは入り、11件目は一覧に入れず、理由を出す", async () => {
    const { user } = renderRoom();
    for (let i = 1; i <= 10; i += 1)
      await user.upload(picker(), sizedFile(`f${i}.txt`, 10));
    await waitFor(() => expect(pendingNames()).toHaveLength(10));
    expect(screen.queryByRole("alert")).toBeNull();
    await user.upload(picker(), sizedFile("f11.txt", 10));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("f11.txt");
    expect(alert.textContent).toContain("添付は10ファイルまでです");
    expect(pendingNames()).toHaveLength(10);
  });

  it("#140 AC-1（1-6 AC-3）: 合計がちょうど200MBまでは入り、超えるファイルは一覧に入れず、理由を出す", async () => {
    const { user } = renderRoom();
    await user.upload(picker(), sizedFile("v1.mp4", 100 * MB));
    await user.upload(picker(), sizedFile("v2.mp4", 75 * MB));
    await user.upload(picker(), sizedFile("d1.pdf", 25 * MB));
    await waitFor(() => expect(pendingNames()).toHaveLength(3));
    await user.upload(picker(), sizedFile("t.txt", 1));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("t.txt");
    expect(alert.textContent).toContain("添付の合計は200MBまでです");
    expect(pendingNames()).toHaveLength(3);
  });
});

describe("#140 AC-1（1-6 AC-1・AC-6）送信", () => {
  it("#140 AC-1: 送信すると、通常の投稿用の入口に1件ずつアップロードし、全部成功してから attachmentIds を付けて投稿する。一覧は空になる", async () => {
    const { user, api } = renderRoom();
    await user.upload(picker(), sizedFile("a.pdf", 10));
    await user.upload(picker(), sizedFile("画像.png", 10));
    await user.type(box(), "[[E2E_TEST]添付つき");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(api.messagePosts).toHaveLength(1));
    expect(api.uploads.map((u) => [u.entry, u.targetId, u.name])).toEqual([
      ["room", ROOM_ID, "a.pdf"],
      ["room", ROOM_ID, "画像.png"],
    ]);
    expect(api.messagePosts[0]?.body).toMatchObject({
      body: "[E2E_TEST]添付つき",
      attachmentIds: [uploadedId(1), uploadedId(2)],
    });
    await waitFor(() => expect(pendingNames()).toEqual([]));
  });

  it("#140 AC-1: どれかのアップロードが失敗したら投稿せず、失敗したファイル名と理由を出し、一覧は残す", async () => {
    const { user, api } = renderRoom();
    api.failNames.add("bad.pdf");
    await user.upload(picker(), sizedFile("ok.pdf", 10));
    await user.upload(picker(), sizedFile("bad.pdf", 10));
    await user.type(box(), "[[E2E_TEST]失敗");
    await user.click(screen.getByRole("button", { name: "送信" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("bad.pdf");
    expect(alert.textContent).toContain("アップロードできませんでした");
    expect(api.messagePosts).toEqual([]);
    expect(pendingNames()).toHaveLength(2);
  });

  it("#140 AC-1: 送信中に「送信を取り消す」を押すと、投稿しない", async () => {
    const { user, api } = renderRoom();
    api.holdNames.add("slow.pdf");
    await user.upload(picker(), sizedFile("slow.pdf", 10));
    await user.type(box(), "[[E2E_TEST]取り消し");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await user.click(
      await screen.findByRole("button", { name: "送信を取り消す" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "送信" })
          .disabled,
      ).toBe(false),
    );
    api.release();
    expect(api.messagePosts).toEqual([]);
    expect(pendingNames()).toHaveLength(1);
  });
});

describe("#140 AC-1（1-6 AC-2・AC-7）メッセージの添付の表示", () => {
  const attachment = (
    n: number,
    name: string,
    kind: TestAttachment["kind"],
    contentType: string,
  ): TestAttachment => ({
    id: uploadedId(n),
    name,
    kind,
    contentType,
    size: 10,
  });

  it("#140 AC-1: 画像は img、動画は video（controls）、そのほかは名前のダウンロードのリンクで、どれも /api/attachments/:id を指す", async () => {
    const { container } = renderRoom([
      message(1, {
        attachments: [
          attachment(1, "写真.png", "image", "image/png"),
          attachment(2, "動画.mp4", "video", "video/mp4"),
          attachment(3, "資料.pdf", "document", "application/pdf"),
        ],
      }),
    ]);
    const image = await screen.findByRole("img", { name: "写真.png" });
    expect(image.getAttribute("src")).toBe(`/api/attachments/${uploadedId(1)}`);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.getAttribute("src")).toBe(
      `/api/attachments/${uploadedId(2)}`,
    );
    const link = screen.getByRole("link", { name: /資料\.pdf/ });
    expect(link.getAttribute("href")).toBe(`/api/attachments/${uploadedId(3)}`);
  });

  it("#140 AC-1（1-6 AC-2）: 削除済みの投稿には添付を出さない", async () => {
    const { container } = renderRoom([
      message(1, { body: "[E2E_TEST]残る投稿" }),
      message(2, {
        body: null,
        deleted: true,
        attachments: [attachment(4, "消えた.png", "image", "image/png")],
      }),
    ]);
    await screen.findByText("[E2E_TEST]残る投稿");
    expect(screen.queryByRole("img", { name: "消えた.png" })).toBeNull();
    expect(container.querySelector('[src*="/api/attachments/"]')).toBeNull();
  });
});
