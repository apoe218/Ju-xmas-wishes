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

// Motion tokens (see "Motion principles" in CLAUDE.md)
const EASE_OUT = "cubic-bezier(.2, .8, .2, 1)"; // entrances
const SPRING = "cubic-bezier(.22, 1.2, .36, 1)"; // sheets/bows: slight overshoot
const DUR_MICRO = 200; // 150–250ms micro-interactions
const DUR_LAYOUT = 380; // 300–450ms layout changes
const TWEEN_MS = 600; // dashboard numbers
const WRAP_GLIDE_DELAY = 900; // wrapped card waits this long before gliding away

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

/** "https://www.rimowa.com/us/…" → "rimowa.com" (shown under the Shop button). */
function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^(www|shop|us)\./, "");
  } catch {
    return "";
  }
}

const clone = (value) =>
  typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));

/** Local YYYY-MM-DD for backup filenames. */
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

/** localStorage wrapper that never throws: falls back to memory if storage is blocked. */
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

/** Shape check for one stored/imported item (types, status enum, non-negative money). */
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

/** A valid list: every item valid and ids unique. */
function isValidItems(value) {
  return (
    Array.isArray(value) &&
    value.every(isValidItem) &&
    new Set(value.map((item) => item.id)).size === value.length
  );
}

/** Items from storage, or a fresh copy of the seed list if missing/invalid. */
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

// Cards that just became Wrapped stay in place briefly for the ribbon + confetti
// moment before gliding into the Wrapped section.
const pendingWrap = new Map(); // id → timeout

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

/** Dashboard numbers: total estimate, spent (paid ?? price for ordered/wrapped), remaining, counts. */
function computeStats(items) {
  const purchased = items.filter(isPurchased);
  const total = items.reduce((sum, item) => sum + item.price, 0);
  const spent = purchased.reduce((sum, item) => sum + (item.paid ?? item.price), 0);
  const wrapped = items.filter((item) => item.status === "wrapped").length;
  return { total, spent, remaining: total - spent, bought: purchased.length, wrapped, count: items.length };
}

/** Items matching both filters, in the chosen sort (ties keep list order). */
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
  const wasAllWrapped = isAllWrapped();
  item.status = status;
  persist();

  clearTimeout(pendingWrap.get(id));
  pendingWrap.delete(id);

  const card = cardEls.get(id);
  const onScreen = card?.isConnected && card.parentElement === els.grid;
  if (status === "wrapped" && onScreen && !prefersReducedMotion()) {
    // The wrapped moment: ribbon + confetti now, glide to the Wrapped section shortly after.
    pendingWrap.set(id, setTimeout(() => {
      pendingWrap.delete(id);
      render();
    }, WRAP_GLIDE_DELAY));
    render();
    celebrateWrap(card);
  } else {
    render();
  }

  if (!wasAllWrapped && isAllWrapped()) celebrateAll();
  announce(
    status === "wrapped"
      ? `${item.name} is wrapped and moved to the Wrapped section.`
      : `${item.name} is now ${STATUS_LABELS[status]}.`
  );
}

const isAllWrapped = () => state.items.length > 0 && state.items.every((i) => i.status === "wrapped");

/** Pill tap: Wishlist → Considering → Ordered → Wrapped → Wishlist. */
function cycleStatus(id) {
  const item = findItem(id);
  if (!item) return;
  setStatus(id, STATUSES[(STATUSES.indexOf(item.status) + 1) % STATUSES.length]);
}

/** Save a card's inline Paid input (blur/Enter); invalid input reverts. */
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

/** Remove a gift, move focus to a neighbour, offer Undo for 6s. */
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

/** Put the last deleted gift back at its original position. */
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

/** Restore the original 14 seed gifts (after confirmation). */
function resetItems() {
  state.items = clone(seedItems);
  resetView();
  persist();
  render();
  announce("Reset to the original list.");
}

/** Back to All / All statuses / Default order. */
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
  hero: $(".hero"),
  celebrate: $("#celebrate"),
  gifts: $("#gifts"),
  grid: $("#grid"),
  wrappedSection: $("#wrapped-section"),
  wrappedGrid: $("#wrapped-grid"),
  wrappedCount: $("#wrapped-count"),
  settingsBtn: $("#settings-btn"),
  addBtn: $("#add-btn"),
  banner: $("#storage-banner"),
  bannerClose: $("#banner-close"),
  announcer: $("#announcer"),
  announcerTotals: $("#announcer-totals"),
  giftsHeading: $("#gifts-heading"),
  controls: $("#controls"),
  controlsSentinel: $("#controls-sentinel"),
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
  toastBar: $("#toast-bar"),
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

