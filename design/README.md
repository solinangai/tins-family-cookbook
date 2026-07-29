# Handoff: Tin's Family Cookbook (mobile web app)

## Overview
A bilingual (English-first, 繁體中文 second) family recipe app for phones. It replaces an
existing single-file app (`uploads/Cookbook/Family Cookbook.html`) that already holds 43 family
recipes. This handoff covers a redesigned UI and reworked navigation, plus new features:
favourites, a shopping list, a market card, a step-by-step cook mode, per-device text size,
and add/edit-a-dish with automatic extraction from a recipe URL or YouTube link.

Primary users: parents / older relatives, the family helper, and the owner. Used at the market,
at the stove, on the sofa, and at a desk. Design bias throughout: large tap targets, high
contrast, English primary with Chinese as a smaller secondary line.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype of the
intended look and behaviour, not production code to copy verbatim. The task is to **recreate
these designs in the target environment**. The intended deployment target is a Google Apps
Script web app (see `DEPLOY.md`), i.e. a single `index.html` served by `Code.gs`; if the project
moves to a framework later, follow that framework's patterns rather than porting this markup.

`Tin's Family Cookbook.dc.html` uses a small in-house template runtime (`<sc-for>`, `<sc-if>`,
`{{ }}` holes, a `Component` logic class). **Do not port the runtime.** Read it as a spec: the
logic class is plain JS and maps 1:1 onto component state; the markup is all inline styles.

## Fidelity
**High-fidelity.** Colours, type, spacing and interactions are final. Recreate pixel-for-pixel.
The one deliberate abstraction: all sizes are in `em` relative to a root `font-size` that the
user controls (see *Text size*), so nothing is hard-coded in px except that root value.

## Design tokens

### Colour (CoHee palette)
| Token | Hex | Use |
|---|---|---|
| CoHee Yellow | `#F7C948` | Every primary filled button, active toggles, avatar, cook-mode progress. Text on it is always Charcoal. |
| Yellow hover | `#EFBB2C` | Hover on all yellow fills |
| Cat Charcoal | `#4A4A46` | Body text, button text on yellow |
| Cream | `#FFFBEE` | Card / input surfaces |
| Page ground | `#FAF2DD` | App background (a touch deeper than card cream) |
| Outer ground | `#EFE6CF` | Desktop letterbox behind the 440px column |
| Roast Brown | `#8A5A33` | Uppercase eyebrows, section rules, step numbers, active tab, links |
| Warm Pop | `#E5734F` | Saved/favourite heart only |
| Line | `#EADFC2` | 1px borders |
| Chip fill | `#F5E9CC` | Meta chips (time / serves) |
| Muted text | `#87806F` | Tertiary meta text |
| Chinese text | `#7A6A52` | Secondary Chinese line (≥4.5:1 on cream) |
| Placeholder ground | `#F0E6CF` | Image slot before load |
| Olive | `#6B7A45` | Shopping-list tick + "add all" |
| Dark ground | `#35352F` | Cook mode background |
| Dark rule / border | `#5C5C55`, `#63635B` | Cook-mode inactive bars, ghost buttons |
| Dark body text | `#C9C6BB` | Cook-mode Chinese line |

Rules of thumb, kept consistently: **yellow = do something**, **brown = label something**,
**warm pop = one saved-state accent only**, never yellow text on cream (fails contrast).

### Typography
- Display / body: **Newsreader** (Google), 400/500. Warm, characterful, readable at size.
- Chinese: **Noto Serif TC**, always one step smaller and in `#7A6A52` — secondary, never below 14px equivalent.
- UI labels, buttons, eyebrows, meta: **Instrument Sans** 600/700; eyebrows uppercase, `letter-spacing:.14em–.18em`, `font-size:.66–.72em`.
- Line-height: 1.15 titles, 1.45 body, 1.5–1.55 Chinese body.

### Text size (per device, persisted)
Root font-size on the app container. Everything else is `em`.
| Name | Root px |
|---|---|
| Small | 14 |
| Medium (default) | 16 |
| Large | 18.5 |
| Largest | 21 |

At Large and above the home grid collapses from 2 columns to 1 (`gridCols`), and cards switch
to a horizontal thumbnail + text layout.

