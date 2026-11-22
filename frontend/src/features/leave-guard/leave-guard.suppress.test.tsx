// #338 AC-2（計画 plan-338 の 5-6・7-2 の U-13）：読み込み直しを待つ間と、読み込み直しの間は、離脱の確認（beforeunload）を出さない。
// leave-guard のモジュールの印（suppressBeforeUnload・restoreBeforeUnload）が立っている間は、変更ありの見張りが beforeunload を止めない。
// 印がなければ、いまのまま止める（既存の leave-guard.test.tsx は変えない）。データは架空。
// 前提にした口（実装の担当へ）：features/leave-guard の index から suppressBeforeUnload()・restoreBeforeUnload() を公開する。
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { restoreBeforeUnload, suppressBeforeUnload, useLeaveGuard } from ".";

function DirtyInput() {
  useLeaveGuard({
    isDirty: true,
    onDiscard: () => undefined,
    focus: () => undefined,
  });
  return <p>[UNIT_TEST]338変更ありの入力</p>;
}

function fireBeforeUnload(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

afterEach(() => {
  restoreBeforeUnload();
});

describe("#338 AC-2 U-13 抑止の印の間は、beforeunload を止めない", () => {
  it("#338 AC-2 U-13: 印がなければ、変更ありの見張りは beforeunload を止める（いまのまま）", () => {
    render(<DirtyInput />);
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it("#338 AC-2 U-13: 印を立てると止めず、外すと、また止める", () => {
    render(<DirtyInput />);
    suppressBeforeUnload();
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
    restoreBeforeUnload();
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it("#338 AC-2 U-13: 印を立てた後に変更ありになった見張りも、止めない", () => {
    suppressBeforeUnload();
    render(<DirtyInput />);
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });
});
