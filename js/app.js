/* بوصلة — منطق التطبيق */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

const cfg = window.FIREBASE_CONFIG || {};
if (!cfg.apiKey || cfg.apiKey.includes("YOUR_FIREBASE")) {
  document.body.innerHTML = `
    <div style="padding:60px 20px;text-align:center;max-width:480px;margin:0 auto" dir="rtl">
      <h2>يلزم إعداد Firebase أولاً</h2>
      <p>افتحي ملف <code>js/config.js</code> وضعي فيه بيانات مشروعك على Firebase (firebaseConfig)، ثم أعيدي تحميل الصفحة.</p>
    </div>`;
  throw new Error("Firebase غير مُعدّ بعد — أضيفي القيم في js/config.js");
}

const app = initializeApp(cfg);
const db = getFirestore(app);
const auth = getAuth(app);
const projectsCol = collection(db, "projects");
const decisionsCol = collection(db, "decisions");
const ideasCol = collection(db, "ideas");

// الحساب المشترك (كلمة سر واحدة للاثنين) — نفس حساب توازن، بدون أي إعداد إضافي في Firebase Console
const AUTH_EMAIL = "tawazon-app@internal.local";

const STORAGE_KEY = "bawsala_user";
const THEME_KEY = "bawsala_theme";
const MAX_PRIORITIES = 3;
const IDEA_STAGES = ["غير مصنّفة", "هذا الأسبوع", "هذا الربع", "مستقبلية"];

let projects = [];
let decisions = [];
let ideas = [];
let currentUser = null;
let editingProjectId = null;
const expandedProjects = new Set();

/* ---------- أدوات مساعدة ---------- */

function convertArabicDigits(str) {
  const arabicIndic = "٠١٢٣٤٥٦٧٨٩";
  const extendedIndic = "۰۱۲۳۴۵۶۷۸۹";
  return str.replace(/[٠-٩۰-۹]/g, (ch) => {
    let idx = arabicIndic.indexOf(ch);
    if (idx === -1) idx = extendedIndic.indexOf(ch);
    return idx === -1 ? ch : String(idx);
  });
}

function todayStr() {
  return formatISO(new Date());
}
function formatISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatDisplayDate(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function isMale() {
  return currentUser === "منذر";
}
function g(female, male) {
  return isMale() ? male : female;
}

/* ---------- أيقونات SVG ---------- */

const ICONS = {
  moon: `<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/></svg>`,
  sun: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>`,
  star: `<svg class="icon" viewBox="0 0 24 24" style="fill:var(--gold)"><path d="M12 2.5l2.9 6.06 6.6.87-4.8 4.63 1.18 6.6L12 17.6l-5.88 3.06 1.18-6.6-4.8-4.63 6.6-.87Z"/></svg>`,
  edit: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  check: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  trash: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`,
  close: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  undo: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h10a5 5 0 0 1 0 10H8"/><path d="M8 5 3 10l5 5"/></svg>`,
  caretDown: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`,
  caretUp: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>`,
};
function icon(name) {
  return ICONS[name] || "";
}

/* ---------- الوضع الداكن/الفاتح ---------- */

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const theme = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(theme);
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("theme-toggle-btn");
  if (btn) btn.innerHTML = icon(theme === "dark" ? "sun" : "moon");
}
document.getElementById("theme-toggle-btn").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});
initTheme();

/* ---------- المستخدم ---------- */

function initUser() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "أسيل" || saved === "منذر") {
    currentUser = saved;
    startApp();
  } else {
    document.getElementById("name-picker").classList.remove("hidden");
  }
}
document.querySelectorAll("#name-picker [data-name]").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentUser = btn.dataset.name;
    localStorage.setItem(STORAGE_KEY, currentUser);
    document.getElementById("name-picker").classList.add("hidden");
    startApp();
  });
});
document.getElementById("switch-user-btn").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  document.documentElement.removeAttribute("data-user");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("name-picker").classList.remove("hidden");
});

