"use strict";

// お知らせ専用チャンネルの「依頼」「緊急削除の申請」「全体管理者の直接削除」「自分の投稿の編集・削除」と、
// 全体管理者向けの申請一覧 S-37、通知（S-14）への送り先をまとめる（C-112・C-114・C-115・C-116、7-2 AC-3〜AC-8、
// state-transitions.md 5.3、api-draft.md V-48・V-49）。
// 画面の入口は screens.js（messageRows・channelScreen・renderExtraPage・notification-open）にある。
// extras.js・screens.js・admin.js・organize.js の後、app.js の前に読み込む。変更はブラウザのメモリだけで、実際の認証はしない。
// 画面の出し分けとは別に、実行する関数の中でも、ロール・投稿の状態・重複・申請の状態を調べて拒否する（ブラウザの
// コンソールからの呼び出しも同じ規則で拒否するため）。拒否したときは何も変えない。
// 文言は未決定（案）。画面には「案」と分かる表示を添える。

/* ---------- 確認用の呼び名（初期データの投稿） ---------- */
// 営業部のお知らせ：P1（testuser_005・返信つき）、P2（testuser_002）、P3・P4（testuser_005）。
// 設計部のお知らせ：P5（testuser_004）、P6（退職者 testuser_006。返信つき）。
const P1 = "m-ann-p1";
const P2 = "m-ann-p2";
const P3 = "m-ann-p3";
const P4 = "m-ann-p4";
const P5 = "m-ann-p5";
const P6 = "m-ann-p6";

/* ---------- データ ---------- */
// 依頼（C-114）。status は pending（未処理）・resolved（対応済み）・void（無効。C-115(2)【案】）。取消はなく、期限もない。
prototypeData.changeRequests = [];
// 緊急削除の申請。status は pending・approved・rejected・cancelled・void。
// 下の3件は S-37 の絞り込みを確かめるための過去の見本（終端の状態。見本の過去の投稿に対する申請）。
const DAY_MS = 86400000;
prototypeData.emergencyRequests = [
  {
    id: "ER-01",
    mid: "m-ann-h1",
    channelId: "announce-design",
    by: "u4",
    byDept: "設計部",
    reason: "誤った図面の情報を載せたため（架空の見本）",
    status: "approved",
    at: "10/20 09:30",
    ts: Date.now() - 8 * DAY_MS,
    decidedBy: "u5",
    rejectReason: "",
  },
  {
    id: "ER-02",
    mid: "m-ann-h2",
    channelId: "announce-design",
    by: "u4",
    byDept: "設計部",
    reason: "表現を見直したいため（架空の見本）",
    status: "rejected",
    at: "10/21 10:00",
    ts: Date.now() - 7 * DAY_MS,
    decidedBy: "u5",
    rejectReason: "内容に問題はないため（架空の見本）",
  },
  {
    id: "ER-03",
    mid: "m-ann-h3",
    channelId: "announce-design",
    by: "u4",
    byDept: "設計部",
    reason: "保管先がまだ決まっていないため（架空の見本）",
    status: "cancelled",
    at: "10/22 15:20",
    ts: Date.now() - 6 * DAY_MS,
    decidedBy: null,
    rejectReason: "",
  },
];
ui.annFilter = "pending";
let annSeq = 0;

const ANN_STATUS = {
  pending: "申請中",
  approved: "承認",
  rejected: "却下",
  cancelled: "取消",
  void: "無効",
};
const ANN_STATUS_BADGE = {
  pending: "pending",
  approved: "active",
  rejected: "rejected",
  cancelled: "withdrawn",
  void: "archived",
};
const ANN_CHANGE_LABEL = { edit: "編集", delete: "削除" };
const ANN_REASON_MAX = 500;
const ANN_TEXT_MAX = 4000;

/* ---------- 検索・判定の部品 ---------- */
const annChannels = () => prototypeData.channels.filter((item) => item.announce);
function annFind(mid) {
  for (const channel of annChannels()) {
    const message = channel.messages.find((item) => item.mid === mid);
    if (message) return { channel, message };
  }
  return null;
}
const annChange = (id) => prototypeData.changeRequests.find((item) => item.id === id);
const annEmergency = (id) =>
  prototypeData.emergencyRequests.find((item) => item.id === id);
const annPendingChanges = (mid, kind = null) =>
  prototypeData.changeRequests.filter(
    (item) =>
      item.mid === mid && item.status === "pending" && (!kind || item.kind === kind),
  );
