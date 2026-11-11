import { seedItems } from "./data.js";

// ==========================================================================
// Constants
// ==========================================================================

const STORAGE_KEY = "juliana-wishlist-v1";
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10; // px of finger movement allowed before cancelling
const UNDO_MS = 6000;
const PHOTO_MAX_EDGE = 800;
const PHOTO_QUALITY = 0.8;
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

const EASE_OUT = "cubic-bezier(.2, .8, .2, 1)";
const SPRING = "cubic-bezier(.22, 1.2, .36, 1)"; // slight overshoot

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
const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);
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

const QUOTA_MESSAGE =
  "This device's storage is full, so that change wasn't saved. Uploaded photos take the most room: try image URLs instead.";

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
const formatPaidInput = (n) => (n == null ? "" : Number.isInteger(n) ? String(n) : n.toFixed(2));
const roundCents = (n) => Math.round(n * 100) / 100;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Parse "1,250", "$99.5" etc. Returns null for empty, NaN for invalid/negative. */
function parseMoney(text) {
  const raw = String(text ?? "").trim().replace(/[$,\s]/g, "");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? roundCents(n) : NaN;
}

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);

/** Only http(s) URLs are allowed into href/src attributes. */
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Image sources: http(s) URLs or our own raster data URLs. */
function safeImageSrc(src) {
  if (typeof src !== "string" || src === "") return null;
  if (/^data:image\/(jpeg|png|webp|gif);base64,/i.test(src)) return src;
  return safeUrl(src);
}

/** "rimowa.com/x" → "https://rimowa.com/x". Returns "" for empty, null if invalid. */
function normalizeLink(text) {
  const value = String(text ?? "").trim();
  if (value === "") return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  const url = safeUrl(withScheme);
  return url && /\./.test(new URL(url).hostname) ? url : null;
}

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const clone = (value) =>
  typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function localDateStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const isWide = () => matchMedia("(min-width: 768px)").matches;

// ==========================================================================
// Storage (localStorage with in-memory fallback)
// ==========================================================================

function isQuotaError(err) {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22 ||
      err.code === 1014)
  );
}

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
    /** Returns "ok", "quota" (storage full; previous value kept) or "unavailable". */
    write(value) {
      memory = value;
      if (!available) return "unavailable";
      try {
        localStorage.setItem(key, value);
        return "ok";
      } catch (err) {
        if (isQuotaError(err)) return "quota";
        available = false; // storage revoked: stay in memory from now on
        return "unavailable";
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

/** Persist items. Returns the store result; shows the banner if storage is gone. */
function save() {
  const result = store.write(JSON.stringify(state.items));
  if (result === "unavailable") showStorageBanner();
  return result;
}

/** save() for everyday edits: a full store just gets a friendly toast. */
function persist() {
  const result = save();
  if (result === "quota") showToast(QUOTA_MESSAGE, { duration: 8000 });
  return result;
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
  return { total, spent, remaining: total - spent, bought: purchased.length, wrapped, count: items.length };
}

function getVisibleItems() {
  const order = new Map(state.items.map((item, i) => [item.id, i]));
  const compare = SORTS[state.sort] ?? SORTS.default;
  return state.items
    .filter((item) => matchesCategory(item) && matchesStatus(item))
    .sort((a, b) => compare(a, b) || order.get(a.id) - order.get(b.id));
}

/** Short, readable, unique id from the item name, e.g. "silk-scarf-k3f9". */
function makeId(name) {
  const base = slug(name).replace(/^-+|-+$/g, "").slice(0, 24) || "gift";
  let id;
  do {
    id = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  } while (findItem(id));
  return id;
}

// ==========================================================================
// Mutations
// ==========================================================================

function setStatus(id, status) {
  const item = findItem(id);
  if (!item || !STATUSES.includes(status) || item.status === status) return;
  item.status = status;
  persist();
  render();
  announce(`${item.name} is now ${STATUS_LABELS[status]}.`);
}

function cycleStatus(id) {
  const item = findItem(id);
  if (!item) return;
  setStatus(id, STATUSES[(STATUSES.indexOf(item.status) + 1) % STATUSES.length]);
}

function commitPaid(input) {
  const item = findItem(input.closest(".card")?.dataset.id);
  if (!item) return;
  const next = parseMoney(input.value);
  if (Number.isNaN(next)) {
    input.value = formatPaidInput(item.paid); // invalid: revert
    return;
  }
  input.value = formatPaidInput(next);
  if (next === item.paid) return;
  item.paid = next;
  persist();
  render();
  announce(next == null ? `Cleared paid price for ${item.name}.` : `Paid ${formatExact(next)} for ${item.name}.`);
}

let lastDeleted = null; // { item, index } for Undo

function deleteItem(id) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index === -1) return;

  // Pick where focus goes once the card is gone: the next card, else the previous one.
  const cardEl = cardEls.get(id);
  const neighbour = cardEl?.nextElementSibling?.matches(".card")
    ? cardEl.nextElementSibling
    : cardEl?.previousElementSibling?.matches(".card")
      ? cardEl.previousElementSibling
      : null;

  const [item] = state.items.splice(index, 1);
  lastDeleted = { item, index };
  persist();
  render();
  (neighbour?.querySelector(".card__more") ?? els.addBtn).focus({ preventScroll: true });

  showToast("Item removed", { actionLabel: "Undo", onAction: undoDelete, duration: UNDO_MS });
}

