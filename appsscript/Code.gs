/**
 * Tin's Family Cookbook — Google Apps Script backend (v5)
 *
 * Serves the cookbook web app and stores everyone's edits in a JSON file
 * ("tins-cookbook-data.json") in the Drive of the account that deploys it.
 *
 * v3 changes:
 *  - "Fill in from this link" no longer needs any AI service or API key.
 *    It reads the structured recipe data that sites publish for Google
 *    (schema.org JSON-LD), then fills the Chinese with Google Translate.
 *  - The 'index' HTML file here is only a small LOADER (see getApp below).
 *
 * v4 adds data safety (the family's recipes are now live data):
 *  - readData_() REFUSES to continue if the data file is empty/unreadable,
 *    instead of silently returning blank data (which the next save would
 *    have written over the top of — wiping everyone's recipes).
 *  - Automatic dated backups in Drive (at most one per 6h of activity,
 *    newest 20 kept): tins-cookbook-backup-YYYYMMDD-HHmm.json
 *  - backupNow(), listBackups(), restoreBackup(name), dataStats() can be run
 *    by hand from the Apps Script editor at any time.
 *
 * v5: doPost() lets the installed app (GitHub Pages) read and write the same
 *     Drive file, so the data still lives only in this Google account.
 *
 * Nothing to configure. No keys, no billing, no region restrictions.
 */

var FILE_NAME = 'tins-cookbook-data.json';
var BACKUP_PREFIX = 'tins-cookbook-backup-';
var BACKUP_KEEP = 20;                        // how many dated backups to keep
var BACKUP_EVERY_MS = 6 * 60 * 60 * 1000;    // at most one auto-backup per 6 hours

/**
 * The 'index' HTML file in this project is only a tiny LOADER.
 * Why: Apps Script's HTML serving pipeline rewrites served pages (it strips
 * what it thinks are JS comments) and corrupts modern JavaScript — e.g. the
 * "//" inside URLs in template literals. So the real app is fetched verbatim
 * by getApp() below from GitHub (with a Drive-cached fallback copy) and
 * injected client-side, bypassing the sanitizer entirely.
 * Bonus: updating src/index.html on GitHub updates the app for everyone
 * with NO redeploy.
 */
var APP_URL = 'https://raw.githubusercontent.com/solinangai/tins-family-cookbook/main/docs/index.html';
var APP_CACHE = 'tins-cookbook-app-cache.html';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle("Tin's Family Cookbook")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * Data API for the installed app (served from GitHub Pages).
 * The page POSTs {action, payload} as text/plain — that content type is
 * "simple" so the browser sends it straight through without a CORS preflight,
 * which Apps Script cannot answer. The recipes themselves never leave this
 * account: they stay in the Drive file above.
 */
function doPost(e) {
  var out = { ok: false, error: 'bad request' };
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = body.action;
    var payload = body.payload;
    if (action === 'get') out = { ok: true, data: getData() };
    else if (action === 'save') out = { ok: true, data: saveRecipe(payload) };
    else if (action === 'delete') out = { ok: true, data: deleteRecipe(payload) };
    else if (action === 'reset') out = { ok: true, data: resetRecipe(payload) };
    else if (action === 'extract') out = { ok: true, data: extractRecipe(payload) };
    else out = { ok: false, error: 'unknown action: ' + action };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Returns the full app HTML, fetched from GitHub, cached in Drive. */
function getApp() {
  try {
    var res = UrlFetchApp.fetch(APP_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var html = res.getContentText();
      if (html && html.indexOf('</html>') > 0) {
        try {
          var it = DriveApp.getFilesByName(APP_CACHE);
          if (it.hasNext()) it.next().setContent(html);
          else DriveApp.createFile(APP_CACHE, html, 'text/html');
        } catch (e) {}
        return html;
      }
    }
  } catch (e) {}
  var it2 = DriveApp.getFilesByName(APP_CACHE);
  if (it2.hasNext()) return it2.next().getBlob().getDataAsString();
  throw new Error('App source unavailable — check that the GitHub repo is public.');
}

/* ---------- storage ---------- */

function getFile_() {
  var it = DriveApp.getFilesByName(FILE_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFile(FILE_NAME, JSON.stringify({ overrides: {}, custom: [] }), 'application/json');
}

/**
 * Reads the shared data. If the file is unreadable this THROWS on purpose:
 * returning blank data here would let the next save overwrite every recipe
 * the family has added. Better a visible error than silent data loss.
 */
function readData_() {
  var raw = getFile_().getBlob().getDataAsString();
  if (!raw || !raw.replace(/\s/g, '')) {
    throw new Error('The cookbook data file is empty. Nothing was changed — restore a backup with restoreBackup().');
  }
  var d;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    throw new Error('The cookbook data file could not be read. Nothing was changed — restore a backup with restoreBackup().');
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    throw new Error('The cookbook data file has an unexpected shape. Nothing was changed — restore a backup with restoreBackup().');
  }
  if (!d.overrides) d.overrides = {};
  if (!d.custom) d.custom = [];
  return d;
}

function writeData_(d) {
  getFile_().setContent(JSON.stringify(d));
}

/* ---------- backups ---------- */

function tstamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Hong_Kong', 'yyyyMMdd-HHmm');
}

