// #150（150-C）#308：useCaseAccessLoss の「確かめ・後片付けを重ねない印」は、参加者に戻ったと分かったときだけ外す。
//   (i) 参加者のまま、拒否（403）を受けて確かめた結果が参加者なら、依存の値（onLost の参照）が変わって効果が走り直しても、
//       次の拒否で概要を取り直さない（参加者のままの 403 で、確かめが循環しないため）
//   (ii) 非参加 → 参加者に戻ったときは印を外し、次の拒否で確かめ直す（(i) の確認が空振りしていないことの裏付け）
// キーは期待の独立のため、配列で直接書く。データは架空（[UNIT_TEST]）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useCaseAccessLoss } from "./useCaseAccessLoss";

const USER = "01JTESTUSER150C000000000U1";
const CASE = "01JTESTCASE150C00000000001";
const SUMMARY = ["cases", "summary", USER, CASE] as const;
const TODOS = ["cases", "todos", USER, CASE] as const;

const forbidden = {
  status: 403,
  code: "FORBIDDEN",
  message: "[UNIT_TEST]参加者だけが見られます",
};

async function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let summaryCalls = 0;
  await client.fetchQuery({
    queryKey: [...SUMMARY],
    queryFn: async () => {
      summaryCalls += 1;
      return { isParticipant: true };
    },
  });
  summaryCalls = 0;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    ({
      isParticipant,
      onLost,
    }: {
      isParticipant: boolean;
      onLost: () => void;
    }) =>
      useCaseAccessLoss({
        caseId: CASE,
        userId: USER,
        roomId: null,
        isParticipant,
        onLost,
      }),
    {
      wrapper,
      initialProps: { isParticipant: true, onLost: () => undefined },
    },
  );
  /** 見張っている TODO の一覧の取得が 403 になる */
  async function deny() {
    await expect(
      client.fetchQuery({
        queryKey: [...TODOS],
        queryFn: () => Promise.reject(forbidden),
        staleTime: 0,
      }),
    ).rejects.toBe(forbidden);
  }
  return { client, ...view, deny, summaryCalls: () => summaryCalls };
}

/** 確かめが走るなら、非同期で概要を取り直す。走らないことを確かめるため、取り直しが済む程度に待つ */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("#150 #308 確かめの印は、参加者に戻ったときだけ外す", () => {
  it("#150 #308 (i): 参加者のまま、onLost の参照が変わって効果が走り直しても、同じ参加の期間の次の拒否では概要を取り直さない", async () => {
    const { rerender, deny, summaryCalls } = await setup();
    await deny();
    await waitFor(() => expect(summaryCalls()).toBe(1));
    rerender({ isParticipant: true, onLost: () => undefined });
    rerender({ isParticipant: true, onLost: () => undefined });
    await deny();
    await settle();
    expect(summaryCalls()).toBe(1);
  });

  it("#150 #308 (ii): 非参加 → 参加者に戻ったときは、次の拒否で確かめ直す", async () => {
    const { rerender, deny, summaryCalls } = await setup();
    const onLost = () => undefined;
    rerender({ isParticipant: true, onLost });
    await deny();
    await waitFor(() => expect(summaryCalls()).toBe(1));
    rerender({ isParticipant: false, onLost });
    rerender({ isParticipant: true, onLost });
    await deny();
    await waitFor(() => expect(summaryCalls()).toBe(2));
  });
});