function undoDelete() {
  if (!lastDeleted) return;
  const { item, index } = lastDeleted;
  lastDeleted = null;
  if (findItem(item.id)) return;
  state.items.splice(Math.min(index, state.items.length), 0, item);
  persist();
  render();
  announce(`Restored ${item.name}.`);
  cardEls.get(item.id)?.querySelector(".card__more")?.focus({ preventScroll: true });
}

function resetItems() {
  state.items = clone(seedItems);
  resetView();
  persist();
  render();
  announce("Reset to the original list.");
}

function resetView() {
  state.filter = "All";
  state.status = "All";
  state.sort = "default";
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
  addBtn: $("#add-btn"),
  banner: $("#storage-banner"),
  bannerClose: $("#banner-close"),
  announcer: $("#announcer"),
  // Sheet
  sheet: $("#item-sheet"),
  sheetPanel: $("#item-form"),
  sheetScrim: $(".sheet__scrim"),
  sheetDrag: $("#sheet-drag"),
  sheetTitle: $("#sheet-title"),
  sheetBody: $("#sheet-body"),
  sheetSave: $("#sheet-save"),
  sheetError: $("#sheet-error"),
  itemForm: $("#item-form"),
  statusSegments: $("#f-status"),
  paidField: $("#paid-field"),
  photoPreview: $("#photo-preview"),
  photoImg: $("#photo-img"),
  photoEmoji: $("#photo-emoji"),
  photoToggle: $("#photo-toggle"),
  photoRemove: $("#photo-remove"),
  photoOptions: $("#photo-options"),
  photoFile: $("#photo-file"),
  photoUploadLabel: $("#photo-upload-label"),
  photoUrl: $("#photo-url"),
  photoUrlApply: $("#photo-url-apply"),
  photoError: $("#photo-error"),
  // Confirm dialog, toast, import
  confirm: $("#confirm-dialog"),
  confirmTitle: $("#confirm-title"),
  confirmText: $("#confirm-text"),
  confirmOk: $("#confirm-ok"),
  toast: $("#toast"),
  toastMsg: $("#toast-msg"),
  toastSep: $("#toast-sep"),
  toastAction: $("#toast-action"),
  importFile: $("#import-file"),
};

// ==========================================================================
// DOM write helpers
// ==========================================================================
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

/** Point an <img> at src (or clear it); its media wrapper tracks loading/loaded/error. */
function setPhoto(media, img, src, alt) {
  setAttr(img, "alt", alt);
  if (!src) {
    if (img.hasAttribute("src")) img.removeAttribute("src");
    setHidden(img, true);
    media.dataset.photo = "none";
  } else if (img.getAttribute("src") !== src) {
    media.dataset.photo = "loading";
    setHidden(img, false);
    img.src = src;
  }
}