const annPendingEmergency = (mid) =>
  prototypeData.emergencyRequests.find(
    (item) => item.mid === mid && item.status === "pending",
  );
const annDeptOwner = (channel) =>
  currentUser().role === "owner" && currentUser().department === channel.dept;
// 依頼を出せる人（C-115(6)）。他人の投稿に対して、その部署のオーナー（編集・削除）と全体管理者（編集のみ）。
const annCanRequestChange = (channel, message, kind) => {
  if (message.by === state.userId) return false;
  if (adminOnly()) return kind === "edit";
  return annDeptOwner(channel);
};
// 緊急削除を申請できるのは、その部署のオーナーだけ（全体管理者は直接削除できるため不可）。
const annCanRequestEmergency = (channel, message) =>
  message.by !== state.userId && !adminOnly() && annDeptOwner(channel);
// 理由の整形。前後の空白を除いて数える（V-48）。無効なときは null を返す。
function annReason(value, required) {
  const text = typeof value === "string" ? value.trim() : null;
  if (text === null) return null;
  const count = [...text].length;
  if (count > ANN_REASON_MAX || (required && count < 1)) return null;
  return text;
}
const annReasonMessage = (required) =>
  required
    ? `理由は1〜${ANN_REASON_MAX}文字で入力してください。`
    : `理由は${ANN_REASON_MAX}文字以内で入力してください。`;
// 操作の対象にできる投稿か。削除済み・読み取り専用（無効な部署）の投稿には、依頼・申請・削除・編集をしない。
function annTarget(mid) {
  const found = typeof mid === "string" ? annFind(mid) : null;
  if (!found) {
    refuse("お知らせの投稿が見つかりません。");
    return null;
  }
  if (!canReadChannel(found.channel)) {
    refuse();
    return null;
  }
  if (found.message.deleted) {
    refuse("この投稿はすでに削除されています。");
    return null;
  }
  if (found.channel.readOnly) {
    refuse("この部署は無効化されたため、読み取り専用です。");
    return null;
  }
  return found;
}
function annNotice(recipient, type, text, target, channelId, mid = null) {
  // 退職者・無効の社員には通知しない。
  if (!employees.some((person) => person.id === recipient && person.active)) return;
  prototypeData.notices.unshift({
    id: `n-ann-${++annSeq}`,
    recipient,
    type,
    text: `${text}（文言は案）`,
    announce: true,
    target,
    channel: channelId,
    mid,
  });
}
const annAdmins = () =>
  employees.filter((person) => person.active && person.role === "admin");
const annAuditTarget = (channel) => `# ${channel.name}`;

/* ---------- 自動の状態遷移（state-transitions.md 5.3。監査ログ・通知は出さない） ---------- */
// 投稿者が編集したとき：未処理の依頼（種類を問わず）を「対応済み」にする。申請は変えない（C-115(5)）。
function onAnnounceEdited(message) {
  annPendingChanges(midOf(message)).forEach((item) => (item.status = "resolved"));
}
// 投稿が消えたとき（本人の削除・全体管理者の直接削除・緊急削除の承認）：未処理の依頼を「対応済み」、
// 承認した申請以外の申請中を「無効」にする（C-114(6)・C-115(1)）。
function onAnnounceDeleted(message, approvedRequestId = null) {
  const mid = midOf(message);
  annPendingChanges(mid).forEach((item) => (item.status = "resolved"));
  prototypeData.emergencyRequests
    .filter(
      (item) =>
        item.mid === mid && item.status === "pending" && item.id !== approvedRequestId,
    )
    .forEach((item) => (item.status = "void"));
}
// 部署の無効化（C-115(2)）：その部署のお知らせ専用チャンネルの未処理の依頼・申請中を「無効」にし、読み取り専用にする。
// 承認・却下・取消などの終端の状態は変えない。
function onDepartmentDisabled(name) {
  annChannels()
    .filter((channel) => channel.dept === name)
    .forEach((channel) => {
      const mids = new Set(channel.messages.map((item) => item.mid));
      prototypeData.changeRequests
        .filter((item) => mids.has(item.mid) && item.status === "pending")
        .forEach((item) => (item.status = "void"));
      prototypeData.emergencyRequests
        .filter((item) => mids.has(item.mid) && item.status === "pending")
        .forEach((item) => (item.status = "void"));
      channel.readOnly = true;
    });
  // 部署の通常の専用チャンネルも読み取り専用にする（C-120(2)）。申請で作った部署のほかのチャンネルを含むかは未決定（Q-45）。
  const dedicated = dedicatedChannel(name);
  if (dedicated) dedicated.readOnly = true;
}

