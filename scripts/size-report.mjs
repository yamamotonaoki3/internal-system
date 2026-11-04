// 初回表示で読み込むファイルの大きさを表示する（圧縮前と gzip level 9）。表示のみで、大きさによって失敗にはしない。
// 対象：dist/client/index.html が読み込む script・modulepreload・stylesheet と、そこから静的 import される assets/*.js。
// 動的 import（遅延読み込み）は初回に読み込まないため、別の欄に分けて示す。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const CLIENT_DIR = path.join("dist", "client");
const INDEX_HTML = path.join(CLIENT_DIR, "index.html");

if (!existsSync(INDEX_HTML)) {
  console.error(
    `${INDEX_HTML} がありません。先に npm run build を実行してください。`,
  );
  process.exit(1);
}

// "/assets/x.js" や "./x.js" を dist/client からの相対パスにする
function toFilePath(url, fromFile) {
  const clean = url.split(/[?#]/)[0];
  if (clean.startsWith("/")) return path.join(CLIENT_DIR, clean.slice(1));
  return path.join(path.dirname(fromFile), clean);
}

const html = readFileSync(INDEX_HTML, "utf8");
const initial = new Set();
for (const tag of html.match(/<(script|link)\b[^>]*>/g) ?? []) {
  const isScript = /^<script\b/.test(tag) && /\bsrc=/.test(tag);
  const rel = /\brel=["']([^"']+)["']/.exec(tag)?.[1] ?? "";
  const isLink =
    /^<link\b/.test(tag) && (rel === "modulepreload" || rel === "stylesheet");
  if (!isScript && !isLink) continue;
  const url = /\b(?:src|href)=["']([^"']+)["']/.exec(tag)?.[1];
  if (url !== undefined) initial.add(toFilePath(url, INDEX_HTML));
}

// JS の静的 import を辿る。動的 import は別に集める
const dynamic = new Set();
const queue = [...initial];
const seen = new Set();
while (queue.length > 0) {
  const file = queue.pop();
  if (seen.has(file) || !file.endsWith(".js") || !existsSync(file)) continue;
  seen.add(file);
  const code = readFileSync(file, "utf8");
  for (const m of code.matchAll(
    /(?:^|[;}\s])(?:import|export)\s*(?:[^'"()]*?from\s*)?["'](\.{0,2}\/[^"']+\.js)["']/g,
  )) {
    const dep = toFilePath(m[1], file);
    if (!initial.has(dep)) initial.add(dep);
    queue.push(dep);
  }
  for (const m of code.matchAll(
    /import\(\s*["'](\.{0,2}\/[^"']+\.js)["']\s*\)/g,
  ))
    dynamic.add(toFilePath(m[1], file));
}
for (const file of initial) dynamic.delete(file);

function measure(file) {
  if (!existsSync(file)) return { file, raw: 0, gzip: 0, missing: true };
  const buffer = readFileSync(file);
  return {
    file,
    raw: buffer.length,
    gzip: gzipSync(buffer, { level: 9 }).length,
    missing: false,
  };
}

function print(title, files) {
  console.log(`\n${title}`);
  if (files.length === 0) {
    console.log("  （なし）");
    return;
  }
  for (const f of files.map(measure))
    console.log(
      `  ${f.file.split(path.sep).join("/")}  圧縮前 ${f.raw} B / gzip ${f.gzip} B${f.missing ? "（ファイルなし）" : ""}`,
    );
}

const initialList = [...initial].sort();
const js = initialList.filter((f) => f.endsWith(".js"));
const css = initialList.filter((f) => f.endsWith(".css"));
print("初回に読み込む JS", js);
print("初回に読み込む CSS", css);
print("動的 import（初回には読み込まない）", [...dynamic].sort());

function total(files) {
  return files
    .map(measure)
    .reduce((a, f) => ({ raw: a.raw + f.raw, gzip: a.gzip + f.gzip }), {
      raw: 0,
      gzip: 0,
    });
}
const jsTotal = total(js);
const cssTotal = total(css);
console.log("\n合計");
console.log(`  JS : 圧縮前 ${jsTotal.raw} B / gzip ${jsTotal.gzip} B`);
console.log(`  CSS: 圧縮前 ${cssTotal.raw} B / gzip ${cssTotal.gzip} B`);
console.log(
  `  JS+CSS: 圧縮前 ${jsTotal.raw + cssTotal.raw} B / gzip ${jsTotal.gzip + cssTotal.gzip} B`,
);