/** Shared load/error handling for card and preview photos (load/error don't bubble, so capture). */
function onPhotoEvent(e) {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains("card__img")) return;
  const media = img.closest(".card__media");
  if (media) media.dataset.photo = e.type === "load" ? "loaded" : "error";
}

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
  setText(els.subtitle, `${plural(state.items.length, "gift", "gifts")} · curated from her Pinterest board`);
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
  setAttr(bar, "aria-valuemax", String(s.count));
  setAttr(bar, "aria-valuenow", String(s.wrapped));
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

/** Scroll a chip fully into its horizontal row (mobile) without moving the page. */
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
const emptyEls = {};

function createCard(item) {
  const el = document.createElement("article");
  el.className = "card";
  el.dataset.id = item.id;
  el.innerHTML = `
    <div class="card__media" data-photo="none">
      <img class="card__img" alt="" decoding="async" hidden>
      <span class="card__emoji" aria-hidden="true"></span>
    </div>
    <div class="card__body">
      <div class="card__meta">
        <span class="card__category"></span>
        <div class="card__meta-end">
          <button type="button" class="pill" data-action="status" aria-describedby="status-hint"></button>
          <button type="button" class="card__more" data-action="card-menu" aria-haspopup="menu" aria-expanded="false">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <circle cx="3" cy="8" r="1.4" fill="currentColor"/>
              <circle cx="8" cy="8" r="1.4" fill="currentColor"/>
              <circle cx="13" cy="8" r="1.4" fill="currentColor"/>
            </svg>
          </button>
        </div>
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

function updateCard(el, item) {
  const q = (selector) => el.querySelector(selector);
  const label = STATUS_LABELS[item.status];
  const purchased = isPurchased(item);

  setAttr(el, "data-status", item.status);
  const media = q(".card__media");
  setClass(media, `card__media card__media--${slug(item.category)}`);
  setText(q(".card__emoji"), EMOJI[item.category] ?? "🎁");
  setPhoto(media, q(".card__img"), safeImageSrc(item.image), item.name);

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
  setAttr(q(".card__more"), "aria-label", `More actions for ${item.name}`);

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

/** Empty states: "no matches" for filters, "add your first gift" for an empty list. */
function getEmptyEl(kind) {
  if (!emptyEls[kind]) {
    const el = document.createElement("div");
    el.className = "empty";
    el.innerHTML =
      kind === "list"
        ? `<p class="empty__sparkle" aria-hidden="true">✦</p>
           <p class="empty__title">A blank page</p>
           <p class="empty__text">Add the first gift to start Juliana's list.</p>
           <button type="button" class="btn btn--solid btn--inline" data-action="add-first">Add a gift</button>`
        : `<p class="empty__sparkle" aria-hidden="true">✦</p>
           <p class="empty__title">No gifts here</p>
           <p class="empty__text"></p>
           <button type="button" class="btn btn--outline btn--inline" data-action="clear-filters">Show all gifts</button>`;
    emptyEls[kind] = el;
  }
  return emptyEls[kind];
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
    if (state.items.length === 0) {
      next.push(getEmptyEl("list"));
    } else {
      const empty = getEmptyEl("filter");
      const active = [
        state.filter !== "All" ? state.filter : null,
        state.status !== "All" ? STATUS_LABELS[state.status] : null,
      ].filter(Boolean);
      setText(empty.querySelector(".empty__text"), `Nothing matches ${active.join(" · ")}.`);
      next.push(empty);
    }
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
// Announcements, storage banner, toast
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

let toastTimer = null;
let toastHandler = null;

/** Bottom toast with an optional action button (e.g. Undo). One at a time. */
function showToast(message, { actionLabel = "", onAction = null, duration = 3500 } = {}) {
  clearTimeout(toastTimer);
  setText(els.toastMsg, message);
  setText(els.toastAction, actionLabel);
  setHidden(els.toastAction, !actionLabel);
  setHidden(els.toastSep, !actionLabel);
  toastHandler = onAction;
  els.toast.hidden = false;
  toastTimer = setTimeout(hideToast, duration);
  announce(actionLabel ? `${message}. ${actionLabel} is available.` : message);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastHandler = null;
  els.toast.hidden = true;
}

// ==========================================================================
// Popover menu (status picker, card actions, settings)
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
      if (it.separator) return `<div class="menu__sep" role="separator"></div>`;
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
    items: STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s], checked: item.status === s, dot: s })),
    onSelect: (status) => setStatus(id, status),
  });
}

function openCardMenu(button) {
  const id = button.closest(".card")?.dataset.id;
  const item = findItem(id);
  if (!item) return;
  openMenu(button, {
    label: `Actions for ${item.name}`,
    items: [
      { value: "edit", label: "Edit" },
      { value: "delete", label: "Delete", danger: true },
    ],
    onSelect: (value) => (value === "edit" ? openSheet("edit", id, button) : deleteItem(id)),
  });
}

function openSettingsMenu() {
  openMenu(els.settingsBtn, {
    label: "Settings",
    items: [
      { value: "export", label: "Export backup" },
      { value: "import", label: "Import backup…" },
      { separator: true },
      { value: "reset", label: "Reset to original list", danger: true },
    ],
    onSelect: (value) => {
      if (value === "export") exportBackup();
      else if (value === "import") {
        els.importFile.value = "";
        els.importFile.click();
      } else if (value === "reset") confirmReset();
    },
  });
}

/** Toggle-style handler shared by buttons that own a menu. */
function handleMenuButton(button, open) {
  if (suppressClickOn === button) {
    suppressClickOn = null;
    return;
  }
  if (menu?.anchor === button) closeMenu();
  else open(button);
}

// ---- Long press on status pills ----

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
// Confirm dialog
// ==========================================================================

/** Resolves true if the user confirms. Falls back to window.confirm without <dialog>. */
function confirmDialog({ title, text, confirmLabel }) {
  const dialog = els.confirm;
  if (typeof dialog.showModal !== "function") return Promise.resolve(window.confirm(`${title}\n\n${text}`));
  setText(els.confirmTitle, title);
  setText(els.confirmText, text);
  setText(els.confirmOk, confirmLabel);
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
  });
}

async function confirmReset() {
  const ok = await confirmDialog({
    title: "Reset to the original list?",
    text: "This brings back the original 14 gifts and clears every status, price, photo and gift you've added. It can't be undone.",
    confirmLabel: "Reset list",
  });
  if (ok) resetItems();
}

// ==========================================================================
// Backup: export + import
// ==========================================================================

function exportBackup() {
  const data = {
    app: "juliana-wishlist",
    version: 1,
    exportedAt: new Date().toISOString(),
    items: state.items,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `juliana-wishlist-${localDateStamp()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Backup saved · ${plural(state.items.length, "gift", "gifts")}`);
}

/** Accepts our backup object or a bare items array. */
function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "That file isn't a wishlist backup (it isn't valid JSON)." };
  }
  const items = Array.isArray(data) ? data : data?.items;
  if (!isValidItems(items)) return { error: "That file doesn't look like a wishlist backup." };
  const exportedAt = typeof data?.exportedAt === "string" ? new Date(data.exportedAt) : null;
  return { items, exportedAt: exportedAt && !Number.isNaN(exportedAt.getTime()) ? exportedAt : null };
}

async function importBackup(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    showToast("That file is too large to be a wishlist backup.", { duration: 6000 });
    return;
  }
  const parsed = parseBackup(await file.text());
  if (parsed.error) {
    showToast(parsed.error, { duration: 6000 });
    return;
  }

  const n = parsed.items.length;
  const when = parsed.exportedAt
    ? ` from ${parsed.exportedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "";
  const ok = await confirmDialog({
    title: "Import this backup?",
    text: `It has ${plural(n, "gift", "gifts")}${when}. Your current list of ${plural(state.items.length, "gift", "gifts")} will be replaced.`,
    confirmLabel: `Import ${plural(n, "gift", "gifts")}`,
  });
  if (!ok) return;

  const previous = state.items;
  state.items = parsed.items;
  if (save() === "quota") {
    state.items = previous;
    showToast("This backup is too large for this device's storage. Try a backup with fewer uploaded photos.", { duration: 8000 });
    return;
  }
  resetView();
  render();
  showToast(`Imported ${plural(n, "gift", "gifts")}`);
}

// ==========================================================================
// Photos
// ==========================================================================

/** Downscale an image file to ≤ maxEdge px on the long side, as a JPEG data URL. */
async function resizeImage(file, maxEdge = PHOTO_MAX_EDGE, quality = PHOTO_QUALITY) {
  if (!file.type.startsWith("image/")) throw new Error("not-an-image");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const { naturalWidth: w, naturalHeight: h } = img;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; // JPEG has no alpha: flatten transparent PNGs onto white
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ==========================================================================
// Item sheet (add / edit)
// ==========================================================================

const sheet = {
  open: false,
  closing: false,
  mode: "add",
  id: null,
  trigger: null,
  image: null,
  busy: false, // processing an upload
  touched: new Set(),
};

function buildSheet() {
  const select = els.itemForm.elements.category;
  select.innerHTML = CATEGORIES.map((c) => `<option value="${c.name}">${c.emoji}  ${c.name}</option>`).join("");
  els.statusSegments.innerHTML = STATUSES.map(
    (s) => `
    <label class="segmented__option">
      <input type="radio" name="status" value="${s}">
      <span>${STATUS_LABELS[s]}</span>
    </label>`
  ).join("");
}

function openSheet(mode, id = null, trigger = document.activeElement) {
  const item = id ? findItem(id) : null;
  if (mode === "edit" && !item) return;
  closeMenu({ restoreFocus: false });
  hideToast();

  Object.assign(sheet, { mode, id, trigger, image: item?.image ?? null, busy: false, touched: new Set() });

  const f = els.itemForm.elements;
  f.name.value = item?.name ?? "";
  f.category.value = item?.category ?? (state.filter !== "All" ? state.filter : CATEGORY_NAMES[0]);
  f.price.value = item ? formatPaidInput(item.price) : "";
  f.link.value = item?.link ?? "";
  f.notes.value = item?.notes ?? "";
  const status = item?.status ?? (state.status !== "All" ? state.status : "wishlist");
  els.itemForm.querySelector(`input[name="status"][value="${status}"]`).checked = true;
  f.paid.value = formatPaidInput(item?.paid ?? null);

  els.photoUrl.value = "";
  setPhotoOptions(false);
  setText(els.photoError, "");
  setText(els.sheetError, "");
  setText(els.sheetTitle, mode === "edit" ? "Edit gift" : "Add a gift");
  setText(els.sheetSave, mode === "edit" ? "Save changes" : "Add gift");
  updatePhotoPreview();
  validateSheet();

  els.sheet.showModal();
  document.documentElement.classList.add("is-locked");
  sheet.open = true;
  sheet.closing = false;
  els.sheetBody.scrollTop = 0;

  // Desktop add: start typing straight away. Phones: focus the title so the
  // keyboard doesn't jump up over the opening animation.
  if (mode === "add" && isWide()) f.name.focus();
  else els.sheetTitle.focus();

  animateSheetIn();
}

/** Animate the sheet away, then close the dialog. */
async function closeSheet({ velocity = 0 } = {}) {
  if (!sheet.open || sheet.closing) return;
  sheet.closing = true;
  await animateSheetOut(velocity);
  if (els.sheet.open) els.sheet.close();
}

/** Runs however the dialog closed (button, Esc, swipe, backdrop). */
function onSheetClosed() {
  sheet.open = false;
  sheet.closing = false;
  document.documentElement.classList.remove("is-locked");
  els.sheetPanel.style.transform = "";
  els.sheetScrim.style.opacity = "";
  const target = sheet.trigger?.isConnected ? sheet.trigger : els.addBtn;
  target.focus({ preventScroll: true });
}

function animateSheetIn() {
  if (prefersReducedMotion()) return;
  els.sheetScrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "linear" });
  if (isWide()) {
    els.sheetPanel.animate(
      [{ opacity: 0, transform: "translateY(16px) scale(.97)" }, { opacity: 1, transform: "none" }],
      { duration: 320, easing: SPRING }
    );
  } else {
    els.sheetPanel.animate([{ transform: "translateY(100%)" }, { transform: "none" }], {
      duration: 440,
      easing: SPRING,
    });
  }
}

/** Slide out from wherever the sheet currently is; faster if flung. */
function animateSheetOut(velocity = 0) {
  if (prefersReducedMotion()) return Promise.resolve();
  const panel = els.sheetPanel;
  const scrim = els.sheetScrim;
  const fromTransform = panel.style.transform || "none";
  const fromOpacity = Number(getComputedStyle(scrim).opacity);
  panel.style.transform = "";
  scrim.style.opacity = "";

  let panelAnim;
  if (isWide()) {
    panelAnim = panel.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(12px) scale(.98)" }],
      { duration: 180, easing: "ease-in", fill: "forwards" }
    );
  } else {
    const height = panel.offsetHeight;
    const current = new DOMMatrixReadOnly(fromTransform === "none" ? undefined : fromTransform).m42;
    const remaining = Math.max(0, height - current);
    const duration = Math.min(320, Math.max(160, velocity > 0 ? remaining / velocity : 280));
    panelAnim = panel.animate([{ transform: fromTransform }, { transform: "translateY(100%)" }], {
      duration,
      easing: "cubic-bezier(.4, 0, 1, 1)",
      fill: "forwards",
    });
  }
  scrim.animate([{ opacity: fromOpacity }, { opacity: 0 }], {
    duration: panelAnim.effect.getTiming().duration,
    fill: "forwards",
  });
  return panelAnim.finished.then(() => {
    panel.getAnimations().forEach((a) => a.cancel());
    scrim.getAnimations().forEach((a) => a.cancel());
  });
}

