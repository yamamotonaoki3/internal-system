"use strict";

// 試作専用の補助。全体管理者・オーナーの管理画面などをまとめている。
//   S-08 部署の作成、S-12 チャンネル招待、S-13 の退職処理の申請、
//   S-22 アカウント管理（情報変更・部署異動・無効化・再有効化・再発行・退職申請・本名変更届）、
//   S-24 部署の一覧とオーナーの任命・交代、S-34 初回セットアップ、S-19 からの本名変更届。
// 画面の入口と共通の部品は screens.js、データは app.js・screens.js にある。extras.js の後に読み込み、
// クリックと送信の受け口（EXTRA_UI・EXTRA_MODAL）に足す。変更はブラウザのメモリだけで、実際の認証はしない。

/* ---------- 共通の部品 ---------- */
const emailOf = (person) => person.email || `${person.id}@example.com`;
const extOf = (person) => person.ext || `000${person.id.slice(-1)}`;
const titleOf = (person) => person.title || "なし";
const roleLabel = (person) =>
  person.role === "admin"
    ? "全体管理者"
    : person.role === "owner"
      ? "オーナー"
      : "メンバー";
const todayText = () => new Date().toLocaleDateString("sv-SE");
const departmentOwner = (name) =>
  employees.find(
    (p) => p.active && p.role === "owner" && p.department === name,
  ) ||
  employees.find((p) => p.active && p.role === "admin" && p.ownerOf?.includes(name));
const departmentSize = (name) =>
  employees.filter((p) => p.active && p.department === name).length;
// 部署の専用チャンネルは、部署名と同じ名前の公開チャンネル（C-95）。
const dedicatedChannel = (name) =>
  prototypeData.channels.find(
    (channel) => channel.dept === name && channel.name === name,
  );
// 画面の再認証の見本。実際の本人確認はしないので、空でなければ通す。
const reauthField = (id) =>
  `<div class="form-field"><label for="${id}">パスワードを再入力（再認証）</label><input id="${id}" name="reauth" type="password" autocomplete="off" required></div><p class="subtle">重要な操作の前の再認証の見本です。入力値は保存せず、実際の本人確認はしません。</p>`;
const reauthMissing = (data) =>
  String(data.get("reauth") || "") ? null : "パスワードを入力してください。";
// 初期パスワードは再発行のときにシステムが生成し、一度だけ表示する（C-34）。試作の見本の文字列。
const sampleInitialPassword = () =>
  `Tmp-${Math.random().toString(36).slice(2, 8)}-${Math.floor(1000 + Math.random() * 9000)}`;
const roleNote = (person) =>
  person.role === "owner"
    ? "オーナー"
    : person.role === "admin"
      ? "全体管理者"
      : "";

// 入力欄の近くにエラーを文字で示し、その欄へフォーカスを移す。
function fieldError(id, message) {
  const el = document.getElementById(id);
  if (!el) return notify(message);
  el.parentElement.querySelector(".field-error")?.remove();
  const note = document.createElement("p");
  note.className = "form-error field-error";
  note.setAttribute("role", "alert");
  note.textContent = message;
  const counter = el.nextElementSibling?.classList.contains("char-count")
    ? el.nextElementSibling
    : el;
  counter.insertAdjacentElement("afterend", note);
  el.setAttribute("aria-invalid", "true");
  el.focus();
  return false;
}
document.addEventListener("input", (event) => {
  event.target.parentElement?.querySelector(".field-error")?.remove();
});

// 確定してモーダルを閉じ、画面を作り直す。作り直しで失われた操作ボタンの代わりに、同じ対象の項目へフォーカスを戻す。
function commitRender() {
  const data = returnFocus?.dataset || {};
  closeModal();
  render();
  const selector =
    data.user !== undefined
      ? `[data-user="${CSS.escape(data.user)}"]`
      : data.id !== undefined
        ? `[data-id="${CSS.escape(data.id)}"]`
        : data.ui
          ? `[data-ui="${CSS.escape(data.ui)}"]`
          : "";
  const next = selector ? screen.querySelector(selector) : null;
  (next || screen).focus();
}

/* ---------- S-08 部署の作成 ---------- */
let pendingDepartment = null;
const needsSuccessor = (person) =>
  !!person && person.role === "owner" && !!person.department;
const successorCandidates = (person) =>
  employees.filter(
    (p) => p.active && p.role === "member" && p.department === person.department,
  );