/* ---------- 実行する関数（ブラウザのコンソールからも呼べる。検査に通らなければ拒否して何も変えない） ---------- */
function requestChange(mid, kind, reason = "") {
  if (kind !== "edit" && kind !== "delete") return refuse();
  const found = annTarget(mid);
  if (!found) return false;
  const { channel, message } = found;
  if (!annCanRequestChange(channel, message, kind)) return refuse();
  const text = annReason(reason, false);
  if (text === null) return refuse(annReasonMessage(false));
  if (annPendingChanges(mid, kind).length) return refuse("すでに依頼されています。");
  prototypeData.changeRequests.push({
    id: `CR-${++annSeq}`,
    mid,
    channelId: channel.id,
    kind,
    by: state.userId,
    byDept: deptOf(currentUser()),
    reason: text,
    status: "pending",
    at: stamp(),
  });
  auditLog(
    "お知らせの依頼",
    annAuditTarget(channel),
    `${ANN_CHANGE_LABEL[kind]}を依頼（理由: ${text || "なし"}）`,
  );
  annNotice(
    message.by,
    "お知らせの依頼",
    `${currentUser().name}さんが、あなたの投稿の${ANN_CHANGE_LABEL[kind]}を依頼しました`,
    "S05",
    channel.id,
    mid,
  );
  notify(`${ANN_CHANGE_LABEL[kind]}を依頼しました。`);
  return true;
}
function requestEmergency(mid, reason) {
  const found = annTarget(mid);
  if (!found) return false;
  const { channel, message } = found;
  if (!annCanRequestEmergency(channel, message)) return refuse();
  const text = annReason(reason, true);
  if (text === null) return refuse(annReasonMessage(true));
  if (annPendingEmergency(mid)) return refuse("すでに申請中です。");
  prototypeData.emergencyRequests.push({
    id: `ER-${++annSeq + 100}`,
    mid,
    channelId: channel.id,
    by: state.userId,
    byDept: deptOf(currentUser()),
    reason: text,
    status: "pending",
    at: stamp(),
    ts: Date.now(),
    decidedBy: null,
    rejectReason: "",
  });
  auditLog("緊急削除の申請", annAuditTarget(channel), `緊急削除を申請（理由: ${text}）`);
  annAdmins().forEach((admin) =>
    annNotice(
      admin.id,
      "緊急削除の申請",
      `${currentUser().name}さんが緊急削除を申請しました`,
      "S37",
      channel.id,
    ),
  );
  notify("緊急削除を申請しました。承認されるまで投稿は消えません。");
  return true;
}
// 申請を取り消せるのは、出した本人だけ。現在のロールは条件にしない（申請後にオーナーでなくなっても取り消せる）。
function cancelEmergency(requestId) {
  const request = annEmergency(requestId);
  if (!request) return refuse("申請が見つかりません。");
  if (request.by !== state.userId) return refuse();
  if (request.status !== "pending")
    return refuse("この申請はすでに処理されています。");
  const channel = prototypeData.channels.find((item) => item.id === request.channelId);
  request.status = "cancelled";
  auditLog("緊急削除の申請の取消", annAuditTarget(channel), "緊急削除の申請を取り消し");
  annAdmins().forEach((admin) =>
    annNotice(
      admin.id,
      "緊急削除の取消",
      `${currentUser().name}さんが緊急削除の申請を取り消しました（移動先は案）`,
      "S37",
      channel.id,
    ),
  );
  notify("申請を取り消しました。");
  return true;
}
function approveEmergency(requestId) {
  if (!adminOnly()) return refuse();
  const request = annEmergency(requestId);
  if (!request) return refuse("申請が見つかりません。");
  if (request.status !== "pending")
    return refuse("この申請はすでに処理されています。");
  const found = annFind(request.mid);
  if (!found || found.message.deleted)
    return refuse("投稿はすでに削除されているため、承認できません。");
  const { channel, message } = found;
  message.deleted = true;
  request.status = "approved";
  request.decidedBy = state.userId;
  onAnnounceDeleted(message, request.id);
  auditLog(
    "緊急削除の承認",
    annAuditTarget(channel),
    `緊急削除を承認（申請者: ${nameOf(request.by)}）`,
  );
  annNotice(
    request.by,
    "緊急削除の結果",
    "緊急削除の申請が承認されました",
    "S05",
    channel.id,
    request.mid,
  );
  notify("承認しました。投稿は「削除されました」の表示になります。");
  return true;
}
function rejectEmergency(requestId, reason = "") {
  if (!adminOnly()) return refuse();
  const request = annEmergency(requestId);
  if (!request) return refuse("申請が見つかりません。");
  if (request.status !== "pending")
    return refuse("この申請はすでに処理されています。");
  const text = annReason(reason, false);
  if (text === null) return refuse(annReasonMessage(false));
  const channel = prototypeData.channels.find((item) => item.id === request.channelId);
  request.status = "rejected";
  request.decidedBy = state.userId;
  request.rejectReason = text;
  auditLog(
    "緊急削除の却下",
    annAuditTarget(channel),
    `緊急削除を却下（申請者: ${nameOf(request.by)}。理由: ${text || "なし"}）`,
  );
  annNotice(
    request.by,
    "緊急削除の結果",
    "緊急削除の申請が却下されました",
    "S05",
    channel.id,
    request.mid,
  );
  notify("却下しました。");
  return true;
}
// 全体管理者が他人の投稿を直接削除する（C-112(1)・C-115(8)）。理由は必須。自分の投稿は deleteOwnAnnounce で消す。
function adminDeleteAnnounce(mid, reason) {
  if (!adminOnly()) return refuse();
  const found = annTarget(mid);
  if (!found) return false;
  const { channel, message } = found;
  if (message.by === state.userId) return refuse();
  const text = annReason(reason, true);
  if (text === null) return refuse(annReasonMessage(true));
  message.deleted = true;
  onAnnounceDeleted(message);
  // 投稿者へ通知し、理由も伝える（C-120(8)。文言は案。無効の社員・退職者には作られない）。削除後の行に理由は出さない。
  annNotice(
    message.by,
    "お知らせの削除",
    `全体管理者があなたのお知らせを削除しました。理由: ${text}`,
    "S05",
    channel.id,
    mid,
  );
  auditLog(
    "お知らせの削除（全体管理者）",
    annAuditTarget(channel),
    `他人の投稿を直接削除（投稿者: ${nameOf(message.by)}。理由: ${text}）`,
  );
  notify("削除しました。投稿は「削除されました」の表示になります。");
  return true;
}
// 投稿者本人の編集（V-18：1〜4,000文字）。お知らせ専用チャンネルだけ（確認事項 Q-5）。
function editOwnAnnounce(mid, text) {
  const found = annTarget(mid);
  if (!found) return false;
  const { channel, message } = found;
  if (message.by !== state.userId) return refuse();
  const body = typeof text === "string" ? text.trim() : "";
  const count = [...body].length;
  if (count < 1 || count > ANN_TEXT_MAX)
    return refuse(`本文は1〜${ANN_TEXT_MAX}文字で入力してください。`);
  message.text = body;
  message.editedAt = stamp();
  onAnnounceEdited(message);
  auditLog("お知らせの編集", annAuditTarget(channel), "自分の投稿を編集");
  notify("投稿を編集しました。");
  return true;
}
function deleteOwnAnnounce(mid) {
  const found = annTarget(mid);
  if (!found) return false;
  const { channel, message } = found;
  if (message.by !== state.userId) return refuse();
  message.deleted = true;
  onAnnounceDeleted(message);
  auditLog("お知らせの削除", annAuditTarget(channel), "自分の投稿を削除");
  notify("削除しました。投稿は「削除されました」の表示になります。");
  return true;
}