// ---- Drag to dismiss (phones) ----

let drag = null; // { startY, samples: [{ y, t }], height }

function onDragStart(e) {
  if (isWide() || !sheet.open || sheet.closing || e.button > 0 || e.target.closest("button")) return;
  els.sheetPanel.getAnimations().forEach((a) => a.cancel());
  drag = { startY: e.clientY, samples: [{ y: e.clientY, t: e.timeStamp }], height: els.sheetPanel.offsetHeight };
  els.sheetDrag.setPointerCapture(e.pointerId);
}

function onDragMove(e) {
  if (!drag) return;
  const dy = e.clientY - drag.startY;
  const offset = dy >= 0 ? dy : -Math.sqrt(-dy) * 2; // gentle resistance when pulled up
  els.sheetPanel.style.transform = `translateY(${offset}px)`;
  els.sheetScrim.style.opacity = String(1 - Math.min(1, Math.max(0, offset) / drag.height));
  drag.samples.push({ y: e.clientY, t: e.timeStamp });
  if (drag.samples.length > 6) drag.samples.shift();
}

function onDragEnd() {
  if (!drag) return;
  const { samples, startY, height } = drag;
  drag = null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const velocity = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0; // px/ms, + = down
  const offset = last.y - startY;

  if (offset > height * 0.3 || (velocity > 0.5 && offset > 12)) {
    closeSheet({ velocity });
    return;
  }
  // Spring back into place.
  const panel = els.sheetPanel;
  const from = panel.style.transform || "none";
  const fromOpacity = els.sheetScrim.style.opacity || "1";
  panel.style.transform = "";
  els.sheetScrim.style.opacity = "";
  if (prefersReducedMotion()) return;
  panel.animate([{ transform: from }, { transform: "none" }], { duration: 360, easing: SPRING });
  els.sheetScrim.animate([{ opacity: fromOpacity }, { opacity: 1 }], { duration: 200 });
}

