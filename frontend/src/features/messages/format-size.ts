// 添付の大きさの表示（MB＝10^6バイト・小数1桁）。送信前の一覧と、案件の添付の一覧（#148）で同じ形にそろえる。
const BYTES_PER_MB = 1_000_000;

export function formatAttachmentSize(size: number): string {
  return `${(size / BYTES_PER_MB).toFixed(1)} MB`;
}
