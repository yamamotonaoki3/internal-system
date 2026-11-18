// 入力が止まってから一定時間たった値を返す（入力のたびに問い合わせないため）。
import { useEffect, useState } from "react";

export function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