function createDepartmentScreen() {
  const nominees = employees.filter((p) => p.active && p.id !== state.userId);
  return screenFrame(
    "S08",
    "部署を作成",
    "部署と、公開の専用チャンネルを同時に作る画面です。再認証して確定します。",
    shellCard(
      "新しい部署",
      `<form data-proto-form="department">${field("部署名（必須）", "dept-name", "text", "", true, [1, 50])}${field("説明（任意）", "dept-description", "text", "", false, [0, 500])}${selectField(
        "オーナー（任意。1人まで）",
        "dept-owner",
        [
          ["", "指定しない（作成した全体管理者がオーナー）"],
          ...nominees.map((p) => [
            p.id,
            `${p.name}（${deptOf(p)}・${roleLabel(p)}）`,
          ]),
        ],
      )}<div id="successor-area" aria-live="polite"></div><p class="subtle">作成すると、公開チャンネル「# 部署名」（部署の専用チャンネル）も同時に作られ、部署の社員が自動で参加します。専用チャンネルは公開のため、ほかの部署の社員も参加せずに読めます。部署内だけの連絡は、非公開チャンネルを申請してください。指名した社員（全体管理者以外）の所属は、この部署に移ります。別の部署のオーナーを指名したときは、元部署の後任を選んで、オーナーの交代と所属の変更をまとめて反映します。</p><div class="form-actions"><button type="submit" class="button primary">作成する</button>${protoButton("キャンセル", "go", 'data-page="S24"')}</div></form>`,
    ),
  );
}
function refreshSuccessorArea() {
  const area = document.getElementById("successor-area");
  if (!area) return;
  const person = employees.find(
    (p) => p.id === document.getElementById("dept-owner")?.value,
  );
  if (!needsSuccessor(person)) {
    area.innerHTML = "";
    return;
  }
  const options = successorCandidates(person);
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、利用者の入力を e()（escapeHtml）で無害化した値と固定のマークアップだけで組み立てている
  area.innerHTML = options.length
    ? `${selectField(
        `元部署（${person.department}）の後任（必須）`,
        "dept-successor",
        options.map((p) => [p.id, p.name]),
      )}<p class="subtle">${e(person.name)} は ${e(person.department)} の現オーナーです。元部署に所属する有効な一般社員から後任を選びます。</p>`
    : `<p class="form-error" role="alert">${e(person.name)} は ${e(person.department)} の現オーナーですが、元部署に後任にできる有効な一般社員がいないため、指名できません。</p>`;
}
// 作成の入力を確かめる。誤りは入力欄の近くに示し、問題がなければ値を返す。
// 部署名: 前後の空白を除き、大文字・小文字を区別せず重複を認めない（C-49）。長さは1〜50文字（C-90。入力欄の検査で確かめる）。
function checkDepartmentInput(values) {
  const name = values.name.trim();
  if (!name) return { error: ["dept-name", "部署名を入力してください。"] };
  if (normalizeName(name) === normalizeName(COMPANY))
    return {
      error: [
        "dept-name",
        `「${COMPANY}」は会社直属のチャンネルの置き場の名前のため、部署名に使えません。`,
      ],
    };
  if (departmentNames().some((value) => normalizeName(value) === normalizeName(name)))
    return {
      error: [
        "dept-name",
        "同じ部署名がすでにあります（大文字・小文字の違いは区別しません）。",
      ],
    };
  // 専用チャンネルは部署名と同じ名前になる。チャンネル名は会社内で重複できない（C-105）。
  if (
    prototypeData.channels.some((c) => normalizeName(c.name) === normalizeName(name)) ||
    prototypeData.channelRequests.some(
      (c) => c.status === "pending" && normalizeName(c.name) === normalizeName(name),
    )
  )
    return {
      error: [
        "dept-name",
        "同じ名前のチャンネル（または承認待ちの申請）があるため、専用チャンネルを作れません。",
      ],
    };
  const owner = values.ownerId
    ? employees.find((p) => p.id === values.ownerId && p.active)
    : null;
  if (values.ownerId && !owner)
    return { error: ["dept-owner", "有効な社員を選んでください。"] };
  let successor = null;
  if (needsSuccessor(owner)) {
    successor = successorCandidates(owner).find(
      (p) => p.id === values.successorId,
    );
    if (!successor)
      return {
        error: [
          successorCandidates(owner).length ? "dept-successor" : "dept-owner",
          "元部署の後任を選べないため、この指名はできません。",
        ],
      };
  }
  return {
    value: { name, description: values.description.trim(), owner, successor },
  };
}
const departmentValues = (data) => ({
  name: String(data.get("dept-name") || ""),
  description: String(data.get("dept-description") || ""),
  ownerId: String(data.get("dept-owner") || ""),
  successorId: String(data.get("dept-successor") || ""),
});
function submitDepartmentForm(data) {
  if (!adminOnly()) return refuse();
  const result = checkDepartmentInput(departmentValues(data));
  if (result.error) return fieldError(...result.error);
  pendingDepartment = departmentValues(data);
  const { name, owner, successor } = result.value;
  showModal(
    "S-26 再認証（部署の作成）",
    `<p>次の内容で作成します。</p><ul class="plain-list"><li>部署名: ${e(name)}</li><li>オーナー: ${owner ? e(owner.name) : `${e(currentUser().name)}（作成した全体管理者）`}</li>${owner && owner.role !== "admin" ? `<li>${e(owner.name)} の所属は ${e(owner.department || "—")} から ${e(name)} に移ります</li>` : ""}${successor ? `<li>${e(owner.department)} の後任オーナー: ${e(successor.name)}（元部署のオーナー交代も同時に反映します）</li>` : ""}<li>公開チャンネル「# ${e(name)}」（部署の専用チャンネル）も同時に作られ、部署の社員が自動で参加します</li></ul>${reauthField("dept-reauth")}`,
    "department-create",
    "作成を確定",
  );
}
function createDepartment(data) {
  if (!adminOnly() || !pendingDepartment) return refuse();
  const missing = reauthMissing(data);
  if (missing) return modalError(missing);
  const result = checkDepartmentInput(pendingDepartment);
  if (result.error) {
    closeModal();
    return fieldError(...result.error);
  }
  const { name, owner, successor } = result.value;
  const admin = currentUser();
  const ownerPerson = owner || admin;
  const from = owner?.department || null;
  // 部署の作成、専用チャンネルの作成、元部署のオーナー交代、所属の変更を、1つの処理としてまとめて反映する（C-45・C-95）。
  prototypeData.departments.push(name);
  prototypeData.folders[name] = ["共通連絡"];
  if (owner && owner.role !== "admin") {
    if (successor) successor.role = "owner";
    // 旧部署の専用チャンネルなどから外れる（C-30 から導いた動き）。
    prototypeData.channels.forEach((channel) => {
      if (channel.dept === from)
        channel.members = channel.members.filter((id) => id !== owner.id);
    });
    owner.role = "owner";
    owner.department = name;
  } else {
    admin.ownerOf = [...(admin.ownerOf || []), name];
  }
  // 専用チャンネルは公開。部署の社員（この時点では移ってきたオーナーだけ）を自動参加させる（C-95）。
  prototypeData.channels.push({
    id: `dept-${Date.now()}`,
    name,
    dept: name,
    folder: "共通連絡",
    private: false,
    members: employees
      .filter((p) => p.active && p.department === name)
      .map((p) => p.id),
    messages: [],
  });
  auditLog("部署の作成", name, `${name} を作成（オーナー: ${ownerPerson.name}）。公開の専用チャンネルも作成`);
  if (successor)
    auditLog(
      "オーナーの交代",
      from,
      `${from} のオーナーを ${successor.name} に交代、${owner.name} の所属を ${name} へ変更`,
    );
  pendingDepartment = null;
  closeModal();
  proceedTo("S01");
  return notify(
    `部署と専用チャンネル（公開）を作成しました（オーナー: ${ownerPerson.name}）。「部署の一覧とオーナーの任命・交代」に反映されています。`,
  );
}

