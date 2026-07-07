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
const tagFilters = new Set(); // فلتر الوسوم: تحديد متعدد (فاضي = عرض الكل)
const STATUS_FILTER_KEY = "tawazon_hidden_statuses";
const hiddenStatuses = new Set(
  JSON.parse(localStorage.getItem(STATUS_FILTER_KEY) || "[]")
); // الحالات المخفية من القائمة (مكتملة/جارية/لم تبدأ)
const expandedIds = new Set();
const openDetailsIds = new Set();
const openAddIds = new Set(); // المهام التي فُتح تحتها مربع "إضافة سريعة"
let editingTaskId = null;
let addingParentId = null;
let currentTags = [];

const STATUS_ORDER = ["لم تبدأ", "جارية", "مكتملة"];
const STATUS_KEY = { "لم تبدأ": "todo", "جارية": "doing", "مكتملة": "done" };
const TAG_COLORS = ["#e57373", "#64b5f6", "#81c784", "#ffca28", "#ba68c8", "#4db6ac", "#f06292", "#a1887f", "#90a4ae"];

function tagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

/* ---------- الوضع الداكن/الفاتح ---------- */

const THEME_KEY = "tawazon_theme";

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const theme = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("theme-toggle-btn");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}

document.getElementById("theme-toggle-btn").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

initTheme();

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

/* ---------- صيغة المخاطب حسب الشخص (أسيل: مؤنث، منذر: مذكر) ---------- */

function isMale() {
  return currentUser === "منذر";
}

// g(نص مؤنث لأسيل, نص مذكر لمنذر)
function g(female, male) {
  return isMale() ? male : female;
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
  document.documentElement.removeAttribute("data-user");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("name-picker").classList.remove("hidden");
});

function startApp() {
  document.documentElement.setAttribute("data-user", currentUser);
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("current-user-label").textContent = `${g("أنتِ", "أنت")}: ${currentUser}`;
  const tagInputEl = document.getElementById("field-tag-input");
  if (tagInputEl) tagInputEl.placeholder = g("اكتبي وسمًا واضغطي Enter", "اكتب وسمًا واضغط Enter");
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
  if (tagFilters.size > 0 && !(task.tags || []).some((t) => tagFilters.has(t))) return false;
  if (hiddenStatuses.has(task.status)) return false;

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

/* ---------- الرسم ---------- */

function allKnownTags() {
  const allTags = new Set();
  tasks.forEach((t) => (t.tags || []).forEach((tag) => allTags.add(tag)));
  return [...allTags].sort();
}

function renderTagFilterOptions() {
  const btn = document.getElementById("tag-filter-btn");
  const panel = document.getElementById("tag-filter-panel");
  const tagsList = allKnownTags();

  // إزالة أي وسم فُلتر عليه سابقًا لكنه لم يعد موجودًا على أي مهمة
  [...tagFilters].forEach((t) => {
    if (!tagsList.includes(t)) tagFilters.delete(t);
  });

  btn.textContent =
    tagFilters.size === 0
      ? "كل الوسوم"
      : tagFilters.size === 1
      ? [...tagFilters][0]
      : `الوسوم (${tagFilters.size})`;
  btn.classList.toggle("active", tagFilters.size > 0);

  panel.innerHTML = "";

  if (tagsList.length === 0) {
    panel.innerHTML = `<div class="tag-filter-empty">لا توجد وسوم بعد</div>`;
    return;
  }

  const clearRow = document.createElement("button");
  clearRow.type = "button";
  clearRow.className = "tag-filter-clear";
  clearRow.textContent = "مسح التحديد";
  clearRow.addEventListener("click", () => {
    tagFilters.clear();
    render();
  });
  panel.appendChild(clearRow);

  tagsList.forEach((tag) => {
    const label = document.createElement("label");
    label.className = "tag-filter-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = tagFilters.has(tag);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) tagFilters.add(tag);
      else tagFilters.delete(tag);
      render();
    });
    const dot = document.createElement("span");
    dot.className = "tag-filter-dot";
    dot.style.background = tagColor(tag);
    const text = document.createElement("span");
    text.textContent = tag;
    label.appendChild(checkbox);
    label.appendChild(dot);
    label.appendChild(text);
    panel.appendChild(label);
  });
}

