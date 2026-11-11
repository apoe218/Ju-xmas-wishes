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
  Considering = #FFF1D6 / #86590C; Ordered = #E3ECF7 / #3E6496;
  Wrapped = blush-tint / blush-ink.
- Accent text + focus rings use --blush-ink: #95505E (added in Step 5: blush-deep
  text was only 2.5–2.9:1). Keep --blush-deep for decorative glyphs/borders only.
  All text meets WCAG AA (≥ 4.5:1).
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

## Motion principles
- Durations: 150–250ms for micro-interactions, 300–450ms for layout changes.
- Easing: cubic-bezier(.2,.8,.2,1) for entrances, a gentle spring feel for sheets.
- Animate only transform and opacity for performance.
- Everything non-essential is disabled under prefers-reduced-motion: reduce.
- In code: EASE_OUT / SPRING / DUR_MICRO / DUR_LAYOUT / TWEEN_MS in app.js,
  --ease-out / --spring / --dur-micro / --dur-layout in style.css. JS checks
  prefersReducedMotion() before every animation; CSS has a global
  reduced-motion override.

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

### Step 4: motion and animation
- Built:
  - Page entrance: header fades up, then tiles stagger 60ms, then cards stagger
    40ms (capped so the last starts by 600ms), each rising 12px.
  - Dashboard numbers tween over 600ms with easeOutCubic. The Wrapped tile is
    now an SVG progress ring ("X / 14 wrapped").
  - FLIP for filter/sort/add/delete/undo.
  - Status pill pulse.
  - The wrapped moment: confetti burst + satin ribbon and bow, then the card
    glides into a new "Wrapped 🎁" section.
  - "Every gift is wrapped ✦" banner + confetti shower.
  - Card hover lift / press compress; press-down on buttons; toast slides up
    with a time-left hairline; photo shimmer.
