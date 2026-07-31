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
 * v6 makes opening the app fast, and adds the things the family asked for:
 *  - Photos no longer live inside the data file. Each one is saved once, under
 *    its own fingerprint, in a "Tin's Cookbook Photos" folder in this Drive.
 *    A recipe just holds a short reference like "ph:9f2c...". Phones fetch a
 *    photo only when it scrolls into view, then keep it forever. The data file
 *    drops from ~9 MB to a few hundred KB.
 *  - Every change bumps a revision number, and every dish carries the revision
 *    it was last touched at. A phone says "I know up to revision N" and gets
 *    back only what changed since. Opening the app is then almost free.
 *  - Courses are editable by the family (no longer fixed in the app).
 *  - Menus are stored here too, one per shelf per day, so whatever is picked
 *    shows up on the helper's phone straight away, and VT, MT and CT — who do
 *    not share a kitchen — each keep their own plan.
 *  Run migratePhotos() ONCE from the editor after installing this.
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
var PHOTO_FOLDER = "Tin's Cookbook Photos";
var DEFAULT_COURSES = [
  { key: 'breakfast', en: 'Breakfast', cn: '早餐' },
  { key: 'lunch',     en: 'Lunch',     cn: '午餐' },
  { key: 'soup',      en: 'Soup',      cn: '湯水' },
  { key: 'appetizer', en: 'Appetiser', cn: '前菜' },
  { key: 'main',      en: 'Main',      cn: '主菜' },
  { key: 'dessert',   en: 'Sweet',     cn: '糖水' },
  { key: 'baby',      en: 'Baby Food', cn: '嬰兒食物' }
];

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
    if (action === 'get') out = { ok: true, data: getData(payload) };
    else if (action === 'photos') out = { ok: true, data: getPhotos(payload) };
    else if (action === 'rephoto') out = { ok: true, data: replacePhoto(payload) };
    else if (action === 'menu') out = { ok: true, data: saveMenu(payload) };
    else if (action === 'courses') out = { ok: true, data: saveCourses(payload) };
    else if (action === 'note') out = { ok: true, data: saveNote(payload) };
    else if (action === 'unnote') out = { ok: true, data: deleteNote(payload) };
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
  for (var k in d.overrides) {
    var o = d.overrides[k];
    if (o === 'deleted' || (o && o.del)) hidden++; else edited++;
  }
  var photos = 0;
  try {
    var it = photoFolder_().getFiles();
    while (it.hasNext()) { it.next(); photos++; }
  } catch (e) {}
  var msg = 'Cookbook data: ' + (d.custom || []).length + ' dishes added by the family, ' +
            edited + ' built-in dishes edited, ' + hidden + ' hidden, ' +
            'revision ' + (d.rev == null ? '(not migrated)' : d.rev) + ', ' +
            photos + ' photos stored separately, ' +
            raw.length + ' characters in the data file.';
  Logger.log(msg);
  Logger.log('Added dishes: ' + (d.custom || []).map(function (r) { return r.en || r.cn; }).join(' | '));
  return msg;
}

/* ---------- photos live outside the data file ----------

   A photo taken on a phone arrives as a "data:image/jpeg;base64,..." string.
   Kept inside the recipe, a few dozen of those turn the cookbook into a
   multi-megabyte download that every phone repeats on every open.

   So each photo is written once into its own small Drive file, named after a
   fingerprint of its contents, and the recipe keeps only "ph:<fingerprint>".
   Identical photos therefore cost nothing twice, a photo never changes once
   written, and a phone that has already seen it never asks again.            */

function photoFolder_() {
  var it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(PHOTO_FOLDER);
}

function photoHash_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] + 256) % 256;
    out += (v < 16 ? '0' : '') + v.toString(16);
  }
  return out;
}

function cleanHash_(h) { return String(h || '').replace(/[^a-f0-9]/gi, '').toLowerCase(); }

var PHOTO_EXPECTED = 220000;   // characters; the app shrinks well below this

/**
 * Stores a data-URL photo (if new) and returns the short reference for it.
 * A photo is never rejected for being big — losing someone's picture would be
 * worse than storing it — but an unusually large one is noted in the log, since
 * it means a phone is running an old copy of the app that does not shrink.
 */
function putPhoto_(dataUrl) {
  if (dataUrl.length > PHOTO_EXPECTED) {
    Logger.log('Large photo stored (' + Math.round(dataUrl.length / 1400) +
               ' KB) — that phone may be running an old copy of the app.');
  }
  var h = photoHash_(dataUrl);
  var name = h + '.txt';
  var folder = photoFolder_();
  if (!folder.getFilesByName(name).hasNext()) folder.createFile(name, dataUrl, 'text/plain');
  return 'ph:' + h;
}