/* ---------- S-24 部署の一覧とオーナーの任命・交代 ---------- */
// 部署の無効化は【案】（C-103）。所属0人・オーナーの引き継ぎ済み・案件の担当部署の付け替え済みが条件。付け替えの手順は未決定。
function disableBlockers(name) {
  const blockers = [];
  const size = departmentSize(name);
  if (size > 0) blockers.push(`所属が${size}人います`);
  if (employees.some((p) => p.active && p.role === "owner" && p.department === name))
    blockers.push("オーナーが引き継がれていません（全体管理者の兼任になっていません）");
  const used =
    state.cases.filter((c) => c.department === name).length +
    state.requests.filter((c) => c.department === name && c.status === "pending").length;
  if (used) blockers.push(`担当部署に指定された案件・申請が${used}件あります`);
  return blockers;
}
function departmentAdminScreen() {
  const rows = departmentNames()
    .map((name) => {
      const owner = departmentOwner(name);
      const channel = dedicatedChannel(name);
      const blockers = disableBlockers(name);
      return `<div class="directory-row"><div><strong>${e(name)}</strong><p class="subtle">${departmentSize(name)}人 ・ オーナー: ${owner ? e(owner.name) + (owner.role === "admin" ? "（全体管理者が兼任）" : "") : "未設定"} ・ 専用チャンネル: ${channel ? "# " + e(channel.name) + "（公開）" : "なし"}</p>${blockers.length ? `<p class="subtle">無効化できない理由: ${e(blockers.join("／"))}</p>` : '<p class="subtle">無効化の条件を満たしています（案）</p>'}</div><div class="inline-actions">${protoButton("オーナーを任命・交代", "owner-handover", `data-dept="${e(name)}" aria-label="${e(name)}のオーナーを任命・交代"`)}<button type="button" class="button" data-ui="dept-disable" data-dept="${e(name)}" aria-label="${e(name)}を無効化（案）" ${blockers.length ? "disabled" : ""}>無効化（案）</button></div></div>`;
    })
    .join("");
  return screenFrame(
    "S24",
    "部署の一覧とオーナーの任命・交代",
    "部署の一覧です。任命・交代は再認証を挟みます。",
    shellCard(
      "部署",
      rows || "<p>部署はありません。</p>",
      protoButton("＋ 部署を作成", "go", 'data-page="S08"'),
    ) +
      hint(
        "未再現: オーナー交代の確定（確認の見本だけ）、部署名の変更、部署の無効化の実行（条件の表示と確認の見本だけ。無効化は【案】で、案件の担当部署の付け替え手順は未決定）。会社のワークスペースは会社に1つで、部署ではないため、この一覧には出しません。",
      ),
  );
}
function openDeptDisable(name) {
  if (!adminOnly() || !departmentNames().includes(name) || disableBlockers(name).length)
    return refuse();
  showModal(
    "S-26 再認証（部署の無効化・案）",
    `<p>${e(name)} を無効化する確認の見本です。無効化は【案】（C-103）で、この試作では部署の状態を変えません。</p>${reauthField("dept-disable-reauth")}`,
    "dept-disable-sample",
    "確認した",
  );
}

/* ---------- S-12 チャンネル招待 ---------- */
function submitInviteForm(data) {
  const channel = prototypeData.channels.find(
    (item) => item.id === String(data.get("invite-channel") || ""),
  );
  const person = employees.find(
    (p) => p.id === String(data.get("invite-person") || "") && p.active,
  );
  const status = document.getElementById("invite-status");
  const say = (message) => {
    status.textContent = message;
    status.hidden = false;
  };
  if (!channel || !isChannelMember(channel)) return refuse();
  if (!person) return say("有効な社員を選んでください。");
  if (channel.members.includes(person.id))
    return say(
      `${person.name} は # ${channel.name} に参加済みです。重複した招待は作りません。`,
    );
  status.hidden = true;
  showModal(
    "S-26 再認証（チャンネルへの招待）",
    `<p># ${e(channel.name)} に ${e(person.name)} を招待します。</p>${reauthField("invite-reauth")}<input type="hidden" name="channel" value="${e(channel.id)}"><input type="hidden" name="person" value="${e(person.id)}">`,
    "invite-reauth",
    "確認へ進む",
  );
}
function inviteReauth(data) {
  const missing = reauthMissing(data);
  if (missing) return modalError(missing);
  const channel = prototypeData.channels.find((c) => c.id === data.get("channel"));
  const person = employees.find((p) => p.id === data.get("person") && p.active);
  if (!channel || !person || !isChannelMember(channel)) return refuse();
  closeModal();
  showModal(
    "招待の確認",
    `<p>招待する社員: <strong>${e(person.name)}</strong></p><p>招待先のチャンネル: <strong># ${e(channel.name)}</strong></p><p class="subtle">確定すると同時に参加者に追加されます。本人の申込や別の人の許可は要りません。確定後は取り消せません。画面を閉じれば、取り消せます。</p><input type="hidden" name="channel" value="${e(channel.id)}"><input type="hidden" name="person" value="${e(person.id)}">`,
    "invite-confirm",
    "招待を確定",
  );
}
function inviteConfirm(data) {
  const channel = prototypeData.channels.find((c) => c.id === data.get("channel"));
  const person = employees.find((p) => p.id === data.get("person") && p.active);
  if (!channel || !person || !isChannelMember(channel)) return refuse();
  if (channel.members.includes(person.id)) {
    closeModal();
    return notify(`${person.name} は参加済みです。`);
  }
  channel.members.push(person.id);
  auditLog("チャンネルへの招待", `# ${channel.name}`, `${person.name} を # ${channel.name} に招待（参加者へ追加）`);
  commitRender();
  return notify(`${person.name} を # ${channel.name} の参加者に追加しました。`);
}