/** Saves a dated copy of the current data in Drive. Returns the file name. */
function backupNow(tag) {
  var raw = getFile_().getBlob().getDataAsString();
  if (!raw || raw.length < 2) return null;
  var name = BACKUP_PREFIX + tstamp_() + (tag ? '-' + tag : '') + '.json';
  DriveApp.createFile(name, raw, 'application/json');
  pruneBackups_();
  Logger.log('Backup written: ' + name + ' (' + raw.length + ' characters)');
  return name;
}

function backupFiles_() {
  var out = [];
  var it = DriveApp.searchFiles('title contains "' + BACKUP_PREFIX + '" and trashed = false');
  while (it.hasNext()) {
    var f = it.next();
    out.push({ file: f, name: f.getName(), when: f.getDateCreated() });
  }
  out.sort(function (a, b) { return b.when - a.when; });
  return out;
}

/** Keeps only the newest BACKUP_KEEP backups; older ones go to the Drive bin. */
function pruneBackups_() {
  try {
    var all = backupFiles_();
    for (var i = BACKUP_KEEP; i < all.length; i++) all[i].file.setTrashed(true);
  } catch (e) {}
}

/** Backs up at most once per BACKUP_EVERY_MS, called before every change. */
function maybeBackup_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var last = Number(props.getProperty('lastBackupMs') || 0);
    var now = new Date().getTime();
    if (now - last < BACKUP_EVERY_MS) return;
    if (backupNow('auto')) props.setProperty('lastBackupMs', String(now));
  } catch (e) {}
}

/** Run from the editor: lists the backups, newest first. */
function listBackups() {
  var all = backupFiles_();
  if (!all.length) { Logger.log('No backups yet. Run backupNow() to make one.'); return []; }
  var names = all.map(function (b) { return b.name + '  (' + b.when + ')'; });
  Logger.log('Backups, newest first:\n' + names.join('\n'));
  return names;
}

/**
 * Run from the editor to put a backup back in place, e.g.
 *   restoreBackup('tins-cookbook-backup-20260729-1830-auto.json')
 * The data being replaced is itself backed up first, so this is reversible.
 */
function restoreBackup(name) {
  if (!name) throw new Error('Pass the backup file name, e.g. restoreBackup("' + BACKUP_PREFIX + '20260729-1830-auto.json")');
  var it = DriveApp.getFilesByName(name);
  if (!it.hasNext()) throw new Error('No backup called ' + name + '. Run listBackups() to see the names.');
  var raw = it.next().getBlob().getDataAsString();
  JSON.parse(raw); // refuse to restore something unreadable
  backupNow('before-restore');
  getFile_().setContent(raw);
  Logger.log('Restored ' + name);
  return true;
}

/** Run from the editor to see what is currently stored. */
function dataStats() {
  var raw = getFile_().getBlob().getDataAsString();
  var d = JSON.parse(raw);
  var edited = 0, hidden = 0;
  for (var k in d.overrides) { if (d.overrides[k] === 'deleted') hidden++; else edited++; }
  var msg = 'Cookbook data: ' + (d.custom || []).length + ' dishes added by the family, ' +
            edited + ' built-in dishes edited, ' + hidden + ' hidden, ' +
            raw.length + ' characters total.';
  Logger.log(msg);
  Logger.log('Added dishes: ' + (d.custom || []).map(function (r) { return r.en || r.cn; }).join(' | '));
  return msg;
}