function startApp() {
  document.documentElement.setAttribute("data-user", currentUser);
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("current-user-label").textContent = `${g("أنتِ", "أنت")}: ${currentUser}`;
  document.getElementById("decision-title-input").placeholder = `${g("أضيفي", "أضف")} بندًا يحتاج قرار منذر...`;
  document.getElementById("idea-title-input").placeholder = `${g("أضيفي", "أضف")} فكرة جديدة...`;
  subscribeRealtime();
}

/* ---------- المزامنة اللحظية ---------- */

function subscribeRealtime() {
  onSnapshot(projectsCol, (snapshot) => {
    projects = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  });
  onSnapshot(decisionsCol, (snapshot) => {
    decisions = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderDecisions();
  });
  onSnapshot(ideasCol, (snapshot) => {
    ideas = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderIdeas();
  });
}

function renderAll() {
  renderPriorities();
  renderProjects();
  renderDone();
}

/* ---------- أولويات الأسبوع ---------- */

function renderPriorities() {
  const row = document.getElementById("priorities-row");
  row.innerHTML = "";
  const active = projects.filter((p) => p.status === "نشط" && p.is_priority).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  if (active.length === 0) {
    row.innerHTML = `<div class="priorities-empty">ما فيه أولويات محددة — ${g("علّمي", "علّم")} مشروع بالنجمة ⭐ من القائمة تحت</div>`;
    return;
  }

  active.forEach((p) => {
    const chip = document.createElement("div");
    chip.className = "priority-chip";
    const dot = document.createElement("span");
    dot.className = "owner-dot";
    dot.style.background = ownerColorVar(p.owner);
    chip.appendChild(dot);
    const text = document.createElement("span");
    text.textContent = p.title;
    chip.appendChild(text);
    row.appendChild(chip);
  });
}

function ownerColorVar(owner) {
  if (owner === "أسيل") return "var(--aseel)";
  if (owner === "منذر") return "var(--munther)";
  return "var(--gold)";
}

/* ---------- المشاريع النشطة ---------- */

function renderProjects() {
  const list = document.getElementById("projects-list");
  list.innerHTML = "";
  const active = projects.filter((p) => p.status === "نشط").sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  if (active.length === 0) {
    list.innerHTML = `<div class="empty-state">لا توجد مشاريع نشطة — ${g("اضغطي", "اضغط")} "+ مشروع جديد"</div>`;
    return;
  }

  active.forEach((p) => list.appendChild(renderProjectRow(p)));
}

function renderProjectRow(p) {
  const row = document.createElement("div");
  row.className = "project-row";

  const isExpanded = expandedProjects.has(p.id);

  const title = document.createElement("div");
  title.className = "project-title";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "details-toggle";
  toggleBtn.title = "خطوات إضافية وملاحظات";
  toggleBtn.innerHTML = icon(isExpanded ? "caretUp" : "caretDown");
  toggleBtn.addEventListener("click", () => {
    if (expandedProjects.has(p.id)) expandedProjects.delete(p.id);
    else expandedProjects.add(p.id);
    renderProjects();
  });
  title.appendChild(toggleBtn);

  const titleText = document.createElement("span");
  titleText.textContent = p.title;
  title.appendChild(titleText);
  row.appendChild(title);

  const owner = document.createElement("div");
  const ownerBadge = document.createElement("span");
  ownerBadge.className = `owner-badge owner-${p.owner}`;
  ownerBadge.textContent = p.owner;
  owner.appendChild(ownerBadge);
  row.appendChild(owner);

  const nextAction = document.createElement("div");
  nextAction.textContent = p.next_action;
  row.appendChild(nextAction);

  const due = document.createElement("div");
  const isOverdue = p.due_date && p.due_date < todayStr();
  due.className = isOverdue ? "due-date due-overdue" : "due-date";
  due.textContent = formatDisplayDate(p.due_date);
  row.appendChild(due);

  const actions = document.createElement("div");
  actions.className = "project-actions";

  const starBtn = document.createElement("button");
  starBtn.type = "button";
  starBtn.className = `star-btn${p.is_priority ? " active" : ""}`;
  starBtn.title = "أولوية الأسبوع";
  starBtn.innerHTML = icon("star");
  starBtn.addEventListener("click", () => togglePriority(p));
  actions.appendChild(starBtn);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn-icon";
  editBtn.title = "تعديل";
  editBtn.innerHTML = icon("edit");
  editBtn.addEventListener("click", () => openProjectModal(p));
  actions.appendChild(editBtn);

  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "btn-icon";
  doneBtn.title = "نقل إلى الإنجازات";
  doneBtn.innerHTML = icon("check");
  doneBtn.addEventListener("click", () => markDone(p.id));
  actions.appendChild(doneBtn);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn-icon";
  delBtn.title = "حذف نهائي";
  delBtn.innerHTML = icon("trash");
  delBtn.addEventListener("click", () => deleteProject(p.id));
  actions.appendChild(delBtn);

  row.appendChild(actions);

  if (isExpanded) row.appendChild(renderProjectDetails(p));

  return row;
}

