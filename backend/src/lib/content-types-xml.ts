// Office のファイルの [Content_Types].xml を読む（#140、C-137(1)・C-176。統括の決定）。汎用の XML の読み取りではなく、決まった形だけを受け付ける。
// 受け付ける形：XML 宣言（任意）→ 根の要素 Types（content-types の名前空間。接頭辞つきでもよい）
//   → 直下に Default・Override だけ（空要素か、中身のない開始・終了の組）。コメントと空白は読み飛ばす。
//   属性の値は二重引用符・単一引用符、順は問わない。名前空間の宣言は根の要素だけで、既定の xmlns を含めて16個まで。
// それ以外（ほかの要素・3段以上の入れ子・子の中の文字・DOCTYPE・CDATA・処理命令・属性の重複・根の後ろの余分な内容等）は null。
// 先頭の BOM は、呼び出し側の TextDecoder（UTF-8）が取り除く。XML 宣言の前の空白は XML 1.0 で許されないので拒否する
//   （宣言のない文書の、根の要素の前の空白は許す）。
// 読み取りは先頭から1回だけ進み、位置を戻さない。保持するのは根の名前空間の対応と、子の要素の一覧だけ（入力の長さに比例する）。

export const CONTENT_TYPES_NS =
  "http://schemas.openxmlformats.org/package/2006/content-types";

const MAX_NAMESPACE_DECLARATIONS = 16;
const CHILD_NAMES = new Set(["Default", "Override"]);
const DECLARATION_ATTRIBUTES = new Set(["version", "encoding", "standalone"]);

export type ContentTypeElement = {
  localName: "Default" | "Override";
  attributes: ReadonlyMap<string, string>;
};

/** 形が合わないことを伝える（この読み取りの中だけで使い、外へは null として返す） */
class Rejected extends Error {
  constructor() {
    super("[Content_Types].xml の形が決まった形と違います");
    this.name = "Rejected";
  }
}

const isSpace = (char: string | undefined) =>
  char === " " || char === "\t" || char === "\n" || char === "\r";
const isNameStart = (char: string | undefined) =>
  char !== undefined && /[A-Za-z_]/.test(char);
const isNameChar = (char: string | undefined) =>
  char !== undefined && /[A-Za-z0-9_.-]/.test(char);

type Attributes = Map<string, string>;

function createReader(xml: string) {
  let pos = 0;
  const fail = (): never => {
    throw new Rejected();
  };
  const at = (text: string) => xml.startsWith(text, pos);
  const expect = (text: string) => {
    if (!at(text)) fail();
    pos += text.length;
  };
  const skipSpaces = () => {
    while (isSpace(xml[pos])) pos += 1;
  };
  /** 空白とコメントを読み飛ばす */
  const skipMisc = () => {
    for (;;) {
      skipSpaces();
      if (!at("<!--")) return;
      const close = xml.indexOf("-->", pos + 4);
      if (close < 0) fail();
      pos = close + 3;
    }
  };
  /** 名前（接頭辞があれば「接頭辞:名前」） */
  const readName = () => {
    const start = pos;
    if (!isNameStart(xml[pos])) fail();
    while (isNameChar(xml[pos])) pos += 1;
    if (xml[pos] === ":") {
      pos += 1;
      if (!isNameStart(xml[pos])) fail();
      while (isNameChar(xml[pos])) pos += 1;
    }
    return xml.slice(start, pos);
  };
  /** タグの終わり（end のどれか）までの属性。値に「<」「&」は許さない。重複は拒否 */
  const readAttributes = (
    ends: readonly string[],
    onAttribute: (name: string) => void,
  ): { attributes: Attributes; end: string } => {
    const attributes: Attributes = new Map();
    for (;;) {
      const hadSpace = isSpace(xml[pos]);
      skipSpaces();
      const end = ends.find((candidate) => at(candidate));
      if (end !== undefined) {
        pos += end.length;
        return { attributes, end };
      }
      if (!hadSpace) fail();
      const name = readName();
      skipSpaces();
      expect("=");
      skipSpaces();
      const quote = xml[pos];
      if (quote !== '"' && quote !== "'") fail();
      const close = xml.indexOf(quote as string, pos + 1);
      if (close < 0) fail();
      const value = xml.slice(pos + 1, close);
      if (value.includes("<") || value.includes("&")) fail();
      if (attributes.has(name)) fail();
      onAttribute(name);
      attributes.set(name, value);
      pos = close + 1;
    }
  };
  return {
    fail,
    at,
    expect,
    skipSpaces,
    skipMisc,
    readName,
    readAttributes,
    atEnd: () => pos >= xml.length,
    advance: (count: number) => {
      pos += count;
    },
  };
}

