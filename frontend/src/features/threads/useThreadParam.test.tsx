// #137 AC-1（1-4 AC-3）: useThreadParam — 開いているスレッドを URL のクエリ ?thread=<親ID> で持つ。
// 契約（実装前の仮置き。計画 plan-137 の「9. 画面」。実装者へ）：
//   features/threads/hooks/useThreadParam.ts（index.ts からも公開）。戻り値は { parentMessageId: string | null; open(id: string): void; close(): void }。
//   parentMessageId は ?thread= の値（なければ null。空文字も null）。open は thread を付け替え、ほかのクエリ・パスは変えない。close は thread だけを外す。
//   open・close は履歴を積む（戻るで前のスレッド・閉じた状態へ戻れる）。
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { useThreadParam } from "./index";

function setup(path: string) {
  return renderHook(
    () => ({ thread: useThreadParam(), location: useLocation() }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      ),
    },
  );
}

describe("#137 AC-1（1-4 AC-3）useThreadParam", () => {
  it("#137 AC-1: クエリがなければ null、あればその値", () => {
    expect(
      setup("/channels/r1").result.current.thread.parentMessageId,
    ).toBeNull();
    expect(
      setup("/channels/r1?thread=01JTESTMSG0000000000000001").result.current
        .thread.parentMessageId,
    ).toBe("01JTESTMSG0000000000000001");
    expect(
      setup("/channels/r1?thread=").result.current.thread.parentMessageId,
    ).toBeNull();
  });

  it("#137 AC-1: open は thread を付け、パスとほかのクエリは残す", () => {
    const { result } = setup("/channels/r1?tab=1");
    act(() => result.current.thread.open("01JTESTMSG0000000000000002"));
    expect(result.current.location.pathname).toBe("/channels/r1");
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get("thread")).toBe("01JTESTMSG0000000000000002");
    expect(params.get("tab")).toBe("1");
    expect(result.current.thread.parentMessageId).toBe(
      "01JTESTMSG0000000000000002",
    );
  });

  it("#137 AC-1: すでに開いているときに open すると、thread を別の親に付け替える（クエリは1つのまま）", () => {
    const { result } = setup("/channels/r1?thread=01JTESTMSG0000000000000001");
    act(() => result.current.thread.open("01JTESTMSG0000000000000002"));
    expect(
      new URLSearchParams(result.current.location.search).getAll("thread"),
    ).toEqual(["01JTESTMSG0000000000000002"]);
  });

  it("#137 AC-1: close は thread だけを外し、ほかのクエリは残す", () => {
    const { result } = setup(
      "/channels/r1?tab=1&thread=01JTESTMSG0000000000000001",
    );
    act(() => result.current.thread.close());
    expect(result.current.location.search).toBe("?tab=1");
    expect(result.current.thread.parentMessageId).toBeNull();
  });

  it("#137 AC-1: 親の ID に URL で特別な文字があっても、そのまま往復できる", () => {
    const { result } = setup("/dms/r1");
    act(() => result.current.thread.open("a&b=c d"));
    expect(result.current.thread.parentMessageId).toBe("a&b=c d");
    expect(
      new URLSearchParams(result.current.location.search).get("b"),
    ).toBeNull();
  });
});