// ---- Form state + validation ----

function readSheet() {
  const f = els.itemForm.elements;
  const status = els.itemForm.querySelector('input[name="status"]:checked')?.value ?? "wishlist";
  return {
    name: f.name.value.trim(),
    category: f.category.value,
    price: parseMoney(f.price.value),
    link: normalizeLink(f.link.value),
    notes: f.notes.value.trim(),
    status,
    paid: parseMoney(f.paid.value),
  };
}

/** Validate, show messages for touched fields (or all), and toggle Save. */
function validateSheet({ showAll = false } = {}) {
  const v = readSheet();
  const purchased = PURCHASED.has(v.status);
  const errors = {
    name: v.name ? "" : "Give the gift a name.",
    price:
      v.price === null ? "Add an estimated price." : Number.isNaN(v.price) ? "Enter a price like 128 or 1,250." : "",
    link: v.link === null ? "That doesn't look like a web address." : "",
    paid: purchased && Number.isNaN(v.paid) ? "Enter an amount like 118, or leave it empty." : "",
  };
  if (!CATEGORY_NAMES.includes(v.category)) v.category = CATEGORY_NAMES[0];

  for (const [field, message] of Object.entries(errors)) {
    const shown = showAll || sheet.touched.has(field) ? message : "";
    setText($(`#e-${field}`), shown);
    setAttr(els.itemForm.elements[field], "aria-invalid", String(Boolean(shown)));
  }
  setHidden(els.paidField, !purchased);
  setAttr(els.itemForm.elements.paid, "placeholder", Number.isNaN(v.price) || v.price === null ? "" : formatPaidInput(v.price));

  const valid = Object.values(errors).every((m) => !m);
  els.sheetSave.disabled = !valid || sheet.busy;
  return { valid, values: v };
}

