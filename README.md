# 🍳 Tin's Family Cookbook

A bilingual (English-first / 繁體中文) family recipe web app — *Made with love for our home kitchen*.
Redesigned in Claude Design (CoHee palette · Newsreader + Noto Serif TC), served as a Google Apps Script web app.

## Layout

```
tins-family-cookbook/
├─ README.md
├─ DEPLOY.md               how to deploy (GitHub + Apps Script)
├─ src/
│  ├─ index.html           the app — one file, recipes inlined; this is what Apps Script serves
│  └─ recipes.js           the 43 built-in recipes (source of the inlined data)
├─ appsscript/
│  ├─ Code.gs              backend: Drive storage, auto-translate, server-side link import
│  └─ appsscript.json      manifest
├─ design/
│  ├─ Tin's Family Cookbook.dc.html   design prototype (spec — do not ship)
│  └─ README.md                       the design brief / tokens / screens
└─ WebApp/                 v1 app (archived)
```

## Features (v2)

- Home grid with search (names + ingredients) and a course sheet; favourites (Saved tab)
- Recipe view → step-by-step **cook mode** (progress bar, keeps screen awake, stamps *last cooked*)
- **Shopping list** with tick-off, and a **market card**: tap any ingredient to show its Chinese name
  full-screen to a stall keeper, with a photo-search link
- Add / edit dishes; **"Fill in from this link"** — paste a recipe URL or YouTube link and the backend
  (`extractRecipe` in `Code.gs`, Claude Haiku via the Anthropic API) fills everything in, both languages
- Per-device settings: text size (Small→Largest), Show Chinese, keep-awake
- Auto-translation on save: blank Chinese fields are filled in server-side
- Shared storage: everyone's edits live in `tins-cookbook-data.json` in the deployer's Google Drive

`src/index.html` also runs standalone (opened as a file): recipes then save only on that device and
link-import is disabled — handy for testing.

## Deploying

See **DEPLOY.md**. Short version: paste `appsscript/Code.gs` and `src/index.html` (as an HTML file
named `index`) into script.google.com, deploy as a web app (Execute as **Me**, access **Anyone**),
and add `ANTHROPIC_API_KEY` in Script Properties to enable link-import. Re-deploy "New version"
after updates — the family link never changes.