/** One photo back as a data URL. */
function getPhoto(h) {
  var name = cleanHash_(h);
  if (!name) return '';
  var it = photoFolder_().getFilesByName(name + '.txt');
  return it.hasNext() ? it.next().getBlob().getDataAsString() : '';
}

/** Several photos at once: { fingerprint: dataUrl }. Missing ones are skipped. */
function getPhotos(list) {
  var out = {};
  if (!list || !list.length) return out;
  var folder = photoFolder_();
  for (var i = 0; i < list.length && i < 12; i++) {
    var name = cleanHash_(list[i]);
    if (!name || out[name]) continue;
    try {
      var it = folder.getFilesByName(name + '.txt');
      if (it.hasNext()) out[name] = it.next().getBlob().getDataAsString();
    } catch (e) {}
  }
  return out;
}

/**
 * Swaps a stored photo for a lighter version of the same picture.
 * The file keeps its name, so no recipe has to change and nobody's cookbook is
 * rewritten — only the photo itself gets smaller. Used by "Make stored photos
 * smaller" in the app's Settings, for pictures saved before the app began
 * shrinking them on the way in. A photo is never replaced by a bigger one.
 */
function replacePhoto(payload) {
  var h = cleanHash_(payload && payload.h);
  var data = String((payload && payload.data) || '');
  if (!h || data.indexOf('data:image') !== 0) throw new Error('That is not a photo.');
  var it = photoFolder_().getFilesByName(h + '.txt');
  if (!it.hasNext()) return 0;
  var f = it.next();
  var was = f.getBlob().getDataAsString().length;
  if (data.length >= was) return 0;
  f.setContent(data);
  return was - data.length;
}

/** Replaces any inline photo on a recipe with a reference. Safe to re-run. */
function externalisePhotos_(r) {
  if (!r || typeof r !== 'object') return r;
  if (typeof r.img === 'string' && r.img.indexOf('data:image') === 0) r.img = putPhoto_(r.img);
  (r.steps || []).forEach(function (s) {
    if (s && typeof s[2] === 'string' && s[2].indexOf('data:image') === 0) s[2] = putPhoto_(s[2]);
  });
  return r;
}

/* ---------- revisions ----------

   The data file carries a counter. Every change bumps it, and stamps the dish
   that changed with the new value. A phone remembers the highest number it has
   seen; next time it asks only for dishes stamped higher than that.          */

/** Fills in the v6 fields on older data. Returns true if anything was added. */
function ensureRev_(d) {
  var changed = false;
  if (!d.tombs) { d.tombs = []; changed = true; }
  if (!d.menus) {
    d.menus = {};
    if (d.menu && d.menu.date) {          // carry an older single menu over to VT
      d.menu.book = 'VT';
      d.menus['VT|' + d.menu.date] = d.menu;
    }
    changed = true;
  }
  // Menus saved before shelves existed sit under a bare date; move them to VT.
  for (var mk in d.menus) {
    if (mk.indexOf('|') < 0) {
      d.menus['VT|' + mk] = d.menus[mk];
      d.menus['VT|' + mk].book = 'VT';
      delete d.menus[mk];
      changed = true;
    }
  }
  if (!d.courses || !d.courses.length) { d.courses = DEFAULT_COURSES.slice(); changed = true; }
  if (d.rev == null) {
    d.rev = 1;
    for (var k in d.overrides) {
      var o = d.overrides[k];
      if (o === 'deleted') d.overrides[k] = { del: true, rev: 1 };
      else if (o && typeof o === 'object') o.rev = 1;
    }
    (d.custom || []).forEach(function (c) { c.rev = 1; });
    changed = true;
  }
  return changed;
}

function bumpRev_(d) { d.rev = (d.rev || 0) + 1; return d.rev; }

/**
 * ONE-OFF, run from the editor: moves every photo already inside the data file
 * out into the photo folder, and stamps the first revision numbers.
 * It stops after four minutes so it never hits the Apps Script time limit —
 * if the log says "RUN IT AGAIN", just press Run once more. Re-running is
 * harmless: photos already moved are left alone.
 */
