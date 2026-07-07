/* توازن — منطق التطبيق */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

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
const tasksCol = collection(db, "tasks");
const linksCol = collection(db, "task_links");

const STORAGE_KEY = "tawazon_user";
const MAX_LEVEL = 2; // مستويات: 0 رئيسية، 1 فرعية، 2 فرعية الفرعية

let tasks = [];        // كل المهام (مسطّحة)
let tasksById = {};     // فهرسة سريعة
let links = [];         // كل task_links
let currentUser = null;
let dateFilter = "all";
let assigneeFilter = "all";
const expandedIds = new Set();
let editingTaskId = null;
let addingParentId = null;

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

function attachDigitSanitizer(inputEl) {
  inputEl.addEventListener("input", () => {
    const converted = convertArabicDigits(inputEl.value);
    if (converted !== inputEl.value) {
      const pos = inputEl.selectionStart;
      inputEl.value = converted;
      inputEl.setSelectionRange(pos, pos);
    }
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

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return formatISO(d);
}

/* ---------- تحميل المستخدم ---------- */

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
  document.getElementById("app").classList.add("hidden");
  document.getElementById("name-picker").classList.remove("hidden");
});

function startApp() {
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("current-user-label").textContent = `أنت: ${currentUser}`;
  subscribeRealtime();
}

/* ---------- المزامنة اللحظية ---------- */

