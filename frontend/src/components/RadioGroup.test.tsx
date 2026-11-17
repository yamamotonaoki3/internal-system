// #147（147-A）コードレビュー1回目（軽微。ADR-0015）：共通の RadioGroup。radiogroup の名前・選択の表示・クリックと矢印キーでの選択・disabled・
// className を受け取らないこと（型）を確かめる。データは架空。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { RadioGroup } from "./RadioGroup";

type Scope = "joined" | "all";
const OPTIONS = [
  { value: "joined", label: "自分が参加する案件" },
  { value: "all", label: "すべての案件" },
] as const satisfies readonly { value: Scope; label: string }[];

function renderGroup(props: Partial<{ value: Scope; disabled: boolean }> = {}) {
  const onChange = vi.fn<(value: Scope) => void>();
  render(
    <RadioGroup<Scope>
      label="表示する案件"
      options={OPTIONS}
      value={props.value ?? "joined"}
      onChange={onChange}
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

const radio = (name: string) =>
  screen.getByRole("radio", { name }) as HTMLInputElement;

describe("#147 RadioGroup", () => {
  it("#147 ADR-0015: radiogroup の名前が label で、選択肢ごとにラベル付きのラジオを出す", () => {
    renderGroup();
    const group = screen.getByRole("radiogroup", { name: "表示する案件" });
    expect(group.querySelectorAll("input[type=radio]")).toHaveLength(2);
    expect(radio("自分が参加する案件")).toBeTruthy();
    expect(radio("すべての案件")).toBeTruthy();
  });

  it("#147: value の選択肢だけが選ばれた表示になる", () => {
    renderGroup({ value: "all" });
    expect(radio("すべての案件").checked).toBe(true);
    expect(radio("自分が参加する案件").checked).toBe(false);
  });

  it("#147: クリックすると、選んだ値で onChange を呼ぶ", async () => {
    const { onChange, user } = renderGroup();
    await user.click(radio("すべての案件"));
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("#147: 矢印キーで選択を移すと、移った先の値で onChange を呼ぶ", async () => {
    const { onChange, user } = renderGroup();
    radio("自分が参加する案件").focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("#147: disabled のときは、クリックしても選べず onChange を呼ばない", async () => {
    const { onChange, user } = renderGroup({ disabled: true });
    expect(radio("すべての案件").disabled).toBe(true);
    await user.click(radio("すべての案件"));
    expect(onChange).not.toHaveBeenCalled();
    expect(radio("自分が参加する案件").checked).toBe(true);
  });

  it("#147 ADR-0015: className を受け取らない（型）", () => {
    type Props = ComponentProps<typeof RadioGroup<Scope>>;
    expectTypeOfNoClassName<Props>(true);
  });
});

/** Props に className のキーがなければ true だけを受け付ける（型の確認。値は使わない） */
function expectTypeOfNoClassName<P>(
  ok: "className" extends keyof P ? never : true,
) {
  expect(ok).toBe(true);
}
