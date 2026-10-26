"use strict";

// このファイルは操作を確かめるための試作品。すべてのデータは再読み込みで初期化される。
const employees = [
  {
    id: "u1",
    name: "testuser_001",
    role: "member",
    department: "営業部",
    active: true,
  },
  {
    id: "u2",
    name: "testuser_002",
    role: "owner",
    department: "営業部",
    active: true,
  },
  {
    id: "u3",
    name: "testuser_003",
    role: "member",
    department: "設計部",
    active: true,
  },
  {
    id: "u4",
    name: "testuser_004",
    role: "owner",
    department: "設計部",
    active: true,
  },
  {
    id: "u5",
    name: "testuser_005",
    role: "admin",
    department: "営業部",
    ownerOf: ["総務部"],
    active: true,
  },
  // 無効化した退職者の見本（C-37）。有効な社員は必ず1つの部署に所属するため、所属はなく、ログインできない。
  // 社員の切り替え・DMの相手・社員一覧には出ず、アカウント管理（S-22）の無効なアカウントにだけ出る。
  {
    id: "u6",
    name: "testuser_006",
    role: "member",
    department: null,
    active: false,
  },
  {
    id: "u7",
    name: "testuser_007",
    role: "member",
    department: "総務部",
    active: true,
  },
  {
    id: "u8",
    name: "testuser_008",
    role: "member",
    department: "設計部",
    active: true,
  },
];
// 有効な社員は必ず1つの部署に所属する（C-102）。所属がない（null）のは無効化された退職者だけ。
const deptOf = (person) => person.department || "退職者";
const initialCases = [
  {
    id: "C-104",
    no: "ABC-261001-0001",
    clientCode: "ABC",
    due: "2026-11-15",
    description: "新店舗の開店に向けた什器の配置計画です（架空）。",
    title: "新店舗の什器配置",
    department: "営業部",
    status: "active",
    visibility: "restricted",
    members: ["u1", "u3"],
    messages: [
      {
        by: "u1",
        text: "来月の開店に向けて、什器の配置を確認したいです。",
        at: "10/18 09:20",
        attachments: [{ id: "a-104-1", name: "配置案.pdf", scope: "restricted" }],
        replies: [
          {
            by: "u3",
            text: "配置図の修正案を共有します。",
            at: "10/18 12:05",
            ts: Date.now() - 10 * 60000,
            unreadFor: ["u1"],
          },
        ],
      },
      {
        by: "u3",
        text: "レイアウト案を確認しました。動線を少し広げる案を共有します。",
        at: "10/18 11:45",
        attachments: [
          { id: "a-104-2", name: "動線チェック表.pdf", scope: "public" },
        ],
      },
    ],
    todos: [
      { id: "t1", title: "レイアウト案を確認", done: true, assignee: "u3" },
      { id: "t2", title: "最終配置を決定", done: false, assignee: "u1" },
    ],
    publication: null,
    events: [],
  },
  {
    id: "C-103",
    no: "XYZ-261005-0001",
    clientCode: "XYZ",
    due: "2026-11-30",
    description: "配送ルートの見直し案を比較します（架空）。",
    title: "配送ルートの見直し",
    department: "設計部",
    status: "active",
    visibility: "restricted",
    members: ["u3", "u4"],
    messages: [
      {
        by: "u3",
        text: "移動時間の比較結果をまとめました。",
        at: "10/17 14:10",
      },
    ],
    todos: [{ id: "t3", title: "改善候補を整理", done: false, assignee: "u3" }],
    publication: null,
    events: [],
  },
  {
    id: "C-102",
    no: "INT-250915-0001",
    clientCode: "INT",
    due: "",
    description: "展示会の準備記録です（架空）。",
    title: "昨年度の展示会準備",
    department: "営業部",
    status: "archived",
    visibility: "public",
    members: ["u1", "u2"],
    messages: [
      {
        by: "u1",
        text: "昨年度の展示台のサイズを記録します。",
        at: "09/28 13:10",
        attachments: [
          { id: "a-102-1", name: "備品一覧.pdf", scope: "public" },
          { id: "a-102-2", name: "社内見積メモ.pdf", scope: "restricted" },
        ],
      },
    ],
    todos: [{ id: "t4", title: "備品を手配", done: true, assignee: "u2" }],
    publication: null,
    events: [],
  },
  {
    id: "C-101",
    no: "ABC-250805-0001",
    clientCode: "ABC",
    due: "2025-09-30",
    description: "倉庫移転の候補地を比較した記録です（架空）。",
    title: "倉庫移転の事前調査",
    department: "設計部",
    status: "archived",
    visibility: "restricted",
    members: [],
    messages: [
      {
        by: "u3",
        text: "過去の倉庫調査結果をまとめました。",
        at: "08/21 10:20",
        attachments: [
          { id: "a-101-1", name: "候補地比較.pdf", scope: "restricted" },
        ],
      },
    ],
    todos: [{ id: "t5", title: "候補地を比較", done: true, assignee: null }],
    publication: null,
    events: [],
  },
];
const state = {
  userId: "u1",
  page: "S01",
  caseTab: "active",
  selectedId: null,
  detailTab: "messages",
  // TODOの編集中の項目。todoId が "" のときは新規追加。draft は再描画しても入力を残すため。
  todoEdit: null,
  viewState: "data",
  scope: "all",
  query: "",
  cases: initialCases,
  requests: [
    {
      id: "R-12",
      title: "受付フローの更新",
      clientCode: "ABC",
      due: "2026-12-10",
      description: "受付の流れを見直します（架空）。",
      caseNo: "",
      department: "営業部",
      applicant: "u1",
      candidates: ["u3"],
      added: [],
      status: "pending",
      reason: "",
      previous: null,
    },
    {
      id: "R-11",
      title: "仕入先への確認事項",
      clientCode: "INT",
      due: "",
      description: "",
      caseNo: "",
      department: "営業部",
      applicant: "u1",
      candidates: ["u3"],
      added: [],
      status: "rejected",
      reason: "対象範囲をもう少し具体的にしてください。",
      previous: null,
    },
  ],
  // RR-01 は、却下された再開申請の見本（5-6 AC-5・AC-6）。「自分の申請」から修正して再申請できる。
  reopenRequests: [
    {
      id: "RR-01",
      caseId: "C-101",
      department: "設計部",
      applicant: "u7",
      reason: "過去の調査結果を確認したい（架空）。",
      status: "rejected",
      decisionReason: "再開の目的を具体的に書いてください。",
      previous: null,
      added: [],
    },
  ],
  audit: [],
  clients: [
    { code: "INT", name: "社内", active: true },
    { code: "ABC", name: "テスト商事(架空)", active: true },
    { code: "XYZ", name: "サンプル工業(架空)", active: true },
    { code: "DEF", name: "サンプル運送(架空)", active: false },
  ],
};
const reviewViewLog = new WeakMap();
const screen = document.querySelector("#screen");
const modal = document.querySelector("#modal");
const toast = document.querySelector("#toast");
let toastTimer;
let returnFocus = null;
// 無効化された社員は、記録時点の表示名に「退職者」を併記する（0-1 AC-14）。
const nameOf = (id) => {
  const person = employees.find((value) => value.id === id);
  if (!person) return "退職した社員";
  return person.active ? person.name : `${person.name}（退職者）`;
};
const currentUser = () =>
  employees.find((person) => person.id === state.userId);
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const e = escapeHtml;
const getCase = (id) => state.cases.find((item) => item.id === id);
const getRequest = (id) => state.requests.find((item) => item.id === id);
const getReopen = (id) => state.reopenRequests.find((item) => item.id === id);
const isMember = (item) => item.members.includes(state.userId);
const canSeeContent = (item) =>
  isMember(item) ||
  (item.status === "archived" && item.visibility === "public") ||
  canReviewPublication(item) ||
  canReviewReopenItem(item);
const canReview = (department) =>
  currentUser().role === "admin" ||
  (currentUser().role === "owner" && currentUser().department === department);
const canReviewRequest = (request) =>
  request.status === "pending" &&
  canReview(request.department) &&
  (request.applicant !== state.userId || currentUser().role === "admin");
const canReviewPublication = (item) =>
  item.publication?.status === "pending" &&
  canReview(item.department) &&
  (item.publication.applicant !== state.userId ||
    currentUser().role === "admin");
const canReviewReopen = (request) =>
  request.status === "pending" &&
  canReview(request.department) &&
  (request.applicant !== state.userId || currentUser().role === "admin");
// 審査中の再開申請（1案件1件。5-6 AC-7）。審査する人は、審査中だけ過去の内容を読み取り専用で見られる（5-6 AC-3）。
const pendingReopenOf = (item) =>
  state.reopenRequests.find(
    (request) => request.caseId === item.id && request.status === "pending",
  );
