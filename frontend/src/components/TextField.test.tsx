// #171 AC-2: 共通の TextField（SetupForm の中にあったものを移す）。ラベル・ヒント・エラーを結び付け、ref を input に渡す。
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
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