/* ---------- translation ---------- */

function tzh_(t) {
  if (!t) return '';
  try { return LanguageApp.translate(t, 'en', 'zh-TW'); } catch (e) { return ''; }
}

function hasCJK_(t) { return /[\u4e00-\u9fff]/.test(t || ''); }

function autoTranslate_(r) {
  if (!r || typeof r !== 'object') return r;
  if (r.en && !r.cn) r.cn = tzh_(r.en);
  (r.ing || []).forEach(function (i) { if (i[1] && !i[2]) i[2] = tzh_(i[1]); });
  (r.steps || []).forEach(function (s) { if (s[0] && !s[1]) s[1] = tzh_(s[0]); });
  if (r.tip && !hasCJK_(r.tip)) {
    var z = tzh_(r.tip);
    if (z && z !== r.tip) r.tip = r.tip + ' ' + z;
  }
  return r;
}

/* ---------- API called from the web page ---------- */

function getData() {
  return readData_();
}

function isCustomId_(id) {
  return /^[cu]/.test(String(id || ''));
}

function saveRecipe(obj) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    maybeBackup_();
    obj = autoTranslate_(obj);
    var d = readData_();
    if (obj.id && isCustomId_(obj.id)) {
      obj.custom = true;
      var i = -1;
      for (var k = 0; k < d.custom.length; k++) if (d.custom[k].id === obj.id) { i = k; break; }
      if (i >= 0) d.custom[i] = obj; else d.custom.push(obj);
    } else if (obj.id) {
      d.overrides[obj.id] = obj;
    } else {
      obj.id = 'c' + Date.now();
      obj.custom = true;
      d.custom.push(obj);
    }
    writeData_(d);
    return obj;
  } finally {
    lock.releaseLock();
  }
}

/** Removes a custom dish, or hides a built-in one. */
function deleteRecipe(id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    maybeBackup_();
    var d = readData_();
    if (isCustomId_(id)) {
      d.custom = d.custom.filter(function (x) { return x.id !== id; });
    } else {
      d.overrides[id] = 'deleted';
    }
    writeData_(d);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** Restores a built-in dish to its original text. */
function resetRecipe(id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    maybeBackup_();
    var d = readData_();
    delete d.overrides[id];
    writeData_(d);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- "fill in from a link" (no API key needed) ---------- */

function ytId_(u) {
  var m = String(u || '').match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : '';
}

/** Fetches a page server-side (no CORS limits here). */
function fetchPage_(url) {
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TinsCookbook/1.0)' }
  });
  if (res.getResponseCode() >= 400) return '';
  return res.getContentText();
}


function decodeEntities_(t) {
  if (!t) return '';
  return String(t)
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags_(t) {
  return decodeEntities_(String(t || '').replace(/<[^>]+>/g, ' '));
}

/** ISO-8601 duration (PT1H30M) -> "1 hr 30 min" */
function isoDur_(v) {
  if (!v) return '';
  var m = String(v).match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return '';
  var d = +(m[1] || 0), h = +(m[2] || 0), mi = +(m[3] || 0);
  h += d * 24;
  if (!h && !mi) return '';
  return (h ? h + ' hr' : '') + (h && mi ? ' ' : '') + (mi ? mi + ' min' : '');
}

function firstStr_(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { var s = firstStr_(v[i]); if (s) return s; } return ''; }
  if (typeof v === 'object') return firstStr_(v.url || v.text || v.name || v['@id'] || '');
  return '';
}

/** Flattens JSON-LD (handles @graph, arrays, nesting) and returns the first Recipe node. */
function findRecipeNode_(root) {
  var out = null;
  function walk(n, depth) {
    if (out || !n || depth > 6) return;
    if (Array.isArray(n)) { for (var i = 0; i < n.length; i++) walk(n[i], depth + 1); return; }
    if (typeof n !== 'object') return;
    var t = n['@type'];
    var types = Array.isArray(t) ? t : [t];
    for (var k = 0; k < types.length; k++) {
      if (String(types[k] || '').toLowerCase() === 'recipe') { out = n; return; }
    }
    if (n['@graph']) walk(n['@graph'], depth + 1);
    for (var key in n) { if (key !== '@graph' && n[key] && typeof n[key] === 'object') walk(n[key], depth + 1); }
  }
  walk(root, 0);
  return out;
}