### Shape & elevation
- Cards, sheets: radius `1em` (cards), `1.4em` (bottom sheet top corners), `.75em` (rows/inputs), `.85em` (buttons), `1.7em` (pills/search).
- Borders: 1px `#EADFC2`. Cards get `border-color:#F7C948` on hover.
- One shadow in the app: the "+" FAB, `0 6px 16px rgba(247,201,72,.55)`.
- Animations: sheet `rise .22s cubic-bezier(.2,.8,.3,1)`, scrim `fade .16s ease-out`, toggles `.2s`.

### Layout
Single column, `max-width:440px`, full `100dvh`, centred; internal padding `1.25em`.

## Screens

### 1. Home
Purpose: find a dish fast.
- **Header** — eyebrow `WEDNESDAY · WHAT'S COOKING?` (Roast Brown, uppercase); title "Tin's Family Cookbook" at `1.42em`, one line, `margin-top:.4em`; tagline "Made with love for our home kitchen" italic `.86em` muted. Right: 2.4em circular yellow avatar (媽) → Family.
- **Search + filter row** — cream pill input (placeholder "Search"); to its right a yellow pill showing the current course + `▼`, opening the course sheet. This is the whole navigation for filtering: nothing is hidden off-screen behind a swipe.
- **Result rule** — eyebrow "SOUPS · 7 DISHES" with a hairline; sticky to the scroll container.
- **Card grid** — 2 columns (1 at Large+), gap `.85em`. Card: 6.5em cover image, heart top-right (Warm Pop when saved, `#DCCFAF` when not), title `1.05em`, Chinese `.87em`, meta `.74em` (`time · serves n`).
- **Empty state** — "Nothing here yet. Try another course, or tap + to add a dish."
- **Bottom tab bar** — Cook · Saved · **+** (yellow FAB, overlapping −1.3em) · Shopping (count badge) · Family. Inactive `#A0947E`, active and hover Roast Brown.

### 2. Course sheet
Bottom sheet over a `rgba(45,42,38,.45)` scrim. Grab handle, "COURSE" eyebrow, one row per course
(All 43 / Breakfast 6 / Lunch 8 / Soup 8 / Appetiser 4 / Main 14 / Sweet 3) showing the count, or a
`✓` in Roast Brown when selected. Yellow CTA at the bottom: "Show N dishes".

### 3. Recipe
- 13.5em cover with a top gradient band; **‹ Back** pill (2.8em tall, `rgba(20,16,12,.72)`, 1px light border) and, on the right, heart + **Edit** pill.
- Title `1.6em`, Chinese `1.12em`, three chips (time / serves / provenance).
- Actions: yellow **Start cooking** + a ghost **▶ Video** link to YouTube.
- **Ingredients** — one cream row each: emoji, English + Chinese (tap either → market card), and a right-hand `+ LIST` / `ON LIST` chip. Section rule has "+ Add all" in olive.
- **Method** — numbered `01`, `02`… in Roast Brown, English then Chinese.
- **Family note** — italic, 2px Roast Brown left rule.

### 4. Cook mode
Full-screen `#35352F`. Top: "✕ Exit", a segmented progress bar (`#F7C948` done / `#5C5C55` to go), "3/5".
Body: dish name in yellow uppercase, the step at `1.75em`, Chinese at `1.3em` in `#C9C6BB`.
Bottom: ghost `‹` (4.4em wide) + yellow **Next step**; the last step reads "Done — 好味！", returns
to the recipe and flashes "Marked as cooked today". Requests a Screen Wake Lock while open when
the setting is on.

### 5. Market card
Full-bleed charcoal overlay. Eyebrow "SHOW THIS TO THE STALL", the Chinese name at `3.1em`,
English underneath, a ghost button "See photos of this" (Google Images search on the Chinese term),
"Tap anywhere to close".

### 6. Shopping list
Title + count. Rows: tick box (olive when done), English + Chinese (tap → market card), `×` to remove.
Done rows drop to 45% opacity. "Clear bought items" appears once anything is ticked.
Empty state points back to "+ Add all".

### 7. Family (settings)
Per-device only — say so in the copy ("Only changes this phone. 只影響這部手機。").
- **Text size** — four Aa tiles, selected has a 2px Roast Brown border.
- **Chinese 中文** — "Show Chinese" toggle (off hides every Chinese line app-wide).
- **While cooking** — "Keep screen awake" toggle.
- **Preview** — a live sample card so the choice is visible without leaving the screen.