function renderProjectDetails(p) {
  const details = document.createElement("div");
  details.className = "project-details";

  const notesLabel = document.createElement("div");
  notesLabel.className = "details-label";
  notesLabel.textContent = "ملاحظات";
  details.appendChild(notesLabel);

  const notesArea = document.createElement("textarea");
  notesArea.className = "notes-field";
  notesArea.maxLength = 1000;
  notesArea.rows = 2;
  notesArea.placeholder = "أي تفاصيل إضافية...";
  notesArea.value = p.notes || "";
  notesArea.addEventListener("blur", () => {
    const value = convertArabicDigits(notesArea.value.trim());
    if (value !== (p.notes || "")) {
      updateDoc(doc(db, "projects", p.id), { notes: value });
    }
  });
  details.appendChild(notesArea);

  const stepsLabel = document.createElement("div");
  stepsLabel.className = "details-label";
  stepsLabel.textContent = "خطوات إضافية";
  details.appendChild(stepsLabel);

  const steps = p.extra_steps || [];
  const stepsList = document.createElement("div");
  stepsList.className = "steps-list";
  steps.forEach((step, idx) => {
    const stepRow = document.createElement("div");
    stepRow.className = "step-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!step.done;
    checkbox.addEventListener("change", () => {
      const updated = steps.map((s, i) => (i === idx ? { ...s, done: checkbox.checked } : s));
      updateDoc(doc(db, "projects", p.id), { extra_steps: updated });
    });
    stepRow.appendChild(checkbox);

    const stepText = document.createElement("span");
    stepText.className = `step-text${step.done ? " step-done" : ""}`;
    stepText.textContent = step.text;
    stepRow.appendChild(stepText);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "delete-x";
    removeBtn.title = "حذف الخطوة";
    removeBtn.innerHTML = icon("close");
    removeBtn.addEventListener("click", () => {
      const updated = steps.filter((_, i) => i !== idx);
      updateDoc(doc(db, "projects", p.id), { extra_steps: updated });
    });
    stepRow.appendChild(removeBtn);

    stepsList.appendChild(stepRow);
  });
  details.appendChild(stepsList);

  const addStepForm = document.createElement("form");
  addStepForm.className = "quick-add-row steps-add-row";

  const addStepInput = document.createElement("input");
  addStepInput.type = "text";
  addStepInput.maxLength = 200;
  addStepInput.placeholder = `${g("أضيفي", "أضف")} خطوة إضافية...`;
  addStepForm.appendChild(addStepInput);

  const addStepBtn = document.createElement("button");
  addStepBtn.type = "submit";
  addStepBtn.className = "btn btn-secondary btn-sm";
  addStepBtn.textContent = "إضافة";
  addStepForm.appendChild(addStepBtn);

  addStepForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = convertArabicDigits(addStepInput.value.trim());
    if (!text) return;
    updateDoc(doc(db, "projects", p.id), { extra_steps: [...steps, { text, done: false }] });
    addStepInput.value = "";
  });
  details.appendChild(addStepForm);

  return details;
}