/** Rebuild everything from state. Card moves between renders are FLIP-animated. */
function render() {
  const flip = captureCardRects();
  renderHeader();
  renderStats();
  renderFilters();
  renderCelebration();
  renderGrid();
  playFlip(flip);
}

/** Show the "Every gift is wrapped" banner when everything is wrapped. */
function renderCelebration() {
  setHidden(els.celebrate, !isAllWrapped());
}

/** Subtitle with the live gift count. */
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
    <div class="stat stat--ring">
      <p class="stat__label">Wrapped</p>
      <div class="ring" role="progressbar" aria-label="Gifts wrapped" aria-valuemin="0">
        <svg class="ring__svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <circle class="ring__track" cx="50" cy="50" r="${RING_R}"/>
          <circle class="ring__fill" cx="50" cy="50" r="${RING_R}"
                  stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/>
        </svg>
        <div class="ring__center" aria-hidden="true">
          <span class="ring__value" data-stat="wrapped"></span>
          <span class="ring__label">wrapped</span>
        </div>
      </div>
      <p class="stat__caption" data-stat="pct"></p>
    </div>`;
}

const RING_R = 44;
const RING_C = 2 * Math.PI * RING_R;

let lastStats = null;

/** Update dashboard tiles + ring (tweened) and announce spend changes. */
function renderStats() {
  const s = computeStats(state.items);
  const pct = s.count ? Math.round((s.wrapped / s.count) * 100) : 0;
  const el = (key) => els.stats.querySelector(`[data-stat="${key}"]`);

  // The longest final amount sets one font size for all three money tiles
  // (CSS reads --chars), so long values never wrap and the tiles stay even.
  const chars = String(Math.max(...[s.total, s.spent, s.remaining].map((v) => formatMoney(v).length)));
  if (els.stats.style.getPropertyValue("--chars") !== chars) els.stats.style.setProperty("--chars", chars);
  const money = (key) => (v) => setText(el(key), formatMoney(Math.round(v)));
  tween("total", s.total, money("total"));
  tween("spent", s.spent, money("spent"));
  tween("remaining", s.remaining, money("remaining"));
  tween("wrapped", s.wrapped, (v) => setText(el("wrapped"), `${Math.round(v)} / ${s.count}`));
  tween("ring", s.count ? s.wrapped / s.count : 0, (v) => {
    els.ringFill.setAttribute("stroke-dashoffset", (RING_C * (1 - v)).toFixed(2));
  });
  setText(el("bought"), `${s.bought} of ${s.count} bought`);
  setText(el("pct"), `${pct}% ready to give`);

  const ring = els.stats.querySelector(".ring");
  setAttr(ring, "aria-valuemax", String(s.count));
  setAttr(ring, "aria-valuenow", String(s.wrapped));
  setAttr(ring, "aria-valuetext", `${s.wrapped} of ${s.count} wrapped`);

  // Speak meaningful dashboard changes (not on first paint).
  if (lastStats && lastStats.spent !== s.spent) announceTotals(`Spent now ${formatMoney(s.spent)}.`);
  lastStats = s;
}

// ---- Number tweens (rAF, easeOutCubic) ----

const tweens = new Map(); // key → { value, raf }
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/** Animate a value from where it currently is to `to`, calling `apply(v)` each frame. */
function tween(key, to, apply) {
  const t = tweens.get(key) ?? { value: to, raf: 0 };
  tweens.set(key, t);
  cancelAnimationFrame(t.raf);
  const from = t.value;
  if (from === to || prefersReducedMotion() || !motionReady) {
    t.value = to;
    apply(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / TWEEN_MS);
    t.value = from + (to - from) * easeOutCubic(k);
    apply(t.value);
    if (k < 1) t.raf = requestAnimationFrame(step);
    else t.value = to;
  };
  t.raf = requestAnimationFrame(step);
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

/** Active state, zero state and count for one filter chip. */
function updateChip(chip, active, count) {
  chip.classList.toggle("is-active", active);
  chip.classList.toggle("is-zero", count === 0);
  setAttr(chip, "aria-pressed", String(active));
  setText(chip.querySelector(".chip__count"), String(count));
}

/** Refresh both chip rows (faceted counts) and the sort select. */
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

/** Build a card's DOM once; updateCard() fills and refreshes it. */
function createCard(item) {
  const el = document.createElement("article");
  el.className = "card";
  el.dataset.id = item.id;
  el.innerHTML = `
    <div class="card__media" data-photo="none">
      <span class="card__shimmer" aria-hidden="true"></span>
      <img class="card__img" alt="" decoding="async" hidden>
      <span class="card__emoji" aria-hidden="true"></span>
    </div>
    ${RIBBON_SVG}
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
        <p class="card__domain" aria-hidden="true"></p>
      </div>
    </div>`;
  return el;
}

// Satin ribbon + bow across the card's top-right corner (shown when Wrapped).
const RIBBON_SVG = `
  <svg class="ribbon" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
    <g class="ribbon__band">
      <path d="M36 0h32l52 52v32z" fill="url(#satin)"/>
      <path d="M36 0h32l52 52v32z" fill="none" stroke="#C98591" stroke-opacity=".35" stroke-width=".8"/>
      <path class="ribbon__sheen" d="M36 0h10l74 74v10z" fill="url(#sheen)" opacity=".55"/>
    </g>
    <g transform="translate(92 40) rotate(45) scale(1.12)">
      <g class="ribbon__bow">
        <path d="M-2 3 L-11 24 L-6 21 L-3 27 L2 5 Z" fill="#D9939F"/>
        <path d="M2 3 L11 24 L6 21 L3 27 L-2 5 Z" fill="#C98591"/>
        <path d="M0 0 C-7 -13 -27 -16 -27 -5 C-27 5 -10 6 0 0 Z" fill="url(#satin-bow)" stroke="#B97683" stroke-opacity=".6" stroke-width=".9"/>
        <path d="M0 0 C7 -13 27 -16 27 -5 C27 5 10 6 0 0 Z" fill="url(#satin-bow)" stroke="#B97683" stroke-opacity=".6" stroke-width=".9"/>
        <path d="M-6 -6 C-12 -10 -20 -10 -21 -5" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.4" stroke-linecap="round"/>
        <ellipse cx="0" cy="0" rx="5" ry="5.5" fill="#D9939F" stroke="#C98591" stroke-opacity=".5" stroke-width=".8"/>
      </g>
    </g>
  </svg>`;

/** Patch one card from its item (change-only writes; pulses the pill on status change). */
function updateCard(el, item) {
  const q = (selector) => el.querySelector(selector);
  const label = STATUS_LABELS[item.status];
  const purchased = isPurchased(item);
  const previousStatus = el.dataset.status;

  setAttr(el, "data-status", item.status);
  el.classList.toggle("is-wrapped", item.status === "wrapped");
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
  if (previousStatus && previousStatus !== item.status && motionReady && !prefersReducedMotion()) {
    // Quick pulse; the colours crossfade via CSS transitions.
    pill.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], {
      duration: DUR_MICRO + 40,
      easing: "ease-out",
    });
  }
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
    const domain = domainOf(href);
    setAttr(q(".btn--outline"), "href", href);
    setText(q('[data-role="shop-sr"]'), `${item.name} at ${domain} (opens in a new tab)`);
    setText(q(".card__domain"), domain);
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
           <p class="empty__title">Nothing here yet</p>
           <p class="empty__text"></p>
           <button type="button" class="btn btn--outline btn--inline" data-action="clear-filters">Show all</button>`;
    emptyEls[kind] = el;
  }
  return emptyEls[kind];
}

