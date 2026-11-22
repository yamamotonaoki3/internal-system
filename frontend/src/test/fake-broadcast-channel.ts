// #341：テスト専用の BroadcastChannel の差し替え（本番のコードには分岐を入れない）。
// jsdom の環境には Node の BroadcastChannel があるが、作ったまま閉じないと購読がプロセスに残り、テストの間で値が混ざりうる。
// そのため、同じ名前の「ほかの」インスタンスにだけ、写した値を届ける（自分自身には届けない。HTML 標準と同じ）、メモリの中だけの代わりを使う。
// 届けるのはマイクロタスク（偽の時計に左右されない）。実ブラウザでの配信は E2E（e2e/case-access-loss-cross-tab.spec.ts）で確かめる。
import { vi } from "vitest";

export class FakeBroadcastChannel extends EventTarget {
  static instances: FakeBroadcastChannel[] = [];
  /** postMessage の記録（名前・値）。invocationCallOrder で、ほかの vi.fn との順序を比べる */
  static readonly onPost = vi.fn<(name: string, data: unknown) => void>();

  readonly name: string;
  closed = false;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    super();
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    if (this.closed)
      throw new DOMException("チャンネルは閉じています", "InvalidStateError");
    FakeBroadcastChannel.onPost(this.name, data);
    this.deliver(data);
  }

  /** 同じ名前の、ほかのインスタンスへ届ける（記録には残さない） */
  deliver(data: unknown): void {
    const targets = FakeBroadcastChannel.instances.filter(
      (other) => other !== this && other.name === this.name,
    );
    const copy: unknown = structuredClone(data);
    queueMicrotask(() => {
      for (const target of targets) {
        if (target.closed) continue;
        const event = new MessageEvent("message", { data: copy });
        target.dispatchEvent(event);
        target.onmessage?.(event);
      }
    });
  }

  close(): void {
    this.closed = true;
  }

  /** 名前ごとの、送られた値（送った順） */
  static sent(name: string): unknown[] {
    return FakeBroadcastChannel.onPost.mock.calls
      .filter(([sentName]) => sentName === name)
      .map(([, data]) => data);
  }

  /** 送った記録だけを消す（作ったチャンネルは生かしたまま。モジュールの中の、遅れて作るチャンネルを使い続けるファイル向け） */
  static clearSent(): void {
    FakeBroadcastChannel.onPost.mockClear();
  }

  /** すべて閉じて忘れる（vi.resetModules でモジュールを作り直すファイル向け） */
  static closeAll(): void {
    for (const instance of FakeBroadcastChannel.instances) instance.close();
    FakeBroadcastChannel.instances = [];
    FakeBroadcastChannel.onPost.mockClear();
  }
}

/** ほかのタブから送る（同じ名前の、アプリの外のインスタンスから postMessage する） */
export function postFromOtherTab(name: string, data: unknown): void {
  const sender = new FakeBroadcastChannel(name);
  // アプリが送った値の数え上げ（onPost）に混ぜない
  sender.deliver(data);
  sender.close();
}

/** マイクロタスクとタスクを何周か進める（届いた値の処理と、MSW の応答を待つ。否定の確かめの前に使う） */
export async function flushTasks(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i += 1)
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