/* ---------- S-13 退職処理の申請（オーナー） ---------- */
function openRetireApply(userId) {
  const person = employees.find((p) => p.id === userId && p.active);
  if (
    !person ||
    !ownerHere() ||
    person.department !== manageDeptNow() ||
    person.role !== "member" ||
    prototypeData.retireRequests.some(
      (r) => r.target === person.id && r.status === "pending",
    )
  )
    return refuse();
  showModal(
    "退職処理の申請",
    `<p>対象: <strong>${e(person.name)}</strong>（${e(person.department)}）</p><p class="subtle">全体管理者へ退職処理を申請します。申請を送っただけでは、社員の所属・状態・権限は変わらず、全体管理者が無効化するまで有効な社員として扱います。</p><input type="hidden" name="target" value="${e(person.id)}">`,
    "retire-apply",
    "申請を送信",
  );
}
function saveRetireApply(data) {
  const person = employees.find((p) => p.id === data.get("target") && p.active);
  if (!person || !ownerHere() || person.department !== manageDeptNow())
    return refuse();
  prototypeData.retireRequests.unshift({
    id: `RT-${Date.now()}`,
    target: person.id,
    by: state.userId,
    at: stamp(),
    status: "pending",
  });
  commitRender();
  return notify(
    "全体管理者へ退職処理を申請しました。処理が完了するまで社員は有効です。",
  );
}

