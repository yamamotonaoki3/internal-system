// リアクション・スタンプの共通規則（#138）。画面とサーバーで同じ意味の定義を1か所に置く（サーバーは画面の検査に頼らず、同じ一覧で必ず検査する）。
// 受け付ける値は固定の一覧だけ（絵文字は完全一致で比べ、異体字セレクタなどの正規化はしない。肌の色の違いは持たない）。

export const REACTION_KINDS = ["emoji", "stamp"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** 1つの投稿に付けられる種類（絵文字とスタンプの合計）の上限 */
export const MAX_REACTION_TYPES = 20;

/** 1種類あたり、付けた人として一覧に返す人数の上限（件数は全数を返す） */
export const MAX_REACTION_USERS_SHOWN = 50;

/** 文字のスタンプ。並びは画面の順。id を value として保存する */
export const STAMPS: readonly {
  readonly id: string;
  readonly label: string;
}[] = [
  { id: "like", label: "いいね" },
  { id: "ok", label: "了解" },
  { id: "thanks", label: "ありがとう" },
  { id: "good-work", label: "お疲れさまです" },
  { id: "checking", label: "確認します" },
  { id: "congrats", label: "おめでとう" },
];

type EmojiCategory = {
  readonly id: string;
  readonly label: string;
  /** name は日本語で、読み上げと title に使う */
  readonly emojis: readonly { readonly char: string; readonly name: string }[];
};

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    id: "reaction",
    label: "よく使う",
    emojis: [
      { char: "👍", name: "いいね" },
      { char: "👏", name: "拍手" },
      { char: "🙏", name: "お願い" },
      { char: "🙇", name: "お辞儀" },
      { char: "✅", name: "チェック" },
      { char: "👀", name: "目" },
      { char: "💯", name: "100点" },
      { char: "🎉", name: "クラッカー" },
      { char: "✨", name: "キラキラ" },
      { char: "🔥", name: "炎" },
      { char: "💪", name: "力こぶ" },
      { char: "🙌", name: "両手を上げる" },
      { char: "👌", name: "OK" },
      { char: "⭐", name: "星" },
      { char: "💡", name: "電球" },
      { char: "📌", name: "ピン" },
      { char: "⏰", name: "時計" },
      { char: "🆗", name: "OKマーク" },
      { char: "❗", name: "感嘆符" },
      { char: "❓", name: "疑問符" },
    ],
  },
  {
    id: "face",
    label: "顔",
    emojis: [
      { char: "😀", name: "笑顔" },
      { char: "😄", name: "満面の笑み" },
      { char: "😆", name: "大笑い" },
      { char: "😊", name: "にっこり" },
      { char: "🙂", name: "微笑み" },
      { char: "😉", name: "ウインク" },
      { char: "😍", name: "目がハート" },
      { char: "🥰", name: "ハートに囲まれた笑顔" },
      { char: "😂", name: "うれし泣き" },
      { char: "🤣", name: "転げ回って笑う" },
      { char: "😅", name: "冷や汗の笑顔" },
      { char: "😮", name: "口を開けた顔" },
      { char: "😲", name: "驚き" },
      { char: "🤔", name: "考える顔" },
      { char: "😌", name: "ほっとした顔" },
      { char: "😢", name: "泣き顔" },
      { char: "😭", name: "号泣" },
      { char: "😱", name: "叫び顔" },
      { char: "😴", name: "眠る顔" },
      { char: "🥳", name: "パーティー顔" },
    ],
  },
  {
    id: "heart",
    label: "ハート・気持ち",
    emojis: [
      { char: "❤️", name: "赤いハート" },
      { char: "🧡", name: "オレンジのハート" },
      { char: "💛", name: "黄色いハート" },
      { char: "💚", name: "緑のハート" },
      { char: "💙", name: "青いハート" },
      { char: "💜", name: "紫のハート" },
      { char: "🤍", name: "白いハート" },
      { char: "💖", name: "輝くハート" },
      { char: "💕", name: "2つのハート" },
      { char: "💓", name: "鼓動するハート" },
      { char: "👋", name: "手を振る" },
      { char: "🤝", name: "握手" },
      { char: "✋", name: "手のひら" },
      { char: "👊", name: "グータッチ" },
      { char: "✌️", name: "ピース" },
      { char: "🤞", name: "指を交差" },
      { char: "🫶", name: "ハートの手" },
      { char: "💤", name: "睡眠" },
      { char: "💦", name: "汗" },
      { char: "💢", name: "怒りマーク" },
    ],
  },
  {
    id: "object",
    label: "もの・その他",
    emojis: [
      { char: "☕", name: "コーヒー" },
      { char: "🍵", name: "お茶" },
      { char: "🍰", name: "ケーキ" },
      { char: "🍙", name: "おにぎり" },
      { char: "🍻", name: "乾杯" },
      { char: "🌸", name: "桜" },
      { char: "🌞", name: "太陽" },
      { char: "🌙", name: "三日月" },
      { char: "☔", name: "雨傘" },
      { char: "❄️", name: "雪の結晶" },
      { char: "📝", name: "メモ" },
      { char: "📎", name: "クリップ" },
      { char: "📅", name: "カレンダー" },
      { char: "📞", name: "電話" },
      { char: "💻", name: "パソコン" },
      { char: "📢", name: "メガホン" },
      { char: "🚀", name: "ロケット" },
      { char: "🏁", name: "ゴール" },
      { char: "🎂", name: "バースデーケーキ" },
      { char: "🎁", name: "プレゼント" },
    ],
  },
];

// 一覧の検索は Set で行う（オブジェクトのプロパティ参照だと、constructor などの継承された名前が一致してしまう）
const VALID_VALUES: Readonly<Record<ReactionKind, ReadonlySet<string>>> = {
  emoji: new Set(
    EMOJI_CATEGORIES.flatMap((category) =>
      category.emojis.map((emoji) => emoji.char),
    ),
  ),
  stamp: new Set(STAMPS.map((stamp) => stamp.id)),
};

/** kind・value が固定の一覧に完全一致するか。知らない kind は false */
export function isValidReaction(kind: ReactionKind, value: string): boolean {
  if (!Object.hasOwn(VALID_VALUES, kind)) return false;
  return VALID_VALUES[kind].has(value);
}
