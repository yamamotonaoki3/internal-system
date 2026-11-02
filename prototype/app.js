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
    departments: ["営業部"],
    status: "active",
    visibility: "restricted",
    members: ["u1", "u3", "u2"],
    messages: [
      {
        by: "u1",
        text: "来月の開店に向けて、什器の配置を確認したいです。",
        at: "10/18 09:20",
        attachments: [{ id: "a-104-1", name: "配置案.pdf", scope: "restricted", by: "u1", size: 1843200, kind: "document" }],
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
          { id: "a-104-2", name: "動線チェック表.pdf", scope: "public", by: "u3", size: 524288, kind: "document" },
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
    departments: ["設計部"],
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
    departments: ["営業部"],
    status: "archived",
    visibility: "public",
    members: ["u1", "u2"],
    messages: [
      {
        by: "u1",
        text: "昨年度の展示台のサイズを記録します。",
        at: "09/28 13:10",
        attachments: [
          { id: "a-102-1", name: "備品一覧.pdf", scope: "public", by: "u1", size: 307200, kind: "document" },
          { id: "a-102-2", name: "社内見積メモ.pdf", scope: "restricted", by: "u1", size: 204800, kind: "document" },
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
    // 一般の参加者がいない終了案件の見本（再開申請の確認用。C-134 で全体管理者は強制参加のため、members は起動時に管理者が加わる）。
    departments: ["総務部"],
    status: "archived",
    visibility: "restricted",
    members: [],
    messages: [
      {
        by: "u3",
        text: "過去の倉庫調査結果をまとめました。",
        at: "08/21 10:20",
        attachments: [
          { id: "a-101-1", name: "候補地比較.pdf", scope: "restricted", by: "u3", size: 921600, kind: "document" },
        ],
      },
    ],
    todos: [{ id: "t5", title: "候補地を比較", done: true, assignee: null }],
    publication: null,
    events: [],
  },
  // 決定 C-129〜C-132 の確認用の見本（架空。件名に [DEMO]）。担当部署が2つの案件、取引先を変えた案件（番号の先頭と現在の取引先が違う）、
  // 現在の取引先が無効の案件（Q-107の確認用）。
  {
    id: "C-105",
    no: "XYZ-261015-0002",
    clientCode: "XYZ",
    due: "2026-12-01",
    description: "担当部署が2つの見本の案件です（架空）。",
    title: "[DEMO] 営業・設計の合同案件",
    departments: ["営業部", "設計部"],
    status: "active",
    visibility: "restricted",
    members: ["u1", "u3", "u2", "u4"],
    messages: [
      {
        by: "u3",
        text: "合同案件の見本です。",
        at: "10/20 10:00",
        attachments: [{ id: "a-105-1", name: "合同計画.pdf", scope: "restricted", by: "u3", size: 409600, kind: "document" }],
        replies: [],
      },
    ],
    todos: [],
    publication: null,
    events: [],
  },
  {
    id: "C-106",
    no: "ABC-250901-0002",
    clientCode: "XYZ",
    due: "",
    description: "取引先を変えた見本の案件です（番号の先頭は発行時の取引先 ABC。架空）。",
    title: "[DEMO] 取引先を変えた案件",
    departments: ["営業部"],
    status: "active",
    visibility: "restricted",
    members: ["u1", "u2"],
    messages: [],
    todos: [],
    publication: null,
    events: [],
  },
  {
    id: "C-107",
    no: "DEF-260901-0001",
    clientCode: "DEF",
    due: "",
    description: "現在の取引先が無効の見本の案件です（架空）。",
    title: "[DEMO] 無効の取引先の案件",
    departments: ["設計部"],
    status: "active",
    visibility: "restricted",
    members: ["u3", "u4"],
    messages: [],
    todos: [],
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
      departments: ["営業部"],
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
      departments: ["営業部"],
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
      applicant: "u7",
      reason: "過去の調査結果を確認したい（架空）。",
      status: "rejected",
      decisionReason: "再開の目的を具体的に書いてください。",
      previous: null,
      added: [],
    },
  ],
  audit: [],
  // 物理削除した案件の番号。連番を再利用しないために残す（5-1 AC-23）。
  purgedCaseNos: [],
  // 再認証の票（メモリだけ。admin.js の issueReauthTicket が作り、consumeReauthTicket が検査する）。
  reauthTickets: [],
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
// 保存時の自動整形（C-121。細部は【案】）。全角英数字→半角、ハイフン類→"-"、連続する空白→1つ、前後の空白を除く。
// 長音符「ー」・波ダッシュは変換しない（Q-42）。先に読まれるファイルのトップレベルからは呼ばず、関数の中から使う。
const normalizeInput = (value) =>
  String(value ?? "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑‒–—−－]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
// 重複の比較用。整形したうえで大文字・小文字を区別しない（【案】）。
const compareKey = (value) => normalizeInput(value).toLowerCase();
const getCase = (id) => state.cases.find((item) => item.id === id);
const getRequest = (id) => state.requests.find((item) => item.id === id);
const getReopen = (id) => state.reopenRequests.find((item) => item.id === id);
const isMember = (item) => item.members.includes(state.userId);
// アーカイブした案件の中身は、全体管理者（強制参加の参加者）だけが読み取り専用で見られる。ほかの人は誰も見られない（Q-70の案。C-135）。
const canViewArchivedCase = (item) =>
  caseArchived(item) && currentUser().role === "admin" && isForcedMember(item, state.userId) && isMember(item);
const canSeeContent = (item) =>
  caseArchived(item)
    ? canViewArchivedCase(item)
    : isMember(item) ||
      (item.status === "archived" && item.visibility === "public") ||
      canReviewPublication(item) ||
      canReviewReopenItem(item);
// 担当部署は配列（departments。1件以上。C-130）。オーナーは、自分の所属部署が担当部署のどれかに完全一致するときだけ（部分一致・前方一致はしない）。
// 配列でない値は、全体管理者でも偽にする（置き換え漏れは、拒否される側に倒れる）。
const ownsAnyDept = (depts) =>
  Array.isArray(depts) && currentUser().role === "owner" && depts.includes(currentUser().department);
const canReview = (depts) => Array.isArray(depts) && (currentUser().role === "admin" || ownsAnyDept(depts));
// 強制参加（C-133・C-134）。「外せない参加者」は、保存した項目を増やさず、次の2つから導く。
//  (1) 有効なすべての全体管理者（role が admin。すべての案件。アーカイブ・終了を含む。兼任のオーナーも全体管理者として数える。Q-115 は解消）
//  (2) 案件の departments が担当する部署の、有効なオーナー（role が owner）
// 管理者でなくなる・退職する・部署が担当から外れる・オーナーが交代すると導かれなくなり、一般の参加者として残る。
const forcedMembers = (depts) =>
  employees.filter(
    (person) =>
      person.active &&
      (person.role === "admin" ||
        (person.role === "owner" && Array.isArray(depts) && depts.includes(person.department))),
  );
const isForcedMember = (item, userId) => forcedMembers(item.departments).some((person) => person.id === userId);
// 強制参加の種類の表示。全体管理者を先に判定する（兼任でも全体管理者と示す）。
const forcedLabel = (item, userId) =>
  employees.find((person) => person.id === userId)?.role === "admin" ? "全体管理者" : "担当部署のオーナー";
// 参加者ゼロ（Q-117）は、強制参加者を除いた一般の参加者がいないこと（全体管理者が常に参加するため、この定義に直した案）。
const noGeneralMembers = (item) => !item.members.some((id) => !isForcedMember(item, id));
// 強制参加者を、まだ参加していなければ参加者に加える（重複させない。通知は出さない。監査ログに案件番号と対象者を残す。Q-116）。
// 前回の同期で強制参加だった人が、管理者でなくなる・退職する・部署が外れるなどで強制参加でなくなり、一般の参加者として残る場合も、監査ログに残す。
// 前回の強制参加者の記録（forcedSeen）は、この同期のときだけ更新するため、同期が呼ばれない間の変化は次の同期で検出する。
// quiet は、起動時のデモデータの初期整合やデモデータの追加用（監査ログを出さない）。加えた社員の ID の配列を返す。
function syncForcedMembers(item, quiet = false) {
  const current = forcedMembers(item.departments);
  const added = [];
  current.forEach((person) => {
    if (!item.members.includes(person.id)) {
      item.members.push(person.id);
      added.push(person.id);
    }
  });
  const currentIds = current.map((person) => person.id);
  const seen = item.forcedSeen || [];
  const lost = seen.filter((id) => !currentIds.includes(id) && item.members.includes(id));
  // 強制参加者の集合の増減で判定する。すでに一般の参加者だった人が強制参加に変わった場合（added には入らない）も記録する。
  const became = item.forcedSeen ? currentIds.filter((id) => !seen.includes(id) && !added.includes(id)) : [];
  item.forcedSeen = currentIds;
  if (!quiet) {
    const describe = (id) => `${nameOf(id)}（${forcedLabel(item, id)}）`;
    if (added.length)
      auditLog("強制参加", item.no, `強制参加の ${added.map(describe).join("・")} が参加者に加わりました（通知は出さない）`);
    if (became.length)
      auditLog("強制参加", item.no, `${became.map(describe).join("・")} は、すでに参加していた一般の参加者から強制参加（外せない）に変わりました`);
    if (lost.length)
      auditLog("強制参加", item.no, `${lost.map(nameOf).join("・")} は強制参加でなくなり、一般の参加者として残ります`);
  }
  return added;
}
const syncAllForcedMembers = (quiet = false) => state.cases.forEach((item) => syncForcedMembers(item, quiet));
// 担当部署の表示。選んだ順のまま「・」でつなぐ（並び順・省略は案。Q-100）。
const deptsText = (item) => (Array.isArray(item.departments) ? item.departments.join("・") : "（不正な値）");
// depts は、承認のように検査済みのコピーで判定したいときに渡す（既定は申請の値）。
const canReviewRequest = (request, depts = request.departments) =>
  request.status === "pending" &&
  canReview(depts) &&
  (request.applicant !== state.userId || currentUser().role === "admin");
const canReviewPublication = (item) =>
  item.publication?.status === "pending" &&
  canReview(item.departments) &&
  (item.publication.applicant !== state.userId ||
    currentUser().role === "admin");
// 再開申請は部署の項目を持たず、対象の案件の担当部署（departments）で判定する。案件がなければ、全体管理者でも審査できない。
const canReviewReopen = (request) => {
  const target = getCase(request.caseId);
  return (
    request.status === "pending" &&
    !!target &&
    canReview(target.departments) &&
    (request.applicant !== state.userId || currentUser().role === "admin")
  );
};
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
// 表示用。取引先を無効にした後も、既存の案件には名前をそのまま出し「（無効）」の印を付ける（C-117(4)）。
const clientLabelOf = (code) =>
  `${clientNameOf(code)}${clientByCode(code) && !clientByCode(code).active ? "（無効）" : ""}`;
// 案件番号の検索は、番号だけ前方一致（大文字・小文字を区別しない）。件名・取引先名は部分一致のまま（C-117(4)）。
// ハイフンなし（ABC261024）の入力も一致する（C-120(9)）。入力は前後の空白除去・全角→半角の整形（案）をしてから比べる。
// ハイフンを除いて空になる入力（"-" など）は、全件一致を防ぐため一致させない。
const caseNoMatches = (item, term) => {
  const key = compareKey(term).replace(/-/g, "");
  return key !== "" && item.no.toLowerCase().replace(/-/g, "").startsWith(key);
};
// 類似件名の判定（案。C-121(3)・基準は未決定）。同じ取引先の既存の案件（進行中・終了）だけが対象で、申請中の申請は比べない。
// 整形後・小文字化し、空白・ハイフン・アンダースコアを除いた件名が同じ、または3文字以上の一方が他方を含むとき似ているとする。
const similarKey = (value) => compareKey(value).replace(/[\s_-]/g, "");
function similarCases(clientCode, title, exceptId = null) {
  const key = similarKey(title);
  if (!key) return [];
  return state.cases.filter((item) => {
    // アーカイブした案件は、一覧・検索から消えるので、似た案件にも出さない（C-123・C-124）。
    if (caseArchived(item)) return false;
    // 案件の再編集では、編集する案件自身は比べない（C-122。Q-75の案）。
    if (item.id === exceptId) return false;
    if (item.clientCode !== clientCode || !["active", "archived"].includes(item.status)) return false;
    const other = similarKey(item.title);
    if (!other) return false;
    if (other === key) return true;
    const [short, long] = key.length <= other.length ? [key, other] : [other, key];
    return [...short].length >= 3 && long.includes(short);
  });
}
// 納期の表示は「2026-11-15」の形式（C-125）。存在する日付だけを返し、未定は空文字。過ぎた納期にも色や印は付けない。
const dueText = (value) => (isRealDate(value) ? value : "");
// 案件番号は承認時に自動で付く（C-89）。形式: 取引先コード-YYMMDD-その取引先のその年の連番4桁。
const issueCaseNo = (clientCode) => {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const used = usedCaseSeq(clientCode, yy);
  return `${clientCode}-${yy}${mm}${dd}-${String(used + 1).padStart(4, "0")}`;
};
// その取引先のその年の使用済みの連番（最大の連番）。画面確認の見本値（state.caseNoUsed）の大きいほうも使う。
// 使われた番号は、現存の案件と物理削除した案件の両方から数える（欠番を再利用しない）。
const usedCaseSeq = (clientCode, yy) => {
  const seqOf = (no) => {
    const [code, date, seq] = String(no).split("-");
    return code === clientCode && date?.slice(0, 2) === yy ? Number(seq) || 0 : 0;
  };
  return Math.max(
    0,
    ...state.cases.map((item) => seqOf(item.no)),
    ...state.purgedCaseNos.map(seqOf),
    (state.caseNoUsed ||= {})[`${clientCode}-${yy}`] || 0,
  );
};
const CASE_SEQ_MAX = 9999;
const thisYY = () => String(new Date().getFullYear()).slice(-2);
// 連番が9999に達していたら、その日の承認は 409（CONFLICT）の見本として拒否する（V-44・EP-5-04）。
const caseSeqFull = (clientCode) => usedCaseSeq(clientCode, thisYY()) >= CASE_SEQ_MAX;
const notify = (message) => {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4500);
};
// 直近の拒否の理由。ダイアログの中で拒否したとき、ダイアログの上に（通知は隠れるため）理由を出すために使う。
let lastRefusal = "";
const refuse = (message) => {
  lastRefusal = message || "この操作は現在の社員にはできません。";
  notify(lastRefusal);
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
// detail は、変更前・変更後の全文を残す行だけが持つ（案件の編集。S-25 で「全文を見る」に出す）。表示用の text とは別に持つ。
const auditLog = (kind, target, text, detail) =>
  state.audit.unshift({
    at: stamp(),
    actor: currentUser().name,
    kind,
    target,
    text,
    ...(detail ? { detail } : {}),
  });
// 主な処理のあとの後始末（下書きの消去・画面の整理など）。失敗しても主な処理の結果（保存・監査ログ・通知）は変えず、失敗を警告と監査ログに残す。
function runCleanup(label, target, task) {
  try {
    task();
    return true;
  } catch (error) {
    console.warn(`後始末に失敗しました（${label}）`, error);
    auditLog("後始末の失敗", String(target), `${label}に失敗しました（主な処理は完了しています）`);
    return false;
  }
}
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
  return `<button type="button" class="case-row" data-action="open-case" data-id="${e(item.id)}" aria-label="${e(item.no)} ${e(item.title)}の詳細を開く"><div><h3><span class="case-id">${e(item.no)}</span>${e(item.title)}</h3><span class="row-note">取引先: ${e(clientLabelOf(item.clientCode))}・${note}${reviewNote}${count}</span><span class="mobile-meta">担当部署 ${e(deptsText(item))} ・ 進捗 ${progressHtml(item)} ・ 納期 ${due ? e(due) : "なし"}</span></div><span class="cell-text hide-mobile"><span class="cell-label">担当部署</span>${e(deptsText(item))}</span><span>${badge(label, badgeType)}</span><span class="cell-text hide-mobile"><span class="cell-label">進捗</span>${progressHtml(item)}</span><span class="cell-text hide-mobile"><span class="cell-label">納期</span>${due ? e(due) : "なし"}</span><span class="arrow" aria-hidden="true">›</span></button>`;
}
function renderList() {
  const archived = state.caseTab === "archived" || state.page === "archived";
  const items = state.cases
    .filter((item) => !caseArchived(item))
    .filter((item) => item.status === (archived ? "archived" : "active"))
    .filter((item) => state.scope === "all" || isMember(item))
    .filter((item) =>
      [item.title, clientNameOf(item.clientCode)].some((text) =>
        text.toLowerCase().includes(state.query.trim().toLowerCase()),
      ) || caseNoMatches(item, state.query),
    );
  // 「アーカイブ」は、管理者が非表示にしたもの（S-38）。ここの終了した案件とは別（Q-82）。
  const title = archived ? "終了した案件" : "進行中の案件";
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
    (item) => !caseArchived(item) && item.status === "active",
  ).length;
  const archiveCount = state.cases.filter(
    (item) => !caseArchived(item) && item.status === "archived",
  ).length;
  html += `<div class="stat-row"><div class="panel stat"><span>進行中の案件</span><strong>${openCount}</strong></div><div class="panel stat"><span>終了した案件</span><strong>${archiveCount}</strong></div><div class="panel stat"><span>自分が参加中</span><strong>${state.cases.filter((item) => !caseArchived(item) && isMember(item) && item.status === "active").length}</strong></div></div>`;
  html += `<div class="toolbar"><label class="search"><span aria-hidden="true">⌕</span><input id="case-search" type="search" placeholder="件名・案件番号（先頭から一致）・取引先名で絞り込み" value="${e(state.query)}" autocomplete="off" aria-label="件名・案件番号（先頭から一致）・取引先名で絞り込み"></label><div class="filters"><label for="scope">表示範囲</label><select id="scope"><option value="all" ${state.scope === "all" ? "selected" : ""}>すべての案件</option><option value="mine" ${state.scope === "mine" ? "selected" : ""}>自分が参加する案件</option></select></div></div>`;
  html += `<div class="panel list-panel"><div class="list-title"><strong>案件一覧</strong><span>${items.length} 件</span></div>${items.length ? `<div class="case-list">${items.map(caseRow).join("")}</div>` : `<div class="empty-screen"><span class="empty-icon">▤</span><h2>該当する案件はありません</h2><p>条件を変えて、もう一度探してください。</p></div>`}</div>`;
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
  screen.innerHTML = html;
}
function renderDetail() {
  const item = getCase(state.selectedId);
  if (!item || (caseArchived(item) && !canViewArchivedCase(item))) {
    state.selectedId = null;
    state.page = "active";
    render();
    return;
  }
  const archived = item.status === "archived";
  // アーカイブ（非表示）した案件を、全体管理者が読み取り専用で見ているとき（C-135）。操作の入口は復元の「⋯」だけにする。
  const deleted = caseArchived(item);
  const visible = canSeeContent(item);
  const publicationReview = !deleted && canReviewPublication(item) && !isMember(item);
  const reopenReview =
    !deleted &&
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
  // 編集・納期の変更・アーカイブの入口は「⋯」メニューにまとめる（C-131(6)。項目は S-40 と同じ権限関数で出し分ける）。
  actions += kebabHtml(item.no, caseMenuItems(item, isMember(item) ? "案件を編集" : "案件を編集（管理者）"));
  if (archived && isMember(item))
    actions += button(
      "再開する",
      "reopen-case",
      `data-id="${item.id}"`,
      "button primary",
    );
  if (archived && !isMember(item) && noGeneralMembers(item) && !pendingReopen)
    actions += button(
      "再開を申請",
      "request-reopen",
      `data-id="${item.id}"`,
      "button primary",
    );
  // 審査中は、申請者以外には審査中であることだけを示す（5-6 AC-7）。
  if (archived && !isMember(item) && noGeneralMembers(item) && pendingReopen)
    actions += '<span class="status-note" role="status">再開申請の審査中です</span>';
  if (!archived && isMember(item))
    actions += button("案件を終了", "close-case", `data-id="${item.id}"`);
  // アーカイブ（非表示。案件の終了とは別）は、担当部署のオーナーと全体管理者。審査中の申請があるときは出さず、理由を文字で示す。
  if (!canArchiveCase(item) && caseManager(item) && hasPendingReview(item))
    actions += '<span class="status-note" role="status">審査中の申請があるため、アーカイブできません（案）</span>';
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
  if (archived && item.visibility === "public" && canReview(item.departments))
    actions += button(
      "全社員公開を取り消す",
      "cancel-publication",
      `data-id="${item.id}"`,
      "button danger",
    );
  if (deleted) actions = kebabHtml(item.no, caseMenuItems(item, "案件を編集（管理者）"));
  let html =
    `<div class="detail-top">${button("← 案件一覧へ", "back", "", "button ghost")}</div>` +
    heading(
      item.no,
      item.title,
      `担当部署 ${deptsText(item)} ・ 進捗 ${progressOf(item)}`,
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
  if (deleted)
    html += `<div class="banner"><strong>アーカイブ済みの案件（全体管理者だけが閲覧）</strong>強制参加の全体管理者として、中身を読み取り専用で確認しています。ほかの人には見えません。操作は「⋯」の復元だけです。</div>`;
  if (publicationReview)
    html += `<div class="banner"><strong>公開申請の審査用閲覧</strong>審査中のみ、この案件の内容を読み取り専用で確認できます。参加者にはなりません。閲覧は試作内の監査記録に残ります。</div>`;
  if (reopenReview)
    html += `<div class="banner"><strong>再開申請の審査用閲覧</strong>審査中のみ、この案件の過去の内容を読み取り専用で確認できます。参加者にはなりません。閲覧は試作内の監査記録に残ります。</div>`;
  html += publicationStatus(item);
  if (!visible) {
    html += `<div class="panel empty-screen"><span class="empty-icon">♧</span><h2>参加者だけが見られます（非公開）</h2><p>この案件の概要は全社員に表示されます。会話・TODO・資料を確認するには参加が必要です。</p>${archived && noGeneralMembers(item) ? (pendingReopen ? "<p>再開申請の審査中です。</p>" : "<p>参加者がいないため、再開申請を出せます。承認までは過去の内容を見られません。</p>") : ""}</div>`;
    // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
    screen.innerHTML = html;
    return;
  }
  const readOnly = archived || deleted || publicationReview || !isMember(item);
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
    )}</div>${detailTabContent(item, readOnly)}</div>${state.detailTab === "messages" && !readOnly ? caseComposer(item) : ""}</section><section class="panel"><div class="panel-header"><h2>操作の履歴</h2></div><div class="panel-body">${item.events.length ? `<div class="timeline">${item.events.map((event) => `<div class="timeline-item"><time>${e(event.at)}</time>${e(event.text)}</div>`).join("")}</div>` : '<p class="subtle">この試作中の操作履歴はまだありません。</p>'}</div></section></div><div class="side-column"><section class="panel"><div class="panel-header"><h2>参加者</h2>${!readOnly ? `<button type="button" class="button small" data-ui="case-manage" data-id="${item.id}">参加者を管理</button>` : ""}</div><div class="panel-body">${item.members.length ? item.members.map((id) => `<div class="person"><span class="message-avatar">${e(nameOf(id).slice(-2))}</span><span>${personButton(id)}${isForcedMember(item, id) ? ` <span class="badge active">${forcedLabel(item, id)}</span>` : ""}</span></div>`).join("") : '<p class="subtle">有効な参加者はいません。</p>'}</div></section><section class="panel"><div class="panel-header"><h2>公開範囲</h2></div><div class="panel-body"><div class="muted-box">${archived && item.visibility === "public" ? "全社員が過去の内容を閲覧できます。再開すると過去も含め参加者限定へ戻ります。" : "案件の内容は参加者だけに公開されています。アーカイブを全社員公開するには承認が必要です。"}</div></div></section></div></div>`;
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
  return `<section class="panel case-info" aria-label="案件の概要"><dl class="info-grid"><div><dt>案件番号</dt><dd>${e(item.no)}</dd></div><div><dt>取引先</dt><dd>${e(clientLabelOf(item.clientCode))}（${e(item.clientCode)}）</dd></div><div><dt>状態</dt><dd>${e(caseStatusLabel(item))}</dd></div><div><dt>担当部署</dt><dd>${e(deptsText(item))}</dd></div><div><dt>進捗</dt><dd>${progressHtml(item)}</dd></div><div><dt>納期</dt><dd>${due ? e(due) : "設定なし"}</dd></div>${visible ? `<div class="wide"><dt>説明</dt><dd>${e(item.description || "なし")}</dd></div>` : ""}</dl>${visible ? "" : '<p class="subtle">この概要は全社員に表示されます。</p>'}</section>`;
}
// 案件の管理者: 担当部署のオーナーと全体管理者。参加しなくても、件名・納期を変えられる（C-122）。
const caseManager = (item) => canReview(item.departments);
// 案件を再編集できるのは、進行中の案件の参加者と、案件の管理者（C-122）。終了中は表示だけ。
const canEditCase = (item) =>
  !caseArchived(item) && item.status === "active" && (isMember(item) || caseManager(item));
// 納期を変えられる人は、再編集と同じ（C-117(3)に C-122 を追記。参加者、担当部署のオーナー、全体管理者）。
const canChangeDue = (item) => canEditCase(item);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// 存在する日付か。年月日から作り直した日付と照合し、2027-02-30 のような補正される値を拒否する。
function isRealDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}
function changeCaseDue(id, due) {
  const item = typeof id === "string" ? getCase(id) : null;
  if (item && caseArchived(item)) return refuse(ARCHIVED_MESSAGE);
  if (!item || !canChangeDue(item)) return refuse();
  // 空は「未定に戻す」（C-120(5)）。それ以外は存在する日付で、今日（日本時間）以降だけ。
  if (due !== "") {
    if (!isRealDate(due)) return refuse("納期は日付で入力してください。");
    if (due < todayText()) return refuse("今日以降の日付を選んでください。");
  }
  if (due === (item.due || "")) return refuse(due === "" ? "納期はもともと未定です。" : "納期が変わっていません。");
  const before = item.due || "設定なし";
  item.due = due;
  // 変更は監査ログに残す（変更前・変更後・変更者・日時）。通知は付けず、案件の画面に履歴も出さない（C-117(3)）。
  auditLog("案件の納期の変更", item.no, `納期を ${before} から ${due || "設定なし"} に変更`);
  notify("納期を変更しました。");
  return true;
}
function openDueChange(id) {
  const item = getCase(id);
  if (!item || !canChangeDue(item)) return refuse();
  showModal(
    "納期を変更（入力欄の細部は案）",
    `<div class="form-field"><label for="due-input">納期（今日以降の日付。今日は日本時間）</label><input id="due-input" name="due" type="date" min="${e(todayText())}" value="${e(item.due && item.due >= todayText() ? item.due : "")}"></div><label class="checkbox-option"><input type="checkbox" name="clear-due" value="1"> 未定に戻す（日付を空にする）</label><input type="hidden" name="id" value="${e(item.id)}"><p class="subtle">変更は監査ログに残ります。通知は出ません。画面に変更の履歴は出しません。</p>${hint("入力欄の細部は案です（未決定）。")}`,
    "case-due",
    "変更する",
  );
}
// 案件の再編集（C-122・C-129・C-130）。件名・説明・取引先・担当部署を変えられる。案件番号は変えられない（発行時の取引先のまま）。
// 実行する関数（editCase）は画面の操作から分け、保存の直前に検査して、検査した値だけを保存に使う。
// 検査と正規化は cleanCaseEdit にまとめる（件名・説明の規則は screens.js の cleanCaseText と申請で共通、担当部署は cleanDepartments）。
// { error } か { value: { title, description, clientCode, departments, changes, normalized } } を返す。
// changes は実際に変わる項目（"title"・"description"・"clientCode"・"departments"）。送られなかった項目は、現在の値のまま（検査もしない）。
const sameDeptSet = (a, b) => a.length === b.length && a.every((name) => b.includes(name)) && b.every((name) => a.includes(name));
function cleanCaseEdit(item, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return { error: "編集の内容が正しくありません。" };
  // 各値を1度だけ読んでコピーし、検査と保存に同じ値を使う（getter・Proxy で値が変わる入力への対策）。
  const keys = Object.keys(values);
  values = Object.fromEntries(keys.map((key) => [key, values[key]]));
  if (keys.includes("no")) return { error: "案件番号は変えられません（発行時の取引先のまま）。" };
  if (keys.includes("department")) return { error: "担当部署は departments で指定してください。" };
  if (keys.some((key) => !["title", "description", "clientCode", "departments"].includes(key)))
    return { error: "編集できない項目が含まれています。" };
  if (!keys.length) return { error: "変更する項目がありません。" };
  const hasTitle = Object.hasOwn(values, "title");
  const hasDescription = Object.hasOwn(values, "description");
  const hasClient = Object.hasOwn(values, "clientCode");
  const hasDepartments = Object.hasOwn(values, "departments");
  // 説明は参加者だけに見せる。参加していない管理者は、件名・取引先・担当部署を編集できる（Q-67の案。C-129(4)・C-130(3)）。
  if (hasDescription && !isMember(item)) return { error: "説明は、案件の参加者だけが編集できます（案）。" };
  if (hasDescription && typeof values.description !== "string") return { error: "説明は文字で入力してください。" };
  const text = cleanCaseText({
    title: hasTitle ? values.title : item.title,
    description: hasDescription ? values.description : item.description,
  });
  if (text.error) return text;
  // 取引先は、送られたときだけ検査する（有効な取引先）。送られなかったときは、現在の取引先（無効でも）をそのまま残す（Q-107の案）。
  let clientCode = item.clientCode;
  if (hasClient) {
    if (typeof values.clientCode !== "string" || !clientByCode(values.clientCode)?.active)
      return { error: "取引先は、有効なものを選んでください。" };
    clientCode = values.clientCode;
  }
  let departments = [...item.departments];
  if (hasDepartments) {
    const depts = cleanDepartments(values.departments);
    if (depts.error) return depts;
    departments = depts.value;
  }
  const changes = [];
  if (hasTitle && text.value.title !== item.title) changes.push("title");
  if (hasDescription && text.value.description !== item.description) changes.push("description");
  if (hasClient && clientCode !== item.clientCode) changes.push("clientCode");
  if (hasDepartments && !sameDeptSet(departments, item.departments)) changes.push("departments");
  if (!changes.length) return { error: "内容が変わっていません。" };
  return {
    value: {
      title: text.value.title,
      description: text.value.description,
      clientCode,
      departments,
      changes,
      normalized: hasTitle && text.value.changed,
    },
  };
}
const clientWithCode = (code) => `${clientNameOf(code)}（${code}）`;
function editCase(id, values) {
  const item = typeof id === "string" ? getCase(id) : null;
  if (!item) return refuse("案件が見つかりません。");
  if (caseArchived(item)) return refuse(ARCHIVED_MESSAGE);
  if (item.status !== "active") return refuse("終了した案件は編集できません。");
  if (!canEditCase(item)) return refuse();
  const cleaned = cleanCaseEdit(item, values);
  if (cleaned.error) return refuse(cleaned.error);
  const { title, description, clientCode, departments, changes, normalized } = cleaned.value;
  const labels = { title: "件名", description: "説明", clientCode: "取引先", departments: "担当部署" };
  // 監査ログには、変更前・変更後を残す（C-122(5)・C-129(3)・C-130(3)）。取引先は名前とコード、担当部署は配列。
  const detail = changes.map((field) => {
    if (field === "clientCode") return { field, before: clientWithCode(item.clientCode), after: clientWithCode(clientCode) };
    if (field === "departments") return { field, before: [...item.departments], after: [...departments] };
    return { field, before: item[field], after: field === "title" ? title : description };
  });
  if (changes.includes("title")) item.title = title;
  if (changes.includes("description")) item.description = description;
  if (changes.includes("clientCode")) item.clientCode = clientCode;
  if (changes.includes("departments")) item.departments = [...departments];
  // 追加された部署のオーナーは、自動で参加する（C-133）。通知は出さない（Q-116）。
  if (changes.includes("departments")) syncForcedMembers(item);
  // 案件番号（no）には触れない。通知は出さない（試作の案。Q-108）。案件の画面に履歴は出さない。
  auditLog("案件の編集", item.no, `${changes.map((field) => labels[field]).join("・")}を変更`, detail);
  notify(`案件を更新しました。${normalized ? "表記を整えて保存しました（案）。" : ""}`);
  return true;
}
let pendingCaseEdit = null;
// values は、似た件名の警告から「戻って直す」で戻ったときの入力の復元用。
function openCaseEdit(id, values = null) {
  const item = typeof id === "string" ? getCase(id) : null;
  if (!item || !canEditCase(item)) return refuse();
  const member = isMember(item);
  // 戻ってきたとき（values）は、送らなかった取引先・担当部署は現在の値のまま。
  const selectedClient = values && typeof values.clientCode === "string" ? values.clientCode : item.clientCode;
  const selectedDepts = values && Array.isArray(values.departments) ? values.departments : item.departments;
  // 現在の取引先が無効のときは、「（無効）」を付けて先頭に置き、選ばれたままにする（Q-107の案）。
  const currentInvalid = !clientByCode(item.clientCode)?.active;
  const clientOptions = [
    ...(currentInvalid ? [[item.clientCode, `${clientNameOf(item.clientCode)}（${item.clientCode}）（無効）`]] : []),
    ...state.clients.filter((client) => client.active).map((client) => [client.code, `${client.name}（${client.code}）`]),
  ];
  showModal(
    "案件を編集（入力欄の細部は案）",
    `<dl class="info-grid"><div><dt>案件番号</dt><dd>${e(item.no)}</dd></div></dl><p class="form-hint">案件番号は、発行時の取引先（${e(item.no.slice(0, 3))}）のままで、取引先を変えても変わりません。</p><div class="form-field"><label for="edit-client">取引先（現在の取引先）</label><select id="edit-client" name="clientCode">${clientOptions.map(([code, label]) => `<option value="${e(code)}" ${code === selectedClient ? "selected" : ""}>${e(label)}</option>`).join("")}</select></div><fieldset class="form-field"><legend>担当部署（1つ以上。全部署から選べます）</legend><div class="checkbox-list">${departmentNames().map((name) => `<label class="checkbox-option"><input type="checkbox" name="departments" value="${e(name)}" ${selectedDepts.includes(name) ? "checked" : ""}>${e(deptOptionLabel(name))}</label>`).join("")}</div></fieldset><div class="form-field"><label for="edit-title">件名</label><p class="field-note" id="edit-title-note">件名は参加していない人にも見える場合があります。機密情報を書かないでください</p><input id="edit-title" name="title" required value="${e(values ? values.title : item.title)}" aria-describedby="edit-title-note" data-min="1" data-max="100" data-name="件名" data-normalize><p class="form-hint">保存時に表記を自動で整えます（全角英数字を半角に、連続する空白を1つに、ハイフン類を「-」に。細部は案）。同じ取引先に似た件名の案件があるときは、保存の前に警告します（警告だけで止めません。基準は案）。</p></div>${member ? `<div class="form-field"><label for="edit-description">説明（任意）</label><textarea id="edit-description" name="description" data-max="2000" data-name="説明">${e(values && Object.hasOwn(values, "description") ? values.description : item.description || "")}</textarea></div>` : '<p class="subtle">説明は、案件の参加者だけが見て編集できます（案。Q-67）。</p>'}<input type="hidden" name="id" value="${e(item.id)}"><p class="subtle">変更は監査ログに残ります（変更前・変更後）。取引先・担当部署の変更は通知しません（試作の案。Q-108）。案件の画面に変更の履歴は出しません。</p>`,
    "case-edit",
    "保存する",
  );
}
// 似た件名の警告（案）。確定するまで保存しない。「戻って直す」は入力を残して編集の画面へ戻る。Esc・閉じるでは保存しない。
function openCaseEditWarning(similar) {
  showModal(
    "似た案件があります（案）",
    `<p>同じ取引先に、似た件名の案件があります。重複していないかを確かめてください。警告だけで、保存は止めません。</p><ul class="plain-list">${similar
      .map((entry) => `<li>${e(entry.no)} ${e(entry.title)}（${e(caseStatusLabel(entry))}）</li>`)
      .join("")}</ul>${hint("似ているかの判定の基準は未決定です（案：同じ取引先の進行中・終了の案件が対象。編集する案件自身は比べません。整形後に、空白・ハイフン・アンダースコアを除いた件名が同じ、または3文字以上の一方が他方を含むとき）。")}`,
    "case-edit-confirm",
    "このまま保存する",
    false,
    "戻って直す",
    "case-edit-back",
  );
}
// 取引先・担当部署を変えて保存するときの流れ：確認の文（オーナーが自分の所属部署を外すとき。Q-106の案）→ 似た件名の警告（件名か取引先が変わったとき。Q-102の案）→ 保存。
// pending は { id, values, step, ownerOk, similarOk }。続けるを押した確認の文・警告は、済みの印を付けて、同じ流れを続ける。
function proceedCaseEdit(pending) {
  const item = getCase(pending.id);
  if (!item || !canEditCase(item)) {
    pendingCaseEdit = null;
    closeModal();
    return refuse();
  }
  const cleaned = cleanCaseEdit(item, pending.values);
  if (cleaned.error) {
    pendingCaseEdit = null;
    return modalError(cleaned.error);
  }
  const v = cleaned.value;
  const me = currentUser();
  if (
    !pending.ownerOk &&
    me.role === "owner" &&
    v.changes.includes("departments") &&
    item.departments.includes(me.department) &&
    !v.departments.includes(me.department)
  ) {
    pendingCaseEdit = { ...pending, step: "owner" };
    return openCaseEditOwnerConfirm();
  }
  if (!pending.similarOk && (v.changes.includes("title") || v.changes.includes("clientCode"))) {
    const similar = similarCases(v.clientCode, v.title, item.id);
    if (similar.length) {
      pendingCaseEdit = { ...pending, step: "similar" };
      return openCaseEditWarning(similar);
    }
  }
  commitCaseEdit(pending.id, pending.values);
}
// 確認の文（案）。全体管理者・自部署以外を外すときには出さない。
function openCaseEditOwnerConfirm() {
  showModal(
    "担当部署から自分の部署を外します（案）",
    `<p>この部署を外すと、あなたはこの案件の管理者としての権限を失います。参加者としての権限は残ります（案）。</p>${hint("文言・確認の要否は未決定です（案。Q-106）。")}`,
    "case-edit-confirm",
    "このまま保存する",
    false,
    "戻って直す",
    "case-edit-back",
  );
}
function commitCaseEdit(id, values) {
  pendingCaseEdit = null;
  closeModal();
  editCase(id, values);
  render();
  refocusMenuOrigin();
}

// 添付後の公開可否の変更（C-126(7)。細部は案）。変更できる人は、添付した本人と、案件の参加者のうち担当部署のオーナー・全体管理者。
// 案件の終了後と、公開申請の審査中・承認済み（全社員公開）は変更できない。できないときは、理由の文字を返す（できるときは空文字）。
function attachmentScopeBlock(item, att) {
  if (caseArchived(item)) return "アーカイブされています";
  if (!isMember(item)) return "参加者だけが変更できます";
  if (item.publication?.status === "pending") return "公開申請の審査中は変更できません";
  if (item.visibility === "public") return "全社員公開が承認済みのため変更できません";
  if (item.status !== "active") return "終了した案件では変更できません";
  if (!(att.by === state.userId || caseManager(item)))
    return "添付した本人、担当部署のオーナー、全体管理者だけが変更できます";
  return "";
}
const canChangeAttachmentScope = (item, att) => attachmentScopeBlock(item, att) === "";
function findCaseAttachment(item, attId) {
  for (const message of item.messages) {
    if (message.deleted) continue;
    const att = (message.attachments || []).find((value) => value.id === attId);
    if (att) return att;
  }
  return null;
}
// 実行する関数。caseId・attId は存在する文字列、scope は "public"・"restricted" だけ。同じ値は拒否する。
function changeAttachmentScope(caseId, attId, scope) {
  if (typeof caseId !== "string" || typeof attId !== "string") return refuse("対象が見つかりません。");
  if (scope !== "public" && scope !== "restricted") return refuse("公開可否は「公開可能」か「参加者限定」を選んでください。");
  const item = getCase(caseId);
  const att = item && findCaseAttachment(item, attId);
  if (!item || !att) return refuse("添付が見つかりません。");
  if (caseArchived(item)) return refuse(ARCHIVED_MESSAGE);
  const block = attachmentScopeBlock(item, att);
  if (block) return refuse(`公開可否を変更できません。${block}。`);
  if (att.scope === scope) return refuse("公開可否が変わっていません。");
  const label = (value) => (value === "public" ? "公開可能" : "参加者限定");
  const before = att.scope;
  att.scope = scope;
  // 監査ログ【案】。通知は出さない。
  auditLog(
    "添付の公開可否の変更（案）",
    item.no,
    `添付「${att.name}」の公開可否を ${label(before)} から ${label(scope)} に変更`,
  );
  notify("添付の公開可否を変更しました。");
  return true;
}
function openAttachmentScope(caseId, attId) {
  const item = typeof caseId === "string" ? getCase(caseId) : null;
  const att = item && typeof attId === "string" ? findCaseAttachment(item, attId) : null;
  if (!item || !att || !canChangeAttachmentScope(item, att)) return refuse();
  showModal(
    "添付の公開範囲を変える（案）",
    `<p>${e(att.name)}</p><div class="form-field"><label for="att-scope">公開可否</label><select id="att-scope" name="scope"><option value="restricted" ${att.scope === "public" ? "" : "selected"}>参加者限定</option><option value="public" ${att.scope === "public" ? "selected" : ""}>公開可能（全社員公開が承認された場合のみ公開）</option></select></div><input type="hidden" name="id" value="${e(item.id)}"><input type="hidden" name="aid" value="${e(att.id)}"><p class="subtle">変更は監査ログに残ります（案）。通知は出ません。公開可能にしても、全社員公開が承認されるまでは参加者だけが見られます。</p>`,
    "att-scope",
    "変更する",
  );
}
Object.assign(EXTRA_UI, {
  "case-due-open": (element) => openDueChange(element.dataset.id),
  "att-scope-open": (element) => openAttachmentScope(element.dataset.id, element.dataset.aid),
  "seed-caseno": () => {
    (state.caseNoUsed ||= {})[`ABC-${thisYY()}`] = CASE_SEQ_MAX;
    notify("ABC の今年の連番を9999にしました（確認用の見本。業務の操作ではありません）。S-29 で ABC の申請を承認すると、上限の拒否が出ます。");
  },
});
Object.assign(EXTRA_MODAL, {
  // 類似件名の警告で「このまま申請する」を押したときだけ申請を作る。押した直後にボタンを無効にし、二重に作らない。
  "case-request-confirm": () => {
    const button = modal.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    const values = pendingCaseRequest;
    pendingCaseRequest = null;
    closeModal();
    if (values) createCaseRequest(values);
  },
  // 案件の再編集。似た件名があるときだけ、保存の前に警告する（件名が変わったときだけ判定する）。
  "case-edit": (data) => {
    const id = String(data.get("id") || "");
    const item = getCase(id);
    if (!item || !canEditCase(item)) {
      closeModal();
      return refuse();
    }
    const values = { title: String(data.get("title") || "") };
    if (data.has("description")) values.description = String(data.get("description"));
    // 取引先・担当部署は、現在の値と違うときだけ送る（同じなら検査しない。無効の現在値は、そのまま残る。Q-107の案）。
    const clientCode = String(data.get("clientCode") || "");
    if (data.has("clientCode") && clientCode !== item.clientCode) values.clientCode = clientCode;
    const departments = data.getAll("departments").map(String);
    if (!sameDeptSet(departments, item.departments)) values.departments = departments;
    pendingCaseEdit = null;
    proceedCaseEdit({ id, values, step: "", ownerOk: false, similarOk: false });
  },
  // 警告のあとの確定。押した直後にボタンを無効にし、保存は1回だけ。保存の直前に editCase が再検査する。
  "case-edit-confirm": () => {
    const submit = modal.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    const pending = pendingCaseEdit;
    pendingCaseEdit = null;
    if (!pending) return closeModal();
    // 続けるを押した確認の文・警告に、済みの印を付けて、同じ流れを続ける。
    proceedCaseEdit({ ...pending, ownerOk: pending.ownerOk || pending.step === "owner", similarOk: pending.similarOk || pending.step === "similar" });
  },
  "att-scope": (data) => {
    const ok = changeAttachmentScope(
      String(data.get("id") || ""),
      String(data.get("aid") || ""),
      String(data.get("scope") || ""),
    );
    closeModal();
    render();
    if (ok) document.querySelector('[data-ui="att-scope-open"]')?.focus();
  },
  "case-due": (data) => {
    const id = String(data.get("id") || "");
    const ok = changeCaseDue(id, data.get("clear-due") ? "" : String(data.get("due") || "-"));
    closeModal();
    render();
    refocusMenuOrigin();
  },
});
function caseComposer(item) {
  const draft = draftFor(`case:${item.id}`);
  const key = `case:${item.id}`;
  return `<form id="message-form" class="composer"><label class="form-label" for="message-text">メッセージを投稿</label><textarea id="message-text" name="text" placeholder="案件の参加者へ共有する内容" required data-max="4000" data-min="1" data-name="メッセージ" data-draft-key="${e(draft.key)}">${e(draft.text)}</textarea>${draftNote(draft)}${attachAreaHtml(key)}${formatHintHtml}<div class="composer-actions"><span class="inline-actions">${attachToolbarHtml(key)}<button type="button" data-ui="picker-open" data-mode="composer" aria-haspopup="dialog" aria-label="絵文字・スタンプを選ぶ">😀</button></span><button class="button primary" type="submit">投稿する</button></div></form>`;
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
    }${!readOnly ? `<form id="todo-form" class="form-field" style="margin-top:18px"><label for="todo-title">TODOを追加</label><input id="todo-title" name="title" required placeholder="次に行うこと" data-min="1" data-max="100" data-name="TODOの題名" data-normalize><button class="button small" type="submit">追加する</button></form>` : ""}`;
  return caseFiles(item);
}
// 資料の一覧は、メッセージの添付から作る（元のメッセージに結び付けたまま、二重には持たない。5-2 AC-7）。
function caseFiles(item) {
  const rows = item.messages.flatMap((message) =>
    (message.attachments || []).map((att) => ({ message, att })),
  );
  const note =
    '<p class="form-hint">添付ごとに「公開可能」「参加者限定」を区別します。公開可能の添付も、全社員公開が承認されるまでは参加者だけが見られます。添付後の公開可否は、添付した本人と、担当部署のオーナー・全体管理者が変えられます（案件の終了後と、公開申請の審査中・承認済みは不可。C-126）。ファイルの中身は、この試作では送らず保存しません。</p>';
  if (!rows.length) return `${note}<div class="muted-box">資料はありません。</div>`;
  return (
    note +
    rows
      .map(({ message, att }) => {
        const restricted = att.scope === "restricted";
        if (restricted && !canSeeRestrictedAttachment(item))
          return '<div class="file-row"><span class="file-icon">▧</span>参加者限定の添付 <span class="row-note">（ファイル名・内容は参加者だけが見られます）</span></div>';
        return `<div class="file-row" data-file="${e(att.id)}"><span class="file-icon">▧</span><span>${e(att.name)} <span class="badge ${restricted ? "archived" : "public"}">${restricted ? "参加者限定" : "公開可能"}</span><br><span class="row-note">${e(nameOf(att.by || message.by))} が添付 ・ ${e(nameOf(message.by))} の投稿・${e(message.at)}${att.size ? ` ・ ${e(sizeText(att.size))}` : ""}</span>${isMember(item) && !canChangeAttachmentScope(item, att) ? `<br><span class="row-note">公開可否は変更できません: ${e(attachmentScopeBlock(item, att))}</span>` : ""}</span><span class="inline-actions">${canChangeAttachmentScope(item, att) ? `<button type="button" class="button small" data-ui="att-scope-open" data-id="${e(item.id)}" data-aid="${e(att.id)}" aria-label="${e(att.name)}の公開範囲を変える">公開範囲を変える</button>` : ""}<button type="button" class="button small" data-ui="case-file-open" data-mid="${e(midOf(message))}" data-aid="${e(att.id)}" aria-label="${e(att.name)}の元の投稿を開く">元の投稿を開く</button><button type="button" class="button small" data-ui="org-add" data-kind="file" data-ref="${e(att.id)}" aria-label="${e(att.name)}を整理スペースに登録">整理スペースに登録</button></span></div>`;
      })
      .join("")
  );
}
/* ---------- アーカイブ・復元・物理削除（C-123・C-124）と、案件の更新を確定する実行する関数（段階2） ---------- */
// 案件の status の "archived" は「終了」で、deletedAt を持つものが「アーカイブ」（旧：論理削除）。取り違えないこと。
// 実行する関数（コンソールから呼べる）は画面の操作から分け、保存の直前に 型 → 対象の存在 → アーカイブ中でない → 状態 → 権限 の順で検査する。
// 拒否したら理由を表示し、データ・監査ログ・通知・再認証の票を変えない。保存には検査した値だけを使う。
const ARCHIVED_MESSAGE = "アーカイブされているため操作できません（案）。";
let archiveSeq = 0;
const archiveTime = (ts) =>
  new Date(ts).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
// 審査中の公開申請・再開申請がある案件は、アーカイブできない（Q-74の案）。
const hasPendingReview = (item) => item.publication?.status === "pending" || !!pendingReopenOf(item);
const canArchiveCase = (item) => !caseArchived(item) && caseManager(item) && !hasPendingReview(item);
// 復元できるのは、全体管理者と、担当部署のどれかのオーナー（誰がアーカイブしたものでも。C-132(2)。#95 のQ-73の案を置き換え）。
const canRestoreCase = (item) =>
  caseArchived(item) && (adminOnly() || ownsAnyDept(item.departments));
const findChannelById = (id) => (typeof id === "string" ? prototypeData.channels.find((channel) => channel.id === id) : null);
// アーカイブ・復元の通知（S-14）。参加者に出す。退職者・無効の社員と、操作した本人には作らない（宛先の細部は未決定のため案）。
function archiveNotice(recipient, type, text, ref) {
  if (recipient === state.userId || !employees.some((person) => person.id === recipient && person.active)) return;
  prototypeData.notices.unshift({
    id: `n-arc-${++archiveSeq}`,
    recipient,
    type,
    text: `${text}（文言は案）`,
    ...ref,
  });
}
// 端末に残っている下書き（入力欄・スレッドの返信）を、物理削除したものの分だけ消す。
function purgeDraftsOf(kind, id) {
  // 後始末として呼ぶ。保存先の取得・列挙・削除の失敗は、例外のまま呼び出し元（runCleanup）へ伝える。
  const store = draftStorage(true);
  draftKeys(store)
    .filter((key) => key.endsWith(`:${kind}:${id}`) || key.includes(`:thread:${kind}:${id}:`))
    .forEach((key) => store.removeItem(key));
}
// アーカイブ・物理削除したものを開いていた画面（スレッド・選んでいる案件・チャンネル・ダイアログ）を閉じ、既定の画面へ戻す。
function closeArchivedViews(kind, id) {
  if (ui.thread && ui.thread.source === kind && (kind === "case" ? ui.thread.caseId : ui.thread.channelId) === id) closeThread();
  if (kind === "case") {
    if (state.selectedId === id) {
      state.selectedId = null;
      if (["detail", "S17", "S18"].includes(state.page)) state.page = "S16";
    }
    if (pendingCaseEdit?.id === id) pendingCaseEdit = null;
    if (state.todoEdit?.caseId === id) state.todoEdit = null;
    state.caseManage = false;
  } else {
    if (ui.channelId === id) ui.channelId = defaultChannelId();
    if (ui.inviteChannelId === id) ui.inviteChannelId = null;
  }
  delete ui.pendingAttachments[`${kind}:${id}`];
  if (modal.open) closeModal();
}
// 理由（任意・必須）の検査。無効なときは null。
const archiveReason = (reason, required) => annReason(reason === undefined ? "" : reason, required);

function archiveChannel(id, reason, ticket) {
  if (typeof id !== "string") return refuse("チャンネルが見つかりません。");
  if (reason !== undefined && typeof reason !== "string") return refuse(annReasonMessage(false));
  if (ticket !== undefined && typeof ticket !== "string") return refuse("再認証が必要です。");
  const channel = findChannelById(id);
  if (!channel) return refuse("チャンネルが見つかりません。");
  if (chArchived(channel)) return refuse("すでにアーカイブされています。");
  if (!canArchiveChannel(channel)) return refuse(channelKind(channel) === "normal" ? undefined : "このチャンネルは、アーカイブできません（専用・お知らせ専用・全社連絡）。");
  const text = archiveReason(reason, false);
  if (text === null) return refuse(annReasonMessage(false));
  if (!consumeReauthTicket(ticket, "archive-channel", channel.id)) return false;
  channel.deletedAt = Date.now();
  channel.deletedBy = state.userId;
  channel.deleteReason = text;
  channel.members.forEach((member) =>
    archiveNotice(member, "アーカイブ", `# ${channel.name} がアーカイブされました${text ? `。理由: ${text}` : ""}`, { channel: channel.id, target: "S05" }),
  );
  auditLog("チャンネルのアーカイブ", `# ${channel.name}`, `# ${channel.name} をアーカイブ${text ? `（理由: ${text}）` : ""}`);
  runCleanup("画面の整理", `# ${channel.name}`, () => {
    closeArchivedViews("channel", channel.id);
    render();
  });
  notify("チャンネルをアーカイブしました。");
  return true;
}
function restoreChannel(id, ticket) {
  if (typeof id !== "string") return refuse("チャンネルが見つかりません。");
  if (ticket !== undefined && typeof ticket !== "string") return refuse("再認証が必要です。");
  const channel = findChannelById(id);
  if (!channel) return refuse("チャンネルが見つかりません。");
  if (!chArchived(channel)) return refuse("アーカイブされていません。");
  if (!canRestoreChannel(channel)) return refuse();
  if (!consumeReauthTicket(ticket, "restore-channel", channel.id)) return false;
  // 復元の通知に、元の理由を添える。理由は復元後は空にする。
  const text = channel.deleteReason;
  delete channel.deletedAt;
  delete channel.deletedBy;
  delete channel.deleteReason;
  channel.members.forEach((member) =>
    archiveNotice(member, "復元", `# ${channel.name} が復元されました${text ? `。元の理由: ${text}` : ""}`, { channel: channel.id, target: "S05" }),
  );
  auditLog("チャンネルの復元", `# ${channel.name}`, `# ${channel.name} を復元`);
  runCleanup("画面の整理", `# ${channel.name}`, render);
  notify("チャンネルを復元しました。");
  return true;
}
function purgeChannel(id, reason, ticket) {
  if (typeof id !== "string") return refuse("チャンネルが見つかりません。");
  if (typeof reason !== "string") return refuse(annReasonMessage(true));
  if (ticket !== undefined && typeof ticket !== "string") return refuse("再認証が必要です。");
  const channel = findChannelById(id);
  if (!channel) return refuse("チャンネルが見つかりません。");
  if (!chArchived(channel)) return refuse("物理削除できるのは、アーカイブしたものだけです。");
  if (!canPurge(channel)) return refuse();
  const text = archiveReason(reason, true);
  if (text === null) return refuse(annReasonMessage(true));
  if (!consumeReauthTicket(ticket, "purge-channel", channel.id)) return false;
  const replyCount = channel.messages.reduce((sum, message) => sum + (message.replies?.length || 0), 0);
  prototypeData.channels.splice(prototypeData.channels.indexOf(channel), 1);
  prototypeData.purged.push(channel.id);
  // 通知はしない。既存の監査ログは消さない。削除と監査記録を先に完結させ、画面の整理と下書きの消去は後始末として最後に行う（失敗しても結果は変えず、記録する）。
  auditLog("チャンネルの物理削除", `# ${channel.name}`, `チャンネルを物理削除：# ${channel.name}・メッセージ${channel.messages.length}件・返信${replyCount}件・理由: ${text}`);
  runCleanup("画面の整理", `# ${channel.name}`, () => {
    closeArchivedViews("channel", channel.id);
    render();
  });
  runCleanup("下書きの消去", `# ${channel.name}`, () => purgeDraftsOf("channel", channel.id));
  notify("チャンネルを物理削除しました。元に戻せません。");
  return true;
}

function archiveCase(id, reason, ticket) {
  if (typeof id !== "string") return refuse("案件が見つかりません。");
  if (reason !== undefined && typeof reason !== "string") return refuse(annReasonMessage(false));
  if (ticket !== undefined && typeof ticket !== "string") return refuse("再認証が必要です。");
  const item = getCase(id);
  if (!item) return refuse("案件が見つかりません。");
  if (caseArchived(item)) return refuse("すでにアーカイブされています。");
  if (hasPendingReview(item)) return refuse("審査中の公開申請・再開申請があるため、アーカイブできません（案）。");
  if (!caseManager(item)) return refuse();
  const text = archiveReason(reason, false);
  if (text === null) return refuse(annReasonMessage(false));
  if (!consumeReauthTicket(ticket, "archive-case", item.id)) return false;
  item.deletedAt = Date.now();
  item.deletedBy = state.userId;
  item.deleteReason = text;
  // 案件専用チャンネルも同時にアーカイブされる。通知は案件の1件だけ（専用チャンネルの分を二重にしない）。
  item.members.forEach((member) =>
    archiveNotice(member, "アーカイブ", `案件 ${item.no} ${item.title} がアーカイブされました${text ? `。理由: ${text}` : ""}`, { caseId: item.id, target: "S17" }),
  );
  auditLog("案件のアーカイブ", item.no, `${item.no} をアーカイブ${text ? `（理由: ${text}）` : ""}`);
  runCleanup("画面の整理", item.no, () => {
    closeArchivedViews("case", item.id);
    render();
  });
  notify("案件をアーカイブしました。");
  return true;
}
function restoreCase(id, ticket) {
  if (typeof id !== "string") return refuse("案件が見つかりません。");
  if (ticket !== undefined && typeof ticket !== "string") return refuse("再認証が必要です。");
  const item = getCase(id);
  if (!item) return refuse("案件が見つかりません。");
  if (!caseArchived(item)) return refuse("アーカイブされていません。");
  if (!canRestoreCase(item)) return refuse();
  if (!consumeReauthTicket(ticket, "restore-case", item.id)) return false;
  const text = item.deleteReason;
  delete item.deletedAt;
  delete item.deletedBy;
  delete item.deleteReason;
  item.members.forEach((member) =>
    archiveNotice(member, "復元", `案件 ${item.no} ${item.title} が復元されました${text ? `。元の理由: ${text}` : ""}`, { caseId: item.id, target: "S17" }),
  );
  auditLog("案件の復元", item.no, `${item.no} を復元`);
  runCleanup("画面の整理", item.no, render);
  notify("案件を復元しました。");
  return true;
}
function purgeCase(id, reason, ticket) {
  if (typeof id !== "string") return refuse("案件が見つかりません。");
  if (typeof reason !== "string") return refuse(annReasonMessage(true));
  if (ticket !== undefined && typeof ticket !== "string") return refuse("再認証が必要です。");
  const item = getCase(id);
  if (!item) return refuse("案件が見つかりません。");
  if (!caseArchived(item)) return refuse("物理削除できるのは、アーカイブしたものだけです。");
  if (!canPurge(item)) return refuse();
  const text = archiveReason(reason, true);
  if (text === null) return refuse(annReasonMessage(true));
  if (!consumeReauthTicket(ticket, "purge-case", item.id)) return false;
  state.cases.splice(state.cases.indexOf(item), 1);
  // 案件番号は再利用しない（欠番になる。5-1 AC-23）。連番は、使われた番号（現存と物理削除済み）の最大から数える。
  state.purgedCaseNos.push(item.no);
  prototypeData.purged.push(item.id);
  // 削除と監査記録を先に完結させ、画面の整理と下書きの消去は後始末として最後に行う（失敗しても結果は変えず、記録する）。
  auditLog("案件の物理削除", item.no, `案件を物理削除：${item.no}・理由: ${text}`);
  runCleanup("画面の整理", item.no, () => {
    closeArchivedViews("case", item.id);
    render();
  });
  runCleanup("下書きの消去", item.no, () => purgeDraftsOf("case", item.id));
  notify("案件を物理削除しました。元に戻せません。案件番号は再利用しません。");
  return true;
}

// チャンネルの名前・説明の変更。values は name・description だけを持つ物。名前は整形・1〜50文字・使用可能文字・重複（アーカイブしたものを含む）を検査する。
// 再認証なし。通知しない。監査ログに変更前・変更後の全文を残す。
function editChannel(id, values) {
  if (typeof id !== "string") return refuse("チャンネルが見つかりません。");
  if (!values || typeof values !== "object" || Array.isArray(values)) return refuse("編集の内容が正しくありません。");
  // 各値を1度だけ読んでコピーし、検査と保存に同じ値を使う。
  const keys = Object.keys(values);
  values = Object.fromEntries(keys.map((key) => [key, values[key]]));
  if (!keys.length || keys.some((key) => key !== "name" && key !== "description"))
    return refuse("編集できない項目が含まれています。");
  if (keys.some((key) => typeof values[key] !== "string")) return refuse("名前・説明は文字で入力してください。");
  const channel = findChannelById(id);
  if (!channel) return refuse("チャンネルが見つかりません。");
  if (chArchived(channel)) return refuse(ARCHIVED_MESSAGE);
  const hasName = keys.includes("name");
  const hasDescription = keys.includes("description");
  if (hasName && !canRenameChannel(channel))
    return refuse(channelKind(channel) === "normal" ? undefined : "このチャンネルの名前は変えられません（専用・お知らせ専用・全社連絡）。");
  if (hasDescription && !canDescribeChannel(channel)) return refuse();
  const name = hasName ? normalizeInput(values.name) : channel.name;
  if (hasName) {
    const problem = channelNameProblem(name, channel.id);
    if (problem) return refuse(problem);
  }
  const description = hasDescription ? values.description.trim() : channel.description || "";
  if ([...description].length > 500) return refuse("説明は500文字以内で入力してください。");
  const changes = [];
  if (hasName && name !== channel.name) changes.push({ field: "name", before: channel.name, after: name });
  if (hasDescription && description !== (channel.description || ""))
    changes.push({ field: "description", before: channel.description || "", after: description });
  if (!changes.length) return refuse("内容が変わっていません。");
  const label = `# ${channel.name}`;
  changes.forEach((change) => {
    if (change.field === "name") channel.name = name;
    else channel.description = description;
  });
  auditLog("チャンネルの編集", label, `${changes.map((change) => (change.field === "name" ? "名前" : "説明")).join("と")}を変更`, changes);
  notify(`チャンネルを更新しました。${hasName && values.name.trim() !== name ? "表記を整えて保存しました（案）。" : ""}`);
  return true;
}

// スレッドの返信。target は postMessage と同じ形。mid は、その部屋の親投稿の ID。添付は付けられない（Q-84）。
function postThreadReply(target, mid, text, files) {
  if (!target || typeof target !== "object" || Array.isArray(target)) return refuse("投稿先が正しくありません。");
  target = { source: target.source, id: target.id, userId: target.userId };
  if (typeof mid !== "string" || !mid) return refuse("元の投稿が見つかりません。");
  if (typeof text !== "string") return refuse("返信は文字で入力してください。");
  if (files !== undefined) return refuse("返信には添付できません。");
  const body = text.trim();
  if (!body) return refuse("返信を入力してください。");
  if ([...body].length > 4000) return refuse("返信は1〜4000文字で入力してください。");
  let list;
  let scope;
  if (target.source === "channel") {
    if (typeof target.id !== "string") return refuse("投稿先が正しくありません。");
    const channel = findChannelById(target.id);
    if (!channel) return refuse("チャンネルが見つかりません。");
    if (chArchived(channel)) return refuse(ARCHIVED_MESSAGE);
    if (!canReadChannel(channel)) return refuse();
    if (!isChannelMember(channel)) return refuse("参加すると返信できます。");
    if (channel.readOnly) return refuse("この部署は無効化されたため、読み取り専用です。");
    list = channel.messages;
    scope = `channel:${channel.id}`;
  } else if (target.source === "dm") {
    if (typeof target.userId !== "string") return refuse("投稿先が正しくありません。");
    const partner = employees.find((person) => person.id === target.userId);
    if (!partner || !partner.active || partner.id === state.userId) return refuse("相手が見つかりません。");
    list = prototypeData.dm[dmKey(state.userId, partner.id)] || [];
    scope = `dm:${partner.id}`;
  } else if (target.source === "case") {
    if (typeof target.id !== "string") return refuse("投稿先が正しくありません。");
    const item = getCase(target.id);
    if (!item) return refuse("案件が見つかりません。");
    if (caseArchived(item)) return refuse(ARCHIVED_MESSAGE);
    if (item.status !== "active") return refuse("終了した案件には返信できません。");
    if (!isMember(item)) return refuse();
    list = item.messages;
    scope = `case:${item.id}`;
  } else return refuse("投稿先が正しくありません。");
  // 親投稿は、すでに付いている mid で探す（検索のために新しい mid を付けて、拒否のときにデータを変えることはしない）。
  const parent = list.find((message) => message.mid === mid);
  if (!parent) return refuse("元の投稿が見つかりません。");
  // 削除済みの親投稿には新しい返信をつけられない。既存の返信は読める（1-4 AC-2・C-59）。
  if (parent.deleted) return refuse("削除された投稿には返信できません。");
  // 返信の相手には未読の印が付く。元の投稿者・これまでの返信者・メンションされた人が対象（C-91）。
  const recipients = [
    ...new Set([parent.by, ...(parent.mentions || []), ...(parent.replies || []).map((reply) => reply.by)]),
  ].filter((id) => id !== state.userId);
  (parent.replies ||= []).push({ by: state.userId, text: body, at: stamp(), ts: Date.now(), unreadFor: recipients });
  // 下書きの消去は後始末。失敗しても、返信の結果は変えず、失敗を記録する。
  runCleanup("下書きの消去", scope, () => removeDraftStrict(draftKey(`thread:${scope}:${list.indexOf(parent)}`)));
  return true;
}

// ----- 案件の更新を確定する実行する関数。送信の処理は、フォームの値を読んでこれらを呼ぶだけにする。 -----
// 型 → 対象の存在 → アーカイブ中でない を共通で検査する。通れば案件を返し、通らなければ理由を表示して null を返す。
function writableCase(caseId) {
  if (typeof caseId !== "string") {
    refuse("案件が見つかりません。");
    return null;
  }
  const item = getCase(caseId);
  if (!item) {
    refuse("案件が見つかりません。");
    return null;
  }
  if (caseArchived(item)) {
    refuse(ARCHIVED_MESSAGE);
    return null;
  }
  return item;
}
function addCaseMember(caseId, userId) {
  if (typeof userId !== "string") return refuse("追加できる社員を選んでください。");
  const item = writableCase(caseId);
  if (!item) return false;
  if (item.status !== "active") return refuse("終了した案件では、参加者を変更できません。");
  if (!isMember(item)) return refuse();
  if (!employees.some((person) => person.id === userId && person.active)) return refuse("追加できる社員を選んでください。");
  if (item.members.includes(userId)) return refuse("すでに参加しています。");
  item.members.push(userId);
  record(item, `${nameOf(userId)} を参加者に追加`);
  return true;
}
function removeCaseMember(caseId, userId) {
  if (typeof userId !== "string") return refuse("外す社員が正しくありません。");
  const item = writableCase(caseId);
  if (!item) return false;
  if (item.status !== "active") return refuse("終了した案件では、参加者を変更できません。");
  if (!isMember(item)) return refuse();
  if (!item.members.includes(userId)) return refuse("参加していない社員です。");
  if (isForcedMember(item, userId)) return refuse("全体管理者と担当部署のオーナーは、参加者から外せません（C-133・C-134）。");
  if (item.members.length <= 1) return refuse("最後の参加者は退出・削除できません。先に別の社員を追加してください。");
  item.members = item.members.filter((id) => id !== userId);
  releaseAssignee(item, [userId]);
  record(item, `${nameOf(userId)} を参加者から外しました`);
  return true;
}
// TODOの追加・編集。todoId が空文字のときは新規。values は title・assignee だけを持つ物。成功すると { id, normalized } を返す。
function saveTodo(caseId, todoId, values) {
  if (typeof todoId !== "string") return refuse("TODOが見つかりません。");
  if (!values || typeof values !== "object" || Array.isArray(values)) return refuse("TODOの内容が正しくありません。");
  // 各値を1度だけ読んでコピーし、検査と保存に同じ値を使う。
  const valueKeys = Object.keys(values);
  values = Object.fromEntries(valueKeys.map((key) => [key, values[key]]));
  if (valueKeys.some((key) => key !== "title" && key !== "assignee")) return refuse("TODOの内容が正しくありません。");
  if (typeof values.title !== "string") return refuse("TODOの題名を入力してください。");
  if (values.assignee !== undefined && values.assignee !== null && typeof values.assignee !== "string")
    return refuse("担当者が正しくありません。");
  const item = writableCase(caseId);
  if (!item) return false;
  if (item.status !== "active") return refuse("終了した案件のTODOは変更できません。");
  if (!isMember(item)) return refuse();
  // TODOの題名は保存時に自動整形する（C-121【案】）。長さは整形後の文字数で検査する。
  const title = normalizeInput(values.title);
  if (!title) return refuse("TODOの題名を入力してください。");
  if ([...title].length > 100) return refuse("TODOの題名は1〜100文字で入力してください（整形後の文字数）。");
  const assignee = values.assignee || null;
  const editing = todoId ? item.todos.find((entry) => entry.id === todoId) : null;
  if (todoId && !editing) return refuse("TODOが見つかりません。");
  // 完了済みの項目は、完了時の担当名を残すため、参加者でなくなった担当もそのまま残せる（5-4 AC-6）。
  const keepsDoneAssignee = !!editing?.done && editing.assignee === assignee;
  if (
    assignee &&
    !keepsDoneAssignee &&
    !(item.members.includes(assignee) && employees.find((person) => person.id === assignee)?.active)
  )
    return refuse("担当者は、この案件の有効な参加者から選んでください。");
  const normalized = values.title.trim() !== title;
  if (editing) {
    const before = `${editing.title}／${editing.assignee ? nameOf(editing.assignee) : "担当なし"}`;
    editing.title = title;
    if (assignee) editing.formerAssignee = null;
    editing.assignee = assignee;
    record(item, `TODOを編集（${before} → ${title}／${assignee ? nameOf(assignee) : "担当なし"}）`);
    return { id: editing.id, normalized };
  }
  const id = `t${Date.now()}`;
  item.todos.push({ id, title, done: false, assignee });
  record(item, `TODO「${title}」を追加`);
  return { id, normalized };
}
function deleteTodo(caseId, todoId) {
  if (typeof todoId !== "string") return refuse("TODOが見つかりません。");
  const item = writableCase(caseId);
  if (!item) return false;
  if (item.status !== "active") return refuse("終了した案件のTODOは変更できません。");
  if (!isMember(item)) return refuse();
  const todo = item.todos.find((entry) => entry.id === todoId);
  if (!todo) return refuse("TODOが見つかりません。");
  item.todos = item.todos.filter((entry) => entry !== todo);
  record(item, `TODO「${todo.title}」を削除`);
  return true;
}
function setTodoDone(caseId, todoId, done) {
  if (typeof todoId !== "string" || typeof done !== "boolean") return refuse("TODOの指定が正しくありません。");
  const item = writableCase(caseId);
  if (!item) return false;
  if (item.status !== "active") return refuse("終了した案件のTODOは変更できません。");
  if (!isMember(item)) return refuse();
  const todo = item.todos.find((entry) => entry.id === todoId);
  if (!todo) return refuse("TODOが見つかりません。");
  if (todo.done === done) return refuse("すでに同じ状態です。");
  todo.done = done;
  record(item, `TODO「${todo.title}」を${todo.done ? "完了" : "未完了"}に変更`);
  return true;
}
// 案件の終了（参加者限定の読み取り専用になる。アーカイブとは別）。
function closeCaseNow(caseId) {
  const item = writableCase(caseId);
  if (!item) return false;
  if (item.status !== "active") return refuse("すでに終了しています。");
  if (!isMember(item)) return refuse();
  item.status = "archived";
  item.visibility = "restricted";
  record(item, `${currentUser().name} が案件を終了`, "案件の終了");
  return true;
}
// 再開。memberIds は再開後の参加者（再開する本人を必ず含む。無効な社員は不可）。
function reopenCaseNow(caseId, memberIds) {
  const memberList = denseStrings(memberIds);
  if (!memberList) return refuse("参加者の指定が正しくありません。");
  const item = writableCase(caseId);
  if (!item) return false;
  if (item.status !== "archived") return refuse("再開できるのは、終了中の案件だけです。");
  if (!isMember(item)) return refuse();
  // 全体管理者と担当部署のオーナーは外せないので、再選定の結果に必ず含める（C-133）。
  const chosen = [...new Set([...memberList, ...forcedMembers(item.departments).map((person) => person.id)])];
  if (!chosen.includes(state.userId)) return refuse("再開する本人は必ず参加者に含めてください。");
  if (chosen.some((id) => !employees.some((person) => person.id === id && person.active)))
    return refuse("無効な社員は参加者にできません。");
  const summary = reselectSummary(item, chosen);
  if (item.publication?.status === "pending") {
    item.publication.status = "cancelled";
    record(item, "再開に伴い公開申請を自動取消。審査用閲覧も終了", "公開申請の自動取消");
  }
  releaseAssignee(item, item.members.filter((memberId) => !chosen.includes(memberId)));
  item.members = chosen;
  item.status = "active";
  item.visibility = "restricted";
  record(item, `${currentUser().name} が案件を再開（参加者の再選定 ${summary}）`, "案件の再開");
  return true;
}
function submitPublicationRequest(caseId) {
  const item = writableCase(caseId);
  if (!item) return false;
  if (item.status !== "archived" || item.visibility !== "restricted") return refuse("公開を申請できるのは、終了中で参加者限定の案件だけです。");
  if (item.publication?.status === "pending") return refuse("すでに審査中です。");
  if (!isMember(item)) return refuse();
  item.publication = { applicant: state.userId, status: "pending" };
  record(item, `${currentUser().name} が全社員公開を申請`);
  return true;
}
function withdrawPublicationRequest(caseId) {
  const item = writableCase(caseId);
  if (!item) return false;
  if (item.status !== "archived" || item.publication?.status !== "pending") return refuse("審査中の申請がありません。");
  if (item.publication.applicant !== state.userId) return refuse();
  item.publication.status = "withdrawn";
  record(item, `${currentUser().name} が全社員公開の申請を取り下げ。審査用の閲覧も終了`, "公開申請の取り下げ");
  return true;
}
// 公開の審査。再認証の票は、全体管理者が自分の申請を審査するときだけ必要（既存の条件。承認・却下のどちらでも求める）。
function judgePublication(caseId, result, reason, ticket) {
  if (result !== "approve" && result !== "reject") return refuse("判断を選んでください。");
  if (reason !== undefined && typeof reason !== "string") return refuse("理由は文字で入力してください。");
  if (ticket !== undefined && typeof ticket !== "string") return refuse("再認証が必要です。");
  const item = writableCase(caseId);
  if (!item) return false;
  if (item.publication?.status !== "pending") return refuse("審査中の申請がありません。");
  if (!canReviewPublication(item)) return refuse();
  const text = (reason || "").trim();
  if (result === "reject" && !text) return refuse("却下理由を入力してください。");
  if ([...text].length > 200) return refuse("理由は200文字以内で入力してください。");
  if (
    currentUser().role === "admin" &&
    item.publication.applicant === state.userId &&
    !consumeReauthTicket(ticket, "judge-publication", item.id)
  )
    return false;
  item.publication.status = result === "approve" ? "approved" : "rejected";
  item.publication.reason = text;
  if (result === "approve") item.visibility = "public";
  record(item, `${currentUser().name} が公開申請を${result === "approve" ? "承認" : "却下"}`);
  return true;
}
// 全社員公開の取消。再認証の票は常に必要（既存のとおり）。
function revokePublication(caseId, reason, ticket) {
  if (typeof reason !== "string") return refuse("取消理由を入力してください。");
  if (ticket !== undefined && typeof ticket !== "string") return refuse("再認証が必要です。");
  const item = writableCase(caseId);
  if (!item) return false;
  if (item.status !== "archived" || item.visibility !== "public") return refuse("全社員公開中の案件だけ取り消せます。");
  if (!canReview(item.departments)) return refuse();
  const text = annReason(reason, true);
  if (text === null) return refuse("取消理由は1〜500文字で入力してください。");
  if (!consumeReauthTicket(ticket, "revoke-publication", item.id)) return false;
  item.visibility = "restricted";
  if (item.publication) item.publication.status = "cancelled";
  record(item, `${currentUser().name} が全社員公開を取消（理由: ${text}）`);
  return true;
}
// 再開の申請。previous は、却下・取り下げされた元の申請の ID（省略・空は新規）。
function submitReopenRequest(caseId, reason, previousId) {
  if (typeof reason !== "string") return refuse("再開理由を入力してください。");
  if (previousId !== undefined && previousId !== null && typeof previousId !== "string") return refuse("再申請の元が正しくありません。");
  const item = writableCase(caseId);
  if (!item) return false;
  if (item.status !== "archived" || isMember(item) || !noGeneralMembers(item)) return refuse("再開を申請できるのは、一般の参加者がいない終了中の案件で、参加者でない社員だけです（参加者は直接再開できます）。");
  if (pendingReopenOf(item)) return refuse("すでに審査中の再開申請があります。");
  const text = reason.trim();
  if (!text) return refuse("再開理由を入力してください。");
  if ([...text].length > 200) return refuse("再開理由は200文字以内で入力してください。");
  const previous = previousId ? getReopen(previousId) : null;
  if (previousId && (!previous || previous.applicant !== state.userId || !["rejected", "withdrawn"].includes(previous.status)))
    return refuse();
  state.reopenRequests.push({
    id: `RR-${String(state.reopenRequests.length + 1).padStart(2, "0")}`,
    caseId: item.id,
    applicant: state.userId,
    reason: text,
    status: "pending",
    previous: previous?.id || null,
    decisionReason: "",
    added: [],
  });
  record(item, `${currentUser().name} が再開を申請（理由: ${text}${previous ? `・元の申請 ${previous.id}` : ""}）`, "再開の申請");
  return true;
}
function withdrawReopenRequest(requestId) {
  if (typeof requestId !== "string") return refuse("再開申請が見つかりません。");
  const request = getReopen(requestId);
  if (!request) return refuse("再開申請が見つかりません。");
  const item = writableCase(request.caseId);
  if (!item) return false;
  if (request.status !== "pending") return refuse("審査中の申請だけ取り下げられます。");
  if (request.applicant !== state.userId) return refuse();
  request.status = "withdrawn";
  record(item, `${currentUser().name} が再開申請を取り下げ。審査用の閲覧も終了`, "再開申請の取り下げ");
  return true;
}
// 再開申請の審査。addedIds は、承認者が追加する参加候補（有効な社員）。
function judgeReopen(requestId, result, reason, addedIds) {
  if (typeof requestId !== "string") return refuse("再開申請が見つかりません。");
  if (result !== "approve" && result !== "reject") return refuse("判断を選んでください。");
  if (reason !== undefined && typeof reason !== "string") return refuse("理由は文字で入力してください。");
  const addedList = addedIds === undefined ? [] : denseStrings(addedIds);
  if (!addedList) return refuse("参加候補の指定が正しくありません。");
  const request = getReopen(requestId);
  if (!request) return refuse("再開申請が見つかりません。");
  const item = writableCase(request.caseId);
  if (!item) return false;
  if (request.status !== "pending") return refuse("審査中の申請がありません。");
  if (item.status !== "archived" || !noGeneralMembers(item)) return refuse();
  if (!canReviewReopen(request)) return refuse();
  const text = (reason || "").trim();
  if (result === "reject" && !text) return refuse("却下理由を入力してください。");
  if ([...text].length > 200) return refuse("理由は200文字以内で入力してください。");
  if (addedList.some((id) => !employees.some((person) => person.id === id && person.active)))
    return refuse("無効な社員は参加者にできません。");
  // 参加者は申請者と、承認者が追加した候補。申請者1人には固定しない（5-6 AC-4、5-1 AC-16）。
  // 全体管理者と担当部署のオーナーは、自動で参加する（C-133・C-134）。
  const chosen = [...new Set([request.applicant, ...addedList, ...forcedMembers(item.departments).map((person) => person.id)])];
  if (!employees.some((person) => person.id === request.applicant && person.active))
    return refuse("申請者が無効なため承認できません。");
  const summary = reselectSummary(item, chosen);
  request.status = result === "approve" ? "approved" : "rejected";
  request.decisionReason = text;
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
    `${currentUser().name} が再開申請を${result === "approve" ? `承認（参加者の再選定 ${summary}）` : `却下（理由: ${text}）`}`,
    result === "approve" ? "再開の承認" : "再開申請の却下",
  );
  return true;
}