function migratePhotos() {
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var before = getFile_().getBlob().getDataAsString().length;
    backupNow('before-photo-move');
    var d = readData_();
    ensureRev_(d);

    var items = (d.custom || []).slice();
    for (var k in d.overrides) {
      var o = d.overrides[k];
      if (o && typeof o === 'object' && !o.del) items.push(o);
    }

    var started = new Date().getTime();
    var checked = 0, shrank = 0, finished = true;
    for (var i = 0; i < items.length; i++) {
      var was = JSON.stringify(items[i]).length;
      externalisePhotos_(items[i]);
      checked++;
      if (JSON.stringify(items[i]).length < was) shrank++;
      if (new Date().getTime() - started > 240000) { finished = false; break; }
    }

    writeData_(d);
    var after = getFile_().getBlob().getDataAsString().length;
    Logger.log('Photo move: checked ' + checked + ' of ' + items.length + ' dishes, ' +
               shrank + ' had photos moved out.');
    Logger.log('Data file: ' + before + ' -> ' + after + ' characters.');
    Logger.log(finished ? 'FINISHED. Nothing else to do.' : 'NOT FINISHED — press Run again to continue.');
    return finished;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- translation ---------- */

function tzh_(t) {
  if (!t) return '';
  try { return LanguageApp.translate(t, 'en', 'zh-TW'); } catch (e) { return ''; }
}

/** The other direction: a dish written in Chinese gets its English filled in. */
function ten_(t) {
  if (!t) return '';
  try { return LanguageApp.translate(t, 'zh-TW', 'en'); } catch (e) { return ''; }
}

function hasCJK_(t) { return /[\u4e00-\u9fff]/.test(t || ''); }

/* A line with Chinese in it and no more Latin letters than Chinese characters
   is a Chinese line — "180C" or a brand name in the middle of one does not
   make it English. */
function mostlyCJK_(t) {
  var cjk = (String(t || '').match(/[\u4e00-\u9fff]/g) || []).length;
  var lat = (String(t || '').match(/[A-Za-z]/g) || []).length;
  return cjk > 0 && cjk >= lat;
}

/* Whichever language a pair is missing is the one that gets filled in. Writing
   the cookbook in Chinese now works exactly as writing it in English does:
   leave the other box empty and it is written for you on saving. Nothing
   already typed is ever replaced. */
function pair_(a, b) {
  if (a && !b) return [a, tzh_(a)];
  if (b && !a) return [ten_(b) || b, b];   /* if it fails, show what was typed */
  return [a, b];
}

function autoTranslate_(r) {
  if (!r || typeof r !== 'object') return r;

  var name = pair_(r.en, r.cn);
  r.en = name[0]; r.cn = name[1];

  (r.ing || []).forEach(function (i) {
    var p = pair_(i[1], i[2]); i[1] = p[0]; i[2] = p[1];
  });
  (r.steps || []).forEach(function (s) {
    var p = pair_(s[0], s[1]); s[0] = p[0]; s[1] = p[1];
  });

  /* The family note is one piece of text written "English 中文", so the half
     that is missing is added on the side it belongs. */
  if (r.tip) {
    if (!hasCJK_(r.tip)) {
      var z = tzh_(r.tip);
      if (z && z !== r.tip) r.tip = r.tip + ' ' + z;
    } else if (mostlyCJK_(r.tip)) {
      var e = ten_(r.tip);
      if (e && e !== r.tip) r.tip = e + ' ' + r.tip;
    }
  }
  return r;
}

/* ---------- API called from the web page ---------- */

/**
 * What a phone asks for on opening.
 * Pass the highest revision that phone already has and it gets back only the
 * dishes changed since — usually nothing at all. Pass nothing and it gets
 * everything. Today's menu and the course list are tiny, so they always come.
 */
function getData(since) {
  var d = readData_();

  if (d.rev == null) {              // not migrated yet: send it all, as before
    return {
      rev: 0, full: true,
      overrides: d.overrides, custom: d.custom, tombs: [],
      courses: d.courses || DEFAULT_COURSES, menu: d.menu || null, menus: futureMenus_(d),
      notes: d.notes || []
    };
  }

  var known = Number((since && since.since) || since || 0);
  /* Courses, menus and notes are small and always sent whole — a phone that has
     been away for a week gets the current board either way. */
  var head = { rev: d.rev, courses: d.courses || DEFAULT_COURSES,
               menu: d.menu || null, menus: futureMenus_(d), notes: d.notes || [] };

  if (known === d.rev) { head.unchanged = true; return head; }

  if (!known || known > d.rev) {    // first time on this phone, or a restore
    head.full = true;
    head.overrides = d.overrides;
    head.custom = d.custom;
    head.tombs = d.tombs || [];
    return head;
  }

  head.delta = true;
  head.overrides = {};
  head.custom = [];
  head.tombs = [];
  for (var k in d.overrides) {
    var o = d.overrides[k];
    if (o && typeof o === 'object' && (o.rev || 0) > known) head.overrides[k] = o;
  }
  (d.custom || []).forEach(function (c) { if ((c.rev || 0) > known) head.custom.push(c); });
  (d.tombs || []).forEach(function (t) { if ((t.rev || 0) > known) head.tombs.push(t); });
  return head;
}

function todayHK_() {
  return Utilities.formatDate(new Date(), 'Asia/Hong_Kong', 'yyyy-MM-dd');
}

/**
 * A menu belongs to a shelf as well as a day: VT, MT and CT do not live in the
 * same kitchen, so each keeps its own plan. The key is "SHELF|YYYY-MM-DD".
 */
function menuKey_(book, date) { return cleanBook_(book) + '|' + date; }
function cleanBook_(b) {
  var v = String(b || '').replace(/[^A-Za-z0-9_-]/g, '').toUpperCase().slice(0, 8);
  return v || 'VT';
}
function menuDate_(key) { return String(key).split('|').pop(); }

/** Days that are still to come (plus today). Yesterday's plans are dropped. */
function futureMenus_(d) {
  var out = {}, today = todayHK_();
  var all = d.menus || {};
  for (var k in all) if (menuDate_(k) >= today) out[k] = all[k];
  return out;
}

/**
 * A day's menu, shared with everyone.
 * Menus are filed by date, so the kitchen can be told about tomorrow, or about
 * a birthday next week, without disturbing what is being cooked today. Saving
 * an empty list simply removes that day.
 */
function saveMenu(m) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = readData_();
    ensureRev_(d);
    if (!d.menus) d.menus = {};

    var date = String((m && m.date) || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A menu needs a date.');
    var book = cleanBook_(m && m.book);
    var key = menuKey_(book, date);

    var rev = bumpRev_(d);
    var items = ((m && m.items) || []).slice(0, 40).map(String);
    if (!items.length) {
      delete d.menus[key];
    } else {
      d.menus[key] = {
        date: date,
        book: book,
        items: items,
        note: String((m && m.note) || '').slice(0, 500),
        occasion: String((m && m.occasion) || '').slice(0, 80),
        by: String((m && m.by) || ''),
        at: new Date().toISOString(),
        rev: rev
      };
    }

    // Keep the file tidy: yesterday and earlier are no longer useful.
    var today = todayHK_();
    for (var k in d.menus) if (menuDate_(k) < today) delete d.menus[k];

    d.menu = null;   // superseded by d.menus, which is per shelf and per day
    writeData_(d);
    return { menus: futureMenus_(d), saved: d.menus[key] || null, rev: rev };
  } finally {
    lock.releaseLock();
  }
}