function saveHiddenStatuses() {
  localStorage.setItem(STATUS_FILTER_KEY, JSON.stringify([...hiddenStatuses]));
}

function renderStatusFilterOptions() {
  const btn = document.getElementById("status-filter-btn");
  const panel = document.getElementById("status-filter-panel");

  btn.textContent = hiddenStatuses.size === 0 ? "كل الحالات" : `مخفي (${hiddenStatuses.size})`;
  btn.classList.toggle("active", hiddenStatuses.size > 0);

  panel.innerHTML = "";

  const clearRow = document.createElement("button");
  clearRow.type = "button";
  clearRow.className = "tag-filter-clear";
  clearRow.textContent = "إظهار كل الحالات";
  clearRow.addEventListener("click", () => {
    hiddenStatuses.clear();
    saveHiddenStatuses();
    render();
  });
  panel.appendChild(clearRow);

  STATUS_ORDER.forEach((status) => {
    const label = document.createElement("label");
    label.className = "tag-filter-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = hiddenStatuses.has(status);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) hiddenStatuses.add(status);
      else hiddenStatuses.delete(status);
      saveHiddenStatuses();
      render();
    });
    const dot = document.createElement("span");
    dot.className = "tag-filter-dot";
    dot.style.background = `var(--color-${STATUS_KEY[status]})`;
    const text = document.createElement("span");
    text.textContent = `إخفاء «${status}»`;
    label.appendChild(checkbox);
    label.appendChild(dot);
    label.appendChild(text);
    panel.appendChild(label);
  });
}

document.getElementById("tag-filter-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("status-filter-panel").classList.add("hidden");
  document.getElementById("tag-filter-panel").classList.toggle("hidden");
});
document.getElementById("status-filter-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("tag-filter-panel").classList.add("hidden");
  document.getElementById("status-filter-panel").classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  const tagDropdown = document.getElementById("tag-filter-dropdown");
  if (!tagDropdown.contains(e.target)) {
    document.getElementById("tag-filter-panel").classList.add("hidden");
  }
  const statusDropdown = document.getElementById("status-filter-dropdown");
  if (!statusDropdown.contains(e.target)) {
    document.getElementById("status-filter-panel").classList.add("hidden");
  }
});

function renderUserBrief() {
  const brief = document.getElementById("user-brief");
  if (!brief || !currentUser) return;

  const today = todayStr();
  const mine = tasks.filter(
    (t) => (t.assignee === currentUser || t.assignee === "كلاهما") && t.status !== "مكتملة"
  );
  const overdueCount = mine.filter((t) => t.due_date && t.due_date < today).length;
  const todayCount = mine.filter((t) => t.due_date === today).length;

  brief.innerHTML = "";

  const greeting = document.createElement("span");
  greeting.className = "user-brief-greeting";
  greeting.textContent = `أهلًا ${currentUser} 👋`;
  brief.appendChild(greeting);

  const goToFilter = (filterName) => {
    const btn = document.querySelector(`.filter-btn[data-filter="${filterName}"]`);
    if (btn) btn.click();
  };

  if (overdueCount > 0) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "user-brief-chip overdue";
    chip.textContent = `${overdueCount} متأخرة عليك`;
    chip.addEventListener("click", () => goToFilter("overdue"));
    brief.appendChild(chip);
  }

  if (todayCount > 0) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "user-brief-chip today";
    chip.textContent = `${todayCount} مستحقة اليوم`;
    chip.addEventListener("click", () => goToFilter("today"));
    brief.appendChild(chip);
  }

  if (overdueCount === 0 && todayCount === 0) {
    const chip = document.createElement("span");
    chip.className = "user-brief-chip ok";
    chip.textContent = "لا شيء عاجل عليك 🎉";
    brief.appendChild(chip);
  }
}

function render() {
  renderTagFilterOptions();
  renderStatusFilterOptions();
  renderUserBrief();

  const list = document.getElementById("task-list");
  list.innerHTML = "";

  const topLevel = getChildren(null).filter(nodeMatchesOrHasMatchingDescendant);

  if (topLevel.length === 0) {
    list.innerHTML = `<div class="empty-state">لا توجد مهام بعد — ${g("اضغطي", "اضغط")} على زر "+" لإضافة أول مهمة</div>`;
    return;
  }

  topLevel.forEach((task) => list.appendChild(renderTaskCard(task, 0)));
}

