import { seedItems } from "./data.js";

// ==========================================================================
// Constants
// ==========================================================================

const STORAGE_KEY = "juliana-wishlist-v1";
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10; // px of finger movement allowed before cancelling

const CATEGORIES = [
  { name: "Tech", emoji: "📱" },
  { name: "Travel", emoji: "🧳" },
  { name: "Bags", emoji: "👜" },
  { name: "Shoes", emoji: "👟" },
  { name: "Beauty", emoji: "💄" },
  { name: "Accessories", emoji: "🕶️" },
  { name: "Clothing", emoji: "🧥" },
  { name: "Home", emoji: "🏠" },
];
const EMOJI = Object.fromEntries(CATEGORIES.map((c) => [c.name, c.emoji]));

const STATUSES = ["wishlist", "considering", "ordered", "wrapped"];
const STATUS_LABELS = {
  wishlist: "Wishlist",
  considering: "Considering",
  ordered: "Ordered",
  wrapped: "Wrapped",
};
const PURCHASED = new Set(["ordered", "wrapped"]);

// Each comparator returns 0 for ties; ties fall back to the original list order.
const SORTS = {
  default: () => 0,
  "price-asc": (a, b) => a.price - b.price,
  "price-desc": (a, b) => b.price - a.price,
  category: (a, b) => a.category.localeCompare(b.category),
  status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status),
};

// ==========================================================================
// Formatting helpers
// ==========================================================================

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const withCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Dashboard and list prices: whole dollars. */
const formatMoney = (n) => wholeDollars.format(n);
/** Paid/saved amounts: show cents only when there are some. */
const formatExact = (n) => (Number.isInteger(n) ? wholeDollars : withCents).format(n);
const formatPaidInput = (paid) =>
  paid == null ? "" : Number.isInteger(paid) ? String(paid) : paid.toFixed(2);
const roundCents = (n) => Math.round(n * 100) / 100;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);

// Only allow http(s) links into href attributes.
const safeUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
};

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const clone = (value) =>
  typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));

// ==========================================================================
// Storage (localStorage with in-memory fallback)
// ==========================================================================