### 8. Add / edit a dish
- Header: Cancel · title · Save.
- **Photo slot** — 9em dashed cream box, tap to pick from the camera roll; images are downscaled to
  900px max and stored as JPEG data URLs at quality .75.
- **Start from a link** — one field for a recipe URL *or* a YouTube link, plus a yellow
  "Fill in from this link" button. On success it fills name (both languages), course, time, serves,
  every ingredient with an emoji, all steps in both languages, a tip, the YouTube id, and a cover
  image (og:image, or the YouTube thumbnail). Status line under the button reports progress, what
  was filled in, or a plain-language failure. **The user always lands in editable fields — nothing
  is saved automatically.**
- Fields: name EN, name 中文 (placeholder says blank Chinese is auto-translated on save),
  course chips (yellow when selected), time, serves, added by, YouTube link.
- Ingredient rows: emoji box + English + Chinese + `×`; "+ Add ingredient".
- Step rows: `01` + two textareas + `×`; "+ Add step".
- Family note textarea.
- Yellow save button; "Delete this dish" only when editing.

## Interactions & behaviour
- Navigation is state, not routes: `view ∈ home | recipe | cook | list | settings | edit`, plus
  overlays `sheet`, `market`, and a transient `toast` (1.7s).
- The tab bar is hidden on recipe, cook and edit views. The recipe view's only exit is the Back
  pill — keep it prominent.
- Favourites: `favs: string[]` of recipe ids; the Saved tab is the home list filtered by it.
- Shopping list: `{en, cn, done}[]`; adding an ingredient already on the list flashes
  "Already on the list" rather than duplicating.
- Search matches dish name (both languages) and ingredient text.

## State
```
recipes[]            merged: built-ins + overrides + customs
view, recipeId, step
cat, query, sheet, market, toast
favs[], shopping[]                      persisted
size, showCn, wake                      persisted, per device
customs[], overrides{}                  persisted (server-side once deployed)
draft, editingId, importing, importNote, importErr
```
Merge rule: `base.filter(not deleted).map(apply override).concat(customs)`.
`overrides[id] = 'deleted'` hides a built-in; custom ids are `c<timestamp>`.

Local persistence key: `tinsCookbook.prefs.v1`. **Only device preferences should stay local once
the backend is live** — recipes move to Drive via `Code.gs`.

## Data
`recipes.js` — the 43 built-in recipes extracted from the original app.
```js
{ id, cat, en, cn, img, ytid, time, serves,
  ing: [[emoji, english, chinese], …],
  steps: [[english, chinese], …],
  tip }
```
Categories: `breakfast · lunch · soup · appetizer · main · dessert` (6/8/8/4/14/3).

## Assets
- Recipe photography: currently YouTube thumbnails (`https://i.ytimg.com/vi/<id>/hqdefault.jpg`).
  The design assumes these are placeholders — real family photos should replace them, thumbnail
  as fallback.
- Fonts: Google Fonts (Newsreader, Instrument Sans, Noto Serif TC).
- No icon set: every icon is a CSS shape (square, circle, rounded square) or a text glyph
  (`‹ ✕ ♥ ✓ × ▼ ▶ +`). Swap in a real icon set if the codebase has one.

## Known gaps / decisions for the developer
1. **`window.claude.complete` does not exist outside the design preview.** The shipped app must
   call the server instead — `extractRecipe(url)` in `Code.gs` does the same job with an Anthropic
   API key held in Script Properties. Wire the import button to it.
2. **CORS.** The prototype fetches pages through `r.jina.ai` / `allorigins`. In production do the
   fetch server-side (`UrlFetchApp`), which has no CORS limits and is more reliable.
3. **Provenance is placeholder.** The chip reads "Family recipe"; the data has no
   `addedBy` / `lastCooked` yet. The editor now captures `addedBy` — persist and display it, and
   stamp `lastCooked` when cook mode completes.
4. **Conflict handling.** Two family members editing the same dish will last-write-win; `Code.gs`
   takes a script lock but does not merge.

## Files in this bundle
| File | What it is |
|---|---|
| `Tin's Family Cookbook.dc.html` | The prototype — read as the spec for layout, colour, copy and logic |
| `recipes.js` | The 43 built-in recipes |
| `Code.gs` | Apps Script backend v2 (storage, auto-translate, server-side link import) |
| `DEPLOY.md` | GitHub + Apps Script deployment steps |
| `Family Cookbook (original).html` | The app being replaced, for reference |
