// #140 AC-1（1-6 AC-1・AC-3・AC-5）: 添付の共通規則（shared/attachment-rules.ts）を、実装とは独立した期待値で固定する。
// 期待値は要件（1-6 AC-1：1メッセージ10ファイル、画像10MB・文書25MB・動画100MB、MB＝10^6バイト。AC-3：合計200MB）と、
// 計画（元の名前は1〜255文字、改行・「"」・制御文字を含む名前は拒否）の数字をそのまま書く。本番の定数から期待値を作らない。
// 置き場所は shared/message-rules.ts のテスト（backend/src/lib/message-rules.test.ts）と同じ。
//
// 実装が前提とする約束（このテストが固定する）：
//   MAX_ATTACHMENTS_PER_MESSAGE = 10 ／ MAX_ATTACHMENT_TOTAL_BYTES = 200_000_000 ／ MAX_ATTACHMENT_UPLOAD_BYTES = 100_000_000
//   ATTACHMENT_SIZE_LIMITS = { image: 10_000_000, document: 25_000_000, video: 100_000_000 }
//   MAX_ATTACHMENT_NAME_LENGTH = 255
//   attachmentKindFromName(name): "image" | "document" | "video" | null（拡張子だけで決める。大文字小文字を区別しない。許可しない拡張子は null）
//   isValidAttachmentName(name): boolean
//   validateAttachmentCandidate(current: readonly { size: number }[], file: { name: string; size: number }):
//     null（受け付ける）| "type" | "name" | "size" | "count" | "total"（拒否の理由。画面が選んだ直後に使う）
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_SIZE_LIMITS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_ATTACHMENT_UPLOAD_BYTES,
  attachmentKindFromName,
  isValidAttachmentName,
  validateAttachmentCandidate,
} from "../../../shared/attachment-rules";

describe("#140 AC-1（1-6 AC-1・AC-3）定数", () => {
  it("#140 AC-1（1-6 AC-1）: 1メッセージの添付は最大10ファイル", () => {
    expect(MAX_ATTACHMENTS_PER_MESSAGE).toBe(10);
  });

  it("#140 AC-1（1-6 AC-1）: 上限は画像10MB・文書25MB・動画100MB（MB＝10^6バイト）", () => {
    expect(ATTACHMENT_SIZE_LIMITS).toEqual({
      image: 10_000_000,
      document: 25_000_000,
      video: 100_000_000,
    });
  });

  it("#140 AC-1（1-6 AC-3）: 1メッセージの合計は200MB", () => {
    expect(MAX_ATTACHMENT_TOTAL_BYTES).toBe(200_000_000);
  });

  it("#140 AC-1（1-6 AC-6）: 1回のアップロードの受信の上限は100MB（最大の種類＝動画と同じ）", () => {
    expect(MAX_ATTACHMENT_UPLOAD_BYTES).toBe(100_000_000);
  });

  it("#140 AC-1（1-6 AC-3）: 元の名前は255文字まで", () => {
    expect(MAX_ATTACHMENT_NAME_LENGTH).toBe(255);
  });
});

describe("#140 AC-1（1-6 AC-5）拡張子と種類", () => {
  it.each([
    ["photo.jpg", "image"],
    ["photo.jpeg", "image"],
    ["PHOTO.JPG", "image"],
    ["image.png", "image"],
    ["anime.gif", "image"],
    ["pic.webp", "image"],
    ["report.pdf", "document"],
    ["doc.docx", "document"],
    ["sheet.xlsx", "document"],
    ["slide.pptx", "document"],
    ["memo.txt", "document"],
    ["list.csv", "document"],
    ["movie.mp4", "video"],
    ["clip.webm", "video"],
  ])("#140 AC-1（1-6 AC-5）: %s は %s", (name, kind) => {
    expect(attachmentKindFromName(name)).toBe(kind);
  });

  it.each([
    "vector.svg",
    "page.html",
    "page.htm",
    "archive.zip",
    "macro.docm",
    "macro.xlsm",
    "macro.pptm",
    "old.doc",
    "old.xls",
    "old.ppt",
    "tool.exe",
    "movie.mkv",
    "noextension",
    "trailingdot.",
    "photo.jpg.exe",
  ])(
    "#140 AC-1（1-6 AC-5、C-137(1)・C-153）: %s は受け付けない（null）",
    (name) => {
      expect(attachmentKindFromName(name)).toBeNull();
    },
  );
});

