# Track 2 — the public cookbook

A blueprint, to be agreed before any code is written.

Status: **draft for review**. Nothing here is built. The family app (Track 1) is
unaffected by everything in this document and keeps running exactly as it does.

---

## 0. The question that has to be answered first

Everything below assumes **"public" means: other households sign up and run
their own private cookbook.** A product, not a publication.

That reading comes from the features asked for — a whiteboard, a messenger
between family members, receipt bookkeeping by a helper. Those are all
*household-private*. None of them makes sense if "public" meant publishing the
family's recipes for the world to read.

If the intent is actually the second thing — a public recipe site — then almost
none of this document applies, and the answer is much smaller: a static site
generator over the existing recipe data, no accounts, no backend. **Say which
one before we build anything.** The rest of this assumes the first.

Second question, nearly as load-bearing: **is this a business or a gift?** A
product other families pay for needs terms, a privacy policy, support, and a
data-deletion path. A thing given to a dozen friends needs none of that. The
architecture is the same either way; the surrounding work is not.

---

## 1. Why the current stack cannot go public

Not a criticism of it. It is very well suited to one family and would be the
wrong thing to rebuild for its own sake. But it has four hard limits, and they
are hard, not soft.

**All data lives in one Google account.** Apps Script runs as the deploying
user. Every household's recipes, photos, menus and — under the new features —
their *receipts and private messages* would sit in Sol's personal Drive, under
Sol's Google identity. That is untenable legally and practically, and there is
no configuration that changes it.

**One JSON file is one tenant.** `tins-cookbook-data.json` is read whole,
mutated, and written whole, under a script lock. Two households are two files;
a hundred are a hundred files and a lookup problem; and the lock serialises
every write in the system.

**Consumer Apps Script quotas are small.** Roughly 90 minutes of total script
runtime a day and 20,000 URL-fetch calls. One family never notices. Fifty
families exhaust it before lunch. There is no paid tier that lifts this for a
consumer account.

**There is no concept of a user.** `doPost` is unauthenticated, and identity is
a name typed into `localStorage` on each phone. Fine for a family who all have
the link. Not a foundation for anything with receipts in it.

The honest summary: the current design traded multi-tenancy away for simplicity,
and got a very good deal. Going public means buying it back.

---

## 2. Recommended architecture

### Backend: Supabase

Postgres, with authentication, file storage, realtime subscriptions and
row-level security in one service.

It is recommended because it answers all four requested features with one
decision rather than four:

| What was asked for | What answers it |
|---|---|
| Per-household privacy | Row-level security policies in Postgres |
| Instant messenger | Realtime subscriptions over Postgres changes |
| Receipt photos, dish photos | Supabase Storage (S3-compatible) |
| Spending summaries by category | It is Postgres — this is a `GROUP BY` |
| Sign-in for a helper without email | Auth supports phone/OTP as well as email and OAuth |

Row-level security deserves emphasis. Isolation is written **once, next to the
data**, as a policy like "you may read a row if you are a member of that
household". Every query from every client is then constrained by the database
itself. That is a far safer default than remembering to filter by household in
every endpoint, which is how multi-tenant data leaks happen.

**Alternatives considered.** *Firebase* is the closest competitor and is
Google-native, which has some appeal given the family's data is already in
Drive; its realtime and offline story is excellent. It loses on querying —
spending summaries across categories and date ranges are awkward in Firestore
and trivial in SQL — and its security rules are harder to reason about than RLS.
*Cloudflare Workers + D1* would be the cheapest and fastest, but is more
assembly and D1 is younger. *A custom Node + Postgres service* on Fly or Render
gives the most control and costs the most time; it is the right answer only if
we later outgrow Supabase, and moving is not hard because the data is already
plain Postgres.

### Frontend: React + Vite + TypeScript, as a PWA

The current app is a single 2,100-line HTML file with hand-rolled state and
`innerHTML` rendering. That was a good decision at its size and it is now at its
limit — the fixes in this repo's recent history have all been fights with
whole-page re-rendering.

The public version needs routing, sign-in flows, three languages, offline sync,
and roughly twice as many screens. That wants a framework.

- **React + Vite + TypeScript** — recommended. Best ecosystem for the specific
  things needed here (`react-i18next`, TanStack Query with offline persistence),
  and the least surprising choice for anyone who joins later.
- **SvelteKit** — a legitimate lighter alternative; smaller bundles, less
  boilerplate. Choose it if bundle size on a slow phone matters more than
  ecosystem depth.