- Decisions:
  - One FLIP pipeline: render() measures every card first, updates everything,
    then playFlip(). Cards that left get an inert, aria-hidden clone (a
    "ghost") that fades + scales to .96 where the card was. The real element
    stays cached, so a quick filter toggle can't fight a running exit.
    Entering cards fade/scale in. Only cards on screen (±40px) animate;
    off-screen ones snap. That keeps the commit cheap on long lists.
  - No animation on first render (motionReady=false): the entrance owns page
    load. An inline head script hides only the header until app.js adds
    .is-ready; a 2.5s fallback means content can't stay hidden if JS fails.
  - Wrapped section: wrapped cards render into #wrapped-grid after the main
    grid. A card that just became Wrapped stays in place for 900ms
    (pendingWrap) for the ribbon + confetti, then a normal render
    FLIP-glides it down. Card event delegation moved to the #gifts section so
    it covers both grids. With the status filter on "Wrapped", the main grid
    hides and only the section shows.
  - Ring progress animates stroke-dashoffset through the same rAF tween as the
    numbers. That's a deliberate exception to "transform/opacity only": the
    ring is one tiny SVG.
  - Confetti: one fixed <canvas> (DPR ≤ 2), created on demand and removed
    when the last particle fades. Squares, circles and ✦ stars in blush,
    blush-deep, silver and white (white gets a silver edge so it reads on
    cream), with gravity, drag, wobble and rotation. Burst = 40 particles,
    ~1.2s; shower = 140 particles, ~2.5s.
  - Ribbon: inline SVG per card with shared gradients (#satin, #satin-bow,
    #sheen) defined once in index.html. Static on wrapped cards; on the
    moment the band scales in from the corner, a sheen sweeps across and the
    bow springs in. Wrapped cards are muted (cream background, desaturated
    image).
  - Toast: the hairline's WAAPI animation is the dismiss timer, so hovering
    or focusing the toast pauses it. Centred with margin:auto so transforms
    stay free for the slide.
  - Sheet: spring open (cubic-bezier(.22,1.2,.36,1)); drag follows the finger
    and closes on velocity (from Step 3).
  - Reduced motion: no entrance, tweens, FLIP, ghosts, confetti, ribbon draw,
    toast/sheet animation or shimmer movement. Wrapped cards move to their
    section immediately with a static ribbon.
- Tested:
  - Motion suite (48 checks): entrance delays, tween mid-values, ring, pill
    pulse keyframes, FLIP ghosts/glides/entrances, the full wrapped moment
    (canvas appears and is removed, card holds then moves), all-wrapped
    banner + shower, toast hairline + hover pause, shimmer with a delayed
    image, mobile press, sheet spring, and the reduced-motion behaviour.
  - Steps 2–3 suites still pass (81 + 78), now run with reduced motion so
    assertions don't race the tweens.
  - Chrome CPU throttling 4x, iPhone 13 emulation, median of 3 trials:
    animations hold 60fps (p95 frame 16.8ms) for filter, unfilter, sort, the
    wrapped moment and the sheet. The only long frames are the render
    commits when you tap: 0–2 frames of 50–100ms throttled (~12–25ms on a
    real phone). Culling FLIP to on-screen cards cut the filter commit from
    133ms to ≤50ms throttled.
- Known issues:
  - Sort/filter commits still re-insert every card (replaceChildren), so very
    long lists would cost more per tap.
  - The ring animates stroke-dashoffset (paint, not composite) — fine at
    this size.

### Step 5: polish and QA
- Before → after:
  - Contrast: Shop text, Wrapped pill and menu checks were blush-deep on
    white/tint (2.5–2.9:1) → new --blush-ink #95505E (4.98–5.85:1).
    Considering pill #9A6B12 (4.19:1) → #86590C (5.45:1). All text pairs are
    now AA.
  - Focus ring: blush-deep at 2.7:1 vs cream → blush-ink at 5.5:1, one 2px
    ring everywhere. Chips' ring hugs the visible pill.
  - Touch targets: chips 38/34px, sort 36px, icon buttons 40px, menu items
    40px, paid field 40px, segmented 40px, small buttons 36px → every control
    is ≥ 44×44. Chips use a transparent border, because a pseudo-element hit
    area was clipped by the scroll container (found with an elementFromPoint
    probe). Menu items got a 2px gap so adjacent targets never touch.
  - Desktop chips: they wrapped with "Home" orphaned on its own row (1440) or
    split 7+2 (1024) → one row that scrolls with edge fades below 1240px, and
    a centred single line from 1240px.
  - Dashboard: "$144,981" overflowed 4-up tiles at 768px → value font sized by
    container units and the longest amount's length (--chars), shared by all
    three money tiles. On 2-up phone tiles the ring's caption hides (a
    container query), so the ring never squeezes text into three lines.
  - Spacing: ~20 off-scale values (6/10/11/14/18px) snapped to the 4–64px
    scale. Radius tokens --r-md (16) and --r-sm (8) for menus, banners and
    items.
  - Empty states: filter → serif "Nothing here yet ✦" + "No gifts match Bags ·
    Wrapped." + "Show all" (focus moves to the Gifts heading). Empty list → "A
    blank page ✦" + Add a gift. Storage banner copy now suggests Export.
  - Screen readers:
    - A separate polite live region for totals ("Spent now $128.").
    - Hint and live paragraphs moved inside <main> (axe "region").
    - "Skip to the gifts" link; the FAB moved early in the tab order (skip →
      settings → add → filters → cards).
    - The Shop link's accessible name includes the shop's domain.
  - Details:
    - Paper grain (inline feTurbulence SVG, 3%, fixed under content).
    - Sticky filter bar that turns frosted (backdrop blur + hairline) once the
      header scrolls away, via an IntersectionObserver sentinel.
    - Domain hint under each Shop button ("rimowa.com", "loropiana.com";
      www./shop./us. stripped).
    - Gift-box favicon in blush and silver.
    - Card :focus-within matches :hover (lift + deeper shadow).
  - Code: no unused functions, els refs or CSS classes (checked by script).
    One-line comments on every major function.
- Tested:
  - New QA suite (33 checks), all passing:
    - axe-core WCAG 2.1 A/AA + best-practice with zero violations (page and
      open sheet).
    - Real hit-area probe on every visible control (phone, grid, sheet,
      menu).
    - Tab order and the focus-ring colour on 16 stops; skip link.
    - Live announcements; all three empty/edge states; domain hints;
      favicon; grain; sticky/frosted bar.
    - Sweep at 375/390/430/768/1024/1440 with a stress list (122-char name,
      $128,500 price, empty notes, every status): no overflow, one-line
      dashboard values, unclipped chips and pills, names clamped to 2 lines,
      even tile heights.
  - All earlier suites still pass (81 + 78 + 48), with no console errors.
  - Totals: 240 automated checks.
- Top 5 ideas (not built):
  1. Move photos (and maybe the list) to IndexedDB: no ~5MB ceiling, and
     saves don't re-serialise every photo on each tap.
  2. Optional sync between devices (e.g. a private GitHub Gist or a tiny
     backend) so the iPhone and laptop share one list instead of
     export/import.
  3. Per-gift reminders and a "buy by" date with a gentle countdown (and an
     "ordered but not arrived" nudge), possibly as .ics calendar files.
  4. Price watch: store a target price and highlight when the paid price beats
     it; show "saved so far" across the whole list.
  5. Gift-giving mode: a hidden-from-Juliana share link / PIN lock, plus a
     print-friendly checklist for wrapping night.