const canReviewReopenItem = (item) => {
  const request = pendingReopenOf(item);
  return !!request && canReviewReopen(request);
};
// 参加者が外れたとき、未完了のTODOは担当なしに戻して以前の担当名を残し、完了済みは完了時の担当名を残す（5-4 AC-6）。
const releaseAssignee = (item, userIds) =>
  item.todos.forEach((todo) => {
    if (todo.done || !userIds.includes(todo.assignee)) return;
    todo.formerAssignee = nameOf(todo.assignee);
    todo.assignee = null;
  });
// 進捗は「完了数/全体数」の数字と進捗バーを併用し、パーセントは出さない（C-84）。0件は「項目なし」。
const progressOf = (item) =>
  item.todos.length
    ? `${item.todos.filter((todo) => todo.done).length}/${item.todos.length}`
    : "項目なし";
const progressHtml = (item) => {
  if (!item.todos.length) return '<span class="progress-none">項目なし</span>';
  const done = item.todos.filter((todo) => todo.done).length;
  return `<span class="progress-wrap"><span class="progress-num">${done}/${item.todos.length}</span><progress max="${item.todos.length}" value="${done}" aria-label="${item.todos.length}項目中${done}項目が完了"></progress></span>`;
};
const clientByCode = (code) =>
  state.clients.find((client) => client.code === code);
const clientNameOf = (code) => clientByCode(code)?.name || "（取引先なし）";
const dueText = (value) => (value ? value : "");
// 案件番号は承認時に自動で付く（C-89）。形式: 取引先コード-YYMMDD-その取引先のその年の連番4桁。
const issueCaseNo = (clientCode) => {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const used = state.cases.filter(
    (item) =>
      item.clientCode === clientCode && item.no.split("-")[1].slice(0, 2) === yy,
  ).length;
  return `${clientCode}-${yy}${mm}${dd}-${String(used + 1).padStart(4, "0")}`;
};
const notify = (message) => {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4500);
};
const refuse = (message) => {
  notify(message || "この操作は現在の社員にはできません。");
  return false;
};
const stamp = () =>
  new Date().toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const record = (item, text, kind = "案件") => {
  const event = { at: stamp(), text };
  item.events.unshift(event);
  state.audit.unshift({
    at: event.at,
    actor: currentUser().name,
    kind,
    target: item.no,
    text,
  });
};
const auditLog = (kind, target, text) =>
  state.audit.unshift({
    at: stamp(),
    actor: currentUser().name,
    kind,
    target,
    text,
  });
const button = (text, action, extra = "", classes = "button small") =>
  `<button type="button" class="${classes}" data-action="${action}" ${extra}>${e(text)}</button>`;
const badge = (text, type) => `<span class="badge ${type}">${e(text)}</span>`;
const requestStatus = (status) =>
  ({
    pending: "承認待ち",
    approved: "承認済み",
    rejected: "却下",
    withdrawn: "取り下げ",
    cancelled: "取消",
  })[status] || status;
const requestType = (status) =>
  ({
    pending: "pending",
    rejected: "rejected",
    withdrawn: "withdrawn",
    cancelled: "withdrawn",
    approved: "active",
  })[status] || "";

