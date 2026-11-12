// S-10 チャンネル作成の申請（申請フォームと自分の申請）。
import {
  ChannelRequestForm,
  MyChannelRequestList,
} from "../features/channel-requests";

export function ChannelRequestPage() {
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">チャンネル作成の申請</h1>
      <ChannelRequestForm />
      <h2 className="mb-2 text-lg font-bold">自分の申請</h2>
      <MyChannelRequestList />
    </section>
  );
}