function renderTaskCard(task, level) {
  const card = document.createElement("div");
  card.className = `task-card level-${level} assignee-${task.assignee}${task.status === "مكتملة" ? " completed" : ""}`;
  if (!matchesFilter(task)) card.style.opacity = "0.5";

  const children = getChildren(task.id);
  const isExpanded = expandedIds.has(task.id);
  const detailsOpen = openDetailsIds.has(task.id);
  const progress = computeProgress(task.id);

  const toggleDetails = () => {
    if (openDetailsIds.has(task.id)) openDetailsIds.delete(task.id);
    else openDetailsIds.add(task.id);
    render();
  };

  /* ---- الصف المختصر: كل ما تحتاجينه بلمحة واحدة فقط ---- */
  const row = document.createElement("div");
  row.className = "task-row";

  if (children.length > 0) {
    const toggle = document.createElement("button");
    toggle.className = "expand-toggle";
    toggle.title = isExpanded ? "طي المهام الفرعية" : "عرض المهام الفرعية";
    toggle.textContent = isExpanded ? "▼" : "◀";
    toggle.addEventListener("click", () => {
      if (isExpanded) expandedIds.delete(task.id);
      else expandedIds.add(task.id);
      render();
    });
    row.appendChild(toggle);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "expand-spacer";
    row.appendChild(spacer);
  }

  const statusBtn = document.createElement("button");
  statusBtn.type = "button";
  statusBtn.className = `status-toggle status-${STATUS_KEY[task.status] || "todo"}`;
  statusBtn.title = `الحالة: ${task.status} (${g("اضغطي", "اضغط")} للتغيير)`;
  statusBtn.addEventListener("click", () => {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(task.status) + 1) % STATUS_ORDER.length];
    updateTask(task.id, { status: next });
  });
  row.appendChild(statusBtn);

  const main = document.createElement("div");
  main.className = "task-main";
  main.addEventListener("click", toggleDetails);

  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = task.title;
  main.appendChild(title);

  const isOverdue = task.due_date && task.due_date < todayStr() && task.status !== "مكتملة";
  const hasMeta = task.due_date || progress || (task.tags && task.tags.length > 0);
  if (hasMeta) {
    const meta = document.createElement("div");
    meta.className = "task-meta";

    const assigneeSpan = document.createElement("span");
    assigneeSpan.className = "meta-assignee";
    assigneeSpan.textContent = task.assignee;
    meta.appendChild(assigneeSpan);

    if (task.due_date) {
      const dueSpan = document.createElement("span");
      dueSpan.className = isOverdue ? "due-overdue" : "";
      dueSpan.textContent = `استحقاق: ${formatDisplayDate(task.due_date)}`;
      meta.appendChild(dueSpan);
    }

    if (progress) {
      const progSpan = document.createElement("span");
      progSpan.className = "meta-progress";
      progSpan.textContent = `${progress.completed}/${progress.total} مكتملة`;
      meta.appendChild(progSpan);
    }

    main.appendChild(meta);
  }

  if (task.tags && task.tags.length > 0) {
    const tagsWrap = document.createElement("div");
    tagsWrap.className = "task-tags";
    task.tags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.style.background = tagColor(tag);
      chip.textContent = tag;
      tagsWrap.appendChild(chip);
    });
    main.appendChild(tagsWrap);
  }

  row.appendChild(main);

  if (level < MAX_LEVEL) {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = `add-child-toggle${openAddIds.has(task.id) ? " active" : ""}`;
    addBtn.title = "إضافة مهمة فرعية";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", () => {
      if (openAddIds.has(task.id)) {
        openAddIds.delete(task.id);
        if (children.length === 0) expandedIds.delete(task.id);
      } else {
        openAddIds.add(task.id);
        expandedIds.add(task.id);
      }
      render();
    });
    row.appendChild(addBtn);
  }

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = `more-toggle${detailsOpen ? " active" : ""}`;
  moreBtn.title = "تفاصيل وخيارات";
  moreBtn.textContent = "⋯";
  moreBtn.addEventListener("click", toggleDetails);
  row.appendChild(moreBtn);

  card.appendChild(row);

  /* ---- لوحة التفاصيل: تظهر فقط عند الحاجة (ملاحظات، ربط، إجراءات) ---- */
  if (detailsOpen) {
    const details = document.createElement("div");
    details.className = "task-details";

    const notesArea = document.createElement("textarea");
    notesArea.className = "task-notes-input";
    notesArea.placeholder = g("أضيفي ملاحظة هنا...", "أضف ملاحظة هنا...");
    notesArea.rows = 2;
    notesArea.value = task.notes || "";
    attachDigitSanitizer(notesArea);
    notesArea.addEventListener("change", () => {
      const val = notesArea.value.trim();
      if (val !== (task.notes || "")) updateTask(task.id, { notes: val || null });
    });
    details.appendChild(notesArea);

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
      details.appendChild(linkedWrap);
    }

    if (task.last_edited_by) {
      const lastEdited = document.createElement("div");
      lastEdited.className = "last-edited";
      lastEdited.textContent = `آخر تحديث: ${task.last_edited_by}${task.last_edited_at ? " · " + formatDisplayDate(task.last_edited_at.slice(0, 10)) : ""}`;
      details.appendChild(lastEdited);
    }

    const actionsRow = document.createElement("div");
    actionsRow.className = "details-actions";

    const sortWrap = document.createElement("div");
    sortWrap.className = "sort-buttons";
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.textContent = "▲";
    upBtn.title = "تحريك للأعلى";
    upBtn.addEventListener("click", () => moveTask(task, -1));
    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.textContent = "▼";
    downBtn.title = "تحريك للأسفل";
    downBtn.addEventListener("click", () => moveTask(task, 1));
    sortWrap.appendChild(upBtn);
    sortWrap.appendChild(downBtn);
    actionsRow.appendChild(sortWrap);

    if (level < MAX_LEVEL) {
      const addSubBtn = document.createElement("button");
      addSubBtn.type = "button";
      addSubBtn.className = "btn-icon";
      addSubBtn.title = "إضافة مهمة فرعية";
      addSubBtn.textContent = "➕";
      addSubBtn.addEventListener("click", () => openTaskModal({ parentId: task.id }));
      actionsRow.appendChild(addSubBtn);
    }

    const linkBtn = document.createElement("button");
    linkBtn.type = "button";
    linkBtn.className = "btn-icon";
    linkBtn.title = "ربط مهمة";
    linkBtn.textContent = "🔗";
    linkBtn.addEventListener("click", () => toggleLinkPicker(task.id, details));
    actionsRow.appendChild(linkBtn);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-icon";
    editBtn.title = "تعديل";
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", () => openTaskModal({ task }));
    actionsRow.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-icon";
    deleteBtn.title = "حذف";
    deleteBtn.textContent = "🗑️";
    deleteBtn.addEventListener("click", () => deleteTask(task.id));
    actionsRow.appendChild(deleteBtn);

    details.appendChild(actionsRow);
    card.appendChild(details);
  }

  const showAddBox = level < MAX_LEVEL && openAddIds.has(task.id);
  if (isExpanded && (children.length > 0 || showAddBox)) {
    const childrenWrap = document.createElement("div");
    childrenWrap.className = "children-wrap";
    children
      .filter(nodeMatchesOrHasMatchingDescendant)
      .forEach((child) => childrenWrap.appendChild(renderTaskCard(child, level + 1)));

    if (showAddBox) {
      const addForm = document.createElement("form");
      addForm.className = "quick-add-form";
      const addInput = document.createElement("input");
      addInput.type = "text";
      addInput.maxLength = 200;
      addInput.placeholder =
        level === 0
          ? g("أضيفي مهمة فرعية...", "أضف مهمة فرعية...")
          : g("أضيفي مهمة فرعية للفرعية...", "أضف مهمة فرعية للفرعية...");
      attachDigitSanitizer(addInput);
      addForm.appendChild(addInput);
      addForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const value = convertArabicDigits(addInput.value.trim());
        if (!value) return;
        addInput.disabled = true;
        await quickAddSubtask(task.id, value);
        addInput.value = "";
        addInput.disabled = false;
        addInput.focus();
      });
      childrenWrap.appendChild(addForm);
    }

    card.appendChild(childrenWrap);
  }

  return card;
}

