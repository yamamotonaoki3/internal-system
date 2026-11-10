import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientForm } from "./ClientForm";

function renderForm(rejection?: Record<string, unknown>) {
  const onSave = vi.fn(async () => {
    if (rejection) throw rejection;
  });
  render(<ClientForm onSave={onSave} onCancel={vi.fn()} />);
  return onSave;
}

async function submitValidValues(onSave: ReturnType<typeof vi.fn>) {
  fireEvent.change(screen.getByLabelText("取引先コード"), {
    target: { value: "ABC" },
  });
  fireEvent.change(screen.getByLabelText("取引先名"), {
    target: { value: "[UNIT_TEST_207]取引先" },
  });
  fireEvent.click(screen.getByRole("button", { name: "登録" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
}

describe("#207 AC-1: ClientForm の保存失敗の示し方", () => {
  it("#207 AC-1: 新規登録のフォームは、コードと名前が空で始まる", () => {
    renderForm();
    expect(
      (screen.getByLabelText("取引先コード") as HTMLInputElement).value,
    ).toBe("");
    expect((screen.getByLabelText("取引先名") as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("#207 AC-1: 422 でも項目がなければ、全体の失敗として示す", async () => {
    const onSave = renderForm({ status: 422, code: "VALIDATION_ERROR" });
    await submitValidValues(onSave);
    expect((await screen.findByRole("alert")).textContent).toMatch(/\S/);
    expect(
      screen.getByLabelText("取引先名").getAttribute("aria-invalid"),
    ).not.toBe("true");
    expect(
      screen.getByLabelText("取引先コード").getAttribute("aria-invalid"),
    ).not.toBe("true");
  });

  it("#207 AC-1: 422 で項目が空の配列でも、全体の失敗として示す", async () => {
    const onSave = renderForm({
      status: 422,
      code: "VALIDATION_ERROR",
      fields: [],
    });
    await submitValidValues(onSave);
    expect((await screen.findByRole("alert")).textContent).toMatch(/\S/);
    expect(
      screen.getByLabelText("取引先名").getAttribute("aria-invalid"),
    ).not.toBe("true");
    expect(
      screen.getByLabelText("取引先コード").getAttribute("aria-invalid"),
    ).not.toBe("true");
  });

  it("#207 AC-1: 409 で項目があっても、欄のエラーにせず全体の失敗として示す", async () => {
    const onSave = renderForm({
      status: 409,
      code: "CONFLICT",
      message: "[UNIT_TEST_207]重複",
      fields: ["name"],
    });
    await submitValidValues(onSave);
    expect((await screen.findByRole("alert")).textContent).toMatch(/\S/);
    expect(
      screen.getByLabelText("取引先名").getAttribute("aria-invalid"),
    ).not.toBe("true");
    expect(
      screen.getByLabelText("取引先コード").getAttribute("aria-invalid"),
    ).not.toBe("true");
  });

  it("#207 AC-1: 500 は全体の失敗として示す", async () => {
    const onSave = renderForm({ status: 500, code: "INTERNAL_ERROR" });
    await submitValidValues(onSave);
    expect((await screen.findByRole("alert")).textContent).toMatch(/\S/);
    expect(
      screen.getByLabelText("取引先名").getAttribute("aria-invalid"),
    ).not.toBe("true");
    expect(
      screen.getByLabelText("取引先コード").getAttribute("aria-invalid"),
    ).not.toBe("true");
  });

  it("#207 AC-1: 422 の項目のエラーは、サーバーの文言が空でも欄に示す", async () => {
    const onSave = renderForm({
      status: 422,
      code: "VALIDATION_ERROR",
      message: "",
      fields: ["name"],
    });
    await submitValidValues(onSave);
    await waitFor(() =>
      expect(
        screen.getByLabelText("取引先名").getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("#207 AC-1: 409 でサーバーの文言が空でも、空でない案内を示す", async () => {
    const onSave = renderForm({ status: 409, code: "CONFLICT", message: "" });
    await submitValidValues(onSave);
    expect((await screen.findByRole("alert")).textContent).toMatch(/\S/);
  });
});