/* ---------- S-22 アカウント管理 ---------- */
const accountRowNote = (person) => {
  const transfer = prototypeData.transfers.find((t) => t.user === person.id);
  return transfer
    ? ` ・ 異動予定: ${transfer.to}（${transfer.date}）`
    : "";
};
function accountsScreen() {
  const people = employees.filter(
    (person) =>
      (ui.accountFilter === "すべて" || person.department === ui.accountFilter) &&
      (ui.accountState === "すべて" ||
        (ui.accountState === "有効") === person.active),
  );
  const row = (person) => {
    const label = e(person.name);
    const operations = person.active
      ? protoButton("情報を変更", "account-info", `data-user="${person.id}" aria-label="${label}の役職・メール・内線を変更"`) +
        protoButton("部署異動を登録", "account-transfer", `data-user="${person.id}" aria-label="${label}の部署異動を登録"`) +
        protoButton("再発行", "account-password", `data-user="${person.id}" aria-label="${label}のパスワードを再発行"`) +
        protoButton("無効化", "account-disable", `data-user="${person.id}" aria-label="${label}を無効化"`)
      : protoButton("再有効化", "account-enable", `data-user="${person.id}" aria-label="${label}を再有効化"`);
    return `<div class="directory-row"><div><strong>ユーザーID ${label}</strong><p class="subtle">表示名 ${label} ・ ${person.active ? e(person.department) : "無効（退職者）"} ・ ${person.active ? "有効" : "無効"}${roleNote(person) ? " ・ " + roleNote(person) : ""}${e(accountRowNote(person))}</p></div><div class="inline-actions">${operations}</div></div>`;
  };
  const pendingRetire = prototypeData.retireRequests.filter(
    (r) => r.status === "pending",
  );
  const retireRows = prototypeData.retireRequests
    .map((request) => {
      const target = employees.find((p) => p.id === request.target);
      return `<div class="directory-row"><div><strong>${e(target.name)}</strong><p class="subtle">申請者: ${e(nameOf(request.by))} ・ ${e(request.at)} ・ ${request.status === "pending" ? "確認待ち（社員は有効のまま）" : "処理済み（無効化）"}</p></div>${request.status === "pending" ? protoButton("確認して無効化", "retire-process", `data-id="${e(request.id)}" aria-label="${e(target.name)}の退職処理の申請を確認して無効化"`) : ""}</div>`;
    })
    .join("");
  const nameRows = prototypeData.nameChanges
    .map(
      (change) =>
        `<div class="directory-row"><div><strong>${e(nameOf(change.user))}</strong><p class="subtle">本人が提出した本名変更届 ・ ${change.status === "pending" ? "確認待ち" : "承認済み（本名を更新）"}</p></div>${change.status === "pending" ? protoButton("確認して承認", "name-change-approve", `data-id="${e(change.id)}" aria-label="${e(nameOf(change.user))}の本名変更届を確認して承認"`) : ""}</div>`,
    )
    .join("");
  const transferRows = prototypeData.transfers
    .map(
      (transfer) =>
        `<div class="directory-row"><div><strong>${e(nameOf(transfer.user))}</strong><p class="subtle">${e(transfer.from)} から ${e(transfer.to)} へ ・ 異動日 ${e(transfer.date)}（それまでは現在の所属を維持）</p></div>${protoButton("異動日になったことにする（確認用）", "transfer-apply-demo", `data-id="${e(transfer.id)}" aria-label="${e(nameOf(transfer.user))}の異動日になったことにする（確認用）"`)}</div>`,
    )
    .join("");
  return screenFrame(
    "S22",
    "アカウント管理",
    "全体管理者が社員の情報・有効状態・退職処理の申請・本名変更届を扱う画面です。変更の前に再認証します。",
    shellCard(
      "アカウント一覧",
      `<p class="subtle">「情報を変更」は役職・メール・内線の変更です。所属は「部署異動を登録」、本名は本人が出した変更届の承認で変えます。無効にした社員（退職者）は所属がないため、状態を「無効」にして探します。</p><div class="directory-toolbar">${selectField(
        "部署",
        "account-department",
        [["すべて", "すべて"], ...departmentNames().map((n) => [n, n])],
        ui.accountFilter,
      )}${selectField(
        "状態",
        "account-state",
        [["有効", "有効"], ["無効", "無効"], ["すべて", "すべて"]],
        ui.accountState,
      )}</div><p class="subtle" role="status">${people.length}件</p><div class="list-cards">${people.map(row).join("") || "<p>該当するアカウントがありません。</p>"}</div>`,
      protoButton("＋ 新規登録", "go", 'data-page="S23"') +
        protoButton("部署異動を登録", "account-transfer", 'data-user=""'),
    ) +
      shellCard(
        `退職処理の申請（確認待ち ${pendingRetire.length}件）`,
        `<p class="subtle">部署のオーナーが申請した退職処理です。申請しただけでは社員は有効なままで、全体管理者が再認証して無効化したときに退職が確定します。</p>${retireRows || "<p>申請はありません。</p>"}`,
      ) +
      shellCard(
        "本名変更届",
        `<p class="subtle">本名は本人が変更届を出し（プロフィール設定 S-19 の「本名の変更届を出す」）、全体管理者が承認して更新します（本人は直接変更できません。C-75）。本名の値は画面に出さず、監査ログにも残しません。</p>${nameRows || "<p>届出はありません。</p>"}`,
      ) +
      (transferRows
        ? shellCard("登録済みの部署異動（異動日前）", transferRows)
        : "") +
      hint(
        "未決定: 再有効化後の全社連絡・部署の専用チャンネルへの参加の戻し方、退職処理の申請の取消・重複・却下、全体管理者側の申請一覧の細かい構成、異動日が過去のときの扱い。この画面では確定した動きとして作っていません。",
      ),
  );
}
function openAccountInfo(userId) {
  const person = employees.find((p) => p.id === userId && p.active);
  if (!adminOnly() || !person) return refuse();
  showModal(
    "社員情報の変更（役職・メール・内線）",
    `<p>対象: <strong>${e(person.name)}</strong>。本名は本人の変更届を承認して変えます。表示名は本人が変更します。所属の変更は「部署異動を登録」で行います。</p>${field("役職（任意）", "info-title", "text", person.title || "", false, [0, 30])}${field("メールアドレス", "info-email", "email", emailOf(person), true, [3, 254])}${field("内線番号（任意。半角数字とハイフン）", "info-ext", "text", person.ext || "", false, [0, 10])}<label class="checkbox-option"><input type="checkbox" name="issued"> 新しいメールアドレスが会社発行のものであることを確認した（メールアドレスを変えるとき必須）</label>${reauthField("info-reauth")}<p class="subtle">確認者・日時と変更した項目だけを監査ログに残します。変更前後の個人情報は残しません。</p><input type="hidden" name="target" value="${e(person.id)}">`,
    "account-info-save",
    "保存する",
  );
}
function saveAccountInfo(data) {
  const person = employees.find((p) => p.id === data.get("target") && p.active);
  if (!adminOnly() || !person) return refuse();
  const title = String(data.get("info-title") || "").trim();
  const email = String(data.get("info-email") || "").trim();
  const ext = String(data.get("info-ext") || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return modalError("メールアドレスは「@」を含む正しい形式で入力してください。");
  if (employees.some((p) => p !== person && emailOf(p).toLowerCase() === email.toLowerCase()))
    return modalError("このメールアドレスはすでに使われています。");
  if (ext && !/^[0-9-]{1,10}$/.test(ext))
    return modalError("内線番号は半角数字とハイフンで10文字以内にしてください。");
  const emailChanged = email.toLowerCase() !== emailOf(person).toLowerCase();
  if (emailChanged && !data.get("issued"))
    return modalError("新しいメールアドレスが会社発行であることの確認が必要です。");
  const missing = reauthMissing(data);
  if (missing) return modalError(missing);
  const changed = [
    title !== (person.title || "") ? "役職" : "",
    emailChanged ? "メールアドレス" : "",
    ext !== (person.ext || "") ? "内線番号" : "",
  ].filter(Boolean);
  person.title = title;
  person.email = email;
  person.ext = ext;
  auditLog("社員情報の変更", person.name, `${person.name} の社員情報を変更（変更項目: ${changed.join("・") || "なし"}）`);
  commitRender();
  return notify("変更しました。");
}
function openTransfer(userId) {
  if (!adminOnly()) return refuse();
  const targets = employees.filter((p) => p.active && p.role !== "admin" && p.department);
  return showModal(
    "部署異動を登録",
    `<p class="subtle">対象社員・新しい所属部署・異動日を指定します。異動日までは現在の所属を維持し、異動日に旧部署から外れて新部署へ所属します。会社のワークスペースには所属し続けます。旧部署の専用チャンネルから外れ、新部署の専用チャンネルに参加します（C-30・C-95）。旧部署のオーナーは、異動の前に後任へ交代しておく必要があります。</p>${selectField("対象社員", "transfer-user", targets.map((p) => [p.id, `${p.name}（${p.department}）`]), userId)}${selectField("新しい所属部署", "transfer-to", departmentNames().map((n) => [n, n]))}<div class="form-field"><label for="transfer-date">異動日</label><input id="transfer-date" name="transfer-date" type="date" required></div>${reauthField("transfer-reauth")}<p class="subtle">異動前後の所属・権限・実行者・日時を監査ログに残します。異動すると、その社員の案件作成の申請（承認待ち）は自動で取り消されます。公開の申請と再開の申請は続きます。</p>`,
    "transfer-save",
    "異動を登録",
  );
}
function applyTransfer(person, to) {
  const from = person.department;
  prototypeData.channels.forEach((channel) => {
    if (channel.dept === from)
      channel.members = channel.members.filter((id) => id !== person.id);
  });
  person.department = to;
  const dedicated = dedicatedChannel(to);
  if (dedicated && !dedicated.members.includes(person.id))
    dedicated.members.push(person.id);
  state.requests.forEach((request) => {
    if (request.applicant === person.id && request.status === "pending") {
      request.status = "cancelled";
      request.reason = "部署異動により自動で取り消されました。";
    }
  });
  auditLog("部署異動", person.name, `${person.name} の所属を ${from} から ${to} へ変更（権限: ${roleLabel(person)}のまま）`);
}
function saveTransfer(data) {
  if (!adminOnly()) return refuse();
  const person = employees.find((p) => p.id === data.get("transfer-user") && p.active);
  const to = String(data.get("transfer-to") || "");
  const date = String(data.get("transfer-date") || "");
  if (!person || person.role === "admin" || !person.department) return refuse();
  if (!departmentNames().includes(to)) return modalError("新しい所属部署を選んでください。");
  if (person.department === to) return modalError("すでにその部署に所属しています。");
  if (person.role === "owner")
    return modalError(
      `${person.name} は ${person.department} のオーナーです。先に後任へ交代してから異動を登録してください（オーナーの交代は全体管理者が行います）。`,
    );
  if (!date) return modalError("異動日を入力してください。");
  const missing = reauthMissing(data);
  if (missing) return modalError(missing);
  if (date <= todayText()) {
    applyTransfer(person, to);
    commitRender();
    return notify(`${person.name} を ${to} へ異動しました。`);
  }
  prototypeData.transfers.push({
    id: `TR-${Date.now()}`,
    user: person.id,
    from: person.department,
    to,
    date,
  });
  auditLog("部署異動の登録", person.name, `${person.name} の ${to} への異動を ${date} 付けで登録（それまでは ${person.department} のまま）`);
  commitRender();
  return notify(`異動を登録しました。${date} までは現在の所属です。`);
}
function applyTransferDemo(id) {
  const transfer = prototypeData.transfers.find((t) => t.id === id);
  const person = employees.find((p) => p.id === transfer?.user && p.active);
  if (!adminOnly() || !transfer || !person) return refuse();
  applyTransfer(person, transfer.to);
  prototypeData.transfers = prototypeData.transfers.filter((t) => t !== transfer);
  render();
  return notify(`異動日になりました。${person.name} は ${transfer.to} に所属します。`);
}
function openDisable(userId, requestId = "") {
  const person = employees.find((p) => p.id === userId && p.active);
  if (!adminOnly() || !person) return refuse();
  showModal(
    "アカウントの無効化（退職処理）",
    `<p>対象: <strong>${e(person.name)}</strong>（${e(person.department)}）</p><p>無効化すると、次のようになります。</p><ul class="plain-list"><li>この社員は、ログインできなくなります</li><li>部署の所属と、すべてのチャンネルへの参加が外れ、会社のワークスペースからも外れて、退職者（所属なし）になります</li><li>過去のメッセージは残り、「退職者」と併記されます</li><li>同じユーザーIDでは新しく登録できません</li><li>全体管理者が「再有効化」で、同じアカウントに戻せます</li></ul>${reauthField("disable-reauth")}<input type="hidden" name="target" value="${e(person.id)}"><input type="hidden" name="request" value="${e(requestId)}">`,
    "account-disable-confirm",
    "無効化する",
    true,
  );
}
function confirmDisable(data) {
  const person = employees.find((p) => p.id === data.get("target") && p.active);
  if (!adminOnly() || !person) return refuse();
  if (person.id === state.userId)
    return modalError("自分のアカウントは無効化できません。");
  if (person.role === "admin")
    return modalError("唯一の全体管理者は、後任へ引き継ぐまで無効化できません。");
  if (person.role === "owner")
    return modalError(
      "オーナーは、先に全体管理者がオーナーを交代させてから無効化します（交代前のオーナーは無効化できません）。",
    );
  const missing = reauthMissing(data);
  if (missing) return modalError(missing);
  const from = person.department;
  person.active = false;
  person.department = null;
  prototypeData.channels.forEach((channel) => {
    channel.members = channel.members.filter((id) => id !== person.id);
  });
  prototypeData.transfers = prototypeData.transfers.filter((t) => t.user !== person.id);
  prototypeData.retireRequests.forEach((request) => {
    if (request.target === person.id && request.status === "pending")
      request.status = "done";
  });
  auditLog("アカウントの無効化", person.name, `${person.name}（${from}）を無効化（退職処理）`);
  commitRender();
  return notify("無効化しました。");
}
function openEnable(userId) {
  const person = employees.find((p) => p.id === userId && !p.active);
  if (!adminOnly() || !person) return refuse();
  showModal(
    "アカウントの再有効化",
    `<p>対象: <strong>${e(person.name)}</strong>（退職者）</p><p>再有効化すると、次のようになります。</p><ul class="plain-list"><li>同じユーザーIDで、再びログインできます（新しいアカウントは作りません）</li><li>過去のメッセージは、そのまま残っています</li><li>所属部署は、下で指定し直します</li><li>以前の管理権限（オーナーなど）と、チャンネル・案件への参加は、自動では戻りません（全社連絡・部署の専用チャンネルも同じ）</li><li>パスワードを再発行し、初回のログインで変更が必要になります</li><li>操作は監査ログに残ります</li></ul>${selectField("所属部署（必須）", "enable-department", departmentNames().map((n) => [n, n]))}${reauthField("enable-reauth")}<input type="hidden" name="target" value="${e(person.id)}">`,
    "account-enable-confirm",
    "再有効化する",
  );
}
function showReissued(person, title) {
  showModal(
    title,
    `<p>対象: <strong>${e(person.name)}</strong></p><p>初期パスワード（試作の見本・架空）: <strong>${e(sampleInitialPassword())}</strong></p><p class="subtle">初期パスワードは、この画面でだけ一度表示します。別の連絡手段で本人に伝えてください。本人は次のログインでパスワードを変更します。この社員の以前のセッションは無効になります。</p>`,
    "result-only",
    "",
  );
}
function confirmEnable(data) {
  const person = employees.find((p) => p.id === data.get("target") && !p.active);
  const department = String(data.get("enable-department") || "");
  if (!adminOnly() || !person) return refuse();
  if (!departmentNames().includes(department))
    return modalError("所属部署を選んでください。");
  const missing = reauthMissing(data);
  if (missing) return modalError(missing);
  person.active = true;
  person.department = department;
  person.role = "member";
  auditLog("アカウントの再有効化", person.name, `${person.name} を再有効化（所属: ${department}。権限・参加は戻さず、パスワードを再発行）`);
  commitRender();
  notify("再有効化しました。");
  showReissued(person, "再有効化しました（パスワードを再発行）");
}
function openReissue(userId) {
  const person = employees.find((p) => p.id === userId && p.active);
  if (!adminOnly() || !person) return refuse();
  showModal(
    "パスワードの再発行",
    `<p>対象: <strong>${e(person.name)}</strong></p><p class="subtle">初期パスワードは再発行のときにシステムが生成します。再発行すると、この社員のすべてのセッションが無効になり、次のログインでパスワードの変更が必要になります。</p>${reauthField("reissue-reauth")}<input type="hidden" name="target" value="${e(person.id)}">`,
    "account-password-reissue",
    "再発行する",
  );
}
function confirmReissue(data) {
  const person = employees.find((p) => p.id === data.get("target") && p.active);
  if (!adminOnly() || !person) return refuse();
  const missing = reauthMissing(data);
  if (missing) return modalError(missing);
  auditLog("パスワードの再発行", person.name, `${person.name} のパスワードを再発行`);
  closeModal();
  showReissued(person, "パスワードを再発行しました");
}
function openNameChange(id) {
  const change = prototypeData.nameChanges.find((c) => c.id === id && c.status === "pending");
  if (!adminOnly() || !change) return refuse();
  showModal(
    "本名変更届の承認",
    `<p>対象: <strong>${e(nameOf(change.user))}</strong>。本人が提出した本名変更届を承認すると、本名が更新されます。</p>${reauthField("name-change-reauth")}<p class="subtle">監査ログには、申請者・承認者・日時・対象者・操作内容を残し、本名の値は残しません。</p><input type="hidden" name="id" value="${e(change.id)}">`,
    "name-change-approve",
    "承認して更新",
  );
}
function approveNameChange(data) {
  const change = prototypeData.nameChanges.find((c) => c.id === data.get("id") && c.status === "pending");
  if (!adminOnly() || !change) return refuse();
  const missing = reauthMissing(data);
  if (missing) return modalError(missing);
  change.status = "done";
  auditLog("本名変更届の承認", nameOf(change.user), `${nameOf(change.user)} の本名変更届を承認（申請者: 本人、本名の値は記録しない）`);
  commitRender();
  return notify("本名を更新しました。");
}

/* ---------- クリック・送信・変更の受け口 ---------- */
Object.assign(EXTRA_UI, {
  "invite-open": (element) => {
    ui.inviteChannelId = element.dataset.id;
    proceedTo("S12");
  },
  "retire-apply": (element) => openRetireApply(element.dataset.user),
  "dept-disable": (element) => openDeptDisable(element.dataset.dept),
  "name-change-request": () => openNameChangeRequest(),
  "retire-process": (element) => {
    const request = prototypeData.retireRequests.find((r) => r.id === element.dataset.id);
    if (request) openDisable(request.target, request.id);
  },
  "account-info": (element) => openAccountInfo(element.dataset.user),
  "account-transfer": (element) => openTransfer(element.dataset.user),
  "account-password": (element) => openReissue(element.dataset.user),
  "account-disable": (element) => openDisable(element.dataset.user),
  "account-enable": (element) => openEnable(element.dataset.user),
  "name-change-approve": (element) => openNameChange(element.dataset.id),
  "transfer-apply-demo": (element) => applyTransferDemo(element.dataset.id),
});
Object.assign(EXTRA_MODAL, {
  "department-create": createDepartment,
  "dept-disable-sample": () => {
    const missing = reauthMissing(new FormData(document.getElementById("modal-form")));
    if (missing) return modalError(missing);
    closeModal();
    return notify("無効化の確認の見本です。この試作では部署の状態を変えません。");
  },
  "name-change-request": saveNameChangeRequest,
  "invite-reauth": inviteReauth,
  "invite-confirm": inviteConfirm,
  "retire-apply": saveRetireApply,
  "account-info-save": saveAccountInfo,
  "transfer-save": saveTransfer,
  "account-disable-confirm": confirmDisable,
  "account-enable-confirm": confirmEnable,
  "account-password-reissue": confirmReissue,
  "name-change-approve": approveNameChange,
  "result-only": () => {
    closeModal();
    screen.focus();
  },
});
/* ---------- S-19 本人の本名変更届（C-75） ---------- */
// 本人は本名を直接変えられない。変更届を出し、全体管理者が S-22 で承認すると更新される。本名の値はこの試作に保持しない。
function openNameChangeRequest() {
  if (prototypeData.nameChanges.some((c) => c.user === state.userId && c.status === "pending"))
    return refuse("確認待ちの本名変更届がすでにあります。");
  showModal(
    "本名の変更届を出す",
    `${field("新しい本名（見本。この試作では保存しません）", "name-change-value", "text", "", true, [1, 50])}<p class="subtle">本名は直接変更できません。変更届を出すと、全体管理者が確認して承認したときに更新されます。本名の値は監査ログに残りません。</p>`,
    "name-change-request",
    "変更届を出す",
  );
}
function saveNameChangeRequest() {
  if (prototypeData.nameChanges.some((c) => c.user === state.userId && c.status === "pending"))
    return refuse("確認待ちの本名変更届がすでにあります。");
  prototypeData.nameChanges.push({
    id: `NC-${Date.now()}`,
    user: state.userId,
    status: "pending",
  });
  closeModal();
  return notify("本名の変更届を出しました。全体管理者が承認すると更新されます。");
}

/* ---------- S-34 初代全体管理者の初回セットアップ ---------- */
// 試作の見本。実際には、初代管理者が未登録の間だけ使える。会社名は必須で、長さ・使用可能文字は未決定（V-47）。
function setupScreen() {
  const done = ui.setupResult;
  const body = done
    ? shellCard(
        "登録が終わりました（見本）",
        `<p>会社名「<strong>${e(done.company)}</strong>」と、初代全体管理者のアカウントを登録しました（見本。何も保存していません）。</p><p>初期パスワード（試作の見本・架空）: <strong>${e(done.password)}</strong></p><p class="subtle">初期パスワードは、この画面でだけ一度表示します。別の連絡手段で本人に伝え、初回ログインで変更してもらいます。</p>${protoButton("ログイン画面へ", "go", 'data-page="S02"', true)}`,
      )
    : shellCard(
        "手順に沿って入力",
        `<form data-proto-form="setup"><ol class="plain-list"><li>手順1　初回認証を入力する</li><li>手順2　会社名を入力する（必須）</li><li>手順3　社員アカウントを登録する</li></ol>${field("手順1　初回認証", "setup-auth", "password", "", true)}${field("手順2　会社名（必須）", "setup-company", "text", "", true)}<p class="subtle">会社名の長さ・使用可能文字は未決定です（API V-47）。</p>${field("手順3　ユーザーID", "setup-id", "text", "", true, [3, 32])}${field("表示名", "setup-display", "text", "", true, [1, 30])}${field("本名", "setup-real", "text", "", true, [1, 50])}${field("メールアドレス", "setup-email", "email", "", true, [3, 254])}<p class="subtle">初期パスワードはシステムが生成し、登録成功後に一度だけ表示します。</p><div class="form-actions"><button type="submit" class="button primary">登録する</button></div></form>`,
      );
  return `<div class="auth-panel">${screenFrame(
    "S34",
    "初回セットアップ（初代全体管理者の登録）",
    "代表取締役社長本人が、会社名と自分の社員アカウントを登録します。",
    body +
      hint(
        "試作の見本です。この試作では初代全体管理者が登録済みのため、実際にはログイン画面から案内されません（画面の確認用に開いています）。初回認証の確認・初代管理者の部署の扱いは再現していません。",
      ),
  )}</div>`;
}
function submitSetupForm(data) {
  const company = String(data.get("setup-company") || "").trim();
  if (!company) return fieldError("setup-company", "会社名を入力してください。");
  if (!String(data.get("setup-auth") || ""))
    return fieldError("setup-auth", "初回認証を入力してください。");
  ui.setupResult = { company, password: sampleInitialPassword() };
  render();
  screen.focus();
  return notify("登録の見本を表示しました。何も保存していません。");
}

/* ---------- 入力・変更の受け口 ---------- */
document.addEventListener("input", (event) => {
  if (event.target.id !== "channel-search") return;
  const term = event.target.value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll("#channel-list [data-channel-name]").forEach((row) => {
    const match = row.dataset.channelName.toLowerCase().includes(term);
    row.hidden = !match;
    if (match) shown += 1;
  });
  document.getElementById("channel-search-empty").hidden = shown > 0;
});
document.addEventListener(
  "change",
  (event) => {
    const target = event.target;
    if (target.id === "dept-owner") refreshSuccessorArea();
    if (target.id === "invite-channel") {
      ui.inviteChannelId = target.value;
      render();
      document.getElementById("invite-channel")?.focus();
    }
    if (target.id === "account-state") {
      ui.accountState = target.value;
      render();
    }
    // 絞り込みで画面を作り直したあとも、操作した選択欄にフォーカスを戻す。
    if (["staff-department", "account-department", "account-state"].includes(target.id))
      document.getElementById(target.id)?.focus();
  },
  true,
);