function toggleLinkPicker(taskId, container) {
  const existing = container.querySelector(".link-picker-inline");
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
  container.appendChild(wrap);
}

/* ---------- عمليات قاعدة البيانات ---------- */

async function quickAddSubtask(parentId, title) {
  const siblings = getChildren(parentId);
  const maxOrder = siblings.reduce((max, t) => Math.max(max, t.sort_order), -1);
  await addDoc(tasksCol, {
    title,
    assignee: currentUser,
    due_date: null,
    status: "لم تبدأ",
    notes: null,
    tags: [],
    parent_id: parentId,
    sort_order: maxOrder + 1,
    last_edited_by: currentUser,
    last_edited_at: new Date().toISOString(),
  });
}

async function updateTask(id, fields) {
  const payload = {
    ...fields,
    last_edited_by: currentUser,
    last_edited_at: new Date().toISOString(),
  };
  await updateDoc(doc(db, "tasks", id), payload);
}

async function deleteTask(id) {
  if (!confirm(g("هل تريدين حذف هذه المهمة وكل ما يتبعها؟", "هل تريد حذف هذه المهمة وكل ما يتبعها؟"))) return;

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
const fieldTagInput = document.getElementById("field-tag-input");
const fieldTagsList = document.getElementById("field-tags-list");
const tagSuggestionsBox = document.getElementById("tag-suggestions");

attachDigitSanitizer(fieldTitle);
attachDigitSanitizer(fieldNotes);
attachDigitSanitizer(fieldTagInput);

function renderTagChips() {
  fieldTagsList.innerHTML = "";
  currentTags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip tag-chip-removable";
    chip.style.background = tagColor(tag);
    chip.innerHTML = `<span>${tag}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      currentTags = currentTags.filter((t) => t !== tag);
      renderTagChips();
    });
    chip.appendChild(removeBtn);
    fieldTagsList.appendChild(chip);
  });
}

function addTagFromInput(value) {
  const clean = convertArabicDigits(value.trim());
  if (clean && !currentTags.includes(clean)) {
    currentTags.push(clean);
    renderTagChips();
  }
  fieldTagInput.value = "";
  hideTagSuggestions();
}

function hideTagSuggestions() {
  tagSuggestionsBox.classList.add("hidden");
  tagSuggestionsBox.innerHTML = "";
}

function renderTagSuggestions() {
  const query = convertArabicDigits(fieldTagInput.value.trim());
  const matches = allKnownTags().filter(
    (tag) => !currentTags.includes(tag) && (query === "" || tag.includes(query))
  );

  if (matches.length === 0) {
    hideTagSuggestions();
    return;
  }

  tagSuggestionsBox.innerHTML = "";
  matches.slice(0, 8).forEach((tag) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tag-suggestion-item";
    const dot = document.createElement("span");
    dot.className = "tag-filter-dot";
    dot.style.background = tagColor(tag);
    const text = document.createElement("span");
    text.textContent = tag;
    item.appendChild(dot);
    item.appendChild(text);
    item.addEventListener("mousedown", (e) => {
      e.preventDefault(); // يمنع إغلاق القائمة قبل تسجيل الاختيار
      addTagFromInput(tag);
      fieldTagInput.focus();
    });
    tagSuggestionsBox.appendChild(item);
  });
  tagSuggestionsBox.classList.remove("hidden");
}

fieldTagInput.addEventListener("focus", renderTagSuggestions);
fieldTagInput.addEventListener("input", renderTagSuggestions);
fieldTagInput.addEventListener("blur", () => setTimeout(hideTagSuggestions, 150));

fieldTagInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideTagSuggestions();
    return;
  }
  if (e.key !== "Enter") return;
  e.preventDefault();
  addTagFromInput(fieldTagInput.value);
});

function openTaskModal({ task = null, parentId = null }) {
  editingTaskId = task ? task.id : null;
  addingParentId = parentId;

  document.getElementById("modal-title").textContent = task ? "تعديل المهمة" : "مهمة جديدة";
  fieldTitle.value = task ? task.title : "";
  fieldAssignee.value = task ? task.assignee : currentUser;
  fieldDueDate.value = task ? task.due_date || "" : "";
  fieldStatus.value = task ? task.status : "لم تبدأ";
  fieldNotes.value = task ? task.notes || "" : "";

  currentTags = task && task.tags ? [...task.tags] : [];
  fieldTagInput.value = "";
  renderTagChips();

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
    tags: [...currentTags],
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
