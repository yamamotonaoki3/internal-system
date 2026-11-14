// #134 AC-2（1-5 AC-8）: 生の HTML を使わせる仕組み（rehype-raw）と rehype-sanitize を入れない設計を、ルールとして固定する（ADR-0026）。
// あわせて、マークダウンの部品が HTML の文字列を挿入する経路（dangerouslySetInnerHTML）を持たないことを確かめる（Skill「frontend」「security」）。
// テストはリポジトリのルートで実行される（vitest.config.ts の位置）。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
const declared = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];

describe("#134 AC-2（1-5 AC-8）生の HTML を通す仕組みを入れない", () => {
  it.each(["rehype-raw", "rehype-sanitize"])(
    "#134 AC-2（1-5 AC-8）: package.json に %s がない",
    (name) => {
      expect(declared).not.toContain(name);
    },
  );

  it("#134 AC-2（1-5 AC-8）: マークダウンの描画に使うライブラリ（react-markdown・remark-gfm）は、版を固定して入っている", () => {
    const dependencies = pkg.dependencies ?? {};
    expect(dependencies["react-markdown"]).toBe("10.1.0");
    expect(dependencies["remark-gfm"]).toBe("4.0.1");
  });

  it("#134 AC-2（1-5 AC-3）: メッセージの機能のコード（テストを除く）は dangerouslySetInnerHTML・rehype-raw を使わない", () => {
    const base = "frontend/src/features/messages";
    const files = readdirSync(base, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\./.test(file))
      .map((file) => join(base, file));
    expect(files.length).toBeGreaterThan(0);
    // マークダウンの部品が実在すること（中身を確かめずに通らないように）
    expect(
      files.some((file) =>
        file.replace(/\\/g, "/").endsWith("markdown/MarkdownBody.tsx"),
      ),
    ).toBe(true);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("dangerouslySetInnerHTML");
      expect(source, file).not.toContain("rehype-raw");
    }
  });
});