async function togglePriority(p) {
  if (!p.is_priority) {
    const currentPriorities = projects.filter((x) => x.status === "نشط" && x.is_priority);
    if (currentPriorities.length >= MAX_PRIORITIES) {
      alert(
        `عندكم بالفعل ${MAX_PRIORITIES} أولويات: ${currentPriorities.map((x) => x.title).join("، ")}.\n` +
          `${g("شيلي", "شيل")} واحدة منهم أول (بالضغط على ⭐) قبل ما ${g("تضيفي", "تضيف")} أولوية جديدة.`
      );
      return;
    }
  }
  await updateDoc(doc(db, "projects", p.id), { is_priority: !p.is_priority });
}

async function markDone(id) {
  await updateDoc(doc(db, "projects", id), { status: "منجز", done_at: todayStr(), is_priority: false });
}

async function deleteProject(id) {
  if (!confirm(g("حذف نهائي لا يمكن التراجع عنه، متأكدة؟", "حذف نهائي لا يمكن التراجع عنه، متأكد؟"))) return;
  await deleteDoc(doc(db, "projects", id));
}

/* ---------- نافذة إضافة/تعديل مشروع ---------- */

const projectModal = document.getElementById("project-modal");
const projectForm = document.getElementById("project-form");
const fieldTitle = document.getElementById("field-project-title");
const fieldOwner = document.getElementById("field-project-owner");
const fieldNextAction = document.getElementById("field-project-next-action");
const fieldDueDate = document.getElementById("field-project-due-date");

function openProjectModal(project = null) {
  editingProjectId = project ? project.id : null;
  document.getElementById("project-modal-title").textContent = project ? "تعديل المشروع" : "مشروع جديد";
  fieldTitle.value = project ? project.title : "";
  fieldOwner.value = project ? project.owner : "";
  fieldNextAction.value = project ? project.next_action : "";
  fieldDueDate.value = project ? project.due_date || "" : "";
  projectModal.classList.remove("hidden");
}

document.getElementById("add-project-btn").addEventListener("click", () => openProjectModal());
document.getElementById("cancel-project-btn").addEventListener("click", () => projectModal.classList.add("hidden"));

projectForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    title: convertArabicDigits(fieldTitle.value.trim()),
    owner: fieldOwner.value,
    next_action: convertArabicDigits(fieldNextAction.value.trim()),
    due_date: fieldDueDate.value,
    last_edited_by: currentUser,
    last_edited_at: new Date().toISOString(),
  };
  if (!payload.title || !payload.owner || !payload.next_action || !payload.due_date) return;

  if (editingProjectId) {
    await updateDoc(doc(db, "projects", editingProjectId), payload);
  } else {
    const maxOrder = projects.reduce((max, p) => Math.max(max, p.sort_order || 0), -1);
    await addDoc(projectsCol, {
      ...payload,
      status: "نشط",
      is_priority: false,
      sort_order: maxOrder + 1,
      created_at: new Date().toISOString(),
      done_at: null,
      notes: "",
      extra_steps: [],
    });
  }
  projectModal.classList.add("hidden");
});

/* ---------- بانتظار قرار منذر ---------- */

function renderDecisions() {
  const list = document.getElementById("decisions-list");
  list.innerHTML = "";
  const sorted = [...decisions].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));

  if (sorted.length === 0) {
    list.innerHTML = `<div class="empty-state">لا يوجد شيء بانتظار قرار منذر حاليًا 🎉</div>`;
    return;
  }

  sorted.forEach((d) => {
    const row = document.createElement("div");
    row.className = "decision-row";

    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = d.title;
    row.appendChild(title);

    const resolveBtn = document.createElement("button");
    resolveBtn.type = "button";
    resolveBtn.className = "resolve-btn";
    resolveBtn.textContent = "✓ تم البت";
    resolveBtn.addEventListener("click", () => deleteDoc(doc(db, "decisions", d.id)));
    row.appendChild(resolveBtn);

    list.appendChild(row);
  });
}

document.getElementById("decision-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("decision-title-input");
  const title = convertArabicDigits(input.value.trim());
  if (!title) return;
  await addDoc(decisionsCol, { title, created_by: currentUser, created_at: new Date().toISOString() });
  input.value = "";
});

/* ---------- بنك الأفكار ---------- */