/** Place cards into the main grid / Wrapped section, plus empty states and the count. */
function renderGrid() {
  const visible = getVisibleItems();
  const liveIds = new Set(state.items.map((item) => item.id));
  for (const id of cardEls.keys()) if (!liveIds.has(id)) cardEls.delete(id);

  const toEl = (item) => {
    let el = cardEls.get(item.id);
    if (!el) {
      el = createCard(item);
      cardEls.set(item.id, el);
    }
    updateCard(el, item);
    return el;
  };
  const isShelved = (item) => item.status === "wrapped" && !pendingWrap.has(item.id);
  const active = visible.filter((item) => !isShelved(item)).map(toEl);
  const wrapped = visible.filter(isShelved).map(toEl);

  if (visible.length === 0) {
    if (state.items.length === 0) {
      active.push(getEmptyEl("list"));
    } else {
      const empty = getEmptyEl("filter");
      const filters = [
        state.filter !== "All" ? state.filter : null,
        state.status !== "All" ? STATUS_LABELS[state.status] : null,
      ].filter(Boolean);
      setText(empty.querySelector(".empty__text"), `No gifts match ${filters.join(" · ")}.`);
      active.push(empty);
    }
  }

  syncChildren(els.grid, active);
  syncChildren(els.wrappedGrid, wrapped);
  setHidden(els.grid, active.length === 0);
  setHidden(els.wrappedSection, wrapped.length === 0);
  setText(els.wrappedCount, `${plural(wrapped.length, "gift", "gifts")} ready to give`);

  const total = state.items.length;
  setText(
    els.resultCount,
    visible.length === total
      ? plural(total, "gift", "gifts")
      : `${visible.length} of ${plural(total, "gift", "gifts")}`
  );
}

