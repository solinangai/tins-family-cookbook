/**
 * Tin's Family Cookbook — Google Apps Script backend
 * Serves the cookbook web app and stores everyone's edits in a JSON file
 * ("tins-cookbook-data.json") in the Google Drive of the account that deploys it.
 * Empty Chinese fields are auto-translated from English on save.
 */

var FILE_NAME = 'tins-cookbook-data.json';

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
  try {
    return LanguageApp.translate(t, 'en', 'zh-TW');
  } catch (e) {
    return '';
  }
}

function hasCJK_(t) {
  return /[一-鿿]/.test(t || '');
}

function autoTranslate_(r) {
  if (r.en && !r.cn) r.cn = tzh_(r.en);
  (r.ing || []).forEach(function (i) {
    if (i[1] && !i[2]) i[2] = tzh_(i[1]);
  });
  (r.steps || []).forEach(function (s) {
    if (s[0] && !s[1]) s[1] = tzh_(s[0]);
  });
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

function saveRecipe(obj) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    obj = autoTranslate_(obj);
    var d = readData_();
    if (obj.id && String(obj.id).charAt(0) === 'u') {
      obj.custom = true;
      var i = d.custom.findIndex(function (x) { return x.id === obj.id; });
      if (i >= 0) d.custom[i] = obj; else d.custom.push(obj);
    } else if (obj.id) {
      d.overrides[obj.id] = obj;
    } else {
      obj.id = 'u' + Date.now();
      obj.custom = true;
      d.custom.push(obj);
    }
    writeData_(d);
    return obj;
  } finally {
    lock.releaseLock();
  }
}

function deleteRecipe(id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = readData_();
    d.custom = d.custom.filter(function (x) { return x.id !== id; });
    writeData_(d);
    return true;
  } finally {
    lock.releaseLock();
  }
}

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
