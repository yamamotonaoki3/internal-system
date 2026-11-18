// #284：描画の確定ごとに、前の利用者の識別の文字列が画面に出ていないかを記録する見張り（テスト用）。
// 対象の領域全体を React の Profiler で包み、onRender（中のどの部品が描画されても、確定のたびに呼ばれる）で調べる。
// 見張り自身が再描画されなくても動くため、深い子の部品だけが一度だけ前の利用者の内容を出す場合も検出できる（計画 10 の共通、T24）。
// 調べるもの：document.body の textContent、すべての input・textarea の value、aria-label（読み上げ用の名前に件数を持つ部品があるため）。
import { Profiler, type ReactNode } from "react";

export type RenderHit = {
  /** 何回目の確定か（arm の後から数える） */
  commit: number;
  /** 見つかった文字列 */
  needle: string;
  /** 見つかった場所 */
  where: "text" | "input" | "aria-label";
};

function findNeedle(needle: string): RenderHit["where"] | undefined {
  if (document.body.textContent?.includes(needle)) return "text";
  for (const field of document.querySelectorAll("input, textarea")) {
    if (
      (field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement) &&
      field.value.includes(needle)
    )
      return "input";
  }
  for (const element of document.querySelectorAll("[aria-label]")) {
    if (element.getAttribute("aria-label")?.includes(needle))
      return "aria-label";
  }
  return undefined;
}

export type RenderWatch = {
  /** 対象の領域を包む部品 */
  Watch: (props: { children: ReactNode }) => ReactNode;
  /** 以後の確定を調べ始める（切り替えの直前に呼ぶ）。呼んだ時点の画面（切り替えの前の正しい表示）は調べない */
  arm: () => void;
  /** 調べるのをやめる */
  disarm: () => void;
  /** 見つかった記録 */
  hits: RenderHit[];
  /** arm の後の確定の回数（見張りが動いたことの確認に使う） */
  commits: () => number;
  /** いまの画面を1回だけ調べる（確定を待たずに確かめたいとき） */
  inspectNow: () => void;
};

export function createRenderWatch(needles: readonly string[]): RenderWatch {
  const hits: RenderHit[] = [];
  let armed = false;
  let commits = 0;

  function inspect() {
    for (const needle of needles) {
      const where = findNeedle(needle);
      if (where !== undefined) hits.push({ commit: commits, needle, where });
    }
  }

  function onRender() {
    if (!armed) return;
    commits += 1;
    inspect();
  }

  function Watch({ children }: { children: ReactNode }) {
    return (
      <Profiler id="render-watch" onRender={onRender}>
        {children}
      </Profiler>
    );
  }

  return {
    Watch,
    arm: () => {
      armed = true;
    },
    disarm: () => {
      armed = false;
    },
    hits,
    commits: () => commits,
    inspectNow: inspect,
  };
}