/** Replace a container's children only if membership or order changed; keep focus. */
function syncChildren(container, next) {
  const current = [...container.children];
  if (current.length === next.length && current.every((el, i) => el === next[i])) return;
  const focused = document.activeElement;
  container.replaceChildren(...next);
  // Moving a node blurs it; put focus back if the element is still on the page.
  if (focused && focused !== document.activeElement && focused.isConnected) {
    focused.focus({ preventScroll: true });
  }
}

// ==========================================================================
// FLIP: animate cards from their old positions to their new ones
// ==========================================================================

/** First: remember where every card is on screen right now. */
function captureCardRects() {
  if (!motionReady || prefersReducedMotion()) return null;
  const rects = new Map();
  for (const el of document.querySelectorAll("#gifts .card")) {
    rects.set(el, el.getBoundingClientRect());
  }
  return rects;
}

/** Last, Invert, Play: glide moved cards, fade new ones in, ghost removed ones out.
    Only cards that are (or were) on screen animate; the rest just snap into place. */
function playFlip(first) {
  if (!first) return;
  const now = new Set(document.querySelectorAll("#gifts .card"));
  const vh = window.innerHeight;
  const onScreen = (r) => r.width > 0 && r.bottom > -40 && r.top < vh + 40;

  // Leaving: a non-interactive clone fades and shrinks where the card used to be.
  let leaving = 0;
  for (const [el, rect] of first) {
    if (now.has(el) || !onScreen(rect)) continue;
    leaving++;
    const ghost = el.cloneNode(true);
    ghost.classList.add("card--ghost");
    ghost.removeAttribute("data-id");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    Object.assign(ghost.style, {
      top: `${rect.top + window.scrollY}px`,
      left: `${rect.left + window.scrollX}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    document.body.append(ghost);
    ghost
      .animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.96)" }], {
        duration: DUR_MICRO + 40,
        easing: "ease-in",
        fill: "forwards",
      })
      .finished.then(() => ghost.remove(), () => ghost.remove());
  }

  // Measure final positions without any glide still in flight.
  for (const el of now) el.getAnimations().forEach((a) => a.id === "flip" && a.cancel());

  for (const el of now) {
    const from = first.get(el);
    const to = el.getBoundingClientRect();
    if (!from || from.width === 0) {
      if (!onScreen(to)) continue;
      // Entering: fade + scale in, after leavers have started clearing out.
      el.animate([{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }], {
        duration: DUR_LAYOUT - 60,
        delay: leaving ? 90 : 0,
        easing: EASE_OUT,
        fill: "backwards",
      });
      continue;
    }
    if (!onScreen(from) && !onScreen(to)) continue;
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    const anim = el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      // Long trips (e.g. down to the Wrapped section) get a little more time.
      { duration: Math.min(DUR_LAYOUT + Math.hypot(dx, dy) / 12, 560), easing: EASE_OUT }
    );
    anim.id = "flip";
  }
}

// ==========================================================================
// Announcements, storage banner, toast
// ==========================================================================

let announceTimer;
/** Polite screen-reader message (re-announces even if the text repeats). */
function announce(message) {
  clearTimeout(announceTimer);
  els.announcer.textContent = "";
  announceTimer = setTimeout(() => {
    els.announcer.textContent = message;
  }, 60);
}

// Dashboard totals get their own live region (debounced) so they don't
// trample the status message that triggered them.
let totalsTimer;
function announceTotals(message) {
  clearTimeout(totalsTimer);
  els.announcerTotals.textContent = "";
  totalsTimer = setTimeout(() => {
    els.announcerTotals.textContent = message;
  }, 400);
}

let bannerDismissed = false;
/** Calm inline notice when the browser blocks storage. */
function showStorageBanner() {
  if (!bannerDismissed) els.banner.hidden = false;
}

let toastTimer = null; // used when motion is reduced
let toastClock = null; // the hairline animation doubles as the dismiss timer
let toastHandler = null;

/** Bottom toast with an optional action (e.g. Undo). Slides up; a hairline shows time left. */
function showToast(message, { actionLabel = "", onAction = null, duration = 3500 } = {}) {
  clearTimeout(toastTimer);
  toastClock?.cancel();
  setText(els.toastMsg, message);
  setText(els.toastAction, actionLabel);
  setHidden(els.toastAction, !actionLabel);
  setHidden(els.toastSep, !actionLabel);
  toastHandler = onAction;

  const wasHidden = els.toast.hidden;
  els.toast.getAnimations().forEach((a) => a.cancel());
  els.toast.hidden = false;
  announce(actionLabel ? `${message}. ${actionLabel} is available.` : message);

  const persistent = !Number.isFinite(duration); // e.g. "Update available" waits for a tap
  setHidden(els.toastBar, persistent);
  if (prefersReducedMotion()) {
    if (!persistent) toastTimer = setTimeout(hideToast, duration);
    return;
  }
  if (wasHidden) {
    els.toast.animate([{ opacity: 0, transform: "translateY(16px) scale(.98)" }, { opacity: 1, transform: "none" }], {
      duration: 280,
      easing: SPRING,
    });
  }
  if (persistent) return;
  toastClock = els.toastBar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
    duration,
    easing: "linear",
    fill: "forwards",
  });
  toastClock.finished.then(() => hideToast(), () => {});
}

/** Slide the toast away and drop its action. */
function hideToast() {
  clearTimeout(toastTimer);
  toastClock?.cancel();
  toastClock = null;
  toastHandler = null;
  if (els.toast.hidden) return;
  if (prefersReducedMotion()) {
    els.toast.hidden = true;
    return;
  }
  els.toast
    .animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(12px)" }], {
      duration: 180,
      easing: "ease-in",
      fill: "forwards",
    })
    .finished.then(() => {
      if (!toastHandler && !toastClock) els.toast.hidden = true;
      els.toast.getAnimations().forEach((a) => a.cancel());
    }, () => {});
}

// Hovering or focusing the toast pauses its countdown.
function pauseToast(paused) {
  if (!toastClock) return;
  if (paused) toastClock.pause();
  else toastClock.play();
}

// ==========================================================================
// Popover menu (status picker, card actions, settings)
// ==========================================================================

let menu = null; // { el, anchor }
let suppressClickOn = null; // element whose next click should be ignored

/** Generic popover menu (role=menu) anchored to a button; focuses the checked/first item. */
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

/** Place a menu under (or above) its anchor, clamped to the viewport. */
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

/** Remove the open menu, optionally returning focus to its anchor. */
function closeMenu({ restoreFocus = true } = {}) {
  if (!menu) return;
  const { el, anchor } = menu;
  menu = null;
  el.remove();
  if (anchor.hasAttribute("aria-haspopup")) anchor.setAttribute("aria-expanded", "false");
  if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
}

/** Arrow/Home/End navigation; Escape or Tab closes. */
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

/** Long-press / right-click picker to jump straight to any status. */
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

/** Card ⋯ menu: Edit / Delete. */
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

/** Header ⋯ menu: Export, Import, Reset. */
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

/** Begin timing a press on a status pill (opens the picker after 500ms). */
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

/** Abort a pending long press (release, movement, scroll). */
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

/** Confirm, then reset to the seed list. */
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

/** Download a dated JSON backup (share sheet → Save to Files in the home-screen app). */
async function exportBackup() {
  const data = {
    app: "juliana-wishlist",
    version: 1,
    exportedAt: new Date().toISOString(),
    items: state.items,
  };
  const name = `juliana-wishlist-${localDateStamp()}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });

  // Installed on iPhone, <a download> just opens a preview; the share sheet can save the file.
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const file = typeof File === "function" ? new File([blob], name, { type: "application/json" }) : null;
  if (standalone && file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Wishlist backup" });
      showToast(`Backup shared · ${plural(state.items.length, "gift", "gifts")}`);
    } catch (err) {
      if (err?.name !== "AbortError") showToast("Couldn't share the backup. Try again from Safari.", { duration: 6000 });
    }
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
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

/** Read, validate, preview and (on confirm) replace the list from a backup file. */
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

/** Fill the sheet's category select and status segmented control. */
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

/** Open the add/edit sheet, prefilled for edit, and remember what opened it. */
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

/** Spring the sheet up (phones) or scale it in (desktop); fade the scrim. */
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

/** Sheet header drag (phones): start tracking the finger. */
function onDragStart(e) {
  if (isWide() || !sheet.open || sheet.closing || e.button > 0 || e.target.closest("button")) return;
  els.sheetPanel.getAnimations().forEach((a) => a.cancel());
  drag = { startY: e.clientY, samples: [{ y: e.clientY, t: e.timeStamp }], height: els.sheetPanel.offsetHeight };
  els.sheetDrag.setPointerCapture(e.pointerId);
}

/** Follow the finger; resist upward pulls; fade the scrim with distance. */
function onDragMove(e) {
  if (!drag) return;
  const dy = e.clientY - drag.startY;
  const offset = dy >= 0 ? dy : -Math.sqrt(-dy) * 2; // gentle resistance when pulled up
  els.sheetPanel.style.transform = `translateY(${offset}px)`;
  els.sheetScrim.style.opacity = String(1 - Math.min(1, Math.max(0, offset) / drag.height));
  drag.samples.push({ y: e.clientY, t: e.timeStamp });
  if (drag.samples.length > 6) drag.samples.shift();
}

/** Close on a long drag or a downward flick; otherwise spring back. */
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

/** Validate and save the sheet; on a full store, roll back and explain. */
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

/** Sheet photo thumbnail + Add/Change/Remove buttons. */
function updatePhotoPreview() {
  const category = els.itemForm.elements.category.value;
  setClass(els.photoPreview, `photo__preview card__media card__media--${slug(category)}`);
  setText(els.photoEmoji, EMOJI[category] ?? "🎁");
  setPhoto(els.photoPreview, els.photoImg, safeImageSrc(sheet.image), "Photo preview");
  setText(els.photoToggle, sheet.image ? "Change photo" : "Add photo");
  setHidden(els.photoRemove, !sheet.image);
}

/** Upload: resize to ≤800px JPEG data URL, then preview. */
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

/** Use a pasted image URL (http/https only). */
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

  // iOS only applies :active styles (card press) when a touch listener exists.
  document.addEventListener("touchstart", () => {}, { passive: true });

  // ---- Cards (delegated on the gifts section: both grids) ----
  els.gifts.addEventListener("click", (e) => {
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
      els.giftsHeading.focus({ preventScroll: true }); // the button just disappeared
      return;
    }
    if (e.target.closest('[data-action="add-first"]')) openSheet("add", null, e.target.closest("button"));
  });

  els.gifts.addEventListener("contextmenu", (e) => {
    const pill = e.target.closest('[data-action="status"]');
    if (!pill) return;
    e.preventDefault();
    cancelLongPress();
    if (menu?.anchor !== pill) openStatusMenu(pill);
  });

  els.gifts.addEventListener("pointerdown", (e) => {
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
  els.gifts.addEventListener("keydown", (e) => {
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
  els.gifts.addEventListener("focusout", (e) => {
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
  for (const [type, paused] of [["pointerenter", true], ["pointerleave", false], ["focusin", true], ["focusout", false]]) {
    els.toast.addEventListener(type, () => pauseToast(paused));
  }
  els.toastAction.addEventListener("click", () => {
    const handler = toastHandler;
    hideToast();
    handler?.();
  });
  els.bannerClose.addEventListener("click", () => {
    bannerDismissed = true;
    els.banner.hidden = true;
  });

  // Frosted sticky filter bar once the header has scrolled away.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      els.controls.classList.toggle("is-stuck", !entry.isIntersecting && entry.boundingClientRect.top < 0);
    }).observe(els.controlsSentinel);
  }

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

// ==========================================================================
// Service worker: offline app shell + "Update available · Refresh"
// ==========================================================================

/** Register ./sw.js (relative, so it works from the Pages subpath) and offer updates. */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  let reloading = false;
  let userAsked = false;

  const offer = (worker) =>
    showToast("Update available", {
      actionLabel: "Refresh",
      duration: Infinity,
      onAction: () => {
        userAsked = true;
        worker.postMessage({ type: "SKIP_WAITING" });
      },
    });

  // Reload once the new worker takes over, but only if the person asked for it
  // (the very first install also fires controllerchange via clients.claim()).
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!userAsked || reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) offer(worker);
        });
      });
      // Check for a new version whenever the app comes back to the foreground.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    } catch {
      /* offline support is a nice-to-have; the app works without it */
    }
  });
}

