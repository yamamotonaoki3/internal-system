// 配信の Content-Disposition（RFC 6266・RFC 5987）。filename は ASCII に置き換えた予備、filename* が本来の名前。
// 名前は保存時に検査済みだが、ヘッダーを壊す文字（改行・「"」・「\」・制御文字）はここでも filename に出さない。

// RFC 5987 の attr-char（英数字と !#$&+-.^_`|~）以外はパーセントエンコードする
const ATTR_CHAR = /^[A-Za-z0-9!#$&+\-.^_`|~]$/;

function encodeRfc5987(name: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(name)) {
    const char = String.fromCharCode(byte);
    out +=
      byte < 0x80 && ATTR_CHAR.test(char)
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

function asciiFallback(name: string): string {
  let out = "";
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    out +=
      code >= 0x20 && code <= 0x7e && char !== '"' && char !== "\\"
        ? char
        : "_";
  }
  return out;
}

export function contentDisposition(
  name: string,
  disposition: "inline" | "attachment",
): string {
  return `${disposition}; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeRfc5987(name)}`;
}