function subscribeRealtime() {
  onSnapshot(tasksCol, (snapshot) => {
    tasks = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    tasksById = {};
    tasks.forEach((t) => (tasksById[t.id] = t));
    render();
  });

  onSnapshot(linksCol, (snapshot) => {
    links = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}

/* ---------- بناء الشجرة ---------- */

function getChildren(parentId) {
  return tasks
    .filter((t) => t.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

function getDescendants(taskId) {
  const result = [];
  const stack = [...getChildren(taskId)];
  while (stack.length) {
    const t = stack.pop();
    result.push(t);
    stack.push(...getChildren(t.id));
  }
  return result;
}

function computeProgress(taskId) {
  const descendants = getDescendants(taskId);
  if (descendants.length === 0) return null;
  const completed = descendants.filter((t) => t.status === "مكتملة").length;
  return { completed, total: descendants.length };
}

/* ---------- الفلترة ---------- */

function matchesFilter(task) {
  if (assigneeFilter !== "all" && task.assignee !== assigneeFilter) return false;

  if (dateFilter === "all") return true;
  if (!task.due_date) return false;

  const today = todayStr();
  if (dateFilter === "today") return task.due_date === today;
  if (dateFilter === "week") return task.due_date >= today && task.due_date <= addDays(today, 6);
  if (dateFilter === "overdue") return task.due_date < today && task.status !== "مكتملة";
  return true;
}

function nodeMatchesOrHasMatchingDescendant(task) {
  if (matchesFilter(task)) return true;
  return getChildren(task.id).some((child) => nodeMatchesOrHasMatchingDescendant(child));
}

/* ---------- الاستمرارية ---------- */

function computeStreak() {
  const completedDates = new Set(
    tasks
      .filter((t) => t.status === "مكتملة" && t.last_edited_at)
      .map((t) => t.last_edited_at.slice(0, 10))
  );

  let streak = 0;
  let cursor = todayStr();
  if (!completedDates.has(cursor)) {
    cursor = addDays(cursor, -1);
  }
  while (completedDates.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/* ---------- الرسم ---------- */

function render() {
  document.getElementById("streak-count").textContent = computeStreak();

  const list = document.getElementById("task-list");
  list.innerHTML = "";

  const topLevel = getChildren(null).filter(nodeMatchesOrHasMatchingDescendant);

  if (topLevel.length === 0) {
    list.innerHTML = `<div class="empty-state">لا توجد مهام بعد — اضغطي على زر "+" لإضافة أول مهمة</div>`;
    return;
  }

  topLevel.forEach((task) => list.appendChild(renderTaskCard(task, 0)));
}

function renderTaskCard(task, level) {
  const card = document.createElement("div");
  card.className = `task-card assignee-${task.assignee}${task.status === "مكتملة" ? " completed" : ""}`;
  if (!matchesFilter(task)) card.style.opacity = "0.5";

  const children = getChildren(task.id);
  const isExpanded = expandedIds.has(task.id);
  const progress = computeProgress(task.id);

  const row = document.createElement("div");
  row.className = "task-row";

  if (children.length > 0) {
    const toggle = document.createElement("button");
    toggle.className = "expand-toggle";
    toggle.textContent = isExpanded ? "▼" : "◀";
    toggle.addEventListener("click", () => {
      if (isExpanded) expandedIds.delete(task.id);
      else expandedIds.add(task.id);
      render();
    });
    row.appendChild(toggle);
  } else {
    const spacer = document.createElement("span");
    spacer.style.width = "22px";
    spacer.style.display = "inline-block";
    row.appendChild(spacer);
  }

  const statusSelect = document.createElement("select");
  statusSelect.className = "task-status-select";
  ["لم تبدأ", "جارية", "مكتملة"].forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    if (s === task.status) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  statusSelect.addEventListener("change", () => updateTask(task.id, { status: statusSelect.value }));
  row.appendChild(statusSelect);

  const main = document.createElement("div");
  main.className = "task-main";
  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = task.title;
  main.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "task-meta";
  const isOverdue = task.due_date && task.due_date < todayStr() && task.status !== "مكتملة";
  meta.innerHTML = `
    <span>${task.assignee}</span>
    ${task.due_date ? `<span class="${isOverdue ? "due-overdue" : ""}">استحقاق: ${formatDisplayDate(task.due_date)}</span>` : ""}
  `;
  main.appendChild(meta);

  if (progress) {
    const pct = Math.round((progress.completed / progress.total) * 100);
    const bar = document.createElement("div");
    bar.className = "progress-bar-outer";
    bar.innerHTML = `<div class="progress-bar-inner" style="width:${pct}%"></div>`;
    main.appendChild(bar);
  }

  if (task.notes) {
    const notes = document.createElement("div");
    notes.className = "task-notes";
    notes.textContent = task.notes;
    main.appendChild(notes);
  }

  const linked = links.filter((l) => l.source_task_id === task.id);
  if (linked.length > 0) {
    const linkedWrap = document.createElement("div");
    linkedWrap.className = "linked-tasks";
    linkedWrap.innerHTML = `<div class="linked-tasks-title">مهام مرتبطة:</div>`;
    linked.forEach((l) => {
      const target = tasksById[l.target_task_id];
      if (!target) return;
      const chip = document.createElement("span");
      chip.className = "linked-task-chip";
      chip.innerHTML = `<span>${target.title}</span>`;
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => removeLink(l.id));
      chip.appendChild(removeBtn);
      linkedWrap.appendChild(chip);
    });
    main.appendChild(linkedWrap);
  }

  const lastEdited = document.createElement("div");
  lastEdited.className = "last-edited";
  if (task.last_edited_by) {
    lastEdited.textContent = `آخر تحديث: ${task.last_edited_by}${task.last_edited_at ? " · " + formatDisplayDate(task.last_edited_at.slice(0, 10)) : ""}`;
  }
  main.appendChild(lastEdited);

  row.appendChild(main);

  const sortWrap = document.createElement("div");
  sortWrap.className = "sort-buttons";
  const upBtn = document.createElement("button");
  upBtn.textContent = "▲";
  upBtn.title = "تحريك للأعلى";
  upBtn.addEventListener("click", () => moveTask(task, -1));
  const downBtn = document.createElement("button");
  downBtn.textContent = "▼";
  downBtn.title = "تحريك للأسفل";
  downBtn.addEventListener("click", () => moveTask(task, 1));
  sortWrap.appendChild(upBtn);
  sortWrap.appendChild(downBtn);
  row.appendChild(sortWrap);

  const actions = document.createElement("div");
  actions.className = "task-actions";

  if (level < MAX_LEVEL) {
    const addSubBtn = document.createElement("button");
    addSubBtn.className = "btn-icon";
    addSubBtn.title = "إضافة مهمة فرعية";
    addSubBtn.textContent = "➕";
    addSubBtn.addEventListener("click", () => openTaskModal({ parentId: task.id }));
    actions.appendChild(addSubBtn);
  }

  const linkBtn = document.createElement("button");
  linkBtn.className = "btn-icon";
  linkBtn.title = "ربط مهمة";
  linkBtn.textContent = "🔗";
  linkBtn.addEventListener("click", () => toggleLinkPicker(task.id, card));
  actions.appendChild(linkBtn);

  const editBtn = document.createElement("button");
  editBtn.className = "btn-icon";
  editBtn.title = "تعديل";
  editBtn.textContent = "✏️";
  editBtn.addEventListener("click", () => openTaskModal({ task }));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn-icon";
  deleteBtn.title = "حذف";
  deleteBtn.textContent = "🗑️";
  deleteBtn.addEventListener("click", () => deleteTask(task.id));
  actions.appendChild(deleteBtn);

  row.appendChild(actions);
  card.appendChild(row);

  if (children.length > 0 && isExpanded) {
    const childrenWrap = document.createElement("div");
    childrenWrap.className = "children-wrap";
    children
      .filter(nodeMatchesOrHasMatchingDescendant)
      .forEach((child) => childrenWrap.appendChild(renderTaskCard(child, level + 1)));
    card.appendChild(childrenWrap);
  }

  return card;
}

function toggleLinkPicker(taskId, card) {
  const existing = card.querySelector(".link-picker-inline");
  if (existing) {
    existing.remove();
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "link-picker-inline";
  wrap.style.marginTop = "8px";
  wrap.style.display = "flex";
  wrap.style.gap = "6px";

  const select = document.createElement("select");
  select.className = "assignee-select";
  select.style.flex = "1";
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "— اختر مهمة —";
  select.appendChild(emptyOpt);
  tasks
    .filter((t) => t.id !== taskId)
    .forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.title;
      select.appendChild(opt);
    });

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-primary";
  confirmBtn.textContent = "ربط";
  confirmBtn.type = "button";
  confirmBtn.addEventListener("click", async () => {
    if (!select.value) return;
    await addLink(taskId, select.value);
    wrap.remove();
  });

  wrap.appendChild(select);
  wrap.appendChild(confirmBtn);
  card.querySelector(".task-main").appendChild(wrap);
}

/* ---------- عمليات قاعدة البيانات ---------- */

async function updateTask(id, fields) {
  const payload = {
    ...fields,
    last_edited_by: currentUser,
    last_edited_at: new Date().toISOString(),
  };
  await updateDoc(doc(db, "tasks", id), payload);
}

async function deleteTask(id) {
  if (!confirm("هل تريدين حذف هذه المهمة وكل ما يتبعها؟")) return;

  const idsToDelete = [id, ...getDescendants(id).map((t) => t.id)];
  const idSet = new Set(idsToDelete);
  const linksToDelete = links.filter(
    (l) => idSet.has(l.source_task_id) || idSet.has(l.target_task_id)
  );

  const batch = writeBatch(db);
  idsToDelete.forEach((taskId) => batch.delete(doc(db, "tasks", taskId)));
  linksToDelete.forEach((l) => batch.delete(doc(db, "task_links", l.id)));
  await batch.commit();
}

async function moveTask(task, direction) {
  const siblings = getChildren(task.parent_id);
  const idx = siblings.findIndex((t) => t.id === task.id);
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;
  const other = siblings[swapIdx];

  const batch = writeBatch(db);
  batch.update(doc(db, "tasks", task.id), { sort_order: other.sort_order });
  batch.update(doc(db, "tasks", other.id), { sort_order: task.sort_order });
  await batch.commit();
}

async function addLink(sourceId, targetId) {
  if (sourceId === targetId) return;
  const exists = links.some((l) => l.source_task_id === sourceId && l.target_task_id === targetId);
  if (exists) return;
  await addDoc(linksCol, { source_task_id: sourceId, target_task_id: targetId });
}

async function removeLink(linkId) {
  await deleteDoc(doc(db, "task_links", linkId));
}

/* ---------- نافذة إضافة/تعديل ---------- */

const modal = document.getElementById("task-modal");
const form = document.getElementById("task-form");
const fieldTitle = document.getElementById("field-title");
const fieldAssignee = document.getElementById("field-assignee");
const fieldDueDate = document.getElementById("field-due-date");
const fieldStatus = document.getElementById("field-status");
const fieldNotes = document.getElementById("field-notes");
const fieldLinkSelect = document.getElementById("field-link-select");

attachDigitSanitizer(fieldTitle);
attachDigitSanitizer(fieldNotes);

function openTaskModal({ task = null, parentId = null }) {
  editingTaskId = task ? task.id : null;
  addingParentId = parentId;

  document.getElementById("modal-title").textContent = task ? "تعديل المهمة" : "مهمة جديدة";
  fieldTitle.value = task ? task.title : "";
  fieldAssignee.value = task ? task.assignee : currentUser;
  fieldDueDate.value = task ? task.due_date || "" : "";
  fieldStatus.value = task ? task.status : "لم تبدأ";
  fieldNotes.value = task ? task.notes || "" : "";

  fieldLinkSelect.innerHTML = `<option value="">— اختر مهمة —</option>`;
  tasks
    .filter((t) => !task || t.id !== task.id)
    .forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.title;
      fieldLinkSelect.appendChild(opt);
    });

  modal.classList.remove("hidden");
}

document.getElementById("add-main-task-btn").addEventListener("click", () => openTaskModal({}));
document.getElementById("cancel-task-btn").addEventListener("click", () => modal.classList.add("hidden"));

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    title: fieldTitle.value.trim(),
    assignee: fieldAssignee.value,
    due_date: fieldDueDate.value || null,
    status: fieldStatus.value,
    notes: fieldNotes.value.trim() || null,
    last_edited_by: currentUser,
    last_edited_at: new Date().toISOString(),
  };

  if (!payload.title) return;

  let savedId = editingTaskId;

  if (editingTaskId) {
    await updateDoc(doc(db, "tasks", editingTaskId), payload);
  } else {
    const siblings = getChildren(addingParentId);
    const maxOrder = siblings.reduce((max, t) => Math.max(max, t.sort_order), -1);
    payload.parent_id = addingParentId;
    payload.sort_order = maxOrder + 1;
    const docRef = await addDoc(tasksCol, payload);
    savedId = docRef.id;
  }

  if (savedId && fieldLinkSelect.value) {
    await addLink(savedId, fieldLinkSelect.value);
  }

  modal.classList.add("hidden");
});

/* ---------- الفلاتر ---------- */

document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    dateFilter = btn.dataset.filter;
    render();
  });
});

document.getElementById("assignee-filter").addEventListener("change", (e) => {
  assigneeFilter = e.target.value;
  render();
});

/* ---------- بدء التشغيل ---------- */

initUser();
