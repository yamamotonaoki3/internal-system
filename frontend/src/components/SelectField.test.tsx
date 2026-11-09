// #199 AC-1・AC-4: 共通の SelectField（所属部署の選択欄から移したもの）。ラベル・ヒント・エラーを結び付け、ref を select に渡す。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { SelectField } from "./SelectField";

const options = (
  <>
    <option value="">選んでください</option>
    <option value="dept_a">[E2E_TEST]テスト部A</option>
    <option value="dept_b">[E2E_TEST]テスト部B</option>
  </>
);

describe("#199 SelectField", () => {
  it("#199 AC-1: ラベルで選択欄を探せる（combobox の名前になる）", () => {
    render(<SelectField label="所属部署">{options}</SelectField>);
    expect(screen.getByLabelText("所属部署").tagName).toBe("SELECT");
    expect(screen.getByRole("combobox", { name: "所属部署" })).toBeTruthy();
  });

  it("#199 AC-4: 選択肢を1つ選べる（単一選択）", async () => {
    const user = userEvent.setup();
    render(<SelectField label="所属部署">{options}</SelectField>);
    const element = screen.getByLabelText("所属部署");
    await user.selectOptions(element, "dept_b");
    const select = element as unknown as HTMLSelectElement;
    expect(select.value).toBe("dept_b");
    expect(select.multiple).toBe(false);
  });

  it("#199 AC-1: ヒントだけのとき、aria-describedby はヒントを指し、aria-invalid は付かない", () => {
    render(
      <SelectField label="所属部署" hint="有効な部署から選びます">
        {options}
      </SelectField>,
    );
    const select = screen.getByLabelText("所属部署");
    const hint = screen.getByText("有効な部署から選びます");
    expect(select.getAttribute("aria-describedby")).toBe(hint.id);
    expect(select.getAttribute("aria-invalid")).toBeNull();
  });

  it("#199 AC-1: エラーのとき aria-invalid=true で、aria-describedby はエラーを指す", () => {
    render(
      <SelectField label="所属部署" error="部署を選んでください">
        {options}
      </SelectField>,
    );
    const select = screen.getByLabelText("所属部署");
    const error = screen.getByText("部署を選んでください");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(select.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("#199 AC-1: ヒントとエラーの両方があるとき、aria-describedby はヒント→エラーの順", () => {
    render(
      <SelectField label="所属部署" hint="1つ選びます" error="部署が未選択です">
        {options}
      </SelectField>,
    );
    const select = screen.getByLabelText("所属部署");
    const hint = screen.getByText("1つ選びます");
    const error = screen.getByText("部署が未選択です");
    expect(select.getAttribute("aria-describedby")).toBe(
      `${hint.id} ${error.id}`,
    );
  });

  it("#199 AC-1: ヒントもエラーも無いとき、aria-describedby は付かない", () => {
    render(<SelectField label="所属部署">{options}</SelectField>);
    expect(
      screen.getByLabelText("所属部署").getAttribute("aria-describedby"),
    ).toBeNull();
  });

  it("#199 AC-1: 複数の欄で id が重ならない", () => {
    render(
      <>
        <SelectField label="一つ目">{options}</SelectField>
        <SelectField label="二つ目">{options}</SelectField>
      </>,
    );
    expect(screen.getByLabelText("一つ目").id).not.toBe(
      screen.getByLabelText("二つ目").id,
    );
  });

  it("#199 AC-1: ref が select に渡る（react-hook-form の register が使える）", () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <SelectField label="参照" ref={ref}>
        {options}
      </SelectField>,
    );
    expect(ref.current).toBe(screen.getByLabelText("参照"));
  });

  it("#199 AC-1: className は型として受け取らない（呼び出し側で見た目を上書きさせない）", () => {
    render(
      // @ts-expect-error className は Props から除いてある
      <SelectField label="型" className="x">
        {options}
      </SelectField>,
    );
    expect(screen.getByLabelText("型")).toBeDefined();
  });
});