function submitSheet() {
  const { valid, values } = validateSheet({ showAll: true });
  if (!valid || sheet.busy) return;
  setText(els.sheetError, "");

  // Keep the existing paid value if the field is hidden and holds junk.
  const paid = Number.isNaN(values.paid) ? null : values.paid;
  const fields = {
    name: values.name,
    category: values.category,
    price: values.price,
    link: values.link,
    notes: values.notes,
    status: values.status,
    paid,
    image: sheet.image,
  };

  let item;
  let rollback;
  if (sheet.mode === "edit") {
    item = findItem(sheet.id);
    if (!item) return closeSheet();
    const before = { ...item };
    Object.assign(item, fields);
    rollback = () => Object.assign(item, before);
  } else {
    item = { id: makeId(fields.name), ...fields };
    state.items.push(item);
    rollback = () => state.items.pop();
  }

  const result = save();
  if (result === "quota") {
    rollback();
    setText(
      els.sheetError,
      sheet.image?.startsWith("data:")
        ? "There isn't room on this device to store this photo. Try pasting an image URL instead, or remove photos from other gifts."
        : QUOTA_MESSAGE
    );
    return;
  }

  // Make sure a new or edited gift is visible under the current filters.
  if (!matchesCategory(item) || !matchesStatus(item)) {
    state.filter = "All";
    state.status = "All";
  }
  const wasAdd = sheet.mode === "add";
  sheet.trigger = wasAdd ? els.addBtn : sheet.trigger;
  closeSheet();
  render();

  const card = cardEls.get(item.id);
  if (wasAdd) {
    card?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    showToast(`Added ${item.name}`);
  } else {
    announce(`Saved changes to ${item.name}.`);
  }
}