describe("#140 AC-1（1-6 AC-3）元の名前", () => {
  it("#140 AC-1（1-6 AC-3）: 日本語・空白を含む名前、1文字・255文字の名前は受け付ける", () => {
    expect(isValidAttachmentName("報告書 2026.pdf")).toBe(true);
    expect(isValidAttachmentName("a")).toBe(true);
    expect(isValidAttachmentName(`${"a".repeat(251)}.pdf`)).toBe(true);
  });

  it.each([
    ["空", ""],
    ["256文字", `${"a".repeat(252)}.pdf`],
    ["改行（LF）", "a\nb.pdf"],
    ["改行（CR）", "a\rb.pdf"],
    ["二重引用符", 'a"b.pdf'],
    ["NUL", "a\u0000b.pdf"],
    ["タブ（制御文字）", "a\tb.pdf"],
    ["DEL（制御文字）", "a\u007fb.pdf"],
  ])("#140 AC-1（1-6 AC-3）: %s の名前は受け付けない", (_label, name) => {
    expect(isValidAttachmentName(name)).toBe(false);
  });
});

describe("#140 AC-1（1-6 AC-1・AC-3）選んだ直後の確認（境界）", () => {
  const MB = 1_000_000;

  it.each([
    ["画像", "a.png", 10 * MB],
    ["文書", "a.pdf", 25 * MB],
    ["動画", "a.mp4", 100 * MB],
  ])(
    "#140 AC-1（1-6 AC-1）: %sは上限ちょうど（%s・%iバイト）を受け付ける",
    (_label, name, size) => {
      expect(validateAttachmentCandidate([], { name, size })).toBeNull();
    },
  );

  it.each([
    ["画像", "a.png", 10 * MB + 1],
    ["文書", "a.pdf", 25 * MB + 1],
    ["動画", "a.mp4", 100 * MB + 1],
  ])(
    "#140 AC-1（1-6 AC-1）: %sは上限より1バイト多いと size で拒否",
    (_label, name, size) => {
      expect(validateAttachmentCandidate([], { name, size })).toBe("size");
    },
  );

  it("#140 AC-1（1-6 AC-1）: 画像の上限は文書・動画の上限を使わない（11MBの PNG は拒否、11MBの PDF は受け付ける）", () => {
    expect(
      validateAttachmentCandidate([], { name: "a.png", size: 11 * MB }),
    ).toBe("size");
    expect(
      validateAttachmentCandidate([], { name: "a.pdf", size: 11 * MB }),
    ).toBeNull();
  });

  it("#140 AC-1（1-6 AC-1）: 0バイトのファイルは size で拒否", () => {
    expect(validateAttachmentCandidate([], { name: "a.txt", size: 0 })).toBe(
      "size",
    );
  });

  it("#140 AC-1（1-6 AC-1）: 9件の後の10件目は受け付け、10件の後の11件目は count で拒否", () => {
    const nine = Array.from({ length: 9 }, () => ({ size: 1 }));
    const ten = Array.from({ length: 10 }, () => ({ size: 1 }));
    expect(
      validateAttachmentCandidate(nine, { name: "a.txt", size: 1 }),
    ).toBeNull();
    expect(validateAttachmentCandidate(ten, { name: "a.txt", size: 1 })).toBe(
      "count",
    );
  });

  it("#140 AC-1（1-6 AC-3）: 合計がちょうど200MBは受け付け、1バイト超えると total で拒否", () => {
    const current = [{ size: 100 * MB }, { size: 75 * MB }];
    expect(
      validateAttachmentCandidate(current, { name: "a.pdf", size: 25 * MB }),
    ).toBeNull();
    expect(
      validateAttachmentCandidate(current, {
        name: "a.pdf",
        size: 25 * MB + 1,
      }),
    ).toBe("total");
  });

  it("#140 AC-1（1-6 AC-5）: 許可しない拡張子は type で拒否", () => {
    expect(validateAttachmentCandidate([], { name: "a.svg", size: 10 })).toBe(
      "type",
    );
  });

  it("#140 AC-1（1-6 AC-3）: 使えない文字を含む名前は name で拒否", () => {
    expect(validateAttachmentCandidate([], { name: 'a".txt', size: 10 })).toBe(
      "name",
    );
  });
});
