// 画面を離れる前の確認の提供元。ルーターの入口（main.tsx）で、ルートの要素を包む。
// ブロッカー（useBlocker）はルーター1つにつき1つしか持てないため、ここで1つだけ持ち、登録された見張りのどれかに変更があれば止める。
// 確認の待ちは「離脱の確認（ブロッカーが止めた遷移）」と「ログアウトの確認」のどちらか1つだけで、ダイアログも1つだけ描く。
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useBlocker,
  useLocation,
  type Blocker,
  type BlockerFunction,
} from "react-router";
import { LeaveConfirmDialog } from "./components/LeaveConfirmDialog";
import {
  LeaveGuardContext,
  type Guard,
  type LeaveGuardContextValue,
} from "./leave-guard-context";

// 戻す先が文書から外れた・見えなくなった（スマホ幅のドロワーが閉じたなど）ときは、フォーカスが body に落ちるので使わない。
// checkVisibility がない環境（jsdom）では判定できないため、見えているとみなす
function isFocusable(target: Element | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (!target.isConnected || target === document.body) return false;
  return "checkVisibility" in target ? target.checkVisibility() : true;
}

type LogoutWait = { resolve: (leave: boolean) => void; locationKey: string };

// ログアウトの 401（自動）と、確認を済ませた手動ログアウトの移動先。ここへの移動では止めない（下書きは残す）
const LOGIN_PATH = "/login";

// ブラウザの履歴の今の項目のキー。ルーターは遷移の完了のとき、描画の反映（startTransition）より先に履歴を更新する。
// memory router（jsdom のテスト）では window.history.state が使えないので undefined になる
function currentHistoryKey(): string | undefined {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null || !("key" in state))
    return undefined;
  return typeof state.key === "string" ? state.key : undefined;
}