Supporting choices: TanStack Query for server state and offline caching,
`vite-plugin-pwa` for the service worker, `react-i18next` for language.

### What must not change

**The design system carries over unchanged.** The CoHee palette, Newsreader and
Noto Serif TC, the em-based text sizing, the warmth of the copy — that is the
best thing about the current app and it is what would make a public version feel
unlike every other recipe app. Port it as a token file and a component library.
Rebuild the markup; do not redesign the product.

---

## 3. Data model

The shape below is the important part of this document. Two decisions in it are
expensive to change later and cheap to get right now.

```sql
households        (id, name, created_at, plan)
household_members (household_id, user_id, role, display_name, locale)
                  -- role: owner | member | helper

shelves           (id, household_id, key, name_i18n)      -- VT/MT/CT, generalised
courses           (id, household_id, key, name_i18n, sort)

recipes           (id, household_id, shelf_id, course_id,
                   title_i18n, tip_i18n, time, serves, yt_id,
                   cover_path, added_by, last_cooked, created_at, updated_at)
recipe_items      (recipe_id, kind, position, emoji, text_i18n, image_path)
                  -- kind: ingredient | step

menus             (id, household_id, shelf_id, on_date, note, occasion, by)
menu_items        (menu_id, recipe_id, position)

notes             (id, household_id, text, pinned, author_id, created_at)

threads           (id, household_id, subject_type, subject_id)
                  -- subject_type: menu | recipe | general
messages          (id, thread_id, author_id, body, starred, created_at)

receipts          (id, household_id, uploaded_by, vendor, purchased_on,
                   total, currency, category, image_path, status, created_at)
                  -- status: pending | confirmed | rejected
receipt_lines     (receipt_id, description, amount, category)

shopping_items    (id, household_id, text_i18n, done, added_by)
```

### Decision 1 — language is data, not code

Every human-readable field is `_i18n jsonb`:

```json
{ "en": "Steamed Egg with Minced Pork", "zh-Hant": "肉碎蒸水蛋", "tl": "..." }
```

Not `title_en`, `title_cn`, `title_tl`. With columns, each new language is a
migration touching every table and every query. With a JSON map, adding
Vietnamese later is a settings entry and a translation pass — no schema change,
no code change.

This is the single most important thing to get right at the start, because the
current app has exactly the problem being avoided: `{en, cn}` pairs and
`[emoji, en, cn]` triples hardcoded everywhere, which is why adding Filipino to
Track 1 would be a rewrite rather than an addition.

UI strings live in `locales/{en,zh-Hant,tl}.json` and are referenced by key.
This also has to be right from the first screen — retrofitting a string table
onto finished markup is miserable work, as Track 1 demonstrates.

### Decision 2 — the helper is a role, not a lesser user

`role = helper` is a first-class concept with its own RLS policies. A helper
should be able to read recipes, menus and the shopping list, and to submit
receipts — and should *not* automatically see the household's spending
summaries or private message threads. That distinction has to exist in the
schema from the beginning; bolting it on after receipts ship means auditing
every policy.

### Notes on the rest

- `recipe_items` holds ingredients and steps in one table, keyed by `kind`. They
  have identical shapes (ordered, translatable, optionally illustrated) and
  splitting them buys nothing.
- Photos are storage paths, never bytes in the database. The current app's
  content-hash trick — store each photo once under a fingerprint — carries over
  and should be kept; it is genuinely good.
- `threads.subject_type/subject_id` is what makes messaging worth building
  rather than deferring to WhatsApp. See §4.

---

## 4. The four new features, in this architecture

**Whiteboard.** Already built for the family (`notes`). Ports directly. The only
addition is that a starred message can be promoted onto the board.

**Messenger.** The honest position: a general-purpose family chat will lose to
WhatsApp, because everyone is already in WhatsApp and nobody wants a second
place to check. What WhatsApp *cannot* do is attach a conversation to a specific
thing — Tuesday's menu, or one dish. "No pork for Ma on Tuesday" belongs on
Tuesday, not in a scroll of 200 messages.

So: threads are attached to a subject (`menu | recipe | general`), and the
conversation appears on the thing it is about. Realtime subscriptions make it
instant. Starring a message pins it to the whiteboard. Build the attached
threads first; add `general` only if the family actually asks for it.

**Receipt scanning.** Flow: helper photographs a receipt → uploaded to Storage →
a background job sends it to a vision model → vendor, date, total and line items
come back → helper confirms or corrects → row is written with
`status = confirmed`. Summaries are then ordinary SQL.

