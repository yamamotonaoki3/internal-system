// #171 AC-3: デザイントークンの色が、実際に接する組み合わせでコントラスト比の基準（WCAG 2.x AA）を満たすこと。
// 値は index.css（@theme）から読む。トークンが見つからなければ失敗にする（基準を黙って飛ばさない）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// テストはリポジトリのルートで実行される（vitest.config.ts の位置）
const css = readFileSync("frontend/src/styles/index.css", "utf8");

function readColorTokens(source: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of source.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined)
      tokens.set(name, value.trim());
  }
  return tokens;
}

const tokens = readColorTokens(css);

function color(name: string): string {
  const value = tokens.get(name);
  if (value === undefined)
    throw new Error(`色のトークン --color-${name} がありません`);
  if (!/^#[0-9a-fA-F]{6}$/.test(value))
    throw new Error(`--color-${name} は 6桁の16進で書いてください: ${value}`);
  return value;
}

function channel(hex: string, start: number): number {
  const c = parseInt(hex.slice(start, start + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  return (
    0.2126 * channel(hex, 1) +
    0.7152 * channel(hex, 3) +
    0.0722 * channel(hex, 5)
  );
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

// [前景, 背景, 最低の比, 理由]
const pairs: [string, string, number, string][] = [
  ["text", "bg", 4.5, "本文×画面の地"],
  ["text", "surface", 4.5, "本文×パネル"],
  ["text-muted", "bg", 4.5, "補足の文字×画面の地"],
  ["text-muted", "surface", 4.5, "補足の文字×パネル"],
  ["on-primary", "primary", 4.5, "主ボタンの文字"],
  ["on-primary", "primary-hover", 4.5, "主ボタン（hover）の文字"],
  ["primary", "bg", 4.5, "リンク×画面の地"],
  ["primary", "surface", 4.5, "リンク×パネル"],
  ["danger", "bg", 4.5, "エラーの文字×画面の地"],
  ["danger", "surface", 4.5, "エラーの文字×パネル"],
  ["danger", "danger-bg", 4.5, "エラーの文字×エラーの地"],
  ["warning-text", "warning-bg", 4.5, "警告の文字"],
  ["info-text", "info-bg", 4.5, "情報の文字"],
  ["border-strong", "bg", 3, "入力欄の枠×画面の地"],
  ["border-strong", "surface", 3, "入力欄の枠×パネル"],
  // 輪郭は outline-offset で外側に出るので、隣り合うのはすき間の背景（primary の地とは接しない）
  ["focus", "bg", 3, "フォーカスの輪郭×画面の地"],
  ["focus", "surface", 3, "フォーカスの輪郭×パネル"],
  ["disabled-text", "disabled-bg", 4.5, "無効なボタンの文字"],
];

describe("#171 AC-3 色のコントラスト比", () => {
  it("#171 AC-3: index.css から色のトークンが読み取れる", () => {
    expect(tokens.size).toBeGreaterThan(0);
  });

  it.each(pairs)(
    "#171 AC-3: --color-%s × --color-%s は %s 以上（%s）",
    (foreground, background, minimum, _reason) => {
      void _reason;
      const ratio = contrast(color(foreground), color(background));
      expect(ratio).toBeGreaterThanOrEqual(minimum);
    },
  );

  it("#171 AC-3: コントラストの計算が正しい（黒×白は21）", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("#171 AC-3: --color-* に、不透明度つきの色（8桁の16進・rgba・hsla・oklch の透過）がない", () => {
    for (const [name, value] of tokens) {
      expect(value, `--color-${name}`).not.toMatch(/^#[0-9a-fA-F]{8}$/);
      expect(value, `--color-${name}`).not.toMatch(/rgba|hsla|\//i);
    }
  });
});

describe("#171 AC-3 フォーカスの輪郭", () => {
  it("#171 AC-3: :focus-visible の規則は @layer base に1か所だけで、outline-offset が2px以上", () => {
    const base = css.slice(css.indexOf("@layer base"));
    expect(css.indexOf("@layer base")).toBeGreaterThanOrEqual(0);
    const rules = [...base.matchAll(/:focus-visible\s*\{([^}]*)\}/g)];
    expect(rules).toHaveLength(1);
    const offset = /outline-offset\s*:\s*(\d+(?:\.\d+)?)px/.exec(
      rules[0]?.[1] ?? "",
    );
    expect(offset, "outline-offset が px で書かれていること").not.toBeNull();
    expect(Number(offset?.[1])).toBeGreaterThanOrEqual(2);
  });
});
