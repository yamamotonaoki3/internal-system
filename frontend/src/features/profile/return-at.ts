// 戻り予定の入力欄（datetime-local）とサーバーの値（UTC の ISO 8601）の変換。
import { latestReturnAt } from "../../../../shared/profile-rules";

const pad = (value: number) => String(value).padStart(2, "0");

/** datetime-local の値（端末の時間帯の "YYYY-MM-DDTHH:mm"） */
export function toDatetimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 入力欄の min（現在）と max（1年後）。サーバーの検証が正で、これは入力の目安 */
export function returnAtBounds(now: Date) {
  return {
    min: toDatetimeLocal(now),
    max: toDatetimeLocal(latestReturnAt(now)),
  };
}

/** 空なら undefined（送らない） */
export function localToIso(value: string): string | undefined {
  return value === "" ? undefined : new Date(value).toISOString();
}

export function isoToLocal(iso: string | null): string {
  return iso === null ? "" : toDatetimeLocal(new Date(iso));
}