Two things to be deliberate about. First, this is the only feature that costs
money per use (roughly a fifth of a cent per receipt with Claude Haiku — real,
but small). Second, it is the feature that most changes what the product *is*:
a cookbook with a spending ledger in it is a household-management app. That may
well be the right product. It should be a decision, not a drift.

Reuse `solinangai/receipt-scanner` here rather than starting again.

**Language, including Filipino.** Falls out of Decision 1 above. Language is
chosen at first run and changeable in settings; it is per-user, not per-
household, so the helper can use the app in Tagalog while the family uses
English or Chinese, over the same data.

One deliberate exception, carried over from the current app and worth
preserving: **the market card always shows Chinese**, whatever the interface
language. It exists to be held up to a stall keeper in Hong Kong. That is a good
piece of design and it should survive the rewrite.

---

## 5. Hosting and cost

| | Free tier carries | Then |
|---|---|---|
| Supabase | ~50k monthly active users, 500 MB database, 1 GB storage | $25/mo Pro |
| Vercel or Netlify | Personal projects, generous bandwidth | $20/mo |
| Domain | — | ~$15/yr |
| Receipt OCR | — | ~$0.002 per receipt |
| Translation | — | Per-character, or Claude at similar cost |

**A public beta of ten to twenty households costs approximately nothing.** The
free tiers are not marketing — they genuinely carry this workload. Paid tiers
arrive with real usage, which is the right time to pay for them.

---

## 6. Migration

The family's existing data has to come across, and it has to be a rehearsal
rather than a leap of faith.

1. An importer reads `tins-cookbook-data.json` plus the `Tin's Cookbook Photos`
   Drive folder.
2. It creates one household, three shelves (VT/MT/CT), the current courses, all
   43 built-ins plus every custom dish and override, every future menu, and the
   whiteboard notes.
3. Existing `{en, cn}` fields map to `{"en": …, "zh-Hant": …}`. Tagalog is left
   empty and filled in later by translation — the JSON map means the app renders
   fine with a language missing, falling back to English.
4. Photos upload to Storage, keeping their content-hash filenames.

The family runs **both** apps in parallel for a few weeks, with the current one
authoritative, until the new one is plainly better. Only then does the old link
redirect. Nothing is switched off on a promise.

---

## 7. Build order

Each phase should be usable by someone at the end of it. No phase is a
foundation-only phase that produces nothing you can look at.

| Phase | What lands | Rough size |
|---|---|---|
| 0 | Answer §0. Name, domain, repo, decision on business-or-gift | — |
| 1 | Supabase project, auth, households, invites, RLS, design system ported as components | Large |
| 2 | Cookbook parity: recipes, shelves, courses, search, cook mode, shopping list, market card | Large |
| 3 | Planning: menus, whiteboard | Medium |
| 4 | Migration importer + family runs both in parallel | Medium |
| 5 | Messaging: threads on menus and dishes, star to whiteboard | Medium |
| 6 | Language: full i18n pass, Tagalog, per-user language picker | Medium |
| 7 | Receipts: capture, OCR, confirm, category summaries | Large |
| 8 | Beta with two or three other households | — |

Phase 4 sits deliberately in the middle. The migration should be proved while
the surface area is still small; discovering at phase 8 that the importer loses
something is a bad afternoon.

Phase 6 could move earlier if the helper's Tagalog is urgent — the schema
supports it from phase 1, so it is purely a question of when the translation
work happens.

---

## 8. Open questions

Ordered by how much they change the plan.

1. **§0 — product for other households, or public recipe site?** Everything
   depends on this.
2. **Business or gift?** Determines whether terms, privacy policy, billing and
   support are in scope.
3. **Is the receipt ledger in the product, or a separate app that shares
   sign-in?** Both are defensible. Bundling makes it a household app; separating
   keeps the cookbook a cookbook.
4. **Which languages at launch?** English, 繁中 and Tagalog are assumed. Adding
   more is cheap under Decision 1, but each needs a translation pass.
5. **How much does a helper see?** Specifically: the spending summaries. This
   needs an answer before phase 7, and ideally before phase 1, since it shapes
   the roles.
6. **React or SvelteKit?** A real choice, not a coin toss, but not one that
   blocks phase 0.

---

## 9. What this does not change

Track 1 continues. The family app is not frozen, not deprecated, and not
migrated until phase 4 proves the importer and the family agrees the new one is
better. Improvements to it in the meantime are not wasted: the design system,
the copy, the market card, the photo-hashing scheme and the whiteboard all
carry across.