type Reader = ReturnType<typeof createReader>;

const isNamespaceDeclaration = (name: string) =>
  name === "xmlns" || name.startsWith("xmlns:");

function readDeclaration(reader: Reader) {
  if (!reader.at("<?xml")) return;
  reader.advance("<?xml".length);
  const { attributes } = reader.readAttributes(["?>"], () => undefined);
  for (const name of attributes.keys())
    if (!DECLARATION_ATTRIBUTES.has(name)) reader.fail();
}

/** 名前空間の対応（接頭辞 → URI。既定は空文字）を引いて、content-types の要素の局所名を返す */
function localNameIn(namespaces: Attributes, qualified: string) {
  const colon = qualified.indexOf(":");
  const prefix = colon < 0 ? "" : qualified.slice(0, colon);
  return namespaces.get(prefix) === CONTENT_TYPES_NS
    ? qualified.slice(colon + 1)
    : null;
}

function readRoot(reader: Reader) {
  reader.expect("<");
  const name = reader.readName();
  let declarations = 0;
  const { attributes, end } = reader.readAttributes(["/>", ">"], (attr) => {
    if (!isNamespaceDeclaration(attr)) {
      // 根の属性も、名前空間の宣言のほかは接頭辞なしだけ
      if (attr.includes(":")) reader.fail();
      return;
    }
    declarations += 1;
    if (declarations > MAX_NAMESPACE_DECLARATIONS) reader.fail();
  });
  const namespaces: Attributes = new Map();
  for (const [attr, value] of attributes)
    if (isNamespaceDeclaration(attr))
      namespaces.set(attr === "xmlns" ? "" : attr.slice(6), value);
  if (localNameIn(namespaces, name) !== "Types") reader.fail();
  return { name, namespaces, closed: end === "/>" };
}

function readChild(reader: Reader, namespaces: Attributes) {
  const name = reader.readName();
  const localName = localNameIn(namespaces, name);
  if (localName === null || !CHILD_NAMES.has(localName)) reader.fail();
  // 子の属性は接頭辞なしだけ（名前空間の宣言も、解決できない接頭辞も置かせない）
  const { attributes, end } = reader.readAttributes(["/>", ">"], (attr) => {
    if (attr.includes(":") || isNamespaceDeclaration(attr)) reader.fail();
  });
  // 開始・終了の組は、中身を持たない（文字も要素も置かない）
  if (end === ">") {
    reader.expect(`</${name}`);
    reader.skipSpaces();
    reader.expect(">");
  }
  return {
    localName: localName as ContentTypeElement["localName"],
    attributes,
  };
}

function readDocument(xml: string): ContentTypeElement[] {
  const reader = createReader(xml);
  readDeclaration(reader);
  reader.skipMisc();
  const root = readRoot(reader);
  const elements: ContentTypeElement[] = [];
  if (!root.closed) {
    for (;;) {
      reader.skipMisc();
      if (reader.at("</")) break;
      reader.expect("<");
      elements.push(readChild(reader, root.namespaces));
    }
    reader.expect(`</${root.name}`);
    reader.skipSpaces();
    reader.expect(">");
  }
  reader.skipMisc();
  if (!reader.atEnd()) reader.fail();
  return elements;
}

/** 決まった形なら、根の直下の Default・Override を出てくる順に返す。形が違えば null */
export function readContentTypes(xml: string): ContentTypeElement[] | null {
  try {
    return readDocument(xml);
  } catch (error) {
    // 形が違うという判定だけを null にする。想定外の例外は投げ直す
    if (error instanceof Rejected) return null;
    throw error;
  }
}
