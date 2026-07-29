# 🍳 Tin's Family Cookbook

A bilingual (English / 繁體中文) family recipe web app — *Made with love for our home kitchen*.

## What's inside

| File | Purpose |
|---|---|
| `Family Cookbook.html` | The complete cookbook app in one file. Works opened directly in any browser (edits then save only on that device). |
| `WebApp/index.html` | The same app, used as the web page of the shared family version. |
| `WebApp/Code.gs` | Google Apps Script backend — stores everyone's edits in the owner's Google Drive (`tins-cookbook-data.json`) and auto-translates English edits to Chinese. |
| `WebApp/Setup Guide - Tins Family Cookbook.html` | Step-by-step instructions to deploy the shared version at script.google.com (one-time, ~5 minutes). |

## Features

- 43 built-in family recipes with YouTube video links, bilingual ingredients & steps
- Category tabs (Breakfast / Lunch / Soup / Appetizer / Main / Dessert) + cuisine filter (中式 / 西式 / 泰式 / 日式 / 韓式 / 越式) + search
- Edit any dish, add new dishes with photos (photos are compressed automatically)
- Tap any ingredient to see its name in large type (to show a market stall keeper) and open a photo search
- English-first editing — empty Chinese fields are translated automatically on save
- Mobile-optimised; family members can "Add to Home Screen" for an app-like experience

## Shared family version

Deploy `WebApp/Code.gs` + `WebApp/index.html` as a Google Apps Script web app
(Execute as **Me**, access **Anyone**) — full instructions in the Setup Guide.
Everyone who has the link can view and edit the same cookbook; no login needed.

## Updating

Edit `WebApp/index.html`, then in Apps Script paste the new version and
**Deploy → Manage deployments → ✎ → New version**. The family link never changes.