// ----- アーカイブ・復元・物理削除・チャンネル管理のダイアログ -----
const archiveTargetOf = (kind, id) => (kind === "case" ? getCase(id) : kind === "channel" ? findChannelById(id) : null);
const archiveLabelOf = (kind, target) => (kind === "case" ? `${target.no} ${target.title}` : `# ${target.name}`);
function openArchiveDialog(kind, id) {
  const target = typeof id === "string" ? archiveTargetOf(kind, id) : null;
  if (!target || !(kind === "case" ? canArchiveCase(target) : canArchiveChannel(target))) return refuse();
  showModal(
    `${kind === "case" ? "案件" : "チャンネル"}をアーカイブ（再認証）`,
    `<div class="alert">アーカイブすると、一覧・検索・未読の印に出なくなります。${kind === "case" ? "案件専用チャンネルも同時にアーカイブされます。" : ""}参加者に通知します。アーカイブ画面から復元できます。</div><p>${e(archiveLabelOf(kind, target))}</p><div class="form-field"><label for="archive-reason">理由（任意。500文字まで）</label><textarea id="archive-reason" name="reason" data-max="500" data-name="理由"></textarea></div>${reauthField("archive-reauth")}<input type="hidden" name="kind" value="${e(kind)}"><input type="hidden" name="id" value="${e(id)}">${hint("文言・通知の宛先は案です（未決定）。")}`,
    "archive-run",
    "アーカイブする",
    true,
  );
}
function openRestoreDialog(kind, id) {
  const target = typeof id === "string" ? archiveTargetOf(kind, id) : null;
  if (!target || !(kind === "case" ? canRestoreCase(target) : canRestoreChannel(target))) return refuse();
  showModal(
    `${kind === "case" ? "案件" : "チャンネル"}を復元（再認証）`,
    `<p>${e(archiveLabelOf(kind, target))} を復元します。一覧・検索・整理スペースの登録が元に戻り、参加者に通知します。</p>${reauthField("restore-reauth")}<input type="hidden" name="kind" value="${e(kind)}"><input type="hidden" name="id" value="${e(id)}">`,
    "restore-run",
    "復元する",
  );
}
function openPurgeDialog(kind, id) {
  const target = typeof id === "string" ? archiveTargetOf(kind, id) : null;
  if (!target || !canPurge(target)) return refuse();
  showModal(
    `${kind === "case" ? "案件" : "チャンネル"}を物理削除（再認証）`,
    `<div class="alert"><strong>元に戻せません。</strong>メッセージ・添付などの中身を含めて、完全に消えます。${kind === "case" ? "案件番号は再利用しません（欠番になります）。" : ""}通知は出ません。</div><p>${e(archiveLabelOf(kind, target))}</p><div class="form-field"><label for="purge-reason">理由（必須。1〜500文字）</label><textarea id="purge-reason" name="reason" required data-min="1" data-max="500" data-name="理由"></textarea></div>${reauthField("purge-reauth")}<input type="hidden" name="kind" value="${e(kind)}"><input type="hidden" name="id" value="${e(id)}">`,
    "purge-run",
    "物理削除する",
    true,
  );
}
// チャンネルの管理（名前・説明の変更とアーカイブの入口）。メッセージの中身は出さない。
function openChannelManage(id) {
  const channel = findChannelById(id);
  if (!channel || chArchived(channel)) return refuse();
  const canName = canRenameChannel(channel);
  const canDescription = canDescribeChannel(channel);
  if (!canName && !canDescription) return refuse();
  const kind = channelKind(channel);
  showModal(
    "チャンネルの管理（案）",
    `<dl class="info-grid"><div><dt>種類</dt><dd>${e(CHANNEL_KIND_LABEL[kind])}</dd></div><div><dt>置き場所</dt><dd>${e(deptLabel(channel.dept))}</dd></div><div><dt>公開範囲</dt><dd>${channel.private ? "非公開" : "公開"}</dd></div><div><dt>参加者</dt><dd>${channel.members.length}人</dd></div></dl><p class="form-hint">この画面にはメッセージを出しません。${kind === "normal" ? "" : "名前の変更とアーカイブはできません（専用・お知らせ専用・全社連絡。説明は変えられます）。"}</p>${canName ? `<div class="form-field"><label for="manage-name">チャンネル名</label><input id="manage-name" name="name" required value="${e(channel.name)}" data-min="1" data-max="50" data-name="チャンネル名" data-normalize><p class="form-hint">保存時に表記を自動で整えます。アーカイブしたチャンネルの名前とも重複できません。</p></div>` : `<p>チャンネル名: # ${e(channel.name)}</p>`}${canDescription ? `<div class="form-field"><label for="manage-description">説明（任意。500文字まで）</label><textarea id="manage-description" name="description" data-max="500" data-name="説明">${e(channel.description || "")}</textarea></div>` : ""}<input type="hidden" name="id" value="${e(channel.id)}">${canArchiveChannel(channel) ? `<div class="inline-actions"><button type="button" class="button danger small" data-action="archive-open" data-kind="channel" data-id="${e(channel.id)}">このチャンネルをアーカイブ</button></div>` : ""}<p class="subtle">変更は監査ログに残ります。通知は出ません。</p>`,
    "channel-edit",
    "保存する",
  );
}
Object.assign(EXTRA_UI, {
  "channel-manage": (element) => openChannelManage(element.dataset.id),
  "archive-restore": (element) => openRestoreDialog(element.dataset.kind, element.dataset.id),
  "archive-purge": (element) => openPurgeDialog(element.dataset.kind, element.dataset.id),
});
Object.assign(EXTRA_MODAL, {
  "channel-edit": (data) => {
    const id = String(data.get("id") || "");
    const values = {};
    if (data.has("name")) values.name = String(data.get("name"));
    if (data.has("description")) values.description = String(data.get("description"));
    if (!editChannel(id, values)) return modalError(lastRefusal);
    closeModal();
    render();
    refocusMenuOrigin();
  },
  // 再認証欄が空でないときだけ、票を作って実行する関数へ渡す。
  "archive-run": (data) => {
    const missing = reauthMissing(data);
    if (missing) return modalError(missing);
    const kind = String(data.get("kind") || "");
    const id = String(data.get("id") || "");
    const ticket = issueReauthTicket(`archive-${kind}`, id);
    const reason = String(data.get("reason") || "");
    const ok = kind === "case" ? archiveCase(id, reason, ticket) : kind === "channel" ? archiveChannel(id, reason, ticket) : refuse();
    if (!ok) return modalError(lastRefusal);
    closeModal();
    render();
    refocusMenuOrigin();
  },
  "restore-run": (data) => {
    const missing = reauthMissing(data);
    if (missing) return modalError(missing);
    const kind = String(data.get("kind") || "");
    const id = String(data.get("id") || "");
    const ticket = issueReauthTicket(`restore-${kind}`, id);
    const ok = kind === "case" ? restoreCase(id, ticket) : kind === "channel" ? restoreChannel(id, ticket) : refuse();
    if (!ok) return modalError(lastRefusal);
    closeModal();
    render();
    refocusMenuOrigin();
  },
  "purge-run": (data) => {
    const missing = reauthMissing(data);
    if (missing) return modalError(missing);
    const kind = String(data.get("kind") || "");
    const id = String(data.get("id") || "");
    const ticket = issueReauthTicket(`purge-${kind}`, id);
    const reason = String(data.get("reason") || "");
    const ok = kind === "case" ? purgeCase(id, reason, ticket) : kind === "channel" ? purgeChannel(id, reason, ticket) : refuse();
    if (!ok) return modalError(lastRefusal);
    closeModal();
    render();
    refocusMenuOrigin();
  },
});

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
    html += `<section class="panel request-card"><div class="request-card-head"><h2>${e(request.title)}</h2>${badge(requestStatus(request.status), requestType(request.status))}</div><p>${e(request.id)} ・ 担当部署 ${e(deptsText(request))} ・ 取引先: ${e(clientLabelOf(request.clientCode))} ・ 納期: ${dueText(request.due) ? e(dueText(request.due)) : "なし"} ・ 参加候補: ${e(request.candidates.concat(request.added).map(nameOf).join("、") || "なし")}</p><p>案件番号: ${request.caseNo ? e(request.caseNo) : "承認時に自動で付きます"}</p>${request.previous ? `<p>元の申請: ${e(request.previous)}</p>` : ""}${request.reason ? `<p>${request.status === "rejected" ? "却下理由" : "理由"}: ${e(request.reason)}</p>` : ""}<div class="request-actions">${request.status === "pending" ? button("取り下げ", "withdraw", `data-id="${request.id}"`, "button small danger") : ""}${["rejected", "withdrawn"].includes(request.status) ? button("修正して再申請", "reapply", `data-id="${request.id}"`) : ""}</div></section>`;
  for (const request of reopens)
    html += `<section class="panel request-card"><div class="request-card-head"><h2>再開の申請：${e(getCase(request.caseId)?.title || request.caseId)}</h2>${badge(requestStatus(request.status), requestType(request.status))}</div><p>${e(request.id)} ・ 担当部署 ${e(getCase(request.caseId) ? deptsText(getCase(request.caseId)) : "（案件なし）")} ・ 理由: ${e(request.reason)}</p>${request.previous ? `<p>元の申請: ${e(request.previous)}</p>` : ""}${request.decisionReason && request.status === "rejected" ? `<p>却下理由: ${e(request.decisionReason)}</p>` : ""}<div class="request-actions">${request.status === "pending" ? button("取り下げ", "withdraw-reopen", `data-id="${request.id}"`, "button small danger") : ""}${["rejected", "withdrawn"].includes(request.status) ? button("修正して再申請", "reapply-reopen", `data-id="${request.id}"`) : ""}</div></section>`;
  html += "</div>";
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
  screen.innerHTML = html;
}
function renderApprovals() {
  const requests = state.requests.filter((request) => canReviewRequest(request));
  const publications = state.cases.filter((item) => !caseArchived(item) && canReviewPublication(item));
  // 案件がアーカイブされた・物理削除された再開申請は出さない。
  const reopens = state.reopenRequests.filter((request) => {
    const target = getCase(request.caseId);
    return !!target && !caseArchived(target) && canReviewReopen(request);
  });
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
    html += `<section class="panel request-card"><div class="request-card-head"><h2>案件作成：${e(request.title)}</h2>${badge("承認待ち", "pending")}</div><p>${e(request.id)} ・ 担当部署 ${e(deptsText(request))} ・ 申請者: ${e(nameOf(request.applicant))}</p><p>取引先: ${e(clientLabelOf(request.clientCode))}（${e(request.clientCode)}） ・ 納期: ${dueText(request.due) ? e(dueText(request.due)) : "なし"} ・ 案件番号は承認時に自動で付きます</p><p>申請された参加候補: ${e(request.candidates.map(nameOf).join("、") || "なし")}</p><p>承認者が追加: ${e(request.added.map(nameOf).join("、") || "なし")}</p><div class="request-actions">${button("内容を確認", "review-request", `data-id="${request.id}"`, "button primary small")}</div></section>`;
  for (const item of publications)
    html += `<section class="panel request-card"><div class="request-card-head"><h2>全社員公開：${e(item.title)}</h2>${badge("承認待ち", "pending")}</div><p>${e(item.no)} ・ 担当部署 ${e(deptsText(item))} ・ 申請者: ${e(nameOf(item.publication.applicant))}</p><p>審査中は内容を読み取り専用で確認できます。</p><div class="request-actions">${button("内容を見る", "review-content", `data-id="${item.id}"`)}${button("公開を審査", "review-publication", `data-id="${item.id}"`, "button primary small")}</div></section>`;
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
  html += `<div class="guide-grid"><section class="panel guide-card"><h2>① 案件の申請と承認</h2><p>testuser_001で「自分の申請」を確認できます。testuser_002は営業部オーナー、testuser_005は全体管理者です。</p><ol><li>申請の参加候補を指定する</li><li>承認者が候補を追加する</li><li>承認か理由付き却下を選ぶ</li><li>却下後は別の申請として再申請する</li></ol></section><section class="panel guide-card"><h2>② 閲覧範囲の変化</h2><p>非参加者には案件の概要だけが見えます。案件を終了しても最初は参加者限定です。公開申請の承認後に全社員が読み取り専用で見られます。</p></section><section class="panel guide-card"><h2>③ 再開の違い</h2><p>参加者（全体管理者を含む）は終了案件を直接再開できます。一般の参加者がいない「倉庫移転の事前調査」は、参加者でない社員が再開申請できます（全体管理者・担当部署のオーナーは強制参加のため数えない）。承認後に申請者が参加者になります。</p></section><section class="panel guide-card"><h2>④ 画面の状態</h2><p>各画面の「表示状態」から読み込み中・データあり・データなし・エラーを切り替えられます。操作後は画面を再読み込みせず表示が変わります。</p></section><section class="panel guide-card"><h2>この試作の監査記録</h2><p>公開審査の閲覧や権限を変える操作を、この画面内だけで記録します。</p><div class="compact-list">${
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
  closePicker();
  ui.menuOrigin = null;
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
  closePicker();
  ui.menuOrigin = null;
  state.todoEdit = null;
  if (ui.thread) closeThread();
  const item = getCase(id);
  if (!item) return refuse(prototypeData.purged.includes(id) ? "削除されました（案）。" : "案件が見つかりません。");
  if (caseArchived(item) && !canViewArchivedCase(item)) return refuse("アーカイブされました。");
  state.selectedId = id;
  state.page = "S17";
  state.detailTab = "messages";
  state.viewState = "data";
  render();
  screen.focus();
}
function modalHtml(title, body, action, actionLabel, danger = false, cancelLabel = "キャンセル", cancelAction = "close-modal") {
  return `<form id="modal-form" data-submit="${action}"><div class="modal-header"><h2 id="modal-title">${e(title)}</h2>${button("閉じる", "close-modal", "", "button ghost small")}</div><div class="modal-body">${body}<p id="modal-error" class="form-error" role="alert" hidden></p></div><div class="modal-footer">${button(cancelLabel, cancelAction)}${actionLabel ? `<button type="submit" class="button ${danger ? "danger" : "primary"}">${e(actionLabel)}</button>` : ""}</div></form>`;
}
function showModal(title, body, action, actionLabel, danger = false, cancelLabel = "キャンセル", cancelAction = "close-modal") {
  // 開いているダイアログの内容を差し替えるとき（似た件名の警告など）は、戻り先のボタンを変えず、開き直さない。
  const alreadyOpen = modal.open;
  if (!alreadyOpen) returnFocus = document.activeElement;
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。html は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てた文字列で、入力をそのまま入れない
  modal.innerHTML = modalHtml(title, body, action, actionLabel, danger, cancelLabel, cancelAction);
  if (!alreadyOpen) modal.showModal();
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
  if (!el) return false;
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
    `<div class="muted-box"><strong>${e(request.title)}</strong><br>担当部署 ${e(deptsText(request))} ・ 申請者: ${e(nameOf(request.applicant))}<br>取引先: ${e(clientLabelOf(request.clientCode))}（${e(request.clientCode)}） ・ 納期: ${dueText(request.due) ? e(dueText(request.due)) : "なし"}<br>申請者は承認時に自動参加します。案件番号は承認時に自動で付きます。</div><p class="form-label">申請者が指定した候補</p><p class="subtle">${e(request.candidates.map(nameOf).join("、") || "なし")}（削除できません）</p><p class="form-label">承認者が追加する候補</p>${participantOptions(request.added, [request.applicant, ...request.candidates])}<input type="hidden" name="id" value="${e(id)}"><div class="form-field"><label for="review-result">判断</label><select id="review-result" name="result"><option value="approve">承認</option><option value="reject">却下</option></select></div><div class="form-field"><label for="review-reason">却下理由（却下時は必須。1〜200文字）</label><textarea id="review-reason" name="reason" placeholder="申請者に伝える理由" data-max="200" data-name="却下理由"></textarea></div>`,
    "judge-request",
    "判断を確定",
  );
}
function closeCase(item) {
  if (!item || caseArchived(item) || item.status !== "active" || !isMember(item)) return refuse();
  showModal(
    "案件を終了",
    `<div class="alert">終了後は参加者限定のアーカイブになり、投稿・TODO・参加者変更はできません。全社員公開は別途申請が必要です。</div><p>${e(item.title)} を終了しますか？</p><input type="hidden" name="id" value="${e(item.id)}">`,
    "close-case",
    "終了する",
  );
}
function requestPublication(item) {
  if (
    !item ||
    caseArchived(item) ||
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
    caseArchived(item) ||
    item.status !== "archived" ||
    item.visibility !== "public" ||
    !canReview(item.departments)
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
  if (!item || caseArchived(item) || !canReviewPublication(item)) return refuse();
  showModal(
    "全社員公開を審査",
    `<div class="muted-box">${e(item.title)}<br>申請者: ${e(nameOf(item.publication.applicant))}</div><p class="subtle">承認すると、過去の会話・TODO・資料を全社員が読み取り専用で見られます。</p><input type="hidden" name="id" value="${e(item.id)}"><div class="form-field"><label for="publication-result">判断</label><select id="publication-result" name="result"><option value="approve">承認</option><option value="reject">却下</option></select></div><div class="form-field"><label for="publication-reason">却下理由（却下時は必須。200文字まで）</label><textarea id="publication-reason" name="reason" data-max="200" data-name="却下理由"></textarea></div>${currentUser().role === "admin" && item.publication.applicant === state.userId ? '<label class="checkbox-option"><input type="checkbox" name="reauth">再認証を確認した（試作の確認操作）</label>' : ""}`,
    "judge-publication",
    "判断を確定",
  );
}
// prior があるときは、却下・取り下げされた元の申請を参照して修正し、別の申請として出す（5-6 AC-5）。
function requestReopen(item, prior = null) {
  if (
    !item ||
    caseArchived(item) ||
    item.status !== "archived" ||
    isMember(item) || !noGeneralMembers(item) ||
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
  if (!item || caseArchived(item)) return refuse(item ? ARCHIVED_MESSAGE : "案件が見つかりません。");
  const others = employees.filter(
    (person) => person.active && person.id !== request.applicant,
  );
  showModal(
    "再開申請を審査",
    `<div class="muted-box">${e(item.title)}<br>申請者: ${e(nameOf(request.applicant))}<br>理由: ${e(request.reason)}</div><div class="alert">承認すると、参加者になった人は過去の会話・TODO・資料もすべて見られます（過去の情報も共有されます）。再開後は参加者限定です。全体管理者は強制参加（C-134）のため、常に参加者です。</div><p class="form-label">再開後の参加者（参加候補）</p><p class="form-hint">申請者は必ず参加します。承認者は候補を追加できます。候補を外す必要があるときは、理由を付けて却下してください。この案件には以前の一般の参加者がいないため、候補は申請者と、追加する人だけです（全体管理者は強制参加で必ず残ります）。</p><div class="checkbox-list"><label class="checkbox-option"><input type="checkbox" checked disabled>${e(nameOf(request.applicant))} <span class="row-note">申請者・必ず参加</span></label>${others.map((person) => `<label class="checkbox-option"><input type="checkbox" name="members" value="${e(person.id)}" data-reselect ${request.added.includes(person.id) ? "checked" : ""}>${e(person.name)} <span class="row-note">${e(deptOf(person))}</span></label>`).join("")}</div><input type="hidden" name="members" value="${e(request.applicant)}"><div id="reselect-summary" class="muted-box reopen-preview" aria-live="polite">${e(reselectSummary(item, [request.applicant, ...request.added]))}</div><input type="hidden" name="case" value="${e(item.id)}"><input type="hidden" name="id" value="${e(id)}"><div class="form-field"><label for="reopen-result">判断</label><select id="reopen-result" name="result"><option value="approve">承認</option><option value="reject">却下</option></select></div><div class="form-field"><label for="reopen-decision-reason">却下理由（却下時は必須。1〜200文字）</label><textarea id="reopen-decision-reason" name="reason" data-max="200" data-name="却下理由"></textarea></div>`,
    "judge-reopen",
    "判断を確定",
  );
}
// 再開時は以前の参加者を候補にして再選定できる（5-1 AC-16）。結果は監査ログへ残す（C-81）。
function reselectSummary(item, chosen) {
  // 全体管理者と担当部署のオーナーは外せない（C-133・C-134）。選択に含まれていなくても、残る人として数える。
  chosen = [...new Set([...chosen, ...forcedMembers(item.departments).map((person) => person.id)])];
  const names = (ids) => ids.map(nameOf).join("、") || "なし";
  return `残る人: ${names(chosen.filter((id) => item.members.includes(id)))} ／ 追加する人: ${names(chosen.filter((id) => !item.members.includes(id)))} ／ 外れる人: ${names(item.members.filter((id) => !chosen.includes(id)))}`;
}
function reopen(item) {
  if (!item || caseArchived(item) || item.status !== "archived" || !isMember(item)) return refuse();
  showModal(
    "案件を再開",
    `<div class="alert">再開すると、過去の会話・TODO・資料も含めて参加者限定に戻ります。追加した人も過去の内容を見られます。</div><p class="form-label">再開後の参加者</p><p class="form-hint">以前の参加者が候補です。再開する本人は必ず参加します。</p><div class="checkbox-list">${employees
      .filter((person) => person.active)
      .map(
        (person) =>
          `<label class="checkbox-option"><input type="checkbox" name="members" value="${person.id}" data-reselect ${item.members.includes(person.id) ? "checked" : ""} ${person.id === state.userId || isForcedMember(item, person.id) ? "disabled" : ""}>${e(person.name)} <span class="row-note">${e(deptOf(person))}</span></label>`,
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
    if (item && caseArchived(item)) return refuse(ARCHIVED_MESSAGE);
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
  if (action === "edit-case") return openCaseEdit(id);
  if (action === "case-edit-back") {
    const pending = pendingCaseEdit;
    pendingCaseEdit = null;
    if (!pending) return closeModal();
    return openCaseEdit(pending.id, pending.values);
  }
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
  if (action === "close-case") return closeCase(getCase(id));
  if (action === "archive-open") return openArchiveDialog(target.dataset.kind, id);
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
    if (!withdrawPublicationRequest(id)) return;
    render();
    notify("公開申請を取り下げました。履歴は残ります。");
    return document.querySelector("#publication-status")?.focus();
  }
  if (action === "withdraw-reopen") {
    if (!withdrawReopenRequest(id)) return;
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
    if (item && caseArchived(item)) return refuse(ARCHIVED_MESSAGE);
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
    if (!removeCaseMember(id, target.dataset.member)) return;
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
  closePicker();
  state.userId = event.target.value;
  ui.pendingAttachments = {};
  pendingCaseEdit = null;
  state.todoEdit = null;
  state.viewState = "data";
  ui.dmUserId = null;
  ui.profile = null;
  state.caseManage = false;
  ui.manageDept = null;
  ui.dirFilter = "すべて";
  ui.dirLocFilter = "すべて";
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
    const todoId = event.target.dataset.todo;
    if (!setTodoDone(state.selectedId, todoId, event.target.checked)) return render();
    render();
    focusTodo(`input[data-todo="${CSS.escape(todoId)}"]`);
  }
});
screen.addEventListener("submit", (event) => {
  if (!["message-form", "todo-form"].includes(event.target.id)) return;
  event.preventDefault();
  const item = getCase(state.selectedId);
  if (item && caseArchived(item)) return refuse(ARCHIVED_MESSAGE);
  if (!item || item.status !== "active" || !isMember(item)) return refuse();
  const data = new FormData(event.target);
  if (event.target.id === "message-form") {
    // 投稿は、投稿を確定する実行する関数（postMessage）に任せる。本文・権限・状態・添付をそこで検査し、通らなければ何も投稿しない。
    if (
      !postMessage(
        { source: "case", id: item.id },
        String(data.get("text") || ""),
        ui.pendingAttachments[`case:${item.id}`] || [],
      )
    )
      return;
  } else {
    // 保存は実行する関数（saveTodo）に任せる。題名の整形・長さ・担当者の検査はそこで行う。
    const saved = saveTodo(item.id, String(event.target.dataset.todo || ""), {
      title: String(data.get("title") || ""),
      assignee: String(data.get("assignee") || "") || null,
    });
    if (!saved) return;
    const todoId = event.target.dataset.todo;
    state.todoEdit = null;
    render();
    notify(`${todoId ? "TODOを保存しました。" : "TODOを追加しました。"}${saved.normalized ? "表記を整えて保存しました（案）。" : ""}`);
    return focusTodo(
      todoId
        ? `[data-action="todo-edit"][data-todo="${CSS.escape(saved.id)}"]`
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
    if (!deleteTodo(id, String(data.get("todo") || ""))) return modalError(lastRefusal);
    state.todoEdit = null;
    closeModal();
    render();
    notify("TODOを削除しました。");
    return focusTodo('[data-action="todo-add"]');
  }
  if (action === "reopen-case") {
    if (!reopenCaseNow(id, [...new Set(data.getAll("members").map(String))])) return modalError(lastRefusal);
    closeModal();
    render();
    return notify("案件を再開しました。過去の内容も参加者限定に戻りました。");
  }
  if (action === "judge-request") {
    const request = getRequest(id);
    if (!request) return refuse();
    // 担当部署は1度だけコピーして検査し、判定にも保存にも同じコピーを使う（承認の検査をすり抜けさせない。C-130(4)）。
    const approvedDepts = cleanDepartments(request.departments);
    if (approvedDepts.error) return refuse(approvedDepts.error);
    if (!canReviewRequest(request, approvedDepts.value)) return refuse();
    if (!employees.find((person) => person.id === request.applicant)?.active)
      return modalError("申請者が無効です。承認できません。");
    // 参加候補は、1度だけ読んだ密な文字列のコピーで検査する（疎な配列・文字列でない値は拒否）。
    const requestCandidates = denseStrings(request.candidates);
    if (!requestCandidates) return refuse("参加候補の指定が正しくありません。");
    if (requestCandidates.some((candidate) => !employees.find((person) => person.id === candidate)?.active))
      return modalError("参加候補に無効な社員がいるため承認できません。");
    const reason = String(data.get("reason") || "").trim();
    if (result === "reject" && !reason)
      return modalError("却下理由を入力してください。");
    if (result === "reject") {
      request.status = "rejected";
      request.reason = reason;
      auditLog("案件作成の却下", request.id, `${currentUser().name} が「${request.title}」の作成申請を却下（理由: ${reason}）`);
    } else {
      if (caseSeqFull(request.clientCode))
        return modalError(
          `この取引先の今年の案件番号が上限（${CASE_SEQ_MAX}）に達したため、今日は承認できません。翌日以降に承認してください（409の見本。翌日以降に承認できる動きは、この試作では再現しません）。案件は作られず、申請は「申請中」のままです。`,
        );
      // 承認者が追加する候補は、ローカルに保持し、すべての検査を通ってから申請（request）へ反映する（拒否のときに申請を変えない）。
      const added = data.getAll("candidates").map(String);
      // 全体管理者と担当部署のオーナーは、自動で参加する（C-133・C-134。申請者が作成者でオーナー本人でも、重複しない）。
      const members = [
        ...new Set([
          request.applicant,
          ...requestCandidates,
          ...added,
          ...forcedMembers(approvedDepts.value).map((person) => person.id),
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
        departments: [...approvedDepts.value],
        status: "active",
        visibility: "restricted",
        members,
        messages: [],
        todos: [],
            publication: null,
        events: [],
      };
      state.cases.unshift(item);
      // 作成と同時に参加した強制参加者を、案件番号と対象者つきで監査ログに残す（通知は出さない。Q-116）。
      // そのあと quiet の同期で forcedSeen だけを初期化する（同じ人の二重の記録を避ける）。
      const forcedAtCreate = forcedMembers(item.departments);
      if (forcedAtCreate.length)
        auditLog("強制参加", item.no, `強制参加の ${forcedAtCreate.map((person) => `${person.name}（${forcedLabel(item, person.id)}）`).join("・")} が参加者に加わりました（案件の作成時。通知は出さない）`);
      syncForcedMembers(item, true);
      request.added = added;
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
  if (action === "close-case") {
    if (!closeCaseNow(id)) return modalError(lastRefusal);
    closeModal();
    render();
    return notify("案件を参加者限定の終了した案件にしました。");
  }
  if (action === "request-publication") {
    if (!submitPublicationRequest(id)) return modalError(lastRefusal);
    closeModal();
    render();
    return notify("公開申請を送りました。承認までは参加者限定です。");
  }
  if (action === "cancel-publication") {
    if (!String(data.get("reauth") || "")) return modalError("再認証の確認入力が必要です。");
    // 再認証欄が空でないときだけ票を作って渡す。票の検査は実行する関数（revokePublication）で行う。
    if (!revokePublication(id, String(data.get("reason") || ""), issueReauthTicket("revoke-publication", id)))
      return modalError(lastRefusal);
    closeModal();
    render();
    return notify("全社員公開を取り消し、参加者限定に戻しました。");
  }
  if (action === "judge-publication") {
    // 全体管理者が自分の申請を審査するときだけ、再認証の票が必要（実行する関数が検査する）。
    const ticket = data.get("reauth") ? issueReauthTicket("judge-publication", id) : undefined;
    if (!judgePublication(id, String(result), String(data.get("reason") || ""), ticket)) return modalError(lastRefusal);
    closeModal();
    render();
    return notify(
      result === "approve"
        ? "全社員への公開を反映しました。"
        : "公開申請を却下しました。",
    );
  }
  if (action === "request-reopen") {
    if (!submitReopenRequest(id, String(data.get("reason") || ""), String(data.get("previous") || ""))) return modalError(lastRefusal);
    closeModal();
    render();
    return notify("再開を申請しました。承認まで内容は非公開です。");
  }
  if (action === "judge-reopen") {
    const target = getReopen(id);
    const added = data.getAll("members").map(String).filter((memberId) => memberId !== target?.applicant);
    if (!judgeReopen(id, String(result), String(data.get("reason") || ""), added)) return modalError(lastRefusal);
    closeModal();
    render();
    return notify(
      result === "approve"
        ? "再開し、参加者を確定しました。"
        : "再開申請を却下しました。",
    );
  }
  if (action === "add-member") {
    if (!addCaseMember(id, String(data.get("member") || ""))) return modalError(lastRefusal);
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
  pendingCaseEdit = null;
  modal.replaceChildren();
  returnFocus?.focus();
});
syncAllForcedMembers(true);
render();