function renderNav() {
  renderShell();
}
function stateSwitcher() {
  return "";
}
function statePanel() {
  if (state.viewState === "loading")
    return `<div class="panel state-card"><h2>読み込み中…</h2><div class="skeleton"></div><div class="skeleton short"></div></div>`;
  if (state.viewState === "error")
    return `<div class="panel state-card" role="alert"><h2>読み込みに失敗しました</h2><p>表示を確認してから、もう一度お試しください。</p></div>`;
  return `<div class="panel state-card"><h2>該当するデータがありません</h2><p>検索条件を変更するか、別の画面を開いてください。</p></div>`;
}
function heading(kicker, title, description, actions = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${e(kicker)}</p><h1>${e(title)}</h1><p class="subtle">${e(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function caseRow(item) {
  const label =
    item.status === "active"
      ? "進行中"
      : item.visibility === "public"
        ? "全社員公開"
        : "参加者限定";
  const badgeType =
    item.status === "active"
      ? "active"
      : item.visibility === "public"
        ? "public"
        : "archived";
  const note = isMember(item)
    ? "参加中"
    : item.status === "archived" && item.visibility === "public"
      ? "公開資料"
      : "概要のみ";
  const reviewNote =
    item.publication?.status === "pending" &&
    (isMember(item) || canReviewPublication(item))
      ? "・公開審査中"
      : "";
  const count = canSeeContent(item) ? `・${item.members.length} 人が参加` : "";
  const due = dueText(item.due);
  return `<button type="button" class="case-row" data-action="open-case" data-id="${e(item.id)}" aria-label="${e(item.no)} ${e(item.title)}の詳細を開く"><div><h3><span class="case-id">${e(item.no)}</span>${e(item.title)}</h3><span class="row-note">取引先: ${e(clientNameOf(item.clientCode))}・${note}${reviewNote}${count}</span><span class="mobile-meta">担当部署 ${e(item.department)} ・ 進捗 ${progressHtml(item)} ・ 納期 ${due ? e(due) : "なし"}</span></div><span class="cell-text hide-mobile"><span class="cell-label">担当部署</span>${e(item.department)}</span><span>${badge(label, badgeType)}</span><span class="cell-text hide-mobile"><span class="cell-label">進捗</span>${progressHtml(item)}</span><span class="cell-text hide-mobile"><span class="cell-label">納期</span>${due ? e(due) : "なし"}</span><span class="arrow" aria-hidden="true">›</span></button>`;
}
function renderList() {
  const archived = state.caseTab === "archived" || state.page === "archived";
  const items = state.cases
    .filter((item) => item.status === (archived ? "archived" : "active"))
    .filter((item) => state.scope === "all" || isMember(item))
    .filter((item) =>
      [item.title, item.no, clientNameOf(item.clientCode)].some((text) =>
        text.toLowerCase().includes(state.query.trim().toLowerCase()),
      ),
    );
  const title = archived ? "アーカイブ" : "進行中の案件";
  const description = archived
    ? "終了した案件の概要を全社員が確認できます。公開済みの内容は読み取り専用です。"
    : "部署をまたぐ案件も、参加者として指定されれば内容を確認できます。";
  const actions = !archived
    ? button(
        "＋ 案件を申請",
        "new-request",
        "",
        "button primary",
      )
    : "";
  let html =
    heading("S-16 · 案件一覧", title, description, actions) +
    caseSubnav() +
    stateSwitcher();
  if (state.viewState !== "data") {
    // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
    screen.innerHTML = html + statePanel();
    return;
  }
  const openCount = state.cases.filter(
    (item) => item.status === "active",
  ).length;
  const archiveCount = state.cases.filter(
    (item) => item.status === "archived",
  ).length;
  html += `<div class="stat-row"><div class="panel stat"><span>進行中の案件</span><strong>${openCount}</strong></div><div class="panel stat"><span>アーカイブ</span><strong>${archiveCount}</strong></div><div class="panel stat"><span>自分が参加中</span><strong>${state.cases.filter((item) => isMember(item) && item.status === "active").length}</strong></div></div>`;
  html += `<div class="toolbar"><label class="search"><span aria-hidden="true">⌕</span><input id="case-search" type="search" placeholder="件名・案件番号・取引先名で絞り込み" value="${e(state.query)}" autocomplete="off" aria-label="件名・案件番号・取引先名で絞り込み"></label><div class="filters"><label for="scope">表示範囲</label><select id="scope"><option value="all" ${state.scope === "all" ? "selected" : ""}>すべての案件</option><option value="mine" ${state.scope === "mine" ? "selected" : ""}>自分が参加する案件</option></select></div></div>`;
  html += `<div class="panel list-panel"><div class="list-title"><strong>案件一覧</strong><span>${items.length} 件</span></div>${items.length ? `<div class="case-list">${items.map(caseRow).join("")}</div>` : `<div class="empty-screen"><span class="empty-icon">▤</span><h2>該当する案件はありません</h2><p>条件を変えて、もう一度探してください。</p></div>`}</div>`;
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
  screen.innerHTML = html;
}
function renderDetail() {
  const item = getCase(state.selectedId);
  if (!item) {
    state.page = "active";
    render();
    return;
  }
  const archived = item.status === "archived";
  const visible = canSeeContent(item);
  const publicationReview = canReviewPublication(item) && !isMember(item);
  const reopenReview =
    !publicationReview &&
    canReviewReopenItem(item) &&
    !isMember(item) &&
    !(archived && item.visibility === "public");
  const pendingReopen = pendingReopenOf(item);
  const label = archived
    ? item.visibility === "public"
      ? "全社員公開"
      : "参加者限定"
    : "進行中";
  let actions = "";
  if (visible)
    actions += `<button type="button" class="button small" data-ui="org-add" data-kind="case" data-ref="${e(item.id)}" aria-label="${e(item.no)} ${e(item.title)}を整理スペースに登録">整理スペースに登録</button>`;
  if (archived && isMember(item))
    actions += button(
      "再開する",
      "reopen-case",
      `data-id="${item.id}"`,
      "button primary",
    );
  if (archived && item.members.length === 0 && !pendingReopen)
    actions += button(
      "再開を申請",
      "request-reopen",
      `data-id="${item.id}"`,
      "button primary",
    );
  // 審査中は、申請者以外には審査中であることだけを示す（5-6 AC-7）。
  if (archived && item.members.length === 0 && pendingReopen)
    actions += '<span class="status-note" role="status">再開申請の審査中です</span>';
  if (!archived && isMember(item))
    actions += button("案件を終了", "archive-case", `data-id="${item.id}"`);
  if (
    archived &&
    item.visibility === "restricted" &&
    isMember(item) &&
    item.publication?.status !== "pending"
  )
    actions += button(
      "全社員公開を申請",
      "request-publication",
      `data-id="${item.id}"`,
    );
  if (archived && item.visibility === "public" && canReview(item.department))
    actions += button(
      "全社員公開を取り消す",
      "cancel-publication",
      `data-id="${item.id}"`,
      "button danger",
    );
  let html =
    `<div class="detail-top">${button("← 案件一覧へ", "back", "", "button ghost")}</div>` +
    heading(
      item.no,
      item.title,
      `担当部署 ${item.department} ・ 進捗 ${progressOf(item)}`,
      actions,
    ) +
    stateSwitcher();
  if (state.viewState !== "data") {
    // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
    screen.innerHTML = html + statePanel();
    return;
  }
  if (publicationReview) {
    const viewedBy = reviewViewLog.get(item.publication) || new Set();
    if (!viewedBy.has(state.userId)) {
      record(item, `${currentUser().name} が公開審査のため内容を閲覧`);
      viewedBy.add(state.userId);
      reviewViewLog.set(item.publication, viewedBy);
    }
  }
  html += `<div class="detail-meta">${badge(label, archived ? (item.visibility === "public" ? "public" : "archived") : "active")}${visible ? `<span>${item.members.length} 人が参加</span>` : ""}${item.publication?.status === "pending" && (isMember(item) || canReviewPublication(item)) ? badge("公開審査中", "pending") : ""}</div>`;
  if (reopenReview) {
    const viewedBy = reviewViewLog.get(pendingReopen) || new Set();
    if (!viewedBy.has(state.userId)) {
      record(item, `${currentUser().name} が再開申請の審査のため過去の内容を閲覧`, "審査用の閲覧");
      viewedBy.add(state.userId);
      reviewViewLog.set(pendingReopen, viewedBy);
    }
  }
  html += caseInfo(item, visible);
  if (publicationReview)
    html += `<div class="banner"><strong>公開申請の審査用閲覧</strong>審査中のみ、この案件の内容を読み取り専用で確認できます。参加者にはなりません。閲覧は試作内の監査記録に残ります。</div>`;
  if (reopenReview)
    html += `<div class="banner"><strong>再開申請の審査用閲覧</strong>審査中のみ、この案件の過去の内容を読み取り専用で確認できます。参加者にはなりません。閲覧は試作内の監査記録に残ります。</div>`;
  html += publicationStatus(item);
  if (!visible) {
    html += `<div class="panel empty-screen"><span class="empty-icon">♧</span><h2>参加者だけが見られます（非公開）</h2><p>この案件の概要は全社員に表示されます。会話・TODO・資料を確認するには参加が必要です。</p>${archived && item.members.length === 0 ? (pendingReopen ? "<p>再開申請の審査中です。</p>" : "<p>参加者がいないため、再開申請を出せます。承認までは過去の内容を見られません。</p>") : ""}</div>`;
    // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
    screen.innerHTML = html;
    return;
  }
  const readOnly = archived || publicationReview || !isMember(item);
  html += `<div class="detail-grid"><div class="main-column"><section class="panel"><div class="panel-header"><h2>TODO</h2><span class="progress-head">進捗 ${progressHtml(item)}</span></div><div class="panel-body">${todoContent(item, readOnly)}</div></section><section class="panel"><div class="panel-header"><h2>案件のやり取り</h2>${readOnly ? badge("読み取り専用", "archived") : badge("参加者限定", "active")}</div><div class="panel-body"><div class="tabs" role="tablist" aria-label="案件内容">${[
    ["messages", "会話"],
    ["files", "資料"],
  ]
    .map(
      ([tab, title]) =>
        `<button type="button" role="tab" aria-selected="${state.detailTab === tab}" class="tab ${state.detailTab === tab ? "active" : ""}" data-action="detail-tab" data-tab="${tab}">${title}</button>`,
    )
    .join(
      "",
    )}</div>${detailTabContent(item, readOnly)}</div>${state.detailTab === "messages" && !readOnly ? caseComposer(item) : ""}</section><section class="panel"><div class="panel-header"><h2>操作の履歴</h2></div><div class="panel-body">${item.events.length ? `<div class="timeline">${item.events.map((event) => `<div class="timeline-item"><time>${e(event.at)}</time>${e(event.text)}</div>`).join("")}</div>` : '<p class="subtle">この試作中の操作履歴はまだありません。</p>'}</div></section></div><div class="side-column"><section class="panel"><div class="panel-header"><h2>参加者</h2>${!readOnly ? `<button type="button" class="button small" data-ui="case-manage" data-id="${item.id}">参加者を管理</button>` : ""}</div><div class="panel-body">${item.members.length ? item.members.map((id) => `<div class="person"><span class="message-avatar">${e(nameOf(id).slice(-2))}</span><span>${personButton(id)}</span></div>`).join("") : '<p class="subtle">有効な参加者はいません。</p>'}</div></section><section class="panel"><div class="panel-header"><h2>公開範囲</h2></div><div class="panel-body"><div class="muted-box">${archived && item.visibility === "public" ? "全社員が過去の内容を閲覧できます。再開すると過去も含め参加者限定へ戻ります。" : "案件の内容は参加者だけに公開されています。アーカイブを全社員公開するには承認が必要です。"}</div></div></section></div></div>`;
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
  screen.innerHTML = html;
}
// 全社員公開の申請状況。参加者には申請者と審査状況を示し、却下されたときは理由も示す。
// 審査中は申請者本人に「取り下げ」を出す（5-5 AC-5〜AC-7）。
function publicationStatus(item) {
  const request = item.publication;
  if (!request || !(isMember(item) || canReviewPublication(item))) return "";
  const labels = { pending: "審査中", rejected: "却下", withdrawn: "取り下げ" };
  if (!labels[request.status]) return "";
  if (request.status !== "pending" && !isMember(item)) return "";
  const mine = request.status === "pending" && request.applicant === state.userId;
  return `<section class="panel publication-status" id="publication-status" tabindex="-1" aria-label="全社員公開の申請状況"><strong>全社員公開の申請</strong>　申請者：${e(nameOf(request.applicant))}・審査状況：${badge(labels[request.status], requestType(request.status))}${request.status === "rejected" ? `<br>却下理由：${e(request.reason || "（理由なし）")}` : ""}${request.status === "pending" ? "<br>承認までは終了済み・参加者限定のままです。" : ""}${mine ? `<div class="request-actions">${button("申請を取り下げる", "withdraw-publication", `data-id="${e(item.id)}"`, "button small danger")}</div>` : ""}</section>`;
}
function caseStatusLabel(item) {
  if (item.status === "active") return "進行中";
  return item.visibility === "public" ? "終了（全社員公開）" : "終了（参加者限定）";
}
// 非参加者にも見える概要は、件名・状態・担当部署・進捗・納期に案件番号・取引先名を加えた7項目（C-86・C-89）。
function caseInfo(item, visible) {
  const due = dueText(item.due);
  return `<section class="panel case-info" aria-label="案件の概要"><dl class="info-grid"><div><dt>案件番号</dt><dd>${e(item.no)}</dd></div><div><dt>取引先</dt><dd>${e(clientNameOf(item.clientCode))}（${e(item.clientCode)}）</dd></div><div><dt>状態</dt><dd>${e(caseStatusLabel(item))}</dd></div><div><dt>担当部署</dt><dd>${e(item.department)}</dd></div><div><dt>進捗</dt><dd>${progressHtml(item)}</dd></div><div><dt>納期</dt><dd>${due ? e(due) : "設定なし"}</dd></div>${visible ? `<div class="wide"><dt>説明</dt><dd>${e(item.description || "なし")}</dd></div>` : ""}</dl>${visible ? "" : '<p class="subtle">この概要は全社員に表示されます。</p>'}</section>`;
}
function caseComposer(item) {
  const draft = draftFor(`case:${item.id}`);
  return `<form id="message-form" class="composer"><label class="form-label" for="message-text">メッセージを投稿</label><textarea id="message-text" name="text" placeholder="案件の参加者へ共有する内容" required data-max="4000" data-min="1" data-name="メッセージ" data-draft-key="${e(draft.key)}">${e(draft.text)}</textarea>${draftNote(draft)}<div class="composer-actions"><button class="button primary" type="submit">投稿する</button></div></form>`;
}
function detailTabContent(item, readOnly) {
  if (state.detailTab === "messages") return messageRows(item.messages, "case");
  if (state.detailTab === "todos")
    return `${
      item.todos.length
        ? item.todos
            .map(
              (todo) =>
                `<div class="todo-item ${todo.done ? "done" : ""}"><input type="checkbox" aria-label="${e(todo.title)}を完了" data-todo="${e(todo.id)}" ${todo.done ? "checked" : ""} ${readOnly ? "disabled" : ""}><span class="todo-title">${e(todo.title)}</span><span class="todo-owner">${todo.assignee ? e(nameOf(todo.assignee)) : "担当なし"}</span></div>`,
            )
            .join("")
        : '<div class="muted-box">項目なし</div>'
    }${!readOnly ? `<form id="todo-form" class="form-field" style="margin-top:18px"><label for="todo-title">TODOを追加</label><input id="todo-title" name="title" maxlength="100" required placeholder="次に行うこと"><button class="button small" type="submit">追加する</button></form>` : ""}`;
  return caseFiles(item);
}
// 資料の一覧は、メッセージの添付から作る（元のメッセージに結び付けたまま、二重には持たない。5-2 AC-7）。
function caseFiles(item) {
  const rows = item.messages.flatMap((message) =>
    (message.attachments || []).map((att) => ({ message, att })),
  );
  const note =
    '<p class="form-hint">添付ごとに「公開可能」「参加者限定」を区別します。公開可能の添付も、全社員公開が承認されるまでは参加者だけが見られます。添付の追加と、添付後の区分の変更はこの試作では再現していません。</p>';
  if (!rows.length) return `${note}<div class="muted-box">資料はありません。</div>`;
  return (
    note +
    rows
      .map(({ message, att }) => {
        const restricted = att.scope === "restricted";
        if (restricted && !canSeeRestrictedAttachment(item))
          return '<div class="file-row"><span class="file-icon">▧</span>参加者限定の添付 <span class="row-note">（ファイル名・内容は参加者だけが見られます）</span></div>';
        return `<div class="file-row" data-file="${e(att.id)}"><span class="file-icon">▧</span><span>${e(att.name)} <span class="badge ${restricted ? "archived" : "public"}">${restricted ? "参加者限定" : "公開可能"}</span><br><span class="row-note">${e(nameOf(message.by))} の投稿・${e(message.at)}</span></span><span class="inline-actions"><button type="button" class="button small" data-ui="case-file-open" data-mid="${e(midOf(message))}" data-aid="${e(att.id)}" aria-label="${e(att.name)}の元の投稿を開く">元の投稿を開く</button><button type="button" class="button small" data-ui="org-add" data-kind="file" data-ref="${e(att.id)}" aria-label="${e(att.name)}を整理スペースに登録">整理スペースに登録</button></span></div>`;
      })
      .join("")
  );
}
function renderMyRequests() {
  const mine = state.requests
    .filter((request) => request.applicant === state.userId)
    .slice()
    .reverse();
  const reopens = state.reopenRequests
    .filter((request) => request.applicant === state.userId)
    .slice()
    .reverse();
  let html =
    heading(
      "S-16 · 案件一覧",
      "自分の申請",
      "申請・却下・取り下げの履歴を確認できます。",
      button(
        "＋ 案件を申請",
        "new-request",
        "",
        "button primary",
      ),
    ) +
    caseSubnav() +
    stateSwitcher();
  if (state.viewState !== "data") {
    // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
    screen.innerHTML = html + statePanel();
    return;
  }
  html += '<div class="section-stack">';
  if (!mine.length && !reopens.length)
    html +=
      '<div class="panel empty-screen"><span class="empty-icon">◷</span><h2>申請はまだありません</h2><p>自部署の案件を申請できます（全体管理者は全部署）。</p></div>';
  for (const request of mine)
    html += `<section class="panel request-card"><div class="request-card-head"><h2>${e(request.title)}</h2>${badge(requestStatus(request.status), requestType(request.status))}</div><p>${e(request.id)} ・ 担当部署 ${e(request.department)} ・ 取引先: ${e(clientNameOf(request.clientCode))} ・ 納期: ${request.due ? e(request.due) : "なし"} ・ 参加候補: ${e(request.candidates.concat(request.added).map(nameOf).join("、") || "なし")}</p><p>案件番号: ${request.caseNo ? e(request.caseNo) : "承認時に自動で付きます"}</p>${request.previous ? `<p>元の申請: ${e(request.previous)}</p>` : ""}${request.reason ? `<p>${request.status === "rejected" ? "却下理由" : "理由"}: ${e(request.reason)}</p>` : ""}<div class="request-actions">${request.status === "pending" ? button("取り下げ", "withdraw", `data-id="${request.id}"`, "button small danger") : ""}${["rejected", "withdrawn"].includes(request.status) ? button("修正して再申請", "reapply", `data-id="${request.id}"`) : ""}</div></section>`;
  for (const request of reopens)
    html += `<section class="panel request-card"><div class="request-card-head"><h2>再開の申請：${e(getCase(request.caseId)?.title || request.caseId)}</h2>${badge(requestStatus(request.status), requestType(request.status))}</div><p>${e(request.id)} ・ 担当部署 ${e(request.department)} ・ 理由: ${e(request.reason)}</p>${request.previous ? `<p>元の申請: ${e(request.previous)}</p>` : ""}${request.decisionReason && request.status === "rejected" ? `<p>却下理由: ${e(request.decisionReason)}</p>` : ""}<div class="request-actions">${request.status === "pending" ? button("取り下げ", "withdraw-reopen", `data-id="${request.id}"`, "button small danger") : ""}${["rejected", "withdrawn"].includes(request.status) ? button("修正して再申請", "reapply-reopen", `data-id="${request.id}"`) : ""}</div></section>`;
  html += "</div>";
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
  screen.innerHTML = html;
}
function renderApprovals() {
  const requests = state.requests.filter(canReviewRequest);
  const publications = state.cases.filter(canReviewPublication);
  const reopens = state.reopenRequests.filter(canReviewReopen);
  let html =
    heading(
      "S-29 · 案件の承認一覧",
      "案件の承認",
      "担当できる案件作成申請と、関連する公開・再開の審査を確認します。",
    ) + stateSwitcher();
  if (state.viewState !== "data") {
    // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
    screen.innerHTML = html + statePanel();
    return;
  }
  html += '<div class="section-stack">';
  if (!requests.length && !publications.length && !reopens.length)
    html +=
      '<div class="panel empty-screen"><span class="empty-icon">✓</span><h2>承認待ちはありません</h2><p>担当できる申請が届くと、ここに表示されます。</p></div>';
  for (const request of requests)
    html += `<section class="panel request-card"><div class="request-card-head"><h2>案件作成：${e(request.title)}</h2>${badge("承認待ち", "pending")}</div><p>${e(request.id)} ・ 担当部署 ${e(request.department)} ・ 申請者: ${e(nameOf(request.applicant))}</p><p>取引先: ${e(clientNameOf(request.clientCode))}（${e(request.clientCode)}） ・ 納期: ${request.due ? e(request.due) : "なし"} ・ 案件番号は承認時に自動で付きます</p><p>申請された参加候補: ${e(request.candidates.map(nameOf).join("、") || "なし")}</p><p>承認者が追加: ${e(request.added.map(nameOf).join("、") || "なし")}</p><div class="request-actions">${button("内容を確認", "review-request", `data-id="${request.id}"`, "button primary small")}</div></section>`;
  for (const item of publications)
    html += `<section class="panel request-card"><div class="request-card-head"><h2>全社員公開：${e(item.title)}</h2>${badge("承認待ち", "pending")}</div><p>${e(item.no)} ・ 担当部署 ${e(item.department)} ・ 申請者: ${e(nameOf(item.publication.applicant))}</p><p>審査中は内容を読み取り専用で確認できます。</p><div class="request-actions">${button("内容を見る", "review-content", `data-id="${item.id}"`)}${button("公開を審査", "review-publication", `data-id="${item.id}"`, "button primary small")}</div></section>`;
  for (const request of reopens)
    html += `<section class="panel request-card"><div class="request-card-head"><h2>再開：${e(getCase(request.caseId)?.title || request.caseId)}</h2>${badge("承認待ち", "pending")}</div><p>申請者: ${e(nameOf(request.applicant))} ・ 理由: ${e(request.reason)}${request.previous ? ` ・ 元の申請: ${e(request.previous)}` : ""}</p><p>審査中は過去の内容を読み取り専用で確認できます（閲覧は監査記録に残ります）。申請者本人には、承認前は過去の内容を表示しません。</p><div class="request-actions">${button("内容を見る", "review-content", `data-id="${request.caseId}"`)}${button("再開を審査", "review-reopen", `data-id="${request.id}"`, "button primary small")}</div></section>`;
  html += "</div>";
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
  screen.innerHTML = html;
}
function renderGuide() {
  let html =
    heading(
      "GUIDE",
      "確認ガイド",
      "表示する社員を切り替え、合意した権限と画面の変化を確かめてください。",
    ) + stateSwitcher();
  if (state.viewState !== "data") {
    // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
    screen.innerHTML = html + statePanel();
    return;
  }
  html += `<div class="guide-grid"><section class="panel guide-card"><h2>① 案件の申請と承認</h2><p>testuser_001で「自分の申請」を確認できます。testuser_002は営業部オーナー、testuser_005は全体管理者です。</p><ol><li>申請の参加候補を指定する</li><li>承認者が候補を追加する</li><li>承認か理由付き却下を選ぶ</li><li>却下後は別の申請として再申請する</li></ol></section><section class="panel guide-card"><h2>② 閲覧範囲の変化</h2><p>非参加者には案件の概要だけが見えます。案件を終了しても最初は参加者限定です。公開申請の承認後に全社員が読み取り専用で見られます。</p></section><section class="panel guide-card"><h2>③ 再開の違い</h2><p>参加者がいる終了案件は参加者が直接再開できます。参加者ゼロの「倉庫移転の事前調査」は誰でも再開申請できます。承認後に申請者が参加者になります。</p></section><section class="panel guide-card"><h2>④ 画面の状態</h2><p>各画面の「表示状態」から読み込み中・データあり・データなし・エラーを切り替えられます。操作後は画面を再読み込みせず表示が変わります。</p></section><section class="panel guide-card"><h2>この試作の監査記録</h2><p>公開審査の閲覧や権限を変える操作を、この画面内だけで記録します。</p><div class="compact-list">${
    state.audit.length
      ? state.audit
          .slice(0, 8)
          .map((event) => `<div>${e(event.at)}　${e(event.text)}</div>`)
          .join("")
      : "<div>まだ操作はありません。</div>"
  }</div></section><section class="panel guide-card"><h2>この試作について</h2><p>データは架空で、ブラウザのメモリだけにあります。再読み込みすると初期状態に戻ります。資料のダウンロードや実際の認証は行いません。</p></section></div>`;
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
  screen.innerHTML = html;
}
function render() {
  const routeId =
    state.page === "detail"
      ? "S17"
      : state.page === "active" ||
          state.page === "archived" ||
          state.page === "my"
        ? "S16"
        : state.page === "approvals"
          ? "S29"
          : state.page;
  screen.dataset.screenId = /^S\d{2}$/.test(routeId)
    ? `S-${routeId.slice(1)}`
    : "S-01";
  renderNav();
  if (state.page === "detail" || state.page === "S17") renderDetail();
  else if (
    state.page === "my" ||
    (state.page === "S16" && state.caseTab === "my")
  )
    renderMyRequests();
  else if (state.page === "approvals" || state.page === "S29")
    renderApprovals();
  else if (state.page === "guide") renderGuide();
  else if (
    state.page === "S16" ||
    state.page === "active" ||
    state.page === "archived"
  )
    renderList();
  else renderExtraPage(state.page);
  restoreTodoDraft();
}
function restoreTodoDraft() {
  const draft = state.todoEdit?.draft;
  const form = document.querySelector("#todo-form");
  if (!draft || !form) return;
  form.elements.title.value = draft.title;
  form.elements.assignee.value = draft.assignee;
}
function focusTodo(selector) {
  document.querySelector(selector)?.focus();
}
// keepSelected は、選んでいる案件を残したまま画面を変えるとき（参加者の管理）に使う。
function navigate(page, keepSelected = false) {
  state.todoEdit = null;
  if (page !== "S34") ui.setupResult = null;
  if (ui.thread) closeThread();
  if (page === "active") {
    page = "S16";
    state.caseTab = "active";
  }
  if (page === "archived") {
    page = "S16";
    state.caseTab = "archived";
  }
  state.page = page;
  if (!keepSelected) state.selectedId = null;
  state.viewState = "data";
  state.query = "";
  state.scope = "all";
  render();
  screen.focus();
}
function openCase(id) {
  state.todoEdit = null;
  if (ui.thread) closeThread();
  const item = getCase(id);
  if (!item) return refuse("案件が見つかりません。");
  state.selectedId = id;
  state.page = "S17";
  state.detailTab = "messages";
  state.viewState = "data";
  render();
  screen.focus();
}
function modalHtml(title, body, action, actionLabel, danger = false) {
  return `<form id="modal-form" data-submit="${action}"><div class="modal-header"><h2 id="modal-title">${e(title)}</h2>${button("閉じる", "close-modal", "", "button ghost small")}</div><div class="modal-body">${body}<p id="modal-error" class="form-error" role="alert" hidden></p></div><div class="modal-footer">${button("キャンセル", "close-modal")}${actionLabel ? `<button type="submit" class="button ${danger ? "danger" : "primary"}">${e(actionLabel)}</button>` : ""}</div></form>`;
}
function showModal(title, body, action, actionLabel, danger = false) {
  returnFocus = document.activeElement;
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
  modal.innerHTML = modalHtml(title, body, action, actionLabel, danger);
  modal.showModal();
  modal
    .querySelector("input:not([type=hidden]),textarea,select,button")
    ?.focus();
}
function closeModal() {
  modal.close();
  modal.replaceChildren();
  returnFocus?.focus();
}
function modalError(message) {
  const el = document.querySelector("#modal-error");
  el.textContent = message;
  el.hidden = false;
}
function participantOptions(selected = [], exclude = []) {
  return `<div class="checkbox-list">${employees
    .filter((person) => person.active && !exclude.includes(person.id))
    .map(
      (person) =>
        `<label class="checkbox-option"><input type="checkbox" name="candidates" value="${person.id}" ${selected.includes(person.id) ? "checked" : ""}>${e(person.name)} <span class="row-note">${e(deptOf(person))}</span></label>`,
    )
    .join("")}</div>`;
}
function reviewRequest(id) {
  const request = getRequest(id);
  if (!request || !canReviewRequest(request)) return refuse();
  const candidates = request.candidates.concat(request.added);
  showModal(
    "案件申請を審査",
    `<div class="muted-box"><strong>${e(request.title)}</strong><br>担当部署 ${e(request.department)} ・ 申請者: ${e(nameOf(request.applicant))}<br>取引先: ${e(clientNameOf(request.clientCode))}（${e(request.clientCode)}） ・ 納期: ${request.due ? e(request.due) : "なし"}<br>申請者は承認時に自動参加します。案件番号は承認時に自動で付きます。</div><p class="form-label">申請者が指定した候補</p><p class="subtle">${e(request.candidates.map(nameOf).join("、") || "なし")}（削除できません）</p><p class="form-label">承認者が追加する候補</p>${participantOptions(request.added, [request.applicant, ...request.candidates])}<input type="hidden" name="id" value="${e(id)}"><div class="form-field"><label for="review-result">判断</label><select id="review-result" name="result"><option value="approve">承認</option><option value="reject">却下</option></select></div><div class="form-field"><label for="review-reason">却下理由（却下時は必須。1〜200文字）</label><textarea id="review-reason" name="reason" placeholder="申請者に伝える理由" data-max="200" data-name="却下理由"></textarea></div>`,
    "judge-request",
    "判断を確定",
  );
}
function archiveCase(item) {
  if (!item || item.status !== "active" || !isMember(item)) return refuse();
  showModal(
    "案件を終了",
    `<div class="alert">終了後は参加者限定のアーカイブになり、投稿・TODO・参加者変更はできません。全社員公開は別途申請が必要です。</div><p>${e(item.title)} を終了しますか？</p><input type="hidden" name="id" value="${e(item.id)}">`,
    "archive-case",
    "終了する",
  );
}
function requestPublication(item) {
  if (
    !item ||
    item.status !== "archived" ||
    item.visibility !== "restricted" ||
    !isMember(item) ||
    item.publication?.status === "pending"
  )
    return refuse();
  showModal(
    "全社員公開を申請",
    `<div class="alert">承認後は全社員が過去のメッセージ・TODO・資料を閲覧できます。公開された情報は後から閲覧を取り消しても、すでに見た人から回収できません。</div><p>${e(item.title)} を全社員に公開するよう申請しますか？</p><input type="hidden" name="id" value="${e(item.id)}">`,
    "request-publication",
    "公開を申請",
  );
}
function cancelPublication(item) {
  if (
    !item ||
    item.status !== "archived" ||
    item.visibility !== "public" ||
    !canReview(item.department)
  )
    return refuse();
  showModal(
    "全社員公開を取り消す",
    `<div class="alert">案件は終了したまま参加者限定に戻ります。すでに閲覧・ダウンロードされた情報は回収できません。非参加の承認者も、取消後は内容を閲覧できなくなります。</div><p>${e(item.title)}</p><div class="form-field"><label for="cancel-reason">取消理由</label><textarea id="cancel-reason" name="reason" required></textarea></div><div class="form-field"><label for="cancel-reauth">再認証（試作の確認入力）</label><input id="cancel-reauth" name="reauth" type="password" required autocomplete="off"></div><input type="hidden" name="id" value="${e(item.id)}">`,
    "cancel-publication",
    "公開を取り消す",
    true,
  );
}
function reviewPublication(item) {
  if (!item || !canReviewPublication(item)) return refuse();
  showModal(
    "全社員公開を審査",
    `<div class="muted-box">${e(item.title)}<br>申請者: ${e(nameOf(item.publication.applicant))}</div><p class="subtle">承認すると、過去の会話・TODO・資料を全社員が読み取り専用で見られます。</p><input type="hidden" name="id" value="${e(item.id)}"><div class="form-field"><label for="publication-result">判断</label><select id="publication-result" name="result"><option value="approve">承認</option><option value="reject">却下</option></select></div><div class="form-field"><label for="publication-reason">却下理由（却下時は必須）</label><textarea id="publication-reason" name="reason"></textarea></div>${currentUser().role === "admin" && item.publication.applicant === state.userId ? '<label class="checkbox-option"><input type="checkbox" name="reauth">再認証を確認した（試作の確認操作）</label>' : ""}`,
    "judge-publication",
    "判断を確定",
  );
}
// prior があるときは、却下・取り下げされた元の申請を参照して修正し、別の申請として出す（5-6 AC-5）。
function requestReopen(item, prior = null) {
  if (
    !item ||
    item.status !== "archived" ||
    item.members.length !== 0 ||
    pendingReopenOf(item)
  )
    return refuse(
      prior ? "この案件は現在、再開を申請できません。" : undefined,
    );
  showModal(
    prior ? "修正して再申請（再開）" : "再開を申請",
    `<div class="alert">承認されるまで過去の内容は見られません。承認されると、申請者が再開後の参加者になります。</div><p>${e(item.title)}</p>${prior ? `<p class="subtle">元の申請: ${e(prior.id)}（${e(requestStatus(prior.status))}）${prior.decisionReason ? `　却下理由: ${e(prior.decisionReason)}` : ""}</p><input type="hidden" name="previous" value="${e(prior.id)}">` : ""}<div class="form-field"><label for="reopen-reason">再開する理由（必須。1〜200文字）</label><textarea id="reopen-reason" name="reason" required data-max="200" data-min="1" data-name="再開する理由">${e(prior?.reason || "")}</textarea></div><input type="hidden" name="id" value="${e(item.id)}">`,
    "request-reopen",
    prior ? "再申請する" : "再開を申請",
  );
}
function reviewReopen(id) {
  const request = getReopen(id);
  if (!request || !canReviewReopen(request)) return refuse();
  const item = getCase(request.caseId);
  const others = employees.filter(
    (person) => person.active && person.id !== request.applicant,
  );
  showModal(
    "再開申請を審査",
    `<div class="muted-box">${e(item.title)}<br>申請者: ${e(nameOf(request.applicant))}<br>理由: ${e(request.reason)}</div><div class="alert">承認すると、参加者になった人は過去の会話・TODO・資料もすべて見られます（過去の情報も共有されます）。再開後は参加者限定です。承認者は自動では参加しません。</div><p class="form-label">再開後の参加者（参加候補）</p><p class="form-hint">申請者は必ず参加します。承認者は候補を追加できます。候補を外す必要があるときは、理由を付けて却下してください。この案件には以前の有効な参加者がいないため、候補は申請者と、追加する人だけです。</p><div class="checkbox-list"><label class="checkbox-option"><input type="checkbox" checked disabled>${e(nameOf(request.applicant))} <span class="row-note">申請者・必ず参加</span></label>${others.map((person) => `<label class="checkbox-option"><input type="checkbox" name="members" value="${e(person.id)}" data-reselect ${request.added.includes(person.id) ? "checked" : ""}>${e(person.name)} <span class="row-note">${e(deptOf(person))}</span></label>`).join("")}</div><input type="hidden" name="members" value="${e(request.applicant)}"><div id="reselect-summary" class="muted-box reopen-preview" aria-live="polite">${e(reselectSummary(item, [request.applicant, ...request.added]))}</div><input type="hidden" name="case" value="${e(item.id)}"><input type="hidden" name="id" value="${e(id)}"><div class="form-field"><label for="reopen-result">判断</label><select id="reopen-result" name="result"><option value="approve">承認</option><option value="reject">却下</option></select></div><div class="form-field"><label for="reopen-decision-reason">却下理由（却下時は必須。1〜200文字）</label><textarea id="reopen-decision-reason" name="reason" data-max="200" data-name="却下理由"></textarea></div>`,
    "judge-reopen",
    "判断を確定",
  );
}
// 再開時は以前の参加者を候補にして再選定できる（5-1 AC-16）。結果は監査ログへ残す（C-81）。
function reselectSummary(item, chosen) {
  const names = (ids) => ids.map(nameOf).join("、") || "なし";
  return `残る人: ${names(chosen.filter((id) => item.members.includes(id)))} ／ 追加する人: ${names(chosen.filter((id) => !item.members.includes(id)))} ／ 外れる人: ${names(item.members.filter((id) => !chosen.includes(id)))}`;
}
function reopen(item) {
  if (!item || item.status !== "archived" || !isMember(item)) return refuse();
  showModal(
    "案件を再開",
    `<div class="alert">再開すると、過去の会話・TODO・資料も含めて参加者限定に戻ります。追加した人も過去の内容を見られます。</div><p class="form-label">再開後の参加者</p><p class="form-hint">以前の参加者が候補です。再開する本人は必ず参加します。</p><div class="checkbox-list">${employees
      .filter((person) => person.active)
      .map(
        (person) =>
          `<label class="checkbox-option"><input type="checkbox" name="members" value="${person.id}" data-reselect ${item.members.includes(person.id) ? "checked" : ""} ${person.id === state.userId ? "disabled" : ""}>${e(person.name)} <span class="row-note">${e(deptOf(person))}</span></label>`,
      )
      .join("")}</div><input type="hidden" name="members" value="${e(state.userId)}"><div id="reselect-summary" class="muted-box" aria-live="polite">${e(reselectSummary(item, item.members))}</div><input type="hidden" name="id" value="${e(item.id)}">`,
    "reopen-case",
    "再開する",
  );
}
function handleAction(target) {
  const action = target.dataset.action;
  const id = target.dataset.id;
  if (action === "nav") return navigate(target.dataset.page);
  if (action === "state") {
    state.todoEdit = null;
    state.viewState = target.dataset.value;
    return render();
  }
  if (["todo-edit", "todo-add", "todo-cancel", "todo-delete"].includes(action)) {
    const item = getCase(state.selectedId);
    if (!item || item.status !== "active" || !isMember(item)) return refuse();
    const todoId = target.dataset.todo || "";
    if (action === "todo-delete") {
      const todo = item.todos.find((entry) => entry.id === todoId);
      if (!todo) return refuse();
      return showModal(
        "TODOを削除",
        `<p>「${e(todo.title)}」を削除しますか？ 進捗の数にも含まれなくなります。</p><p class="form-hint">この試作では、削除したTODOの一覧と復元は再現していません。</p><input type="hidden" name="id" value="${e(item.id)}"><input type="hidden" name="todo" value="${e(todo.id)}">`,
        "delete-todo",
        "削除する",
        true,
      );
    }
    if (action === "todo-cancel") {
      state.todoEdit = null;
      render();
      return focusTodo(
        todoId
          ? `[data-action="todo-edit"][data-todo="${CSS.escape(todoId)}"]`
          : '[data-action="todo-add"]',
      );
    }
    if (action === "todo-edit" && !item.todos.some((entry) => entry.id === todoId))
      return refuse();
    state.todoEdit = { caseId: item.id, todoId, draft: null };
    render();
    return focusTodo("#todo-title");
  }
  if (action === "open-case") return openCase(id);
  if (action === "back") {
    state.caseTab =
      getCase(state.selectedId)?.status === "archived" ? "archived" : "active";
    return navigate("S16");
  }
  if (action === "detail-tab") {
    state.todoEdit = null;
    state.detailTab = target.dataset.tab;
    return render();
  }
  if (action === "new-request") {
    state.reapplySource = null;
    return navigate("S18");
  }
  if (action === "reapply") {
    const request = getRequest(id);
    if (
      request?.applicant === state.userId &&
      ["rejected", "withdrawn"].includes(request.status)
    ) {
      state.reapplySource = request.id;
      return navigate("S18");
    }
    return refuse();
  }
  if (action === "review-request") return reviewRequest(id);
  if (action === "archive-case") return archiveCase(getCase(id));
  if (action === "request-publication") return requestPublication(getCase(id));
  if (action === "cancel-publication") return cancelPublication(getCase(id));
  if (action === "review-publication") return reviewPublication(getCase(id));
  if (action === "request-reopen") return requestReopen(getCase(id));
  if (action === "review-reopen") return reviewReopen(id);
  if (action === "close-modal") return closeModal();
  if (action === "reopen-case") return reopen(getCase(id));
  if (action === "review-content") {
    const item = getCase(id);
    if (!item || !(canReviewPublication(item) || canReviewReopenItem(item)))
      return refuse();
    notify("審査用の読み取り専用表示です。");
    return openCase(id);
  }
  if (action === "withdraw") {
    const request = getRequest(id);
    if (
      !request ||
      request.status !== "pending" ||
      request.applicant !== state.userId
    )
      return refuse();
    request.status = "withdrawn";
    notify("申請を取り下げました。履歴は残ります。");
    return render();
  }
  if (action === "withdraw-publication") {
    const item = getCase(id);
    if (
      !item ||
      item.status !== "archived" ||
      item.publication?.status !== "pending" ||
      item.publication.applicant !== state.userId
    )
      return refuse();
    item.publication.status = "withdrawn";
    record(item, `${currentUser().name} が全社員公開の申請を取り下げ。審査用の閲覧も終了`, "公開申請の取り下げ");
    render();
    notify("公開申請を取り下げました。履歴は残ります。");
    return document.querySelector("#publication-status")?.focus();
  }
  if (action === "withdraw-reopen") {
    const request = getReopen(id);
    if (
      !request ||
      request.status !== "pending" ||
      request.applicant !== state.userId
    )
      return refuse();
    request.status = "withdrawn";
    const item = getCase(request.caseId);
    if (item)
      record(item, `${currentUser().name} が再開申請を取り下げ。審査用の閲覧も終了`, "再開申請の取り下げ");
    notify("再開申請を取り下げました。履歴は残ります。");
    return render();
  }
  if (action === "reapply-reopen") {
    const request = getReopen(id);
    if (
      !request ||
      request.applicant !== state.userId ||
      !["rejected", "withdrawn"].includes(request.status)
    )
      return refuse();
    return requestReopen(getCase(request.caseId), request);
  }
  if (action === "add-member") {
    const item = getCase(id);
    if (!item || item.status !== "active" || !isMember(item)) return refuse();
    const choices = employees.filter(
      (person) => person.active && !item.members.includes(person.id),
    );
    if (!choices.length) return notify("追加できる社員はいません。");
    return showModal(
      "参加者を追加",
      `<p class="subtle">追加すると、案件の過去の内容も見られるようになります。</p><div class="form-field"><label for="new-member">追加する社員</label><select id="new-member" name="member">${choices.map((person) => `<option value="${person.id}">${e(person.name)}（${e(deptOf(person))}）</option>`).join("")}</select></div><input type="hidden" name="id" value="${e(id)}">`,
      "add-member",
      "追加する",
    );
  }
  if (action === "remove-member") {
    const item = getCase(id),
      member = target.dataset.member;
    if (
      !item ||
      item.status !== "active" ||
      !isMember(item) ||
      !item.members.includes(member)
    )
      return refuse();
    if (item.members.length <= 1)
      return refuse(
        "最後の参加者は退出・削除できません。先に別の社員を追加してください。",
      );
    item.members = item.members.filter((personId) => personId !== member);
    releaseAssignee(item, [member]);
    record(item, `${nameOf(member)} を参加者から外しました`);
    notify("参加者を外しました。閲覧権限にも反映されました。");
    return render();
  }
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (target && !target.disabled) handleAction(target);
});
document.querySelector("#viewer").addEventListener("change", (event) => {
  if (ui.thread) closeThread();
  state.userId = event.target.value;
  state.todoEdit = null;
  state.viewState = "data";
  ui.dmUserId = null;
  ui.profile = null;
  state.caseManage = false;
  ui.manageDept = null;
  ui.announcementDept = null;
  ui.dirFilter = "すべて";
  ui.channelId = defaultChannelId();
  closeModalIfOpen();
  render();
  notify(`${currentUser().name} の表示に切り替えました。`);
});
function closeModalIfOpen() {
  if (modal.open) closeModal();
}
function keepTodoDraft(form) {
  if (!state.todoEdit || !form) return;
  state.todoEdit.draft = {
    title: form.elements.title.value,
    assignee: form.elements.assignee.value,
  };
}
screen.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !event.target.closest?.("#todo-form")) return;
  event.preventDefault();
  event.target.closest("#todo-form").querySelector('[data-action="todo-cancel"]').click();
});
screen.addEventListener("input", (event) => {
  if (event.target.closest("#todo-form")) keepTodoDraft(event.target.form);
  if (event.target.id === "case-search") {
    state.query = event.target.value;
    const selection = {
      start: event.target.selectionStart,
      end: event.target.selectionEnd,
    };
    renderList();
    const field = document.querySelector("#case-search");
    field.focus();
    field.setSelectionRange(selection.start, selection.end);
  }
});
screen.addEventListener("change", (event) => {
  if (event.target.id === "scope") {
    state.scope = event.target.value;
    return render();
  }
  if (event.target.id === "todo-assignee") return keepTodoDraft(event.target.form);
  if (event.target.type === "checkbox" && event.target.dataset.todo) {
    const item = getCase(state.selectedId);
    if (!item || item.status !== "active" || !isMember(item)) return refuse();
    const todo = item.todos.find(
      (entry) => entry.id === event.target.dataset.todo,
    );
    if (!todo) return refuse();
    todo.done = event.target.checked;
    record(
      item,
      `TODO「${todo.title}」を${todo.done ? "完了" : "未完了"}に変更`,
    );
    render();
    focusTodo(`input[data-todo="${CSS.escape(todo.id)}"]`);
  }
});
screen.addEventListener("submit", (event) => {
  if (!["message-form", "todo-form"].includes(event.target.id)) return;
  event.preventDefault();
  const item = getCase(state.selectedId);
  if (!item || item.status !== "active" || !isMember(item)) return refuse();
  const data = new FormData(event.target);
  if (event.target.id === "message-form") {
    const text = String(data.get("text") || "").trim();
    if (!text) return refuse("メッセージを入力してください。");
    item.messages.push({ by: state.userId, text, at: stamp(), replies: [] });
    removeDraft(event.target.querySelector("[data-draft-key]")?.dataset.draftKey);
    record(item, "メッセージを投稿");
  } else {
    const title = String(data.get("title") || "").trim();
    if (!title) return refuse("TODOの題名を入力してください。");
    const assignee = String(data.get("assignee") || "") || null;
    const todoId = event.target.dataset.todo;
    const editing = todoId && item.todos.find((entry) => entry.id === todoId);
    // 完了済みの項目は、完了時の担当名を残すため、参加者でなくなった担当もそのまま残せる（5-4 AC-6）。
    const keepsDoneAssignee = !!editing?.done && editing.assignee === assignee;
    if (
      assignee &&
      !keepsDoneAssignee &&
      !(
        item.members.includes(assignee) &&
        employees.find((person) => person.id === assignee)?.active
      )
    )
      return refuse("担当者は、この案件の有効な参加者から選んでください。");
    let focusId = "";
    if (todoId) {
      const todo = item.todos.find((entry) => entry.id === todoId);
      if (!todo) return refuse();
      const before = `${todo.title}／${todo.assignee ? nameOf(todo.assignee) : "担当なし"}`;
      todo.title = title;
      if (assignee) todo.formerAssignee = null;
      todo.assignee = assignee;
      record(
        item,
        `TODOを編集（${before} → ${title}／${assignee ? nameOf(assignee) : "担当なし"}）`,
      );
      focusId = todo.id;
    } else {
      item.todos.push({
        id: `t${Date.now()}`,
        title,
        done: false,
        assignee,
      });
      record(item, `TODO「${title}」を追加`);
    }
    state.todoEdit = null;
    render();
    notify(todoId ? "TODOを保存しました。" : "TODOを追加しました。");
    return focusTodo(
      focusId
        ? `[data-action="todo-edit"][data-todo="${CSS.escape(focusId)}"]`
        : '[data-action="todo-add"]',
    );
  }
  render();
  notify("内容を更新しました。");
});
modal.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target,
    action = form.dataset.submit,
    data = new FormData(form);
  const id = String(data.get("id") || ""),
    result = data.get("result");
  if (action === "delete-todo") {
    const item = getCase(id);
    if (!item || item.status !== "active" || !isMember(item)) return refuse();
    const todo = item.todos.find((entry) => entry.id === String(data.get("todo")));
    if (!todo) return refuse();
    item.todos = item.todos.filter((entry) => entry !== todo);
    record(item, `TODO「${todo.title}」を削除`);
    state.todoEdit = null;
    closeModal();
    render();
    notify("TODOを削除しました。");
    return focusTodo('[data-action="todo-add"]');
  }
  if (action === "reopen-case") {
    const item = getCase(id);
    if (!item || item.status !== "archived" || !isMember(item)) return refuse();
    const chosen = [...new Set(data.getAll("members").map(String))].filter(
      (memberId) =>
        employees.some((person) => person.id === memberId && person.active),
    );
    if (!chosen.includes(state.userId))
      return modalError("再開する本人は必ず参加者に含めてください。");
    const summary = reselectSummary(item, chosen);
    if (item.publication?.status === "pending") {
      item.publication.status = "cancelled";
      record(item, "再開に伴い公開申請を自動取消。審査用閲覧も終了", "公開申請の自動取消");
    }
    releaseAssignee(
      item,
      item.members.filter((memberId) => !chosen.includes(memberId)),
    );
    item.members = chosen;
    item.status = "active";
    item.visibility = "restricted";
    record(
      item,
      `${currentUser().name} が案件を再開（参加者の再選定 ${summary}）`,
      "案件の再開",
    );
    closeModal();
    render();
    return notify("案件を再開しました。過去の内容も参加者限定に戻りました。");
  }
  if (action === "judge-request") {
    const request = getRequest(id);
    if (!request || !canReviewRequest(request)) return refuse();
    if (!employees.find((person) => person.id === request.applicant)?.active)
      return modalError("申請者が無効です。承認できません。");
    if (
      request.candidates.some(
        (candidate) =>
          !employees.find((person) => person.id === candidate)?.active,
      )
    )
      return modalError("参加候補に無効な社員がいるため承認できません。");
    const reason = String(data.get("reason") || "").trim();
    if (result === "reject" && !reason)
      return modalError("却下理由を入力してください。");
    if (result === "reject") {
      request.status = "rejected";
      request.reason = reason;
      auditLog("案件作成の却下", request.id, `${currentUser().name} が「${request.title}」の作成申請を却下（理由: ${reason}）`);
    } else {
      request.added = data.getAll("candidates").map(String);
      const members = [
        ...new Set([
          request.applicant,
          ...request.candidates,
          ...request.added,
        ]),
      ];
      if (
        members.some(
          (member) => !employees.find((person) => person.id === member)?.active,
        )
      )
        return modalError("無効な社員は参加者にできません。");
      const item = {
        id: `C-${Date.now()}`,
        no: issueCaseNo(request.clientCode),
        clientCode: request.clientCode,
        due: request.due || "",
        description: request.description || "",
        title: request.title,
        department: request.department,
        status: "active",
        visibility: "restricted",
        members,
        messages: [],
        todos: [],
            publication: null,
        events: [],
      };
      state.cases.unshift(item);
      request.status = "approved";
      request.caseNo = item.no;
      record(item, `${currentUser().name} が作成を承認（案件番号 ${item.no} を付与）`, "案件作成の承認");
    }
    closeModal();
    render();
    return notify(
      result === "reject"
        ? "理由付きで却下しました。"
        : "案件を承認し、参加者を確定しました。",
    );
  }
  if (action === "archive-case") {
    const item = getCase(id);
    if (!item || item.status !== "active" || !isMember(item)) return refuse();
    item.status = "archived";
    item.visibility = "restricted";
    record(item, `${currentUser().name} が案件を終了`, "案件の終了");
    closeModal();
    render();
    return notify("案件を参加者限定のアーカイブにしました。");
  }
  if (action === "request-publication") {
    const item = getCase(id);
    if (
      !item ||
      item.status !== "archived" ||
      item.visibility !== "restricted" ||
      !isMember(item) ||
      item.publication?.status === "pending"
    )
      return refuse();
    item.publication = { applicant: state.userId, status: "pending" };
    record(item, `${currentUser().name} が全社員公開を申請`);
    closeModal();
    render();
    return notify("公開申請を送りました。承認までは参加者限定です。");
  }
  if (action === "cancel-publication") {
    const item = getCase(id);
    if (
      !item ||
      item.status !== "archived" ||
      item.visibility !== "public" ||
      !canReview(item.department)
    )
      return refuse();
    const reason = String(data.get("reason") || "").trim();
    if (!reason) return modalError("取消理由を入力してください。");
    if (!String(data.get("reauth") || ""))
      return modalError("再認証の確認入力が必要です。");
    item.visibility = "restricted";
    if (item.publication) item.publication.status = "cancelled";
    record(item, `${currentUser().name} が全社員公開を取消（理由: ${reason}）`);
    closeModal();
    render();
    return notify("全社員公開を取り消し、参加者限定に戻しました。");
  }
  if (action === "judge-publication") {
    const item = getCase(id);
    if (!item || !canReviewPublication(item)) return refuse();
    const reason = String(data.get("reason") || "").trim();
    if (result === "reject" && !reason)
      return modalError("却下理由を入力してください。");
    if (
      currentUser().role === "admin" &&
      item.publication.applicant === state.userId &&
      !data.get("reauth")
    )
      return modalError("自己承認には再認証の確認が必要です。");
    item.publication.status = result === "approve" ? "approved" : "rejected";
    item.publication.reason = reason;
    if (result === "approve") item.visibility = "public";
    record(
      item,
      `${currentUser().name} が公開申請を${result === "approve" ? "承認" : "却下"}`,
    );
    closeModal();
    render();
    return notify(
      result === "approve"
        ? "全社員への公開を反映しました。"
        : "公開申請を却下しました。",
    );
  }
  if (action === "request-reopen") {
    const item = getCase(id),
      reason = String(data.get("reason") || "").trim();
    if (
      !item ||
      item.status !== "archived" ||
      item.members.length !== 0 ||
      state.reopenRequests.some(
        (request) => request.caseId === id && request.status === "pending",
      )
    )
      return refuse();
    if (!reason) return modalError("再開理由を入力してください。");
    const previous = getReopen(String(data.get("previous") || ""));
    if (
      String(data.get("previous") || "") &&
      (!previous ||
        previous.applicant !== state.userId ||
        !["rejected", "withdrawn"].includes(previous.status))
    )
      return refuse();
    state.reopenRequests.push({
      id: `RR-${String(state.reopenRequests.length + 1).padStart(2, "0")}`,
      caseId: id,
      department: item.department,
      applicant: state.userId,
      reason,
      status: "pending",
      previous: previous?.id || null,
      decisionReason: "",
      added: [],
    });
    record(item, `${currentUser().name} が再開を申請（理由: ${reason}${previous ? `・元の申請 ${previous.id}` : ""}）`, "再開の申請");
    closeModal();
    render();
    return notify("再開を申請しました。承認まで内容は非公開です。");
  }
  if (action === "judge-reopen") {
    const request = getReopen(id),
      item = request && getCase(request.caseId);
    if (
      !request ||
      !item ||
      !canReviewReopen(request) ||
      item.status !== "archived" ||
      item.members.length !== 0
    )
      return refuse();
    const reason = String(data.get("reason") || "").trim();
    if (result === "reject" && !reason)
      return modalError("却下理由を入力してください。");
    // 参加者は申請者と、承認者が追加した候補。申請者1人には固定しない（5-6 AC-4、5-1 AC-16）。
    const chosen = [...new Set([request.applicant, ...data.getAll("members").map(String)])].filter(
      (memberId) =>
        employees.some((person) => person.id === memberId && person.active),
    );
    if (!chosen.includes(request.applicant))
      return modalError("申請者が無効なため承認できません。");
    const summary = reselectSummary(item, chosen);
    request.status = result === "approve" ? "approved" : "rejected";
    request.decisionReason = reason;
    if (result === "approve") {
      if (item.publication?.status === "pending") {
        item.publication.status = "cancelled";
        record(item, "再開に伴い公開申請を自動取消。審査用閲覧も終了");
      }
      request.added = chosen.filter((memberId) => memberId !== request.applicant);
      item.members = chosen;
      item.status = "active";
      item.visibility = "restricted";
    }
    record(
      item,
      `${currentUser().name} が再開申請を${result === "approve" ? `承認（参加者の再選定 ${summary}）` : `却下（理由: ${reason}）`}`,
      result === "approve" ? "再開の承認" : "再開申請の却下",
    );
    closeModal();
    render();
    return notify(
      result === "approve"
        ? "再開し、参加者を確定しました。"
        : "再開申請を却下しました。",
    );
  }
  if (action === "add-member") {
    const item = getCase(id),
      member = String(data.get("member") || "");
    if (!item || item.status !== "active" || !isMember(item)) return refuse();
    if (
      !employees.find((person) => person.id === member && person.active) ||
      item.members.includes(member)
    )
      return modalError("追加できる社員を選んでください。");
    item.members.push(member);
    record(item, `${nameOf(member)} を参加者に追加`);
    closeModal();
    render();
    return notify("参加者を追加しました。閲覧範囲にも反映されました。");
  }
});
modal.addEventListener("change", (event) => {
  if (!event.target.matches("[data-reselect]")) return;
  const data = new FormData(modal.querySelector("form"));
  const item = getCase(String(data.get("case") || data.get("id") || ""));
  if (!item) return;
  document.querySelector("#reselect-summary").textContent = reselectSummary(
    item,
    [...new Set(data.getAll("members").map(String))],
  );
});
modal.addEventListener("cancel", () => {
  modal.replaceChildren();
  returnFocus?.focus();
});
render();