let motionReady = false; // false during the first render: no tweens/FLIP on page load

buildStats();
els.ringFill = els.stats.querySelector(".ring__fill");
buildFilters();
buildSheet();
bindEvents();
render();
playEntrance();
motionReady = true;

if (!store.available) showStorageBanner();
registerServiceWorker();

// ==========================================================================
// Motion: page entrance, wrapped moment, confetti
// ==========================================================================

/** Header fades up, then dashboard tiles (60ms apart), then cards (40ms apart, last by 600ms). */
function playEntrance() {
  document.documentElement.classList.add("is-ready");
  if (prefersReducedMotion()) return;
  const rise = [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }];
  const play = (el, delay, duration = 450) =>
    el.animate(rise, { duration, delay, easing: EASE_OUT, fill: "backwards" });

  play(els.hero, 0, 520);
  [...els.stats.children].forEach((tile, i) => play(tile, 120 + i * 60));
  document.querySelectorAll(".filters, .toolbar").forEach((el) => play(el, 300, 400));
  [...els.grid.children, ...els.wrappedGrid.children].forEach((card, i) => play(card, Math.min(240 + i * 40, 600)));
}

/** Ribbon draws across the corner, the bow pops, confetti bursts from the pill. */
function celebrateWrap(card) {
  const band = card.querySelector(".ribbon__band");
  const sheen = card.querySelector(".ribbon__sheen");
  const bow = card.querySelector(".ribbon__bow");
  band.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: 420, easing: EASE_OUT });
  sheen.animate(
    [{ transform: "translate(-40px, -40px)", opacity: 0 }, { opacity: 0.8, offset: 0.4 }, { transform: "translate(30px, 30px)", opacity: 0 }],
    { duration: 900, delay: 260, easing: "ease-in-out", fill: "backwards" }
  );
  bow.animate(
    [{ transform: "scale(0) rotate(-25deg)", opacity: 0 }, { transform: "scale(1) rotate(0)", opacity: 1 }],
    { duration: 460, delay: 220, easing: SPRING, fill: "backwards" }
  );
  const r = card.querySelector(".pill").getBoundingClientRect();
  confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 40 });
}