/* ---------- S-05：操作メニューと印 ---------- */
// 投稿ごとの操作メニューの項目。[キー, 表示]。画面の出し分けで、実行する関数でも同じ条件を検査する。
function announceMenuFor(channel, message) {
  if (message.deleted || channel.readOnly) return [];
  const items = [];
  if (message.by === state.userId) {
    items.push(["edit-own", "編集"], ["delete-own", "削除"]);
  } else if (adminOnly()) {
    items.push(["admin-delete", "削除"], ["req-edit", "編集を依頼"]);
  } else if (annDeptOwner(channel)) {
    items.push(
      ["req-edit", "編集を依頼"],
      ["req-delete", "削除を依頼"],
      ["req-emergency", "緊急削除を申請"],
    );
  }
  const mine = annPendingEmergency(midOf(message));
  if (mine && mine.by === state.userId) items.push(["cancel", "申請を取り消す"]);
  return items;
}
function announceMenu(channel, message) {
  const items = announceMenuFor(channel, message);
  if (!items.length) return "";
  const who = `${nameOf(message.by)}の${message.at}の投稿`;
  return `<details class="announce-menu"><summary aria-label="${e(who)}の操作">操作 …</summary><div class="announce-menu-items">${items
    .map(
      ([key, label]) =>
        `<button type="button" class="button small" data-ui="ann-${key}" data-post="${e(midOf(message))}" aria-label="${e(label)}：${e(who)}">${e(label)}</button>`,
    )
    .join("")}</div></details>`;
}
// 印は、投稿者・依頼者（申請者）・自部署のオーナー・全体管理者だけに見せる（C-114(4)）。
// 投稿者・依頼者は本人として見え、現在のロールを条件にしない。
function announceMarksFor(channel, message) {
  const mid = midOf(message);
  const seenBy = (request) =>
    message.by === state.userId ||
    request.by === state.userId ||
    adminOnly() ||
    annDeptOwner(channel);
  const marks = annPendingChanges(mid)
    .filter(seenBy)
    .map((request) => ({
      kind: "change",
      id: request.id,
      label:
        request.kind === "edit"
          ? "編集が依頼されています"
          : "削除が依頼されています",
    }));
  const emergency = annPendingEmergency(mid);
  if (emergency && seenBy(emergency))
    marks.push({ kind: "emergency", id: emergency.id, label: "緊急削除が申請中です" });
  return marks;
}
function announceMarks(channel, message) {
  if (message.deleted) return "";
  const marks = announceMarksFor(channel, message);
  if (!marks.length) return "";
  return `<div class="announce-marks">${marks
    .map(
      (mark) =>
        `<button type="button" class="announce-mark" data-ui="ann-mark" data-kind="${mark.kind}" data-id="${e(mark.id)}" aria-label="${e(mark.label)}。押すと理由と依頼者を見られます">⚑ ${e(mark.label)}</button>`,
    )
    .join("")}</div>`;
}
function announceDeletedRow(message, index) {
  return `<article class="chat-message is-deleted" data-mid="${e(midOf(message))}"><div class="message-avatar">${e(nameOf(message.by).slice(-2))}</div><div class="chat-body"><div class="chat-meta">${personButton(message.by)}<time>${e(message.at)}</time></div><p class="deleted-note">削除されました</p><div class="chat-tools"><button type="button" data-ui="thread-open" data-source="channel" data-index="${index}">返信 ${message.replies?.length || 0}件</button></div></div></article>`;
}

