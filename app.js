import { seedItems } from "./data.js";

// ---------- Constants ----------

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

const STATUS_LABELS = {
  wishlist: "Wishlist",
  considering: "Considering",
  ordered: "Ordered",
  wrapped: "Wrapped",
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// ---------- Helpers ----------

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
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

// ---------- Stats ----------

function computeStats(items) {
  const total = items.reduce((sum, item) => sum + item.price, 0);
  const spent = items
    .filter((item) => item.status === "ordered" || item.status === "wrapped")
    .reduce((sum, item) => sum + (item.paid ?? item.price), 0);
  const wrapped = items.filter((item) => item.status === "wrapped").length;
  return { total, spent, remaining: total - spent, wrapped, count: items.length };
}

// ---------- Render ----------

function renderSubtitle(items) {
  const n = items.length;
  document.getElementById("subtitle").textContent =
    `${n} ${n === 1 ? "gift" : "gifts"} · curated from her Pinterest board`;
}

function renderStats(items) {
  const s = computeStats(items);
  const pct = s.count ? Math.round((s.wrapped / s.count) * 100) : 0;

  const tile = (label, value, caption, extra = "") => `
    <div class="stat">
      <p class="stat__label">${label}</p>
      <p class="stat__value">${value}</p>
      ${extra}
      <p class="stat__caption">${caption}</p>
    </div>`;

  document.getElementById("stats").innerHTML = [
    tile("Total budget", currency.format(s.total), "Estimated, all gifts"),
    tile("Spent", currency.format(s.spent), "Ordered + wrapped"),
    tile("Remaining", currency.format(s.remaining), "Still to buy"),
    tile(
      "Wrapped",
      `${s.wrapped}<span class="stat__of"> / ${s.count}</span>`,
      `${pct}% ready to give`,
      `<div class="progress" role="progressbar" aria-label="Gifts wrapped"
            aria-valuemin="0" aria-valuemax="${s.count}" aria-valuenow="${s.wrapped}">
         <span class="progress__fill" style="width:${pct}%"></span>
       </div>`
    ),
  ].join("");
}

function renderFilters() {
  const chips = [{ name: "All", emoji: "" }, ...CATEGORIES].map(
    (c, i) => `
      <button type="button" class="chip${i === 0 ? " is-active" : ""}"
              aria-pressed="${i === 0}">
        ${c.emoji ? `<span class="chip__emoji" aria-hidden="true">${c.emoji}</span>` : ""}
        <span>${c.name}</span>
      </button>`
  );
  document.getElementById("filters").innerHTML = chips.join("");
}

function cardHtml(item, index) {
  const status = STATUS_LABELS[item.status] ? item.status : "wishlist";
  const href = safeUrl(item.link);
  const cat = escapeHtml(item.category);

  return `
    <article class="card" style="--i:${index}">
      <div class="card__media card__media--${slug(item.category)}">
        <span class="card__emoji" aria-hidden="true">${EMOJI[item.category] ?? "🎁"}</span>
      </div>
      <div class="card__body">
        <div class="card__meta">
          <span class="card__category">${cat}</span>
          <span class="pill pill--${status}">${STATUS_LABELS[status]}</span>
        </div>
        <h3 class="card__name">${escapeHtml(item.name)}</h3>
        <p class="card__price">${currency.format(item.price)}</p>
        ${item.notes ? `<p class="card__notes">${escapeHtml(item.notes)}</p>` : ""}
        ${
          href
            ? `<a class="btn btn--outline" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
                 Shop <span class="btn__arrow" aria-hidden="true">↗</span>
                 <span class="visually-hidden">${escapeHtml(item.name)} (opens in a new tab)</span>
               </a>`
            : ""
        }
      </div>
    </article>`;
}

function renderGrid(items) {
  document.getElementById("grid").innerHTML = items.map(cardHtml).join("");
}

// ---------- Init ----------

const items = seedItems;
renderSubtitle(items);
renderStats(items);
renderFilters();
renderGrid(items);