// ---- Photo controls in the sheet ----

function setPhotoOptions(open) {
  setHidden(els.photoOptions, !open);
  setAttr(els.photoToggle, "aria-expanded", String(open));
}

function updatePhotoPreview() {
  const category = els.itemForm.elements.category.value;
  setClass(els.photoPreview, `photo__preview card__media card__media--${slug(category)}`);
  setText(els.photoEmoji, EMOJI[category] ?? "🎁");
  setPhoto(els.photoPreview, els.photoImg, safeImageSrc(sheet.image), "Photo preview");
  setText(els.photoToggle, sheet.image ? "Change photo" : "Add photo");
  setHidden(els.photoRemove, !sheet.image);
}

async function onPhotoFile() {
  const file = els.photoFile.files?.[0];
  els.photoFile.value = "";
  if (!file) return;
  sheet.busy = true;
  setText(els.photoUploadLabel, "Preparing photo…");
  setText(els.photoError, "");
  validateSheet();
  try {
    sheet.image = await resizeImage(file);
    setPhotoOptions(false);
    updatePhotoPreview();
  } catch {
    setText(els.photoError, "Couldn't read that image. Try another photo, or paste an image URL.");
  } finally {
    sheet.busy = false;
    setText(els.photoUploadLabel, "Upload from library");
    validateSheet();
  }
}