/** Every gift wrapped: the banner rises in and a bigger shower falls. */
function celebrateAll() {
  if (prefersReducedMotion()) return;
  setTimeout(() => {
    els.celebrate.animate(
      [{ opacity: 0, transform: "translateY(-8px) scale(.98)" }, { opacity: 1, transform: "none" }],
      { duration: 520, easing: SPRING }
    );
    els.celebrate.scrollIntoView({ behavior: "smooth", block: "center" });
    confetti({ shower: true, count: 140 });
  }, WRAP_GLIDE_DELAY + 200);
}

const CONFETTI_COLORS = ["#E8B4BC", "#C98591", "#BFC3C7", "#FFFFFF"];
let confettiLayer = null; // { canvas, ctx, particles, raf, last }

/**
 * Hand-rolled confetti on one fixed canvas, removed when the last particle fades.
 * Burst: from (x, y) upward with gravity. Shower: falls from the top of the screen.
 */
function confetti({ x = 0, y = 0, count = 40, shower = false } = {}) {
  if (prefersReducedMotion()) return;
  if (!confettiLayer) {
    const canvas = document.createElement("canvas");
    canvas.className = "confetti";
    canvas.setAttribute("aria-hidden", "true");
    document.body.append(canvas);
    confettiLayer = { canvas, ctx: canvas.getContext("2d"), particles: [], raf: 0, last: performance.now() };
    sizeConfetti();
    confettiLayer.raf = requestAnimationFrame(tickConfetti);
  }
  const vw = window.innerWidth;
  const rand = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < count; i++) {
    const angle = shower ? rand(80, 100) * (Math.PI / 180) : rand(-150, -30) * (Math.PI / 180);
    const speed = shower ? rand(0.05, 0.22) : rand(0.28, 0.72); // px/ms
    confettiLayer.particles.push({
      x: shower ? rand(0, vw) : x,
      y: shower ? rand(-80, -10) : y,
      vx: Math.cos(angle) * speed + (shower ? rand(-0.05, 0.05) : 0),
      vy: Math.sin(angle) * speed,
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.012, 0.012),
      size: rand(5, 9),
      shape: ["square", "circle", "star"][i % 3],
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      age: 0,
      ttl: shower ? rand(2200, 3000) : rand(950, 1300),
      wobble: rand(0, Math.PI * 2),
    });
  }
}

