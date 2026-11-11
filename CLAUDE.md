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

### Step 1: static layout
- Built: index.html, style.css, app.js. Renders from data.js: header (eyebrow,
  serif title with ✦, dynamic gift count), 4-tile dashboard (Total budget,
  Spent, Remaining, Wrapped with progress bar), category filter chips (visual
  only), card grid, footer. Only the Shop links are interactive.
- Layout: page max width 1200px, gutters 16px (<1024px) / 32px (≥1024px),
  all with env(safe-area-inset-*) fallbacks. Stats 2×2 under 768px, 4 across
  at 768px+. Grid 1 col <640px, 2 cols 640–1023px, 3 cols 1024px+.
- Decisions:
  - Spent = sum of (paid ?? price) for ordered + wrapped items; currency via
    Intl.NumberFormat en-US with no cents.
  - Placeholder image: per-category pastel gradient (.card__media--<category>)
    with a frosted circular "plate" and faint ring behind the emoji. The emoji
    scales with card width using container query units (fallback 72px).
  - Stat tiles share one row height (grid-auto-rows: 1fr) so captions align.
  - In 2- and 3-column grids, card names reserve two lines so prices and notes
    line up across a row; single-column mobile doesn't reserve the space.
  - Filter chips scroll edge to edge on mobile with a mask-image fade and no
    scrollbar; at 1024px+ they wrap and center, with no fade.
  - Active chip is ink-filled. Wrapped progress bar fills blush → success.
  - Subtle motion only: staggered card rise on load, hover lift on cards,
    nudge on the Shop arrow. All of it is disabled under prefers-reduced-motion.
  - All text from data goes through escapeHtml; links only allow http(s), and
    every link opens with target=_blank rel="noopener noreferrer".
  - No localStorage yet (nothing to persist in this step).
