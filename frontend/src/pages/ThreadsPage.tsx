// S-35 スレッド一覧（/threads）。自分が関わるスレッドの一覧と、開いているスレッド（S-07）を並べる。
// 案件のスレッドへの返信でも添付の公開範囲を選べるよう、案件の設定を渡す（出すかは、返信の取得の応答で案件の部屋かを見て決まる）。
import { CASE_ATTACHMENT_PUBLICATION } from "../features/cases";
import { ThreadList, ThreadPane, useThreadParam } from "../features/threads";

export function ThreadsPage() {
  const { parentMessageId } = useThreadParam();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-start">
      <section className="min-w-0 flex-1 rounded-lg bg-surface p-4 md:p-6">
        <h1 className="mb-4 text-2xl font-bold">スレッド</h1>
        <ThreadList />
      </section>
      {parentMessageId !== null && (
        <ThreadPane
          parentMessageId={parentMessageId}
          publication={CASE_ATTACHMENT_PUBLICATION}
        />
      )}
    </div>
  );
}