/* ---------- 入口：ダイアログ ---------- */
function annDialog(element, title, body, action, label, danger = false) {
  const details = element?.closest?.("details");
  const summary = details?.querySelector("summary");
  if (details) details.open = false;
  showModal(title, `${body}${hint("文言は案です（未決定）。")}`, action, label, danger);
  // 閉じたときに、押したボタンではなく、メニューの見出しへフォーカスを戻す。
  if (summary) returnFocus = summary;
}
const annTargetLine = (message) =>
  `<p>対象の投稿：${e(nameOf(message.by))}（${e(message.at)}）「${e(excerpt(message.text))}」</p>`;
const annHidden = (name, value) =>
  `<input type="hidden" name="${name}" value="${e(value)}">`;
const annReasonField = (label, max, required, name) =>
  `<div class="form-field"><label for="ann-reason">${e(label)}</label><textarea id="ann-reason" name="reason" ${required ? 'required data-min="1"' : ""} data-max="${max}" data-name="${e(name)}"></textarea></div>`;
function annFocus(mid) {
  const root = document.querySelector(`[data-mid="${CSS.escape(mid)}"]`);
  const target =
    root?.querySelector(".announce-menu summary") ||
    root?.querySelector('[data-ui="thread-open"]') ||
    screen.querySelector("h1");
  if (target) {
    if (!target.matches("button, summary")) target.setAttribute("tabindex", "-1");
    target.focus();
  }
}
function annAfterModal(mid, ok) {
  closeModal();
  render();
  if (ok && mid) annFocus(mid);
}
function annMenuAction(key, element) {
  // 項目を押したら、メニューは閉じる（拒否のときも）。
  element.closest("details")?.removeAttribute("open");
  const found = annFind(element.dataset.post);
  if (!found) return refuse("お知らせの投稿が見つかりません。");
  const { channel, message } = found;
  // 画面の出し分けとは別に、いま実行できる項目かを確かめる。
  if (!announceMenuFor(channel, message).some(([item]) => item === key))
    return refuse();
  const mid = midOf(message);
  if (key === "edit-own")
    return annDialog(
      element,
      "自分の投稿を編集",
      `<div class="form-field"><label for="ann-text">本文（1〜4,000文字）</label><textarea id="ann-text" name="text" required data-min="1" data-max="${ANN_TEXT_MAX}" data-name="本文">${e(message.text)}</textarea></div>${annHidden("mid", mid)}`,
      "ann-edit-own",
      "保存する",
    );
  if (key === "delete-own")
    return annDialog(
      element,
      "自分の投稿を削除",
      `${annTargetLine(message)}<p>削除すると「削除されました」と表示され、本文は見えなくなります。返信は残ります。</p>${reauthField("ann-reauth")}${annHidden("mid", mid)}`,
      "ann-delete-own",
      "削除する",
      true,
    );
  if (key === "admin-delete")
    return annDialog(
      element,
      "他人の投稿を削除",
      `${annTargetLine(message)}${annReasonField("理由（必須。500文字まで）", ANN_REASON_MAX, true, "削除の理由")}<p class="subtle">理由は監査ログに残ります。投稿者への見せ方は未決定のため、この試作では見せません。</p>${reauthField("ann-reauth")}${annHidden("mid", mid)}`,
      "ann-admin-delete",
      "削除する",
      true,
    );
  if (key === "req-edit" || key === "req-delete") {
    const kind = key === "req-edit" ? "edit" : "delete";
    if (annPendingChanges(mid, kind).length)
      return refuse("すでに依頼されています。");
    return annDialog(
      element,
      kind === "edit" ? "編集を依頼" : "削除を依頼",
      `${annTargetLine(message)}${annReasonField("理由（任意。500文字まで）", ANN_REASON_MAX, false, "依頼の理由")}<p class="subtle">投稿者へ通知し、投稿に印を出します。依頼は取り消せません。</p>${annHidden("mid", mid)}${annHidden("kind", kind)}`,
      "ann-req-change",
      "依頼する",
    );
  }
  if (key === "req-emergency") {
    if (annPendingEmergency(mid)) return refuse("すでに申請中です。");
    return annDialog(
      element,
      "緊急削除を申請",
      `${annTargetLine(message)}${annReasonField("理由（必須。500文字まで）", ANN_REASON_MAX, true, "申請の理由")}<p>承認されるまで投稿は消えません。承認するのは全体管理者です。</p>${annHidden("mid", mid)}`,
      "ann-req-emergency",
      "申請する",
    );
  }
  if (key === "cancel") {
    const request = annPendingEmergency(mid);
    return annDialog(
      element,
      "申請を取り消す",
      `${annTargetLine(message)}<p>緊急削除の申請を取り消します。全体管理者へ通知します。取り消した後も、新しい申請として出し直せます。</p>${annHidden("mid", mid)}${annHidden("rid", request.id)}`,
      "ann-cancel",
      "取り消す",
    );
  }
}
// 印を押すと、依頼・申請の理由と依頼者を見られる（C-114(4)）。
function annOpenMark(element) {
  const kind = element.dataset.kind;
  const request =
    kind === "emergency" ? annEmergency(element.dataset.id) : annChange(element.dataset.id);
  const found = request && annFind(request.mid);
  if (!found || request.status !== "pending") return refuse();
  // 見える人かを確かめる（印を出す条件と同じ）。
  if (!announceMarksFor(found.channel, found.message).some((mark) => mark.id === request.id))
    return refuse();
  const title =
    kind === "emergency"
      ? "緊急削除の申請"
      : `${ANN_CHANGE_LABEL[request.kind]}の依頼`;
  annDialog(
    element,
    title,
    `<dl class="ann-detail"><dt>${kind === "emergency" ? "申請者" : "依頼者"}</dt><dd>${e(nameOf(request.by))}（${e(request.byDept || "")}）</dd><dt>日時</dt><dd>${e(request.at)}</dd><dt>理由</dt><dd>${request.reason ? e(request.reason) : "理由なし"}</dd></dl>`,
    "demo-only",
    "",
  );
}