/** The family's own list of courses. Keys are never renamed, only added. */
function saveCourses(list) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = readData_();
    ensureRev_(d);
    var out = [];
    (list || []).forEach(function (c) {
      var key = String((c && c.key) || '').replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
      if (!key) return;
      for (var i = 0; i < out.length; i++) if (out[i].key === key) return;
      var en = String((c && c.en) || '').slice(0, 40);
      var cn = String((c && c.cn) || '').slice(0, 40);
      if (!en && cn) en = ten_(cn) || cn;
      if (!en) en = key;
      if (!cn) cn = tzh_(en);
      out.push({ key: key, en: en, cn: cn });
    });
    if (!out.length) throw new Error('A cookbook needs at least one course.');
    d.courses = out;
    bumpRev_(d);
    writeData_(d);
    return d.courses;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- the whiteboard ----------

   The one place for the things that are not a recipe: "Ma is off salt this
   week", "the oven trips the switch above 200", "helper away Thursday". They
   belong to the whole family rather than to a shelf or a day, so they are kept
   in one list, newest first, with whoever wrote it and when.

   A note can be pinned, which is what puts it on the front page. Pinned notes
   never fall off the end; unpinned ones do, once there are enough of them. */
var NOTE_KEEP = 80;          // unpinned notes kept, newest first
var NOTE_MAX = 600;          // characters in one note

function noteId_() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function saveNote(n) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = readData_();
    ensureRev_(d);
    if (!d.notes) d.notes = [];

    var text = String((n && n.text) || '').trim().slice(0, NOTE_MAX);
    if (!text) throw new Error('A note needs something written on it.');

    var rev = bumpRev_(d);
    /* The app names a note when it is written, so that starring it a moment
       later cannot arrive as a stranger and be written a second time. Take the
       name, but only the harmless part of it. */
    var id = String((n && n.id) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    var at = new Date().toISOString();
    var book = cleanBook_(n && n.book);
    var pinned = !!(n && n.pinned);
    /* A photographed label or prescription is stored the way a dish photo is:
       once, under its fingerprint, with the note keeping only a reference. */
    var img = String((n && n.img) || '');
    if (img.indexOf('data:image') === 0) img = putPhoto_(img);

    var found = null;
    for (var i = 0; i < d.notes.length; i++) if (d.notes[i].id === id) { found = d.notes[i]; break; }

    if (found) {
      found.text = text;
      found.pinned = pinned;
      found.img = img;
      found.book = book;
      found.editedBy = String((n && n.by) || '');
      found.editedAt = at;
      found.rev = rev;
    } else {
      found = {
        id: id || noteId_(),
        text: text,
        by: String((n && n.by) || ''),
        at: at,
        pinned: pinned,
        img: img,
        book: book,
        rev: rev
      };
      d.notes.unshift(found);
    }

    /* One note at a time sits on a shelf's Cook page. */
    if (pinned) {
      d.notes.forEach(function (x) {
        if (x !== found && cleanBook_(x.book) === book) x.pinned = false;
      });
    }

    /* Trim the tail, but never a pinned note. */
    var kept = [], loose = 0;
    for (var j = 0; j < d.notes.length; j++) {
      var note = d.notes[j];
      if (note.pinned) { kept.push(note); continue; }
      if (loose < NOTE_KEEP) { kept.push(note); loose++; }
    }
    d.notes = kept;

    writeData_(d);
    return { notes: d.notes, saved: found, rev: rev };
  } finally {
    lock.releaseLock();
  }
}