function createStore(key) {
  let memory = null;
  let available = true;

  try {
    const probe = `${key}:probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
  } catch {
    available = false;
  }

  return {
    get available() {
      return available;
    },
    read() {
      if (available) {
        try {
          return localStorage.getItem(key);
        } catch {
          available = false;
        }
      }
      return memory;
    },
    /** Returns true if the value was persisted to localStorage. */
    write(value) {
      memory = value;
      if (!available) return false;
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        available = false; // quota exceeded or storage revoked: stay in memory
        return false;
      }
    },
  };
}

const store = createStore(STORAGE_KEY);

const isMoney = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

function isValidItem(item) {
  return (
    item !== null &&
    typeof item === "object" &&
    typeof item.id === "string" && item.id !== "" &&
    typeof item.name === "string" &&
    typeof item.category === "string" &&
    isMoney(item.price) &&
    typeof item.link === "string" &&
    typeof item.notes === "string" &&
    STATUSES.includes(item.status) &&
    (item.paid === null || isMoney(item.paid)) &&
    (item.image === null || typeof item.image === "string")
  );
}

function isValidItems(value) {
  return (
    Array.isArray(value) &&
    value.every(isValidItem) &&
    new Set(value.map((item) => item.id)).size === value.length
  );
}

function loadItems() {
  const raw = store.read();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isValidItems(parsed)) return parsed;
    } catch {
      /* fall through to seed data */
    }
  }
  return clone(seedItems);
}

// ==========================================================================
// State
// ==========================================================================

const state = {
  items: loadItems(),
  filter: "All", // category name or "All"
  status: "All", // status key or "All"
  sort: "default",
};

function save() {
  if (!store.write(JSON.stringify(state.items))) showStorageBanner();
}

const findItem = (id) => state.items.find((item) => item.id === id);
const isPurchased = (item) => PURCHASED.has(item.status);
const matchesCategory = (item, filter = state.filter) => filter === "All" || item.category === filter;
const matchesStatus = (item, status = state.status) => status === "All" || item.status === status;

function computeStats(items) {
  const purchased = items.filter(isPurchased);
  const total = items.reduce((sum, item) => sum + item.price, 0);
  const spent = purchased.reduce((sum, item) => sum + (item.paid ?? item.price), 0);
  const wrapped = items.filter((item) => item.status === "wrapped").length;
  return {
    total,
    spent,
    remaining: total - spent,
    bought: purchased.length,
    wrapped,
    count: items.length,
  };
}

function getVisibleItems() {
  const order = new Map(state.items.map((item, i) => [item.id, i]));
  const compare = SORTS[state.sort] ?? SORTS.default;
  return state.items
    .filter((item) => matchesCategory(item) && matchesStatus(item))
    .sort((a, b) => compare(a, b) || order.get(a.id) - order.get(b.id));
}

// ==========================================================================
// Mutations (each one saves and re-renders)
// ==========================================================================

function setStatus(id, status) {
  const item = findItem(id);
  if (!item || !STATUSES.includes(status) || item.status === status) return;
  item.status = status;
  save();
  render();
  announce(`${item.name} is now ${STATUS_LABELS[status]}.`);
}

function cycleStatus(id) {
  const item = findItem(id);
  if (!item) return;
  setStatus(id, STATUSES[(STATUSES.indexOf(item.status) + 1) % STATUSES.length]);
}

function commitPaid(input) {
  const id = input.closest(".card")?.dataset.id;
  const item = findItem(id);
  if (!item) return;

  const raw = input.value.trim().replace(/[$,\s]/g, "");
  let next;
  if (raw === "") {
    next = null;
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      input.value = formatPaidInput(item.paid); // invalid: revert
      return;
    }
    next = roundCents(n);
  }

  input.value = formatPaidInput(next);
  if (next === item.paid) return;
  item.paid = next;
  save();
  render();
  announce(next == null ? `Cleared paid price for ${item.name}.` : `Paid ${formatExact(next)} for ${item.name}.`);
}

function resetItems() {
  state.items = clone(seedItems);
  state.filter = "All";
  state.status = "All";
  state.sort = "default";
  save();
  render();
  announce("Reset to the original list.");
}

// ==========================================================================
// DOM references
// ==========================================================================

const $ = (selector) => document.querySelector(selector);
const els = {
  subtitle: $("#subtitle"),
  stats: $("#stats"),
  categoryFilters: $("#category-filters"),
  statusFilters: $("#status-filters"),
  resultCount: $("#result-count"),
  sort: $("#sort"),
  grid: $("#grid"),
  settingsBtn: $("#settings-btn"),
  resetDialog: $("#reset-dialog"),
  banner: $("#storage-banner"),
  bannerClose: $("#banner-close"),
  announcer: $("#announcer"),
};

// ==========================================================================
// Render
// ==========================================================================

function render() {
  renderHeader();
  renderStats();
  renderFilters();
  renderGrid();
}

function renderHeader() {
  els.subtitle.textContent = `${plural(state.items.length, "gift", "gifts")} · curated from her Pinterest board`;
}

// ---- Dashboard ----

function buildStats() {
  els.stats.innerHTML = `
    <div class="stat">
      <p class="stat__label">Total budget</p>
      <p class="stat__value" data-stat="total"></p>
      <p class="stat__caption">Estimated, all gifts</p>
    </div>
    <div class="stat">
      <p class="stat__label">Spent</p>
      <p class="stat__value" data-stat="spent"></p>
      <p class="stat__caption" data-stat="bought"></p>
    </div>
    <div class="stat">
      <p class="stat__label">Remaining</p>
      <p class="stat__value" data-stat="remaining"></p>
      <p class="stat__caption">Still to buy</p>
    </div>
    <div class="stat">
      <p class="stat__label">Wrapped</p>
      <p class="stat__value"><span data-stat="wrapped"></span><span class="stat__of" data-stat="of"></span></p>
      <div class="progress" role="progressbar" aria-label="Gifts wrapped" aria-valuemin="0">
        <span class="progress__fill"></span>
      </div>
      <p class="stat__caption" data-stat="pct"></p>
    </div>`;
}

function renderStats() {
  const s = computeStats(state.items);
  const pct = s.count ? Math.round((s.wrapped / s.count) * 100) : 0;
  const set = (key, text) => setText(els.stats.querySelector(`[data-stat="${key}"]`), text);

  set("total", formatMoney(s.total));
  set("spent", formatMoney(s.spent));
  set("bought", `${s.bought} of ${s.count} bought`);
  set("remaining", formatMoney(s.remaining));
  set("wrapped", String(s.wrapped));
  set("of", ` / ${s.count}`);
  set("pct", `${pct}% ready to give`);

  const bar = els.stats.querySelector(".progress");
  bar.setAttribute("aria-valuemax", String(s.count));
  bar.setAttribute("aria-valuenow", String(s.wrapped));
  bar.firstElementChild.style.width = `${pct}%`;
}

// ---- Filters ----

function buildFilters() {
  els.categoryFilters.innerHTML = [{ name: "All", emoji: "" }, ...CATEGORIES]
    .map(
      (c) => `
      <button type="button" class="chip" data-filter="${c.name}" aria-pressed="false">
        ${c.emoji ? `<span class="chip__emoji" aria-hidden="true">${c.emoji}</span>` : ""}
        <span>${c.name}</span>
        <span class="chip__count"></span>
      </button>`
    )
    .join("");

  els.statusFilters.innerHTML = ["All", ...STATUSES]
    .map(
      (s) => `
      <button type="button" class="chip chip--status" data-status="${s}" aria-pressed="false">
        ${s === "All" ? "" : `<span class="chip__dot chip__dot--${s}" aria-hidden="true"></span>`}
        <span>${s === "All" ? "All statuses" : STATUS_LABELS[s]}</span>
        <span class="chip__count"></span>
      </button>`
    )
    .join("");
}

function updateChip(chip, active, count) {
  chip.classList.toggle("is-active", active);
  chip.classList.toggle("is-zero", count === 0);
  setAttr(chip, "aria-pressed", String(active));
  setText(chip.querySelector(".chip__count"), String(count));
}

function renderFilters() {
  // Counts are faceted: each row's counts respect the *other* row's filter.
  for (const chip of els.categoryFilters.children) {
    const filter = chip.dataset.filter;
    const count = state.items.filter((i) => matchesCategory(i, filter) && matchesStatus(i)).length;
    updateChip(chip, state.filter === filter, count);
  }
  for (const chip of els.statusFilters.children) {
    const status = chip.dataset.status;
    const count = state.items.filter((i) => matchesStatus(i, status) && matchesCategory(i)).length;
    updateChip(chip, state.status === status, count);
  }
  els.sort.value = state.sort;
}

// Scroll a chip fully into its horizontal row (mobile) without moving the page.
function revealChip(chip) {
  const row = chip.parentElement;
  if (row.scrollWidth <= row.clientWidth) return;
  const pad = 24;
  const left = chip.offsetLeft - pad;
  const right = chip.offsetLeft + chip.offsetWidth + pad - row.clientWidth;
  if (row.scrollLeft > left) row.scrollTo({ left, behavior: "smooth" });
  else if (row.scrollLeft < right) row.scrollTo({ left: right, behavior: "smooth" });
}

// ---- Grid ----
// Card elements are created once per item id and updated in place, so focus,
// in-progress taps and CSS transitions survive re-renders.

const cardEls = new Map();
let emptyEl = null;

function createCard(item) {
  const el = document.createElement("article");
  el.className = "card";
  el.dataset.id = item.id;
  el.innerHTML = `
    <div class="card__media"><span class="card__emoji" aria-hidden="true"></span></div>
    <div class="card__body">
      <div class="card__meta">
        <span class="card__category"></span>
        <button type="button" class="pill" data-action="status" aria-describedby="status-hint"></button>
      </div>
      <h3 class="card__name"></h3>
      <p class="card__price"></p>
      <div class="paid" hidden>
        <label class="paid__field">
          <span class="paid__label" aria-hidden="true">Paid</span>
          <span class="paid__currency" aria-hidden="true">$</span>
          <input class="paid__input" type="text" inputmode="decimal" enterkeyhint="done"
                 autocomplete="off" spellcheck="false" data-action="paid">
        </label>
        <span class="badge badge--saved" hidden></span>
      </div>
      <p class="card__notes"></p>
      <div class="card__actions">
        <a class="btn btn--outline" target="_blank" rel="noopener noreferrer">
          Shop <span class="btn__arrow" aria-hidden="true">↗</span>
          <span class="visually-hidden" data-role="shop-sr"></span>
        </a>
      </div>
    </div>`;
  return el;
}

// Write to the DOM only when a value actually changes. Replacing a text node
// between pointerdown and pointerup makes Chrome drop the click, and untouched
// nodes keep focus, selection and transitions intact.
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
function setAttr(node, name, value) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
function setClass(node, className) {
  if (node.className !== className) node.className = className;
}
function setHidden(node, hidden) {
  if (node.hidden !== hidden) node.hidden = hidden;
}

function updateCard(el, item) {
  const q = (selector) => el.querySelector(selector);
  const label = STATUS_LABELS[item.status];
  const purchased = isPurchased(item);

  setAttr(el, "data-status", item.status);
  setClass(q(".card__media"), `card__media card__media--${slug(item.category)}`);
  setText(q(".card__emoji"), EMOJI[item.category] ?? "🎁");
  setText(q(".card__category"), item.category);
  setText(q(".card__name"), item.name);
  setText(q(".card__price"), formatMoney(item.price));

  const notes = q(".card__notes");
  setText(notes, item.notes);
  setHidden(notes, !item.notes);

  const pill = q(".pill");
  setClass(pill, `pill pill--${item.status}`);
  setText(pill, label);
  setAttr(pill, "aria-label", `Status: ${label}. Tap to change.`);

  // Paid price (only for ordered / wrapped)
  const input = q(".paid__input");
  setHidden(q(".paid"), !purchased);
  setAttr(input, "placeholder", String(item.price));
  setAttr(input, "aria-label", `Price paid for ${item.name}`);
  if (document.activeElement !== input) {
    const value = formatPaidInput(item.paid);
    if (input.value !== value) input.value = value;
  }

  const saved = item.paid == null ? 0 : roundCents(item.price - item.paid);
  const badge = q(".badge--saved");
  setHidden(badge, !(purchased && saved > 0));
  setText(badge, `Saved ${formatExact(saved)}`);

  // Shop link
  const href = safeUrl(item.link);
  setHidden(q(".card__actions"), !href);
  if (href) {
    setAttr(q(".btn--outline"), "href", href);
    setText(q('[data-role="shop-sr"]'), `${item.name} (opens in a new tab)`);
  }
}

function getEmptyEl() {
  if (!emptyEl) {
    emptyEl = document.createElement("div");
    emptyEl.className = "empty";
    emptyEl.innerHTML = `
      <p class="empty__sparkle" aria-hidden="true">✦</p>
      <p class="empty__title">No gifts here</p>
      <p class="empty__text"></p>
      <button type="button" class="btn btn--outline btn--inline" data-action="clear-filters">Show all gifts</button>`;
  }
  return emptyEl;
}

function renderGrid() {
  const visible = getVisibleItems();
  const liveIds = new Set(state.items.map((item) => item.id));
  for (const id of cardEls.keys()) if (!liveIds.has(id)) cardEls.delete(id);

  const next = visible.map((item) => {
    let el = cardEls.get(item.id);
    if (!el) {
      el = createCard(item);
      cardEls.set(item.id, el);
    }
    updateCard(el, item);
    return el;
  });
  if (next.length === 0) {
    const empty = getEmptyEl();
    const active = [
      state.filter !== "All" ? state.filter : null,
      state.status !== "All" ? STATUS_LABELS[state.status] : null,
    ].filter(Boolean);
    setText(empty.querySelector(".empty__text"), active.length ? `Nothing matches ${active.join(" · ")}.` : "The list is empty.");
    next.push(empty);
  }

  // Only touch the grid's children when membership or order actually changed.
  const current = [...els.grid.children];
  const changed = current.length !== next.length || current.some((el, i) => el !== next[i]);
  if (changed) {
    const focused = document.activeElement;
    els.grid.replaceChildren(...next);
    // Moving a node blurs it; put focus back if the element is still on the page.
    if (focused && focused !== document.activeElement && focused.isConnected) {
      focused.focus({ preventScroll: true });
    }
  }

  const total = state.items.length;
  setText(
    els.resultCount,
    visible.length === total
      ? plural(total, "gift", "gifts")
      : `${visible.length} of ${plural(total, "gift", "gifts")}`
  );
}

// ==========================================================================
// Announcements + storage banner
// ==========================================================================

let announceTimer;
function announce(message) {
  clearTimeout(announceTimer);
  els.announcer.textContent = "";
  announceTimer = setTimeout(() => {
    els.announcer.textContent = message;
  }, 60);
}

let bannerDismissed = false;
function showStorageBanner() {
  if (!bannerDismissed) els.banner.hidden = false;
}

// ==========================================================================
// Popover menu (status picker + settings)
// ==========================================================================

let menu = null; // { el, anchor }
let suppressClickOn = null; // element whose next click should be ignored

function openMenu(anchor, { label, items, onSelect }) {
  closeMenu({ restoreFocus: false });

  const el = document.createElement("div");
  el.className = "menu";
  el.setAttribute("role", "menu");
  el.setAttribute("aria-label", label);
  el.innerHTML = items
    .map((it) => {
      const radio = it.checked !== undefined;
      return `
        <button type="button" tabindex="-1"
                class="menu__item${it.danger ? " menu__item--danger" : ""}"
                role="${radio ? "menuitemradio" : "menuitem"}"
                ${radio ? `aria-checked="${it.checked}"` : ""}
                data-value="${escapeHtml(it.value)}">
          ${it.dot ? `<span class="chip__dot chip__dot--${it.dot}" aria-hidden="true"></span>` : ""}
          <span>${escapeHtml(it.label)}</span>
          ${it.checked ? `<span class="menu__check" aria-hidden="true">✓</span>` : ""}
        </button>`;
    })
    .join("");

  document.body.append(el);
  positionMenu(el, anchor);
  if (anchor.hasAttribute("aria-haspopup")) anchor.setAttribute("aria-expanded", "true");
  menu = { el, anchor };

  el.addEventListener("click", (e) => {
    const item = e.target.closest(".menu__item");
    if (!item) return;
    closeMenu({ restoreFocus: true }); // focus the anchor first so dialogs return focus to it
    onSelect(item.dataset.value);
  });
  el.addEventListener("keydown", onMenuKeydown);

  const initial = el.querySelector('[aria-checked="true"]') ?? el.querySelector(".menu__item");
  initial?.focus({ preventScroll: true });
}

function positionMenu(el, anchor) {
  const gap = 6;
  const margin = 8;
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const { offsetWidth: w, offsetHeight: h } = el;

  // Right-align with the anchor, clamped to the viewport.
  const left = Math.min(Math.max(margin, r.right - w), vw - w - margin);
  // Below the anchor, or above it if there isn't room.
  let top = r.bottom + gap;
  if (top + h > vh - margin && r.top - gap - h > margin) top = r.top - gap - h;

  el.style.left = `${left + window.scrollX}px`;
  el.style.top = `${top + window.scrollY}px`;
}

function closeMenu({ restoreFocus = true } = {}) {
  if (!menu) return;
  const { el, anchor } = menu;
  menu = null;
  el.remove();
  if (anchor.hasAttribute("aria-haspopup")) anchor.setAttribute("aria-expanded", "false");
  if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
}

function onMenuKeydown(e) {
  const items = [...menu.el.querySelectorAll(".menu__item")];
  const i = items.indexOf(document.activeElement);
  const move = (index) => items[(index + items.length) % items.length].focus();

  switch (e.key) {
    case "ArrowDown": e.preventDefault(); move(i + 1); break;
    case "ArrowUp": e.preventDefault(); move(i - 1); break;
    case "Home": e.preventDefault(); move(0); break;
    case "End": e.preventDefault(); move(items.length - 1); break;
    case "Escape":
    case "Tab":
      e.preventDefault();
      closeMenu({ restoreFocus: true });
      break;
  }
}

function openStatusMenu(pill) {
  const id = pill.closest(".card")?.dataset.id;
  const item = findItem(id);
  if (!item) return;
  openMenu(pill, {
    label: `Status for ${item.name}`,
    items: STATUSES.map((s) => ({
      value: s,
      label: STATUS_LABELS[s],
      checked: item.status === s,
      dot: s,
    })),
    onSelect: (status) => setStatus(id, status),
  });
}

// ---- Long press ----

let press = null; // { pill, x, y, timer }

function startLongPress(pill, e) {
  cancelLongPress();
  press = {
    pill,
    x: e.clientX,
    y: e.clientY,
    timer: setTimeout(() => {
      press = null;
      suppressClickOn = pill; // the release would otherwise cycle the status
      openStatusMenu(pill);
    }, LONG_PRESS_MS),
  };
}

function cancelLongPress() {
  if (!press) return;
  clearTimeout(press.timer);
  press = null;
}

// ==========================================================================
// Reset
// ==========================================================================

function confirmReset() {
  const dialog = els.resetDialog;
  if (typeof dialog.showModal !== "function") {
    if (window.confirm("Reset to the original list? This clears every status and paid price.")) resetItems();
    return;
  }
  dialog.returnValue = "";
  dialog.showModal();
}

// ==========================================================================
// Events
// ==========================================================================

function bindEvents() {
  // Close an open menu on any outside press. Pressing the menu's own anchor
  // closes it without also triggering the anchor's click.
  document.addEventListener(
    "pointerdown",
    (e) => {
      suppressClickOn = null;
      if (!menu || menu.el.contains(e.target)) return;
      if (menu.anchor.contains(e.target)) suppressClickOn = menu.anchor;
      closeMenu({ restoreFocus: false });
    },
    true
  );
  window.addEventListener("resize", () => closeMenu({ restoreFocus: false }));

  // ---- Grid (delegated) ----
  els.grid.addEventListener("click", (e) => {
    const pill = e.target.closest('[data-action="status"]');
    if (pill) {
      if (suppressClickOn === pill) {
        suppressClickOn = null;
        return;
      }
      cycleStatus(pill.closest(".card").dataset.id);
      return;
    }
    if (e.target.closest('[data-action="clear-filters"]')) {
      state.filter = "All";
      state.status = "All";
      render();
    }
  });

  els.grid.addEventListener("contextmenu", (e) => {
    const pill = e.target.closest('[data-action="status"]');
    if (!pill) return;
    e.preventDefault();
    cancelLongPress();
    if (menu?.anchor !== pill) openStatusMenu(pill);
  });

  els.grid.addEventListener("pointerdown", (e) => {
    const pill = e.target.closest('[data-action="status"]');
    if (!pill || e.button !== 0 || suppressClickOn === pill) return;
    startLongPress(pill, e);
  });
  document.addEventListener("pointermove", (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP) cancelLongPress();
  });
  document.addEventListener("pointerup", cancelLongPress);
  document.addEventListener("pointercancel", cancelLongPress);

  // Paid input: save on blur or Enter, revert on Escape.
  els.grid.addEventListener("keydown", (e) => {
    const input = e.target.closest('[data-action="paid"]');
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      const item = findItem(input.closest(".card").dataset.id);
      input.value = formatPaidInput(item?.paid ?? null);
      input.blur();
    }
  });
  els.grid.addEventListener("focusout", (e) => {
    if (e.target.matches('[data-action="paid"]')) commitPaid(e.target);
  });

  // ---- Filters + sort ----
  els.categoryFilters.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip || chip.dataset.filter === state.filter) return;
    state.filter = chip.dataset.filter;
    render();
    revealChip(chip);
  });
  els.statusFilters.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip || chip.dataset.status === state.status) return;
    state.status = chip.dataset.status;
    render();
    revealChip(chip);
  });
  els.sort.addEventListener("change", () => {
    state.sort = SORTS[els.sort.value] ? els.sort.value : "default";
    render();
  });

  // ---- Settings menu + reset dialog ----
  els.settingsBtn.addEventListener("click", () => {
    if (suppressClickOn === els.settingsBtn) {
      suppressClickOn = null;
      return;
    }
    if (menu?.anchor === els.settingsBtn) {
      closeMenu();
      return;
    }
    openMenu(els.settingsBtn, {
      label: "Settings",
      items: [{ value: "reset", label: "Reset to original list", danger: true }],
      onSelect: (value) => {
        if (value === "reset") confirmReset();
      },
    });
  });

  els.resetDialog.addEventListener("close", () => {
    if (els.resetDialog.returnValue === "reset") resetItems();
  });
  // Clicking the backdrop (the dialog element itself, outside its content) cancels.
  els.resetDialog.addEventListener("click", (e) => {
    if (e.target === els.resetDialog) els.resetDialog.close("cancel");
  });

  // ---- Storage banner ----
  els.bannerClose.addEventListener("click", () => {
    bannerDismissed = true;
    els.banner.hidden = true;
  });

  // Keep multiple open tabs in sync.
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    state.items = loadItems();
    render();
  });
}

// ==========================================================================
// Init
// ==========================================================================

buildStats();
buildFilters();
bindEvents();

els.grid.classList.add("is-entering"); // one-time entrance on first paint only
render();
setTimeout(() => els.grid.classList.remove("is-entering"), 1600);

if (!store.available) showStorageBanner();