/* ---------- 入口：ダイアログの送信 ---------- */
const annDecision = (data) => {
  const missing = reauthMissing(data);
  if (missing) {
    modalError(missing);
    return false;
  }
  return true;
};
Object.assign(EXTRA_MODAL, {
  "ann-edit-own": (data) => {
    const mid = String(data.get("mid"));
    annAfterModal(mid, editOwnAnnounce(mid, String(data.get("text") || "")));
  },
  "ann-delete-own": (data) => {
    if (!annDecision(data)) return;
    const mid = String(data.get("mid"));
    annAfterModal(mid, deleteOwnAnnounce(mid));
  },
  "ann-admin-delete": (data) => {
    if (!annDecision(data)) return;
    const mid = String(data.get("mid"));
    annAfterModal(mid, adminDeleteAnnounce(mid, String(data.get("reason") || "")));
  },
  "ann-req-change": (data) => {
    const mid = String(data.get("mid"));
    annAfterModal(
      mid,
      requestChange(mid, String(data.get("kind")), String(data.get("reason") || "")),
    );
  },
  "ann-req-emergency": (data) => {
    const mid = String(data.get("mid"));
    annAfterModal(mid, requestEmergency(mid, String(data.get("reason") || "")));
  },
  "ann-cancel": (data) => {
    const mid = String(data.get("mid"));
    annAfterModal(mid, cancelEmergency(String(data.get("rid"))));
  },
  "ann-approve": (data) => {
    if (!annDecision(data)) return;
    approveEmergency(String(data.get("rid")));
    annAfterList();
  },
  "ann-reject": (data) => {
    if (!annDecision(data)) return;
    rejectEmergency(String(data.get("rid")), String(data.get("reason") || ""));
    annAfterList();
  },
});
function annAfterList() {
  closeModal();
  render();
  focusOrg("#ann-status-filter");
}