function deleteNote(id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = readData_();
    ensureRev_(d);
    if (!d.notes) d.notes = [];
    var rev = bumpRev_(d);
    d.notes = d.notes.filter(function (n) { return n.id !== String(id || ''); });
    writeData_(d);
    return { notes: d.notes, rev: rev };
  } finally {
    lock.releaseLock();
  }
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
    obj = externalisePhotos_(obj);
    var d = readData_();
    ensureRev_(d);
    obj.rev = bumpRev_(d);
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
      obj.rev = d.rev;
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
    ensureRev_(d);
    var rev = bumpRev_(d);
    if (isCustomId_(id)) {
      d.custom = d.custom.filter(function (x) { return x.id !== id; });
      d.tombs.push({ id: id, rev: rev });   // so other phones drop it too
    } else {
      d.overrides[id] = { del: true, rev: rev };
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
    ensureRev_(d);
    delete d.overrides[id];
    bumpRev_(d);
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

/* A recipe site behind Cloudflare will not answer something that announces
   itself as a script, which is why "fill in from this link" so often came back
   with nothing. Ask the way a browser asks. If that still fails, ask again
   plainly — a few sites prefer it — and only then give up. */
var UA_BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                 '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function fetchPage_(url) {
  var tries = [
    { 'User-Agent': UA_BROWSER,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9,zh-TW;q=0.8' },
    {}
  ];
  for (var i = 0; i < tries.length; i++) {
    try {
      var res = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true, followRedirects: true, headers: tries[i]
      });
      if (res.getResponseCode() < 400) {
        var body = res.getContentText();
        if (body) return body;
      }
    } catch (e) { /* try the next way in */ }
  }
  return '';
}

/* Last resort for a page that will not hand over its HTML: a free reader
   service returns it as plain text, which the description parser can still
   turn into ingredients and steps. No key, no account. */
