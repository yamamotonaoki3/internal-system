// S-14 通知の一覧（自分宛ての通知・既読・すべて既読）。
import { NotificationList } from "../features/notifications";

export function NotificationsPage() {
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">通知</h1>
      <NotificationList />
    </section>
  );
}
