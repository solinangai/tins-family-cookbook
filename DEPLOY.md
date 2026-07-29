# Deploying Tin's Family Cookbook

Two moving parts: **GitHub** (where the source lives and where Claude Code works) and
**Google Apps Script** (what the family actually opens on their phones).

---

## 1. Repository layout

```
tins-family-cookbook/
├─ README.md
├─ src/
│  ├─ index.html          the app (one file — what Apps Script serves)
│  └─ recipes.js          the 43 built-in recipes
├─ appsscript/
│  ├─ Code.gs             backend
│  └─ appsscript.json     manifest
└─ design/
   ├─ Tin's Family Cookbook.dc.html    design reference
   └─ README.md                        the spec
```

Apps Script cannot load a separate `.js` file the way a normal web server does — when you build
`src/index.html`, inline `recipes.js` into it (or paste it as an `index.js.html` and pull it in
with `<?!= HtmlService.createHtmlOutputFromFile('index.js').getContent() ?>`).

## 2. Connect GitHub

1. Create the repo (private is fine — the family never sees it).
2. Push the layout above.
3. Point Claude Code at the repo and hand it `design/README.md` as the brief.

Suggested first tasks for Claude Code, in order:
1. Build `src/index.html` from the design reference — no framework, one file, inline styles.
2. Replace the prototype's `localStorage` recipe store with `google.script.run` calls to
   `getData` / `saveRecipe` / `deleteRecipe` / `resetRecipe`. Keep text size, Show Chinese and
   keep-awake in `localStorage` — those are per-device by design.
3. Wire the "Fill in from this link" button to `extractRecipe(url)` instead of
   `window.claude.complete`.
4. Add `addedBy` + `lastCooked` to the stored recipe shape and show them on the recipe chip.

## 3. Deploy to Apps Script

**Option A — clasp (recommended, keeps GitHub as the source of truth)**

```bash
npm i -g @google/clasp
clasp login
clasp create --type webapp --title "Tin's Family Cookbook" --rootDir ./appsscript
# copy the built src/index.html into ./appsscript/index.html before each push
clasp push
clasp deploy --description "v2 redesign"
```

`appsscript/appsscript.json`:
```json
{
  "timeZone": "Asia/Hong_Kong",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" },
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.locale"
  ]
}
```

**Option B — by hand (what the original setup guide describes)**

1. script.google.com → New project.
2. Paste `Code.gs`. Add an HTML file named exactly `index` and paste the built app into it.
3. Deploy → New deployment → Web app → Execute as **Me**, Access **Anyone**.
4. Share the URL. Family members "Add to Home Screen".
5. Updating later: paste the new code, then **Deploy → Manage deployments → ✎ → New version**.
   The family's link never changes.

## 4. Enable "Fill in from this link"

Project Settings → Script Properties → add:

| Property | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-…` |

Without it the app still works; the import button reports that automatic filling isn't set up.
Cost is negligible (one Haiku call per import), but the key belongs to whoever deploys — anyone
with the app link can trigger imports, so keep the URL within the family.

## 5. Data

Everything lives in one Drive file, `tins-cookbook-data.json`, in the deploying account's Drive:

```json
{ "overrides": { "r12": { …recipe… }, "r30": "deleted" },
  "custom":    [ { "id": "c1737…", …recipe… } ] }
```

Back it up by copying that file. Deleting it resets the cookbook to the 43 built-ins.

## 6. Sanity checklist before sharing the link

- [ ] Opens on a phone, no horizontal scroll
- [ ] Text size Small → Largest all readable; Largest goes single-column
- [ ] Show Chinese off hides every Chinese line
- [ ] Add a dish → appears for everyone (test on a second phone)
- [ ] Edit a built-in → the change syncs; other dishes untouched
- [ ] Shopping list survives a reload
- [ ] Cook mode keeps the screen on
- [ ] Import from one recipe site and one YouTube link
