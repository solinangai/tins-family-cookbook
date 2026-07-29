/**
 * Tin's Family Cookbook — Google Apps Script backend (v2)
 *
 * Serves the cookbook web app and stores everyone's edits in a JSON file
 * ("tins-cookbook-data.json") in the Drive of the account that deploys it.
 *
 * v2 changes vs the original Code.gs:
 *  - custom recipe ids may start with "c" (new app) or "u" (old app)
 *  - overrides[id] may be the string "deleted" (a hidden built-in recipe)
 *  - adds fetchPageText() + extractRecipe(): server-side "fill in from a link"
 *    (the in-preview window.claude.complete helper does NOT exist once deployed)
 *
 * One-time setup for extractRecipe():
 *   Project Settings → Script Properties → add ANTHROPIC_API_KEY = sk-ant-…
 *   Leave it unset and the app still works; the import button just reports
 *   that automatic filling is not configured.
 */

var FILE_NAME = 'tins-cookbook-data.json';
var MODEL = 'claude-haiku-4-5';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle("Tin's Family Cookbook")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/* ---------- storage ---------- */

function getFile_() {
  var it = DriveApp.getFilesByName(FILE_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFile(FILE_NAME, JSON.stringify({ overrides: {}, custom: [] }), 'application/json');
}

function readData_() {
  try {
    var d = JSON.parse(getFile_().getBlob().getDataAsString());
    if (!d || typeof d !== 'object') d = {};
    if (!d.overrides) d.overrides = {};
    if (!d.custom) d.custom = [];
    return d;
  } catch (e) {
    return { overrides: {}, custom: [] };
  }
}

function writeData_(d) {
  getFile_().setContent(JSON.stringify(d));
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
    var d = readData_();
    delete d.overrides[id];
    writeData_(d);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- "fill in from a link" ---------- */

function ytId_(u) {
  var m = String(u || '').match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : '';
}

/** Fetches a page server-side (no CORS limits here) and returns {text, img}. */
function fetchPageText(url) {
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TinsCookbook/1.0)' }
  });
  if (res.getResponseCode() >= 400) return { text: '', img: '' };
  var raw = res.getContentText();

  var img = '';
  var og = raw.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/i);
  if (og) img = og[1];

  var text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  return { text: text.slice(0, 14000), img: img };
}

/**
 * Reads a recipe page or YouTube link and returns a draft recipe object
 * in the app's own shape: {en, cn, cat, time, serves, ing, steps, tip, img, ytid}.
 */
function extractRecipe(url) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { error: 'not-configured' };

  var vid = ytId_(url);
  var page = fetchPageText(vid ? 'https://www.youtube.com/watch?v=' + vid : url);
  var cover = vid ? 'https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg' : page.img;
  if (!page.text) return { error: 'unreadable', img: cover };

  var prompt =
    'From the page text below, extract ONE recipe. Reply with JSON only, this exact shape:\n' +
    '{"en":"dish name in English","cn":"菜名（繁體中文）","cat":"breakfast|lunch|soup|appetizer|main|dessert",' +
    '"time":"e.g. 30 min","serves":"e.g. 4","ing":[["emoji","ingredient + amount in English","材料及份量（繁體中文）"]],' +
    '"steps":[["step in plain English","步驟（繁體中文）"]],"tip":"one short tip, English then 中文"}\n' +
    'Always fill BOTH languages. One food emoji per ingredient. Short, practical steps. ' +
    'If there is no recipe, reply {"error":"no recipe"}.\n\nPAGE TEXT:\n' + page.text;

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: 'You extract home-cooking recipes and reply with JSON only — no prose, no code fences.',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (res.getResponseCode() >= 400) return { error: 'api', detail: res.getContentText().slice(0, 300) };

  try {
    var body = JSON.parse(res.getContentText());
    var txt = body.content.map(function (c) { return c.text || ''; }).join('');
    var m = txt.match(/\{[\s\S]*\}/);
    var out = JSON.parse(m[0]);
    if (out.error) return { error: 'no-recipe', img: cover };
    out.img = cover || '';
    out.ytid = vid || '';
    return out;
  } catch (e) {
    return { error: 'parse' };
  }
}