function collectSteps_(ri, acc, depth) {
  if (!ri || depth > 4) return;
  if (typeof ri === 'string') {
    var txt = stripTags_(ri);
    if (!txt) return;
    // A single blob of text: split it into sentences so it becomes real steps.
    if (txt.length > 120 && acc.length === 0) {
      var marked = txt.replace(/([.。！!？?])\s+/g, '$1');
      var parts = marked.split('');
      var kept = 0;
      parts.forEach(function (p) { p = p.trim(); if (p.length > 2) { acc.push(p); kept++; } });
      if (kept) return;
    }
    acc.push(txt);
    return;
  }
  if (Array.isArray(ri)) { for (var i = 0; i < ri.length; i++) collectSteps_(ri[i], acc, depth + 1); return; }
  if (typeof ri === 'object') {
    var ty = String(ri['@type'] || '').toLowerCase();
    if (ty === 'howtosection' && ri.itemListElement) { collectSteps_(ri.itemListElement, acc, depth + 1); return; }
    if (ri.itemListElement) { collectSteps_(ri.itemListElement, acc, depth + 1); return; }
    var s = stripTags_(ri.text || ri.name || '');
    if (s) acc.push(s);
  }
}

var CAT_RULES = [
  { cat: 'dessert', re: /dessert|cake|cookie|sweet|pudding|ice cream|糖水|甜品/i },
  { cat: 'soup', re: /soup|broth|chowder|湯/i },
  { cat: 'breakfast', re: /breakfast|brunch|pancake|omelet|早餐/i },
  { cat: 'appetizer', re: /appetiz|appetis|starter|snack|side dish|前菜|小食/i },
  { cat: 'lunch', re: /lunch|salad|sandwich|pasta|noodle|wrap|午餐/i },
  { cat: 'main', re: /main|dinner|entr[ée]e|主菜|晚餐/i }
];

function guessCat_(node, title) {
  var hay = [firstStr_(node.recipeCategory), firstStr_(node.recipeCuisine), title || ''].join(' ');
  for (var i = 0; i < CAT_RULES.length; i++) if (CAT_RULES[i].re.test(hay)) return CAT_RULES[i].cat;
  return 'main';
}

var EMOJI_RULES = [
  [/chicken|poultry|雞/i, '🍗'], [/beef|steak|牛/i, '🥩'], [/pork|bacon|ham|豬/i, '🐖'],
  [/fish|salmon|cod|tuna|魚/i, '🐟'], [/shrimp|prawn|蝦/i, '🦐'], [/crab|lobster|蟹/i, '🦀'],
  [/egg|蛋/i, '🥚'], [/milk|cream|奶/i, '🥛'], [/cheese|芝士/i, '🧀'], [/butter|牛油/i, '🧈'],
  [/rice|飯|米/i, '🍚'], [/noodle|pasta|spaghetti|麵|粉/i, '🍜'], [/bread|toast|flour|麵包|粉/i, '🍞'],
  [/onion|shallot|洋蔥|乾蔥/i, '🧅'], [/garlic|蒜/i, '🧄'], [/ginger|薑/i, '🫚'],
  [/tomato|番茄|茄/i, '🍅'], [/potato|薯/i, '🥔'], [/carrot|蘿蔔/i, '🥕'],
  [/mushroom|菇/i, '🍄'], [/pepper|chilli|chili|辣椒|椒/i, '🌶️'], [/lemon|lime|檸檬/i, '🍋'],
  [/oil|油/i, '🫒'], [/salt|鹽/i, '🧂'], [/sugar|honey|糖|蜜/i, '🍯'],
  [/soy|sauce|vinegar|豉油|生抽|醋|醬/i, '🍶'], [/water|水/i, '💧'],
  [/spinach|lettuce|cabbage|greens|菜/i, '🥬'], [/bean|tofu|豆/i, '🫘'],
  [/apple|蘋果/i, '🍎'], [/corn|粟米/i, '🌽'], [/wine|酒/i, '🍷'], [/nut|peanut|果仁|花生/i, '🥜']
];

