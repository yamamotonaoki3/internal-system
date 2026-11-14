// #134 AC-2（ADR-0026「読み込みに失敗したときの扱い」・C-171(9)）: MessageBodyBoundary と MarkdownLoadError。データは架空。
// 契約：
//   MarkdownLoadError は、整形の部品の動的読み込みの失敗を、描画中の例外と区別するための専用のエラー。
//     名前（name）は "MarkdownLoadError"、メッセージは空でない（記録に残したときに何の失敗か分かる）。原因（cause）を残す。
//   MessageBodyBoundary は、子の描画の失敗を受け止め、その本文だけを書いたままの文字と案内に替える。
//     MarkdownLoadError のときは「書式つきの表示を読み込めませんでした。再読み込みしてください。」、
//     それ以外（Error でない値・null・undefined が投げられたときも）は「この本文は書式つきで表示できませんでした。」を出す。例外の詳細は出さない。
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownLoadError, MessageBodyBoundary } from "./MessageBodyBoundary";

const LOAD_NOTICE =
  "書式つきの表示を読み込めませんでした。再読み込みしてください。";
const RENDER_NOTICE = "この本文は書式つきで表示できませんでした。";
const BODY = "[E2E_TEST]一行目\n**二行目**";

function Thrower({ value }: { value: unknown }): never {
  throw value;
}

function renderWith(thrown: unknown) {
  return render(
    <MessageBodyBoundary body={BODY}>
      <Thrower value={thrown} />
    </MessageBodyBoundary>,
  );
}

beforeEach(() => {
  // React が、境界で受け止めた例外を console.error に出す（このテストでは意図した失敗）
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#134 AC-2 MarkdownLoadError", () => {
  it("#134 AC-2: 名前は MarkdownLoadError で、メッセージは空でなく、原因（cause）を残す Error である", () => {
    const cause = new TypeError("Failed to fetch dynamically imported module");
    const error = new MarkdownLoadError({ cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MarkdownLoadError");
    expect(error.message).not.toBe("");
    expect(error.cause).toBe(cause);
  });
});

describe("#134 AC-2 MessageBodyBoundary", () => {
  it("#134 AC-2: 子が失敗しなければ、子をそのまま出し、案内を出さない", () => {
    render(
      <MessageBodyBoundary body={BODY}>
        <p>[E2E_TEST]整形した本文</p>
      </MessageBodyBoundary>,
    );
    expect(screen.getByText("[E2E_TEST]整形した本文")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("#134 AC-2: MarkdownLoadError のときは、本文を書いたままの文字で出し、再読み込みを勧める案内を出す", () => {
    const { container } = renderWith(new MarkdownLoadError());
    expect(container.querySelector("p")?.textContent).toBe(BODY);
    expect(screen.getByRole("status").textContent).toBe(LOAD_NOTICE);
  });

  it.each([
    ["Error", new TypeError("[E2E_TEST]描画の内部の失敗")],
    ["文字列", "[E2E_TEST]文字列の失敗"],
    ["null", null],
    ["undefined", undefined],
    ["名前だけ MarkdownLoadError の別の物", { name: "MarkdownLoadError" }],
  ])(
    "#134 AC-2: %s が投げられたときは、本文を書いたままの文字で出し、書式つきで表示できなかった案内を出す（詳細は出さない）",
    (_label, thrown) => {
      const { container } = renderWith(thrown);
      expect(container.querySelector("p")?.textContent).toBe(BODY);
      expect(screen.getByRole("status").textContent).toBe(RENDER_NOTICE);
      expect(container.textContent).not.toContain("内部の失敗");
      expect(container.textContent).not.toContain("文字列の失敗");
    },
  );
});