/** Match the confetti canvas to the viewport. DPR capped at 1.5: tiny moving specks
    don't need retina resolution, and it halves the pixels to clear and composite. */
function sizeConfetti() {
  const layer = confettiLayer;
  layer.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  layer.canvas.width = Math.round(window.innerWidth * layer.dpr);
  layer.canvas.height = Math.round(window.innerHeight * layer.dpr);
  layer.dirty = null;
}

// Unit shapes (size 1), scaled per particle with setTransform. The star is ✦.
const STAR_PATH = (() => {
  const path = new Path2D();
  for (let k = 0; k < 8; k++) {
    const r = k % 2 === 0 ? 0.75 : 0.2;
    const a = (k * Math.PI) / 4;
    path.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  path.closePath();
  return path;
})();
const CIRCLE_PATH = (() => {
  const path = new Path2D();
  path.arc(0, 0, 1 / 2.4, 0, Math.PI * 2);
  return path;
})();

/** One confetti frame: physics, then draw. Only the area the particles covered
    last frame is cleared, and each particle is a single setTransform + fill. */
function tickConfetti(now) {
  const layer = confettiLayer;
  const dt = Math.min(32, now - layer.last);
  layer.last = now;
  const { ctx, particles, dpr } = layer;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (layer.dirty) {
    const d = layer.dirty;
    ctx.clearRect(d.x0 * dpr, d.y0 * dpr, (d.x1 - d.x0) * dpr, (d.y1 - d.y0) * dpr);
  }

  const GRAVITY = 0.0011; // px/ms²
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.ttl) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += GRAVITY * dt;
    p.vx *= 0.992;
    p.vy *= 0.992;
    p.wobble += dt * 0.008;
    p.x += (p.vx + Math.sin(p.wobble) * 0.02) * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;

    const life = p.age / p.ttl;
    ctx.globalAlpha = life < 0.7 ? 1 : 1 - (life - 0.7) / 0.3;
    const k = p.size * dpr;
    const cos = Math.cos(p.rot) * k;
    const sin = Math.sin(p.rot) * k;
    ctx.setTransform(cos, sin, -sin, cos, p.x * dpr, p.y * dpr);
    ctx.fillStyle = p.color;
    if (p.shape === "circle") ctx.fill(CIRCLE_PATH);
    else if (p.shape === "star") ctx.fill(STAR_PATH);
    else ctx.fillRect(-0.5, -1 / 3, 1, 2 / 3);
    if (p.color === "#FFFFFF") {
      // White pieces need an edge to read on the cream background.
      ctx.strokeStyle = "rgba(191, 195, 199, .9)";
      ctx.lineWidth = 0.8 / p.size;
      if (p.shape === "square") ctx.strokeRect(-0.5, -1 / 3, 1, 2 / 3);
      else ctx.stroke(p.shape === "star" ? STAR_PATH : CIRCLE_PATH);
    }
    const r = p.size;
    box.x0 = Math.min(box.x0, p.x - r);
    box.y0 = Math.min(box.y0, p.y - r);
    box.x1 = Math.max(box.x1, p.x + r);
    box.y1 = Math.max(box.y1, p.y + r);
  }
  ctx.globalAlpha = 1;
  layer.dirty = particles.length ? { x0: box.x0 - 2, y0: box.y0 - 2, x1: box.x1 + 2, y1: box.y1 + 2 } : null;

  if (particles.length) {
    layer.raf = requestAnimationFrame(tickConfetti);
  } else {
    layer.canvas.remove();
    confettiLayer = null;
  }
}

window.addEventListener("resize", () => confettiLayer && sizeConfetti());