function applyPhotoUrl() {
  const url = normalizeLink(els.photoUrl.value);
  if (!url) {
    setText(els.photoError, "Paste a full image link that starts with https://");
    return;
  }
  setText(els.photoError, "");
  sheet.image = url;
  els.photoUrl.value = "";
  setPhotoOptions(false);
  updatePhotoPreview();
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
    const more = e.target.closest('[data-action="card-menu"]');
    if (more) {
      handleMenuButton(more, openCardMenu);
      return;
    }
    if (e.target.closest('[data-action="clear-filters"]')) {
      state.filter = "All";
      state.status = "All";
      render();
      return;
    }
    if (e.target.closest('[data-action="add-first"]')) openSheet("add", null, e.target.closest("button"));
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

  // Photos (card + sheet preview)
  document.addEventListener("load", onPhotoEvent, true);
  document.addEventListener("error", onPhotoEvent, true);

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

  // ---- Header, FAB ----
  els.settingsBtn.addEventListener("click", () => handleMenuButton(els.settingsBtn, openSettingsMenu));
  els.addBtn.addEventListener("click", () => openSheet("add", null, els.addBtn));

  // ---- Sheet ----
  els.itemForm.addEventListener("submit", (e) => {
    e.preventDefault();
    submitSheet();
  });
  els.itemForm.addEventListener("input", (e) => {
    if (e.target.name === "category") updatePhotoPreview();
    validateSheet();
  });
  els.itemForm.addEventListener("change", (e) => {
    if (e.target.name === "status") validateSheet();
  });
  els.itemForm.addEventListener("focusout", (e) => {
    const name = e.target.name;
    if (["name", "price", "link", "paid"].includes(name)) {
      sheet.touched.add(name);
      // Tidy the link once the user leaves the field ("rimowa.com" → "https://rimowa.com/").
      if (name === "link") {
        const link = normalizeLink(e.target.value);
        if (link) e.target.value = link;
      }
      validateSheet();
    }
  });
  els.itemForm.addEventListener("keydown", (e) => {
    // Enter in a single-line field moves on instead of submitting half a form.
    if (e.key === "Enter" && e.target.matches("input.input:not(#photo-url)")) {
      e.preventDefault();
      const fields = [...els.itemForm.querySelectorAll("input.input:not([hidden]), select.input, textarea.input")].filter(
        (el) => el.offsetParent !== null && el.id !== "photo-url"
      );
      const next = fields[fields.indexOf(e.target) + 1];
      if (next) next.focus();
      else if (!els.sheetSave.disabled) submitSheet();
    }
  });
  els.sheet.addEventListener("click", (e) => {
    if (e.target.closest('[data-action="close-sheet"]')) closeSheet();
  });
  els.sheet.addEventListener("cancel", (e) => {
    // Esc: animate out ourselves (if the browser lets us intercept it).
    if (e.cancelable) {
      e.preventDefault();
      closeSheet();
    }
  });
  els.sheet.addEventListener("close", onSheetClosed);
  els.sheetDrag.addEventListener("pointerdown", onDragStart);
  els.sheetDrag.addEventListener("pointermove", onDragMove);
  els.sheetDrag.addEventListener("pointerup", onDragEnd);
  els.sheetDrag.addEventListener("pointercancel", onDragEnd);

  els.photoToggle.addEventListener("click", () => {
    const open = els.photoOptions.hidden;
    setPhotoOptions(open);
    if (open) els.photoUrl.focus();
  });
  els.photoRemove.addEventListener("click", () => {
    sheet.image = null;
    setText(els.photoError, "");
    updatePhotoPreview();
    els.photoToggle.focus();
  });
  els.photoFile.addEventListener("change", onPhotoFile);
  els.photoUrlApply.addEventListener("click", applyPhotoUrl);
  els.photoUrl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyPhotoUrl();
    }
  });
  els.photoImg.addEventListener("error", () => {
    if (sheet.image && !sheet.image.startsWith("data:")) {
      setText(els.photoError, "That link didn't load an image. The card will show the emoji instead.");
    }
  });

  // ---- Confirm dialog: clicking the backdrop cancels ----
  els.confirm.addEventListener("click", (e) => {
    if (e.target === els.confirm) els.confirm.close("cancel");
  });

  // ---- Import ----
  els.importFile.addEventListener("change", () => {
    const file = els.importFile.files?.[0];
    els.importFile.value = ""; // so picking the same file again still fires "change"
    importBackup(file);
  });

  // ---- Toast + banner ----
  els.toastAction.addEventListener("click", () => {
    const handler = toastHandler;
    hideToast();
    handler?.();
  });
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
buildSheet();
bindEvents();

els.grid.classList.add("is-entering"); // one-time entrance on first paint only
render();
setTimeout(() => els.grid.classList.remove("is-entering"), 1600);

if (!store.available) showStorageBanner();
