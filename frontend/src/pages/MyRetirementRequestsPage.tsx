// 自分の退職処理の申請（通知の移動先）。申請の状態・却下の理由を確かめ、申請中のものを取り下げる。
import { MyRetirementRequestList } from "../features/retirement-requests";

export function MyRetirementRequestsPage() {
  return (
    <section className="mx-auto max-w-5xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">自分の退職処理の申請</h1>
      <MyRetirementRequestList />
    </section>
  );
}