function renderIdeas() {
  const list = document.getElementById("ideas-list");
  list.innerHTML = "";
  const sorted = [...ideas].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));

  if (sorted.length === 0) {
    list.innerHTML = `<div class="empty-state">لا توجد أفكار مسجّلة بعد</div>`;
    return;
  }

  sorted.forEach((idea) => {
    const row = document.createElement("div");
    row.className = "idea-row";

    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = idea.title;
    row.appendChild(title);

    const select = document.createElement("select");
    select.className = "idea-stage-select";
    IDEA_STAGES.forEach((stage) => {
      const opt = document.createElement("option");
      opt.value = stage;
      opt.textContent = stage;
      if ((idea.stage || IDEA_STAGES[0]) === stage) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => updateDoc(doc(db, "ideas", idea.id), { stage: select.value }));
    row.appendChild(select);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "delete-x";
    delBtn.title = "حذف";
    delBtn.innerHTML = icon("close");
    delBtn.addEventListener("click", () => deleteDoc(doc(db, "ideas", idea.id)));
    row.appendChild(delBtn);

    list.appendChild(row);
  });
}

document.getElementById("idea-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("idea-title-input");
  const title = convertArabicDigits(input.value.trim());
  if (!title) return;
  await addDoc(ideasCol, { title, stage: IDEA_STAGES[0], created_by: currentUser, created_at: new Date().toISOString() });
  input.value = "";
});

/* ---------- الإنجازات ---------- */

function renderDone() {
  const list = document.getElementById("done-list");
  const stat = document.getElementById("done-stat");
  list.innerHTML = "";

  const done = projects.filter((p) => p.status === "منجز").sort((a, b) => (b.done_at || "").localeCompare(a.done_at || ""));

  const thisMonth = todayStr().slice(0, 7);
  const doneThisMonth = done.filter((p) => (p.done_at || "").slice(0, 7) === thisMonth).length;
  stat.textContent = doneThisMonth > 0 ? `— 🎉 ${doneThisMonth} أُنجزت هذا الشهر` : "";

  if (done.length === 0) {
    list.innerHTML = `<div class="empty-state">لسه ما فيه مشاريع منجزة</div>`;
    return;
  }

  done.forEach((p) => {
    const row = document.createElement("div");
    row.className = "done-row";

    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = p.title;
    row.appendChild(title);

    const ownerBadge = document.createElement("span");
    ownerBadge.className = `owner-badge owner-${p.owner}`;
    ownerBadge.textContent = p.owner;
    row.appendChild(ownerBadge);

    const date = document.createElement("span");
    date.textContent = formatDisplayDate(p.done_at);
    row.appendChild(date);

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "restore-btn";
    restoreBtn.innerHTML = `${icon("undo")}<span>استرجاع</span>`;
    restoreBtn.addEventListener("click", () => updateDoc(doc(db, "projects", p.id), { status: "نشط", done_at: null }));
    row.appendChild(restoreBtn);

    list.appendChild(row);
  });
}

document.getElementById("done-toggle").addEventListener("click", () => {
  const list = document.getElementById("done-list");
  const caret = document.getElementById("done-caret");
  const isHidden = list.classList.toggle("hidden");
  caret.innerHTML = icon(isHidden ? "caretDown" : "caretUp");
});
document.getElementById("done-caret").innerHTML = icon("caretDown");

/* ---------- بوابة كلمة السر المشتركة ---------- */

const authGateEl = document.getElementById("auth-gate");
const authForm = document.getElementById("auth-form");
const authPasswordInput = document.getElementById("auth-password");
const authErrorEl = document.getElementById("auth-error");
const authSubmitBtn = document.getElementById("auth-submit-btn");

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = authPasswordInput.value;
  if (!password) return;
  authSubmitBtn.disabled = true;
  authErrorEl.classList.add("hidden");
  try {
    await signInWithEmailAndPassword(auth, AUTH_EMAIL, password);
    authPasswordInput.value = "";
  } catch (err) {
    authErrorEl.classList.remove("hidden");
    authSubmitBtn.disabled = false;
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    authGateEl.classList.add("hidden");
    initUser();
  } else {
    authGateEl.classList.remove("hidden");
    authSubmitBtn.disabled = false;
  }
});