- Known issues:
  - Contrast: --blush-deep (#C98591) on white is ~2.9:1, below WCAG AA (4.5:1)
    for the Shop button text and the Wrapped pill. It's kept as specified in
    the design system; consider a darker accent-text token later.
  - Filter chips are <button>s with aria-pressed but do nothing yet.
  - The edge fade on the chip row is always on below 1024px, even when the
    row is scrolled to its end.

### Step 2: state, status, filters, persistence
- Built:
  - `state` = { items, filter, status, sort }. `status` is the status-filter
    row: an extra field beside the requested { items, filter, sort }.
  - Items load from localStorage "juliana-wishlist-v1" (a JSON array). If the
    key is missing, invalid or fails validation, the app deep-copies seedItems.
  - save() runs after every change; render() drives everything from state.
  - Status pill: tap cycles the four statuses; long-press (500ms) or
    right-click opens a picker.
  - Paid input on Ordered/Wrapped cards, with a "Saved $X" badge.
  - Dashboard updates live.
  - Category and status filter rows with faceted counts, plus a sort select.
  - ⋯ settings menu → "Reset to original list", confirmed in a <dialog>.
  - Storage banner; empty state; cross-tab sync via the `storage` event.
- Decisions:
  - Storage: createStore() probes localStorage once. Every read/write is in
    try/catch, with an in-memory copy as fallback. If storage is unavailable
    at load, or a later write throws (e.g. quota), a dismissible banner says
    changes won't survive closing the tab. Validation checks every field's
    type, the status enum, non-negative prices and unique ids.
  - Rendering: card elements are created once per id and patched in place
    (setText/setAttr/setClass/setHidden only write when a value changes). The
    grid's children are only replaced when membership or order changes, and
    focus is put back afterwards. Bug found in testing: re-assigning the
    pill's textContent on every render made Chrome drop a click that started
    while a paid input was focused (the blur saved and re-rendered between
    pointerdown and pointerup). Change-only writes fixed it.
  - Event delegation on #grid handles pill click/contextmenu/pointerdown,
    paid keydown/focusout, and the empty state's "Show all gifts".
  - Long-press: after it opens the picker, the release's click is suppressed;
    moving more than 10px or a pointercancel (scroll) aborts it. The pill has
    -webkit-touch-callout:none and user-select:none so iOS doesn't show its
    own callout, plus a ::after hit area for a larger touch target.
    Shift+F10 / the ContextMenu key open the picker from the keyboard.
  - Popover (shared by the status picker and settings): role=menu with
    menuitemradio items; arrow keys, Home/End, Escape and Tab work; it closes
    on outside press or resize. Pressing the anchor while it's open just
    closes it. Focus goes back to the anchor before the action runs, so the
    reset dialog returns focus to ⋯ when it closes.
  - Paid: accepts "118", "$1,200.50" etc. and rounds to cents. Empty clears
    it (null → the estimate counts). Invalid or negative input reverts.
    Escape reverts; Enter or blur saves. The value is kept when the status
    leaves Ordered/Wrapped (it just stops counting), so cycling past by
    accident doesn't lose it. Saved badge shows only when paid < estimate;
    cents appear only when non-zero ("Saved $9.75"). Dashboard stays
    whole-dollar.
  - Spent caption is "N of 14 bought". Remaining = Total − Spent, so it goes
    up when you pay under the estimate.
  - Filter counts are faceted: category counts respect the status filter and
    vice versa. Zero-count chips are muted but still clickable. Active chips
    are blush with ink text. Tapping a chip near the edge of its row scrolls
    it into view.
  - Sort ties fall back to the original list order (stable).
  - Reset also resets filters and sort to defaults.
  - The page-load card entrance (Step 1) now runs on first paint only, via
    .grid.is-entering, so re-renders don't replay it. Everything else is
    plain CSS transitions (pill colours, chips, progress bar width).
  - Inputs and the sort select are 16px on mobile to stop iOS zoom-on-focus.
  - Screen readers: pill aria-label "Status: X. Tap to change." plus an
    aria-describedby hint about long-press. A polite live region announces
    status/paid changes, and the result count is aria-live.
- Tested (Playwright, 81 checks, all passing):
  - Lululemon → Ordered, paid $118: Spent $118, Remaining $16,363, "Saved
    $10". Survives a reload.
  - Wrapped → 1/14 and a 7% bar; full cycle back to Wishlist; paid kept.
  - Keyboard cycling.
  - Right-click, mouse long-press and real CDP touch long-press on iPhone 13
    emulation: none of them cycles on release.
  - Paid edge cases (commas/$, cents, invalid, negative, Escape, Tab, clear).
  - Tapping another pill while an input is focused: both actions land.
  - All 225 category × status × sort combinations match an independently
    computed order, with the empty state where expected.
  - Chip counts; "Travel 3"; active chip colours.
  - Reset: Cancel keeps data; confirming restores seed data in storage.
  - Corrupt/invalid storage falls back to seed data.
  - localStorage that throws: banner shows and the app works in memory.
  - Quota error on save: banner appears.
  - No horizontal overflow at 390px; no console errors.
- Known issues:
  - --blush-deep text contrast (~2.9:1) is still below AA (Shop button,
    Wrapped pill, menu check).
  - The chip-row edge fade still shows when the row is scrolled to its end.
  - iOS Safari long-press was tested in Chromium touch emulation, not on a
    real iPhone.

### Step 3: item management, photos, backup
- Built:
  - Floating blush "+" button (safe-area aware) → item sheet in "add" mode.
  - Shared add/edit sheet: a bottom sheet on phones, a centered 520px dialog
    from 768px.
  - Card "⋯" menu with Edit / Delete; Delete has a 6s "Item removed · Undo"
    toast.
  - Photos: upload (resized on a canvas) or image URL. Cards show them
    object-fit: cover with a fade-in; broken URLs fall back to the emoji.
  - Settings ⋯ menu: Export backup / Import backup… / Reset.
  - Empty-list state ("A blank page" + Add a gift).
- Decisions:
  - Sheet = a full-screen transparent <dialog> containing its own scrim and
    panel (not ::backdrop), so both can be animated and dragged.
    showModal() gives native focus containment and Esc. Esc is intercepted
    (when cancelable) so it animates out. Focus returns to the trigger (the
    card ⋯, the FAB or the empty-state button), falling back to the FAB.
  - Swipe to close: only the sheet header (handle + title) is draggable, with
    touch-action:none, so scrolling the form never fights the gesture. It
    closes past 30% of the sheet's height or on a downward flick
    (> 0.5 px/ms); otherwise it springs back. Backdrop tap closes.
  - Focus on open: desktop "add" focuses Name; phones focus the sheet title
    so the keyboard doesn't jump up over the opening animation.
  - Fields: Name (required), Category (select), Estimated price (required;
    text + inputmode=decimal, so "$1,250" is accepted), Link (optional;
    "rimowa.com/x" becomes "https://rimowa.com/x" on blur), Notes, Status
    (segmented control of real radio buttons), Paid (shown only for
    Ordered/Wrapped; its placeholder mirrors the estimate), Photo.
  - Validation messages appear after a field is blurred; Save stays disabled
    until valid and while an upload is processing. Enter in a single-line
    field moves to the next field rather than submitting.
  - New ids: slug of the name + 4 random chars (e.g. "silk-scarf-blush-k3f9").
    New gifts go at the end of the list. If a new or edited gift wouldn't
    match the current filters, the filters reset so it's visible.
  - Delete: focus moves to the next card's ⋯ (else the previous card, else
    the FAB). Undo re-inserts at the original index. One undo slot: a newer
    delete replaces the toast.
  - Photos: resizeImage() draws onto a white-filled canvas (flattens PNG
    transparency), max 800px on the long edge, JPEG quality 0.8, stored as a
    data URL. Only http(s) URLs and raster data:image URLs are rendered
    (safeImageSrc). Image load/error events are captured at the document
    level, so card photos need no per-card listeners.
  - Storage quota: store.write() now returns "ok" | "quota" | "unavailable".
    A quota error no longer marks storage unavailable. In the sheet, the edit
    is rolled back and the sheet stays open with a message suggesting image
    URLs. Elsewhere a toast explains it.
  - Backup format: { app, version: 1, exportedAt, items }, pretty-printed,
    named juliana-wishlist-YYYY-MM-DD.json (local date). Import also accepts
    a bare items array. It validates with the same isValidItems() as
    loading, previews the count and export date, and confirms in a shared
    confirm dialog (reset uses it too). A quota failure rolls back. Import
    and reset both reset filters and sort.
  - Storage banner moved inline to the top of the page, so it can't collide
    with the toast and FAB.
- Tested (Playwright: 78 new checks + the 81 Step 2 checks, all passing):
  - Validation messages and the disabled Save.
  - Upload of a 3000×2000 JPEG → an 800×533 JPEG data URL, shown on the card
    with alt text.
  - Non-image upload error.
  - Broken image URL → emoji fallback.
  - Edit price + notes.
  - Delete → Undo restores the exact order; without Undo the toast leaves
    after 6s.
  - Export filename and content are byte-identical to storage.
  - Reset → import (bad files rejected, cancel keeps data) → everything comes
    back identical, photos included, and survives reload.
  - Simulated QuotaExceededError on a photo save.
  - iPhone 13: sheet docked to the bottom; backdrop tap closes; a slow short
    drag springs back; a quick flick and a long drag both close; focus
    returns to the FAB.
- Known issues:
  - Uploaded photos live in localStorage (~5MB per site), so roughly a few
    dozen photos at most. IndexedDB would remove that ceiling.
  - Export uses an <a download> blob. In an iOS home-screen web app this can
    open a preview rather than save a file (revisit with the Web Share API
    in Step 6).
