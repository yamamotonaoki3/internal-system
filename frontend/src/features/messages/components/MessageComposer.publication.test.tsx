// #148（148-B-2）5-2 AC-8・D2・D3、計画 6.8「入力欄」：入力欄（MessageComposer）で、添付ごとに公開範囲を選べる（設定 publication を渡したときだけ）。
// features/messages は業務（案件）を知らない。選択肢・既定値・案内は、使う側（features/cases・pages）が props で渡す。
// この層で確かめるもの：publication を渡したときだけ、ファイルごとに選択欄（名前「{ファイル名} の公開範囲」）と案内（1つ）。初期値は既定値（参加者限定）。
//   選んだ値がファイルごとにアップロードのクエリ publicationVisibility に乗る（MSW で要求を見る）。ファイルを取り消すと対応する選択も消え、ほかの選択は保たれる。
//   送信中は選択欄も無効。渡さないと選択欄も案内もなく、クエリも付かない（全部屋の共通の部品の退行なし）。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//   MessageComposer の props publication?: { options: { value, label }[]; defaultValue; hint }（AttachmentPublicationConfig）
//   選択欄は combobox（共通部品の Select）。名前「{ファイル名} の公開範囲」。選択肢の名前は options の label。
// データは架空（testuser_・[E2E_TEST]）。
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  respondAttachments,
  sizedFile,
} from "../../../test/attachment-handlers";
import { ROOM_ID, respondMessages } from "../../../test/message-handlers";
import { renderInApp, respondSelf } from "../../../test/thread-harness";
import { MessageComposer } from "./MessageComposer";

const HINT = "全社員公開が承認されるまでは、参加者だけが見られます";
const LIMITED = "参加者限定";
const PUBLIC = "全社員公開アーカイブで公開できる";

const PUBLICATION = {
  options: [
    { value: "participants_only", label: LIMITED },
    { value: "public_archive", label: PUBLIC },
  ],
  defaultValue: "participants_only",
  hint: HINT,
} as const;

function build(withPublication: boolean) {
  respondSelf();
  respondMessages([]);
  const api = respondAttachments();
  const view = renderInApp(
    withPublication ? (
      <MessageComposer roomId={ROOM_ID} publication={PUBLICATION} />
    ) : (
      <MessageComposer roomId={ROOM_ID} />
    ),
  );
  return { ...view, api };
}

const picker = () => screen.getByLabelText("ファイルを添付");
const selectOf = (name: string) =>
  screen.getByRole("combobox", {
    name: `${name} の公開範囲`,
  });

describe("#148 AC-8 入力欄の公開範囲（publication を渡したとき）", () => {
  it("#148 AC-8 D2・D3: ファイルごとに選択欄が出て、初期値は参加者限定。案内は1つ", async () => {
    const { user } = build(true);
    await user.upload(picker(), [
      sizedFile("a148.txt", 10),
      sizedFile("b148.txt", 10),
    ]);
    await waitFor(() => expect(selectOf("a148.txt")).toBeTruthy());
    for (const name of ["a148.txt", "b148.txt"]) {
      const select = selectOf(name);
      expect(valueOf(select)).toBe("participants_only");
      expect(
        within(select)
          .getAllByRole("option")
          .map((o) => [o.getAttribute("value"), o.textContent]),
      ).toEqual([
        ["participants_only", LIMITED],
        ["public_archive", PUBLIC],
      ]);
    }
    expect(screen.getAllByText(HINT)).toHaveLength(1);
  });

  it("#148 AC-8 D2: 選んだ値が、ファイルごとにアップロードのクエリに乗る", async () => {
    const { user, api } = build(true);
    await user.upload(picker(), [
      sizedFile("a148.txt", 10),
      sizedFile("b148.txt", 10),
    ]);
    await user.selectOptions(selectOf("b148.txt"), PUBLIC);
    await user.type(
      screen.getByRole("textbox", { name: "メッセージ" }),
      "[[E2E_TEST]148",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(api.messagePosts).toHaveLength(1));
    expect(api.uploads.map((u) => [u.name, u.publicationVisibility])).toEqual([
      ["a148.txt", "participants_only"],
      ["b148.txt", "public_archive"],
    ]);
  });

  it("#148 AC-8: ファイルを取り消すと、その選択欄も消え、残りのファイルの選択は保たれる", async () => {
    const { user } = build(true);
    await user.upload(picker(), [
      sizedFile("a148.txt", 10),
      sizedFile("b148.txt", 10),
    ]);
    await user.selectOptions(selectOf("b148.txt"), PUBLIC);
    await user.click(
      screen.getByRole("button", { name: "a148.txt を取り消す" }),
    );
    expect(
      screen.queryByRole("combobox", { name: "a148.txt の公開範囲" }),
    ).toBeNull();
    expect(valueOf(selectOf("b148.txt"))).toBe("public_archive");
  });

  it("#148 AC-8: 送信中は選択欄も無効", async () => {
    const { user, api } = build(true);
    api.holdNames.add("a148.txt");
    await user.upload(picker(), sizedFile("a148.txt", 10));
    await user.type(
      screen.getByRole("textbox", { name: "メッセージ" }),
      "[[E2E_TEST]148",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(api.uploads).toHaveLength(1));
    expect(selectOf("a148.txt").hasAttribute("disabled")).toBe(true);
    api.release();
    await waitFor(() => expect(api.messagePosts).toHaveLength(1));
  });

  it("#148 AC-8: ファイルを選ぶ前は、案内も選択欄も出ない", () => {
    build(true);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
  });
});

describe("#148 AC-8 退行なし（publication を渡さないとき：通常のチャンネル・DM）", () => {
  it("#148 AC-8: 選択欄も案内も出ず、アップロードにクエリが付かない", async () => {
    const { user, api } = build(false);
    await user.upload(picker(), sizedFile("a148.txt", 10));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
    await user.type(
      screen.getByRole("textbox", { name: "メッセージ" }),
      "[[E2E_TEST]148",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(api.messagePosts).toHaveLength(1));
    expect(api.uploads.map((u) => u.publicationVisibility)).toEqual([null]);
  });
});

/** 選択欄のいまの値 */
function valueOf(element: HTMLElement): string {
  return (element as unknown as { value: string }).value;
}