function fetchAsText_(url) {
  try {
    var res = UrlFetchApp.fetch('https://r.jina.ai/' + url, {
      muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': UA_BROWSER, 'Accept': 'text/plain' }
    });
    if (res.getResponseCode() >= 400) return '';
    return res.getContentText();
  } catch (e) { return ''; }
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

/**
 * Collects the cooking steps.
 * Each entry is { t: "step text", img: "photo for THIS step (may be blank)" }.
 * Recipe sites that publish HowToStep.image give a real picture per step - that
 * is where the photos under "Start cooking" come from. When a source has none,
 * the step simply has no photo and the family can add one from a phone.
 */
function collectSteps_(ri, acc, depth) {
  if (!ri || depth > 4) return;
  if (typeof ri === 'string') {
    var txt = stripTags_(ri);
    if (!txt) return;
    // A single blob of text: split it into sentences so it becomes real steps.
    if (txt.length > 120 && acc.length === 0) {
      var SPLIT = String.fromCharCode(1);
      var parts = txt.replace(/([.\u3002\uFF01!\uFF1F?])\s+/g, '$1' + SPLIT).split(SPLIT);
      var kept = 0;
      parts.forEach(function (p) { p = p.trim(); if (p.length > 2) { acc.push({ t: p, img: '' }); kept++; } });
      if (kept > 1) return;
      while (kept-- > 0) acc.pop();   // only one sentence - keep the blob whole
    }
    acc.push({ t: txt, img: '' });
    return;
  }
  if (Array.isArray(ri)) { for (var i = 0; i < ri.length; i++) collectSteps_(ri[i], acc, depth + 1); return; }
  if (typeof ri === 'object') {
    var ty = String(ri['@type'] || '').toLowerCase();
    if (ty === 'howtosection' && ri.itemListElement) { collectSteps_(ri.itemListElement, acc, depth + 1); return; }
    if (ri.itemListElement) { collectSteps_(ri.itemListElement, acc, depth + 1); return; }
    var s = stripTags_(ri.text || ri.name || '');
    if (s) acc.push({ t: s, img: stepImage_(ri) });
  }
}

/** Picks a usable photo URL off a HowToStep node. */
function stepImage_(node) {
  var u = firstStr_(node.image || node.thumbnailUrl || '');
  if (!u) return '';
  u = String(u).trim();
  return /^https?:\/\//i.test(u) ? u : '';
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
  node = node || {};
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
/* ---------- YouTube ----------

   A YouTube watch page carries no schema.org recipe, so the JSON-LD reader
   below can never find anything there — which is why pasting a video link only
   ever filled in the title. What a cooking video does have is the description,
   and that is where nearly every channel writes the ingredient list and the
   steps out in full. So for a video we read the description and parse that.

   Two ways in, because YouTube does not always answer a server the way it
   answers a phone: the watch page (which carries the full description inside
   ytInitialPlayerResponse), and oEmbed (a small, reliable, key-free endpoint
   that always gives at least the title, author and thumbnail). */

/** Title + full description out of the watch page's player payload. */
function ytPlayer_(raw) {
  var out = { title: '', desc: '' };
  if (!raw) return out;
  var d = raw.match(/"shortDescription":("(?:[^"\\]|\\.)*")/);
  if (d) { try { out.desc = JSON.parse(d[1]); } catch (e) {} }
  var t = raw.match(/"title":\s*\{\s*"simpleText":\s*("(?:[^"\\]|\\.)*")/);
  if (t) { try { out.title = JSON.parse(t[1]); } catch (e) {} }
  if (!out.title) out.title = metaOf_(raw, 'og:title');
  if (!out.desc) out.desc = metaOf_(raw, 'og:description') || metaOf_(raw, 'description');
  return out;
}

/* The watch page is the unreliable part. Apps Script asks from a Google data
   centre, and YouTube frequently answers those with a consent page carrying no
   description at all — which is the whole reason a video import came back with
   only a title. The Data API answers the same question properly, costs one
   unit of a 10,000-a-day free allowance, and needs a key that costs nothing:

     console.cloud.google.com -> a project -> enable "YouTube Data API v3"
     -> Credentials -> Create credentials -> API key
     Apps Script -> Project Settings -> Script Properties -> YOUTUBE_API_KEY

   Without the key everything still works exactly as before; this is only the
   better road when it is available. */
function ytApiKey_() {
  try { return PropertiesService.getScriptProperties().getProperty('YOUTUBE_API_KEY') || ''; }
  catch (e) { return ''; }
}

function ytFromApi_(vid) {
  var key = ytApiKey_();
  if (!key) return null;
  try {
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/youtube/v3/videos?part=snippet&id=' +
      encodeURIComponent(vid) + '&key=' + encodeURIComponent(key),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var j = JSON.parse(res.getContentText());
    var sn = j && j.items && j.items[0] && j.items[0].snippet;
    if (!sn) return null;
    var thumbs = sn.thumbnails || {};
    var best = thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || {};
    return { title: sn.title || '', desc: sn.description || '', img: best.url || '' };
  } catch (e) { return null; }
}

/** Key-free fallback: always answers, even when the watch page is withheld. */
function ytOembed_(vid) {
  try {
    var res = UrlFetchApp.fetch(
      'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + vid),
      { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  } catch (e) { return null; }
}

var YT_ING_HEAD  = /^[\s\-*•>#]*(ingredients?|what you(?:'ll)? need|材\s*料|食\s*材|配\s*料)\s*[:：]?\s*$/i;
var YT_STEP_HEAD = /^[\s\-*•>#]*(instructions?|method|directions?|steps?|how to make|做\s*法|步\s*驟|製\s*法)\s*[:：]?\s*$/i;
var YT_OTHER_HEAD = /^[\s\-*•>#]*(notes?|tips?|nutrition|equipment|chapters?|timestamps?|music|follow|subscribe|about me|小貼士)\s*[:：]?\s*$/i;
/* Channel boilerplate — links, socials, sponsors, chapter timestamps. */
var YT_JUNK = /(https?:\/\/|www\.|@[A-Za-z0-9_]{3,}|#[A-Za-z0-9_]{2,}|subscribe|patreon|instagram|facebook|tiktok|discord|amazon|affiliate|sponsor|^\d{1,2}:\d{2})/i;

/* When a description has no "Ingredients:" header we have to guess, and the
   thing that marks an ingredient is a quantity: either at the front the way
   English writes it ("200g flour"), or at the end the way Chinese does
   ("蝦仁 150克"). A line like "Bake at 180C for 45 min" has neither, so it
   stays out of the list. */
var YT_QTY = /^[\d½¼¾⅓⅔⅛⅜⅝⅞]|\d\s*(g|kg|ml|l|oz|lb|tbsp|tsp|cups?|cloves?|克|毫升|湯匙|茶匙|隻|個|片|條|斤|兩|杯)\.?$/i;

function ytClean_(line) {
  return String(line || '')
    .replace(/^[\s\-*•·▪◆‣●o]+/, '')          /* bullet glyphs */
    .replace(/^\d{1,2}\s*[.)、]\s*/, '')       /* "1." / "2)" / "3、" */
    .replace(/\s+/g, ' ')
    .trim();
}

/** A video description -> { ing:[[emoji,text,'']], steps:[[text,'','']], note } */
function parseYtDescription_(desc) {
  var out = { ing: [], steps: [], note: '' };
  if (!desc) return out;
  var lines = String(desc).split(/\r?\n/);
  var mode = '', sawIngHead = false, loose = [];

  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    var line = ytClean_(raw);
    if (!line) { continue; }

    if (YT_ING_HEAD.test(raw) || YT_ING_HEAD.test(line)) { mode = 'ing'; sawIngHead = true; continue; }
    if (YT_STEP_HEAD.test(raw) || YT_STEP_HEAD.test(line)) { mode = 'step'; continue; }
    if (YT_OTHER_HEAD.test(raw) || YT_OTHER_HEAD.test(line)) { mode = ''; continue; }
    if (YT_JUNK.test(line)) { if (mode) mode = ''; continue; }
    if (line.length > 320) { continue; }

    if (mode === 'ing') {
      out.ing.push([emojiFor_(line), line, '']);
    } else if (mode === 'step') {
      if (line.length > 3) out.steps.push([line, '', '']);
    } else if (!sawIngHead && line.length <= 90 && YT_QTY.test(line)) {
      /* No "Ingredients:" header — collect quantity-looking lines as a guess. */
      loose.push(line);
    } else if (!out.note && line.length > 40) {
      out.note = line;
    }
  }

  /* Nothing was labelled, but several lines looked like quantities: use them. */
  if (!out.ing.length && loose.length >= 3) {
    for (var j = 0; j < loose.length; j++) out.ing.push([emojiFor_(loose[j]), loose[j], '']);
  }
  return out;
}

/* The reader service answers with a short header ("Title:", "URL Source:",
   "Markdown Content:") and then the page as plain text. The ingredients and the
   steps are laid out on a recipe page much as they are in a video description,
   so the same reading works on both. */
function parseTextRecipe_(txt) {
  var out = { title: '', img: '', ing: [], steps: [], note: '' };
  if (!txt) return out;

  var t = txt.match(/^Title:\s*(.+)$/m);
  if (t) out.title = decodeEntities_(t[1]).slice(0, 120);
  var im = txt.match(/^Image URL:\s*(\S+)$/m) || txt.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
  if (im) out.img = im[1];

  var body = txt.replace(/^[\s\S]*?Markdown Content:\s*/, '');
  /* Markdown link syntax turns an ingredient into noise — keep the words. */
  body = body.replace(/\[([^\]]*)\]\((?:[^)]*)\)/g, '$1');

  var got = parseYtDescription_(body);
  out.ing = got.ing;
  out.steps = got.steps;
  out.note = got.note;
  return out;
}

/** A video link -> draft recipe, from the description rather than JSON-LD. */
function parseYouTube_(raw, vid) {
  var img = 'https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg';
  var p = ytPlayer_(raw);
  var title = p.title, desc = p.desc;

  /* The Data API, when a key is set: the only source that reliably carries the
     whole description, which is where the ingredients are written. */
  var api = ytFromApi_(vid);
  if (api) {
    if (api.title) title = api.title;
    if (api.desc) desc = api.desc;
    if (api.img) img = api.img;
  }

  /* The watch page was withheld or unhelpful — ask oEmbed instead. */
  if (!title || !desc) {
    var o = ytOembed_(vid);
    if (o) {
      if (!title) title = o.title || '';
      if (o.thumbnail_url) img = o.thumbnail_url;
    }
  }
  if (!title) return { error: 'no-recipe', img: img };

  var parsed = parseYtDescription_(desc);
  var body = { en: title, cat: guessCat_(null, title), img: img, ytid: vid,
               ing: parsed.ing, steps: parsed.steps, tip: parsed.note };

  /* Only the title came back: say so, so the app can tell the reader that the
     rest needs typing in rather than pretending the import worked. */
  if (!parsed.ing.length && !parsed.steps.length) {
    body.partial = true;
    if (!body.tip && desc) body.tip = String(desc).slice(0, 300);
  }
  return body;
}

function parseRecipeHtml_(raw, vid) {
  /* A video is a different kind of page — read its description, not its markup. */
  if (vid) return parseYouTube_(raw, vid);

  var blocks = ldBlocks_(raw), node = null;
  for (var i = 0; i < blocks.length && !node; i++) {
    try { node = findRecipeNode_(JSON.parse(blocks[i].trim())); } catch (e) {}
  }

  var img = metaOf_(raw, 'og:image') || metaOf_(raw, 'twitter:image');

  if (!node) {
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
  var steps = stepsAcc
    .filter(function (s) { return s && s.t && s.t.length > 1; })
    .map(function (s) { return [s.t, '', s.img || '']; });

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
  return autoTranslate_(r);
}

/**
 * Reads a recipe page or YouTube link and returns a draft recipe in the app's shape.
 * Uses the recipe data that sites publish for Google (schema.org JSON-LD) — so it needs
 * NO AI service and NO API key, and works from anywhere.
 */
/**
 * Why did that link not work?
 *
 * Run this from the Apps Script editor with a link that failed — pick
 * diagnoseImport, put the URL in the line below, press Run, and read the
 * execution log. It reports what each way in actually returned, so the answer
 * is "the site refused us" or "the site answered but publishes no recipe"
 * rather than a guess. Nothing is saved and nothing is changed.
 */
function diagnoseImport(url) {
  url = url || 'https://www.bbcgoodfood.com/recipes/classic-lasagne';   // <- put a failing link here
  url = String(url).trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  var out = ['Link: ' + url];
  var vid = ytId_(url);
  out.push(vid ? 'Looks like a video (' + vid + ')' : 'Looks like a web page');

  if (vid) {
    out.push('YouTube Data API key set: ' + (ytApiKey_() ? 'yes' : 'no — see ytFromApi_ for how to add one'));
    var api = ytFromApi_(vid);
    out.push('  Data API: ' + (api ? 'title "' + api.title + '", description ' + api.desc.length + ' chars'
                                   : 'no answer'));
    var oe = ytOembed_(vid);
    out.push('  oEmbed: ' + (oe ? 'title "' + oe.title + '"' : 'no answer'));
  }

  var raw = '';
  try { raw = fetchPage_(vid ? 'https://www.youtube.com/watch?v=' + vid : url); } catch (e) {}
  out.push('Direct fetch: ' + (raw ? raw.length + ' characters' : 'REFUSED (nothing came back)'));

  if (raw) {
    if (vid) {
      var p = ytPlayer_(raw);
      out.push('  description on the page: ' + (p.desc ? p.desc.length + ' characters' : 'none — probably a consent page'));
    } else {
      var blocks = ldBlocks_(raw), node = null;
      for (var i = 0; i < blocks.length && !node; i++) {
        try { node = findRecipeNode_(JSON.parse(blocks[i].trim())); } catch (e) {}
      }
      out.push('  structured data blocks: ' + blocks.length);
      out.push('  recipe among them: ' + (node ? 'YES — this link should work' : 'no'));
      out.push('  og:title: ' + (metaOf_(raw, 'og:title') || '(none)'));
      out.push('  og:image: ' + (metaOf_(raw, 'og:image') ? 'present' : '(none)'));
    }
  }

  if (!vid) {
    var txt = fetchAsText_(url);
    out.push('Reader fallback: ' + (txt ? txt.length + ' characters' : 'no answer'));
    if (txt) {
      var got = parseTextRecipe_(txt);
      out.push('  title: ' + (got.title || '(none)'));
      out.push('  ingredients found: ' + got.ing.length);
      out.push('  steps found: ' + got.steps.length);
    }
  }

  var verdict = extractRecipe(url);
  out.push('What the app would show: ' + (verdict.error
    ? 'FAILED (' + verdict.error + ')'
    : (verdict.partial ? 'partly filled' : 'filled') +
      ' — ' + (verdict.ing || []).length + ' ingredients, ' + (verdict.steps || []).length + ' steps'));

  var report = out.join('\n');
  Logger.log(report);
  return report;
}

function extractRecipe(url) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  var vid = ytId_(url);
  var raw;
  try {
    raw = fetchPage_(vid ? 'https://www.youtube.com/watch?v=' + vid : url);
  } catch (e) {
    raw = '';
  }
  /* A page we could not open is the end of the road — except for a video, where
     oEmbed can still tell us the title and the thumbnail without the page. */
  var out;
  try {
    out = raw ? parseRecipeHtml_(raw, vid) : { error: 'unreadable' };
  } catch (e) {
    out = { error: 'parse' };
  }

  /* The page was refused, or it publishes no recipe data. Read it as plain
     text and pick the recipe out of that instead — the same reading that gets
     ingredients out of a video description. */
  if (!vid && out.error) {
    var txt = fetchAsText_(url);
    if (txt) {
      var got = parseTextRecipe_(txt);
      if (got.ing.length || got.steps.length) {
        out = {
          en: got.title || (raw ? metaOf_(raw, 'og:title') : '') || '',
          cat: guessCat_(null, got.title || ''),
          img: (raw ? (metaOf_(raw, 'og:image') || metaOf_(raw, 'twitter:image')) : '') || got.img || '',
          ing: got.ing, steps: got.steps, tip: got.note, ytid: ''
        };
        if (!got.ing.length || !got.steps.length) out.partial = true;
      }
    }
  }

  if (out.error) return out;
  return translateDraft_(out);
}