function emojiFor_(text) {
  for (var i = 0; i < EMOJI_RULES.length; i++) if (EMOJI_RULES[i][0].test(text)) return EMOJI_RULES[i][1];
  return '🧺';
}

/** Pulls every <script type="application/ld+json"> block out of raw HTML. */
function ldBlocks_(raw) {
  var out = [], re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, m;
  while ((m = re.exec(raw)) !== null) out.push(m[1]);
  return out;
}

function metaOf_(raw, prop) {
  var re = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']+)["\']', 'i');
  var m = raw.match(re);
  if (m) return decodeEntities_(m[1]);
  re = new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']' + prop + '["\']', 'i');
  m = raw.match(re);
  return m ? decodeEntities_(m[1]) : '';
}

/** Main: raw page HTML -> draft recipe (no AI, no API key). */
function parseRecipeHtml_(raw, vid) {
  var blocks = ldBlocks_(raw), node = null;
  for (var i = 0; i < blocks.length && !node; i++) {
    try { node = findRecipeNode_(JSON.parse(blocks[i].trim())); } catch (e) {}
  }

  var img = vid ? 'https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg' : (metaOf_(raw, 'og:image') || metaOf_(raw, 'twitter:image'));

  if (!node) {
    var title = metaOf_(raw, 'og:title') || stripTags_((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    var desc = metaOf_(raw, 'og:description') || metaOf_(raw, 'description');
    if (vid && title) {
      return { partial: true, en: title, cat: 'main', img: img, ytid: vid, ing: [], steps: [], tip: desc ? desc.slice(0, 400) : '' };
    }
    return { error: 'no-recipe', img: img };
  }

  if (!img) img = firstStr_(node.image);

  var ingRaw = node.recipeIngredient || node.ingredients || [];
  if (!Array.isArray(ingRaw)) ingRaw = [ingRaw];
  var ing = [];
  ingRaw.forEach(function (x) {
    var t = stripTags_(typeof x === 'string' ? x : firstStr_(x));
    if (t) ing.push([emojiFor_(t), t, '']);
  });

  var stepsAcc = [];
  collectSteps_(node.recipeInstructions, stepsAcc, 0);
  var steps = stepsAcc.filter(function (s) { return s && s.length > 1; }).map(function (s) { return [s, '']; });

  var time = isoDur_(node.totalTime) || isoDur_(node.cookTime) || isoDur_(node.prepTime);
  var serves = firstStr_(node.recipeYield).replace(/servings?|serves|人份/gi, '').trim();
  var title2 = stripTags_(firstStr_(node.name)) || metaOf_(raw, 'og:title');

  return {
    en: title2,
    cat: guessCat_(node, title2),
    time: time,
    serves: serves,
    img: img,
    ytid: vid || '',
    ing: ing,
    steps: steps,
    tip: stripTags_(firstStr_(node.description)).slice(0, 300)
  };
}


/** Fills every blank Chinese field using Google Translate (built into Apps Script, free). */
function translateDraft_(r) {
  if (!r || r.error) return r;
  if (r.en && !r.cn) r.cn = tzh_(r.en);
  (r.ing || []).forEach(function (i) { if (i[1] && !i[2]) i[2] = tzh_(i[1]); });
  (r.steps || []).forEach(function (s) { if (s[0] && !s[1]) s[1] = tzh_(s[0]); });
  if (r.tip && !hasCJK_(r.tip)) {
    var z = tzh_(r.tip);
    if (z && z !== r.tip) r.tip = r.tip + ' ' + z;
  }
  return r;
}

/**
 * Reads a recipe page or YouTube link and returns a draft recipe in the app's shape.
 * Uses the recipe data that sites publish for Google (schema.org JSON-LD) — so it needs
 * NO AI service and NO API key, and works from anywhere.
 */
function extractRecipe(url) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  var vid = ytId_(url);
  var raw;
  try {
    raw = fetchPage_(vid ? 'https://www.youtube.com/watch?v=' + vid : url);
  } catch (e) {
    return { error: 'unreadable' };
  }
  if (!raw) return { error: 'unreadable' };
  var out;
  try {
    out = parseRecipeHtml_(raw, vid);
  } catch (e) {
    return { error: 'parse' };
  }
  if (out.error) return out;
  return translateDraft_(out);
}
