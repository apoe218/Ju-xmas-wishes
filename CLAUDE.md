# CLAUDE.md

## Project goal
A gift tracker for Juliana's Christmas wishlist: see every item, its price,
where to buy it, and its status (Wishlist → Considering → Ordered → Wrapped),
with a dashboard of budget vs. spent.

## Tech rules
- Vanilla HTML/CSS/JS only. Files: index.html, style.css, app.js, data.js.
  No frameworks, no bundler, no npm, no build step.
- All app files live at the repo root (GitHub Pages serves from the root of the
  branch; there is no /docs folder).
- ALL asset paths must be relative (./style.css, not /style.css) because
  GitHub Pages serves this from a subpath.
- Google Fonts is the only allowed external resource.
- Use ES modules (type="module") for app.js and data.js.
- Every localStorage access is wrapped in try/catch with an in-memory fallback.
- Commit after every step with a clear message (e.g. "Step 1: static layout").
  Do not push unless I say so.

## Design system
- Mood: soft luxury, like a curated Pinterest board. Calm, airy, elegant.
- Colors (as CSS custom properties in :root):
  --bg: #FAF7F2 (warm cream)
  --surface: #FFFFFF
  --ink: #1C1A19 (near-black text)
  --ink-soft: #6B6560 (secondary text)
  --blush: #E8B4BC (primary accent)
  --blush-deep: #C98591 (accent text/hover)
  --blush-tint: #F8E9EB (pale pink fills)
  --silver: #BFC3C7
  --silver-tint: #EEF0F2
  --line: #ECE6DF (hairline borders)
  --success: #8FB89A (wrapped/done)
- Status colors: Wishlist = silver-tint bg / ink-soft text;
  Considering = #FFF1D6 / #9A6B12; Ordered = #E3ECF7 / #3E6496;
  Wrapped = blush-tint / blush-deep.
- Typography: headings in "Cormorant Garamond" (600, slightly tight letter
  spacing); body and UI in "Inter" (400/500/600). Base 16px, line-height 1.5.
  Prices use tabular numbers (font-variant-numeric: tabular-nums).
- Shape: cards 20px radius, buttons and pills fully rounded, inputs 12px radius.
- Shadows: soft and layered, e.g.
  0 1px 2px rgba(28,26,25,.04), 0 8px 24px rgba(28,26,25,.06).
- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64px.
- Accents: small ✦ sparkle glyphs used sparingly (title, empty states, wrapped).
- Mobile-first at 390px wide (iPhone), then tablet 768px, desktop 1200px max width.
- Category emoji: Tech 📱, Travel 🧳, Bags 👜, Shoes 👟, Beauty 💄,
  Accessories 🕶️, Clothing 🧥, Home 🏠.

## Progress log
(Update at the end of every step: what was built, decisions made, known issues.)

### Step 0: project brief and seed data
- Built: CLAUDE.md (this brief) and data.js exporting `seedItems`, 14 items,
  total list price $16,481.
- Decisions: the repo was empty (no commits, no /docs, no CNAME, no Pages
  workflow), so all app files live at the repo root. Item ids are short, stable
  slugs (e.g. "lulu-jacket"). Every item starts as status "wishlist",
  paid null, image null.
- Known issues: GitHub Pages' source branch/folder can't be confirmed from the
  repo itself. Check Settings → Pages and make sure it points at the branch
  the app ends up on, folder "/ (root)". Work is currently on branch
  `claude/dreamy-ritchie-81dbso`.