/* ---------- 通知・投稿への移動 ---------- */
function annOpenPost(channelId, mid) {
  const channel = prototypeData.channels.find((item) => item.id === channelId);
  if (!channel?.announce || !canReadChannel(channel)) return refuse();
  ui.channelId = channel.id;
  proceedTo("S05");
  ui.flash = { mid, label: "通知・申請一覧から開いた投稿" };
  applyFlash();
}
// S-14 の通知を押したとき（screens.js の notification-open から呼ぶ）。依頼と結果は投稿 S-05、申請と取消は S-37 へ。
function announceOpenNotice(note) {
  if (note.target === "S37") {
    if (!adminOnly()) return refuse();
    return proceedTo("S37");
  }
  return annOpenPost(note.channel, note.mid);
}

/* ---------- S-37 緊急削除の申請一覧 ---------- */
function annRow(request) {
  const found = annFind(request.mid);
  const message = found?.message;
  const channel = prototypeData.channels.find((item) => item.id === request.channelId);
  const post = !message
    ? "（投稿が見つかりません）"
    : message.deleted
      ? "削除されました"
      : `「${excerpt(message.text)}」`;
  const label = `${nameOf(request.by)}の申請（${message?.deleted ? "削除済みの投稿" : excerpt(message?.text || "")}）`;
  const actions =
    request.status === "pending"
      ? `<button type="button" class="button small primary" data-ui="ann-approve" data-id="${e(request.id)}" aria-label="承認：${e(label)}">承認</button><button type="button" class="button small" data-ui="ann-reject" data-id="${e(request.id)}" aria-label="却下：${e(label)}">却下</button>`
      : "";
  const open = `<button type="button" class="button small" data-ui="ann-open-post" data-channel="${e(request.channelId)}" data-post="${e(request.mid)}" aria-label="投稿を開く：${e(label)}">投稿を開く</button>`;
  const rejected =
    request.status === "rejected"
      ? `<p class="ann-reason-line"><strong>却下の理由:</strong> ${e(request.rejectReason)}</p>`
      : "";
  return `<tr><td data-label="申請日時">${e(request.at)}</td><td data-label="申請者（部署）">${e(nameOf(request.by))}（${e(request.byDept || "")}）</td><td data-label="チャンネル"># ${e(channel?.name || "")}</td><td data-label="投稿者">${message ? e(nameOf(message.by)) : "—"}</td><td data-label="状態"><span class="badge ${ANN_STATUS_BADGE[request.status]}">${e(ANN_STATUS[request.status])}</span></td><td data-label="内容"><p>投稿: ${e(post)}</p><p class="ann-reason-line"><strong>理由:</strong> ${e(request.reason)}</p>${rejected}<div class="inline-actions">${actions}${open}</div></td></tr>`;
}
function emergencyListScreen() {
  const filter = Object.hasOwn(ANN_STATUS, ui.annFilter) ? ui.annFilter : "pending";
  const rows = prototypeData.emergencyRequests
    .filter((request) => request.status === filter)
    .sort((a, b) => b.ts - a.ts);
  const toolbar = `<div class="directory-toolbar">${selectField(
    "状態",
    "ann-status-filter",
    Object.entries(ANN_STATUS),
    filter,
  )}</div>`;
  const table = rows.length
    ? `<table class="ann-table"><caption class="visually-hidden">緊急削除の申請（${e(ANN_STATUS[filter])}、新しい順）</caption><thead><tr><th scope="col">申請日時</th><th scope="col">申請者（部署）</th><th scope="col">チャンネル</th><th scope="col">投稿者</th><th scope="col">状態</th><th scope="col">内容と操作</th></tr></thead><tbody>${rows.map(annRow).join("")}</tbody></table>`
    : `<p class="empty-note" role="status">${filter === "pending" ? "処理待ちの申請はありません（文言は案）" : `状態が「${e(ANN_STATUS[filter])}」の申請はありません`}</p>`;
  return screenFrame(
    "S37",
    "緊急削除の申請一覧",
    "お知らせ専用チャンネルの緊急削除の申請を確認し、承認または却下します。承認・却下は再認証してから実行します。",
    shellCard(
      "申請",
      `${toolbar}${table}${hint("文言・絞り込み・並びの細部は案です（未決定）。対応済みの依頼は画面では見せず、監査ログで確認します。")}`,
    ),
  );
}
document.addEventListener("change", (event) => {
  if (event.target.id !== "ann-status-filter") return;
  ui.annFilter = event.target.value;
  render();
  document.getElementById("ann-status-filter")?.focus();
});