export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const guards = useRef(new Set<Guard>());
  const [guardCount, setGuardCount] = useState(0);
  const location = useLocation();
  const logoutWait = useRef<LogoutWait | null>(null);
  const [logoutWaiting, setLogoutWaiting] = useState(false);
  // 遷移を止めたときにフォーカスのあった要素。確認を閉じたら、そこへ戻す
  const opener = useRef<Element | null>(null);
  const afterClose = useRef<(() => void) | null>(null);
  // proceed・reset を呼んだ後、描画に反映されるまでの間は、もう一度呼ばない（素早い2回押し）
  // 処理した blocker のオブジェクト。新しい blocked は別のオブジェクトなので、印に引きずられない
  const settledBlocker = useRef<Blocker | null>(null);

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => {
      const block =
        guards.current.size > 0 &&
        currentLocation.pathname !== nextLocation.pathname &&
        nextLocation.pathname !== LOGIN_PATH;
      if (block) opener.current = document.activeElement;
      return block;
    },
    [],
  );
  const blocker = useBlocker(shouldBlock);

  const blockerRef = useRef(blocker);
  const locationKeyRef = useRef(location.key);
  useEffect(() => {
    blockerRef.current = blocker;
    locationKeyRef.current = location.key;
  });

  // blocked の blocker にだけ proceed・reset を呼ぶ（unblocked・proceeding に呼ぶと React Router が例外を投げる）。
  // 描画は遅れることがあるので、描画した状態だけでなく履歴のキーでも、ルーターがまだ止めたままかを確かめる。
  // 止めている間の履歴は、描画中の場所（location.key）にある。別の遷移（401 の /login など）が済んでいれば、履歴のキーが変わる。
  // 戻る（POP）で止めた直後は、ルーターが履歴を元の位置へ戻すまで、履歴が戻り先（blocker.location.key）にある。
  // ルーターはその間も blocked なので、これも許す。push で止めたときの blocker.location.key は履歴にないキーで、401 の /login のキーとも違うため、競合の防止は保たれる。
  // 履歴が使えない環境（memory router）では、最新の描画の blocker だけで判断する
  const canSettleBlocker = useCallback((): Blocker | null => {
    const latest = blockerRef.current;
    if (latest.state !== "blocked" || latest === settledBlocker.current)
      return null;
    const key = currentHistoryKey();
    if (
      key !== undefined &&
      key !== locationKeyRef.current &&
      key !== latest.location.key
    )
      return null;
    return latest;
  }, []);

  const settleBlocker = useCallback(
    (action: "proceed" | "reset") => {
      const latest = canSettleBlocker();
      if (latest === null || latest.state !== "blocked") return false;
      settledBlocker.current = latest;
      if (action === "proceed") latest.proceed();
      else latest.reset();
      return true;
    },
    [canSettleBlocker],
  );

  const register = useCallback((guard: Guard) => {
    guards.current.add(guard);
    setGuardCount(guards.current.size);
    return () => {
      guards.current.delete(guard);
      setGuardCount(guards.current.size);
    };
  }, []);

  const hasChanges = useCallback(() => guards.current.size > 0, []);

  const settleLogout = useCallback((leave: boolean) => {
    const wait = logoutWait.current;
    if (wait === null) return;
    logoutWait.current = null;
    setLogoutWaiting(false);
    wait.resolve(leave);
  }, []);

  const confirmLeave = useCallback(() => {
    if (guards.current.size === 0) return Promise.resolve(true);
    // 確認は1つだけ。待ち中の連打・離脱の確認の表示中は、確認を重ねずに留まる
    if (logoutWait.current !== null || blockerRef.current.state === "blocked")
      return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      logoutWait.current = { resolve, locationKey: locationKeyRef.current };
      setLogoutWaiting(true);
    });
  }, []);

  const focusFirstGuard = useCallback(
    () => guards.current.values().next().value?.focus(),
    [],
  );

  // 確認を閉じた後、遷移を始めた要素（なければ入力欄）へフォーカスを戻すよう予約する
  const restoreFocusToOpener = useCallback(() => {
    const target = opener.current;
    afterClose.current = () => {
      if (isFocusable(target)) target.focus();
      else focusFirstGuard();
    };
  }, [focusFirstGuard]);

  // 場所が変わった（401 の自動ログアウトを含む）ら、ログアウトの確認は取り下げる。見張りがなくなるより先に判定する
  useEffect(() => {
    const wait = logoutWait.current;
    if (wait !== null && wait.locationKey !== location.key) settleLogout(false);
  }, [location.key, settleLogout]);

  // 失う下書きがなくなったら、そのままログアウトを進める
  useEffect(() => {
    if (guardCount === 0) settleLogout(true);
  }, [guardCount, settleLogout]);

  // blocked の blocker にだけ proceed・reset ができる（unblocked に呼ぶと React Router が例外を投げる）。
  // 描画の後に別の遷移（401 の /login）が済んで unblocked に戻っていることがあるため、次のタスクまで待ち、
  // その間に再描画されたら取り消し（effect の後始末）、実行の直前にも最新の状態を確かめる
  useEffect(() => {
    const keepBlockedOnly = guardCount === 0 || logoutWaiting;
    if (!keepBlockedOnly || blocker.state !== "blocked") return;
    const timer = setTimeout(() => {
      if (logoutWait.current !== null) {
        // ログアウトの確認を優先する。戻る等で止めた遷移は取り消して、確認を重ねない
        settleBlocker("reset");
        return;
      }
      // 離脱の確認の表示中に見張りがなくなった。失う入力がないので、確認を閉じて遷移を進める
      if (settleBlocker("proceed")) restoreFocusToOpener();
    }, 0);
    return () => clearTimeout(timer);
  }, [guardCount, logoutWaiting, blocker, restoreFocusToOpener, settleBlocker]);

  const open = logoutWaiting || blocker.state === "blocked";
  useEffect(() => {
    if (open) return;
    const restore = afterClose.current;
    afterClose.current = null;
    restore?.();
  }, [open]);

  const continueEditing = () => {
    if (logoutWait.current !== null) {
      afterClose.current = focusFirstGuard;
      settleLogout(false);
      return;
    }
    if (settleBlocker("reset")) restoreFocusToOpener();
  };

  const discard = () => {
    // ログアウトの確認では見張りの discard を呼ばない。下書きの消去はログアウトの成功時にまとめて行う
    if (logoutWait.current !== null) {
      settleLogout(true);
      return;
    }
    // 判定が通らないときは、下書きも消さない
    if (canSettleBlocker() === null) return;
    for (const guard of [...guards.current]) guard.discard();
    settleBlocker("proceed");
  };

  const value = useMemo<LeaveGuardContextValue>(
    () => ({ register, hasChanges, confirmLeave }),
    [register, hasChanges, confirmLeave],
  );

  return (
    <LeaveGuardContext value={value}>
      {children}
      {open && (
        <LeaveConfirmDialog onContinue={continueEditing} onDiscard={discard} />
      )}
    </LeaveGuardContext>
  );
}
