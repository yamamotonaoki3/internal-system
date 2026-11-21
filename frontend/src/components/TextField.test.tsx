// #171 AC-2: 共通の TextField（SetupForm の中にあったものを移す）。ラベル・ヒント・エラーを結び付け、ref を input に渡す。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { TextField } from "./TextField";

describe("#171 AC-2 TextField", () => {
  it("#171 AC-2: ラベルで入力欄を探せる", () => {
    render(<TextField label="会社名" name="companyName" />);
    expect(screen.getByLabelText("会社名").tagName).toBe("INPUT");
  });

  it("#171 AC-2: ヒントだけのとき、aria-describedby はヒントを指し、aria-invalid は付かない", () => {
    render(<TextField label="部署名" hint="所属する部署です" />);
    const input = screen.getByLabelText("部署名");
    const hint = screen.getByText("所属する部署です");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("#171 AC-2: エラーのとき aria-invalid=true で、aria-describedby はエラーを指す", () => {
    render(<TextField label="社員ID" error="入力してください" />);
    const input = screen.getByLabelText("社員ID");
    const error = screen.getByText("入力してください");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("#171 AC-2: ヒントとエラーの両方があるとき、aria-describedby はヒント→エラーの順", () => {
    render(<TextField label="本名" hint="1〜30文字" error="長すぎます" />);
    const input = screen.getByLabelText("本名");
    const hint = screen.getByText("1〜30文字");
    const error = screen.getByText("長すぎます");
    expect(input.getAttribute("aria-describedby")).toBe(
      `${hint.id} ${error.id}`,
    );
  });

  it("#171 AC-2: ヒントもエラーも無いとき、aria-describedby は付かない", () => {
    render(<TextField label="役職" />);
    expect(
      screen.getByLabelText("役職").getAttribute("aria-describedby"),
    ).toBeNull();
  });

  it("#171 AC-2: 複数の欄で id が重ならない", () => {
    render(
      <>
        <TextField label="一つ目" />
        <TextField label="二つ目" />
      </>,
    );
    expect(screen.getByLabelText("一つ目").id).not.toBe(
      screen.getByLabelText("二つ目").id,
    );
  });

  it("#171 AC-2: type・autoComplete などの属性を input に渡す", () => {
    render(<TextField label="メール" type="email" autoComplete="off" />);
    const input = screen.getByLabelText("メール");
    expect(input.getAttribute("type")).toBe("email");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });

  it("#171 AC-2: ref が input に渡る（react-hook-form の register が使える）", () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField label="参照" ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText("参照"));
  });
});

// #337 AC-2: hideLabel。ラベルを画面から隠しても、label 要素は残し、入力欄と結び付ける（aria-label にしない）。
// 視覚的な非表示（寸法・切り取り）と余白は jsdom では分からないため E2E（e2e/search.spec.ts）で確かめる。クラス名では確かめない。
describe("#337 AC-2 TextField hideLabel", () => {
  it("#337 AC-2: hideLabel のとき、label 要素が残り、for で入力欄に結び付く。hideLabel は input の属性として漏れない（React の警告が出ない）", () => {
    const consoleError = vi.spyOn(console, "error");
    render(<TextField label="検索する言葉" type="search" hideLabel />);
    const input = screen.getByRole("searchbox", { name: "検索する言葉" });
    expect(screen.getByLabelText("検索する言葉")).toBe(input);
    const label = screen.getByText("検索する言葉");
    expect(label.tagName).toBe("LABEL");
    expect(label.getAttribute("for")).toBe(input.id);
    expect(input.getAttribute("aria-label")).toBeNull();
    expect(input.hasAttribute("hidelabel")).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("#337 AC-2: hideLabel のとき、エラーは aria-describedby でエラーの文と結び付き、aria-invalid=true になる", () => {
    render(
      <TextField
        label="検索する言葉"
        type="search"
        hideLabel
        error="検索する言葉を入力してください"
      />,
    );
    const input = screen.getByRole("searchbox", { name: "検索する言葉" });
    const error = screen.getByText("検索する言葉を入力してください");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("#337 AC-2: hideLabel のとき、ヒントとエラーの両方があっても、aria-describedby はヒント→エラーの順で結び付く", () => {
    render(
      <TextField
        label="検索する言葉"
        type="search"
        hideLabel
        hint="100文字まで"
        error="長すぎます"
      />,
    );
    const input = screen.getByRole("searchbox", { name: "検索する言葉" });
    const hint = screen.getByText("100文字まで");
    const error = screen.getByText("長すぎます");
    expect(input.getAttribute("aria-describedby")).toBe(
      `${hint.id} ${error.id}`,
    );
  });

  it("#337 AC-2: hideLabel のとき、type・ref・値の入力は、これまでどおり input に届く", async () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <TextField label="検索する言葉" type="search" hideLabel ref={ref} />,
    );
    const input = screen.getByRole("searchbox", { name: "検索する言葉" });
    expect(ref.current).toBe(input);
    await userEvent.type(input, "見積書");
    expect((input as HTMLInputElement).value).toBe("見積書");
  });

  it("#337 AC-2: hideLabel={false} は、渡さないときと同じ DOM（既存の使用箇所の見た目が変わらない）", () => {
    const consoleError = vi.spyOn(console, "error");
    const omitted = render(<TextField label="会社名" name="c" />);
    const omittedHtml = omitted.container.innerHTML.replace(
      /(id|for)="[^"]*"/g,
      "",
    );
    omitted.unmount();
    const explicit = render(
      <TextField label="会社名" name="c" hideLabel={false} />,
    );
    expect(explicit.container.innerHTML.replace(/(id|for)="[^"]*"/g, "")).toBe(
      omittedHtml,
    );
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// #337 AC-2: 既定（hideLabel なし）は、今のまま。ラベルは画面に出て、入力欄と結び付く
describe("#337 AC-2 TextField 既定", () => {
  it("#337 AC-2: hideLabel なしでも、ラベルと入力欄が結び付き、名前で引ける", () => {
    render(<TextField label="会社名" />);
    const input = screen.getByRole("textbox", { name: "会社名" });
    expect(screen.getByLabelText("会社名")).toBe(input);
    expect(screen.getByText("会社名").getAttribute("for")).toBe(input.id);
  });
});