/* ---------- クリックの受け口（extras.js の表に足す） ---------- */
function annRequestOfButton(element) {
  const request = annEmergency(element.dataset.id);
  if (!adminOnly()) return refuse();
  if (!request || request.status !== "pending") {
    notify("この申請はすでに処理されています。");
    render();
    return null;
  }
  return request;
}
Object.assign(EXTRA_UI, {
  "ann-edit-own": (element) => annMenuAction("edit-own", element),
  "ann-delete-own": (element) => annMenuAction("delete-own", element),
  "ann-admin-delete": (element) => annMenuAction("admin-delete", element),
  "ann-req-edit": (element) => annMenuAction("req-edit", element),
  "ann-req-delete": (element) => annMenuAction("req-delete", element),
  "ann-req-emergency": (element) => annMenuAction("req-emergency", element),
  "ann-cancel": (element) => annMenuAction("cancel", element),
  "ann-mark": annOpenMark,
  "ann-open-post": (element) => annOpenPost(element.dataset.channel, element.dataset.post),
  "ann-approve": (element) => {
    const request = annRequestOfButton(element);
    if (!request) return;
    const found = annFind(request.mid);
    if (!found || found.message.deleted) {
      notify("投稿はすでに削除されているため、承認できません。");
      return render();
    }
    showModal(
      "緊急削除を承認",
      `${annTargetLine(found.message)}<p>申請者: ${e(nameOf(request.by))}。理由: ${e(request.reason)}</p><p>承認すると、投稿は「削除されました」の表示になります。</p>${reauthField("ann-reauth")}${annHidden("rid", request.id)}${hint("文言は案です（未決定）。")}`,
      "ann-approve",
      "承認する",
      true,
    );
  },
  "ann-reject": (element) => {
    const request = annRequestOfButton(element);
    if (!request) return;
    showModal(
      "緊急削除を却下",
      `<p>申請者: ${e(nameOf(request.by))}。理由: ${e(request.reason)}</p>${annReasonField("却下の理由（任意。500文字まで）", ANN_REASON_MAX, false, "却下の理由")}${reauthField("ann-reauth")}${annHidden("rid", request.id)}${hint("文言は案です（未決定）。")}`,
      "ann-reject",
      "却下する",
    );
  },
});
["ann-open-post"].forEach((name) => LEAVING_UI.add(name));
