/**
 * ============================================================
 *  EVENT-DAY CHECK-IN — backend for checkin/index.html
 * ============================================================
 *  Add this as a SECOND script file in the same Apps Script project
 *  as Code.gs (File > + > Script, name it "Checkin"). It shares
 *  CONFIG, STATUS, HEADERS, jsonResponse(), getOrCreateAuditSheet_()
 *  etc. with Code.gs, so it does not work on its own.
 *
 *  FLOW
 *  ---------------------------------------------------------
 *  1. Staff sign in on the scanner page with a 6-digit PIN.
 *  2. Scan a ticket QR (or search by name / Reg ID).
 *     - Approved and not yet used  -> VALID, shows name + ticket count
 *     - Already checked in         -> USED, shows when and by whom
 *     - Unknown QR / not approved  -> INVALID, with the reason
 *  3. Staff take a photo of the registrant's ID, then tap Confirm.
 *  4. Confirm runs under a script lock and re-checks the row, so if
 *     two phones confirm the same ticket at once only the first one
 *     goes through. The row is marked checked in, struck through and
 *     greyed out, and can never be checked in again unless the admin
 *     undoes it (with a reason, logged).
 *
 *  STAFF & PINS
 *  ---------------------------------------------------------
 *  Staff live in the "_Staff" sheet: Staff ID, Name, Role (Admin or
 *  Staff), Active, PIN Hash. Only a hash of each PIN is stored, so
 *  anyone who can open the spreadsheet still can't read the PINs.
 *  - Menu > Set Up Event Check-in: creates the sheet and 5 accounts
 *    (Jason as Admin, Team 1-4 as Staff) and shows the PINs ONCE.
 *  - Menu > Reset a Check-in PIN: new PIN for one Staff ID.
 *  - To lock someone out immediately, set their Active cell to "No".
 *  - Rename "Team 1" etc. freely in the Name column; names show on
 *    the scanner and in the sheet as "Checked In By".
 *
 *  Only the Admin role can undo a check-in or open ID photos.
 *
 *  ID PHOTOS
 *  ---------------------------------------------------------
 *  Saved to the private Drive folder "Wakas at Simula - Check-in ID
 *  Photos" (never link-shared). Delete the folder after the event,
 *  in line with the Data Privacy Notice.
 * ============================================================
 */

const CHECKIN = {
  STAFF_SHEET_NAME: '_Staff',
  STAFF_HEADERS: ['Staff ID', 'Name', 'Role', 'Active', 'PIN Hash', 'Notes'],
  DEFAULT_STAFF: [
    ['S1', 'Jason', 'Admin'],
    ['S2', 'Team 1', 'Staff'],
    ['S3', 'Team 2', 'Staff'],
    ['S4', 'Team 3', 'Staff'],
    ['S5', 'Team 4', 'Staff'],
  ],

  // Added to the right end of the Registrations sheet the first time
  // check-in runs. Found by header name, so column order doesn't matter.
  EXTRA_HEADERS: ['Checked In At', 'Checked In By', 'Check-in Method', 'Admitted As (Transfer)', 'ID Photo URL'],

  ID_FOLDER_NAME: 'Wakas at Simula - Check-in ID Photos',

  SESSION_SECONDS: 21600, // 6 hours, the CacheService maximum
  HOLD_SECONDS: 180, // "Team 2 has this ticket open" warning window
  PIN_FAIL_LIMIT: 15, // wrong PINs (all phones combined) before a lockout
  PIN_FAIL_WINDOW_SECONDS: 600,
  MAX_PHOTO_BYTES: 4 * 1024 * 1024,

  TEST_PREFIX: 'TEST-',
  TZ: 'Asia/Manila',
};

// ============================================================
//  ROUTER  (called from doPost when ?action=checkin)
// ============================================================

function handleCheckin_(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Malformed request.' });
  }

  try {
    if (req.op === 'login') return jsonResponse(ciLogin_(req));

    const staff = ciSessionStaff_(req.token);
    if (!staff) {
      return jsonResponse({ ok: false, code: 'AUTH', error: 'Your session has ended. Please sign in again.' });
    }

    switch (req.op) {
      case 'lookup':
        return jsonResponse(ciLookup_(req, staff));
      case 'search':
        return jsonResponse(ciSearch_(req, staff));
      case 'confirm':
        return jsonResponse(ciConfirm_(req, staff));
      case 'undo':
        return jsonResponse(ciUndo_(req, staff));
      case 'stats':
        return jsonResponse(ciStats_(staff));
      case 'release':
        ciReleaseHold_(req.key, staff);
        return jsonResponse({ ok: true });
      case 'logout':
        CacheService.getScriptCache().remove('ci_sess_' + req.token);
        return jsonResponse({ ok: true });
      default:
        return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'Unknown operation.' });
    }
  } catch (err) {
    console.error('handleCheckin_ error: ' + err.stack);
    return jsonResponse({ ok: false, code: 'SERVER', error: 'Server error: ' + err.message });
  }
}

// ============================================================
//  STAFF / AUTH
// ============================================================

function ciHashPin_(pin) {
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty('checkinPinSalt');
  if (!salt) {
    salt = Utilities.getUuid();
    props.setProperty('checkinPinSalt', salt);
  }
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return bytes
    .map(function (b) {
      const v = (b + 256) % 256;
      return (v < 16 ? '0' : '') + v.toString(16);
    })
    .join('');
}

function ciNewPin_() {
  // 6 digits, no leading-zero confusion when someone types it into a number field.
  return String(100000 + Math.floor(Math.random() * 900000));
}

/** Returns [{id, name, role, active, hash, row}] from the _Staff sheet. */
function ciLoadStaff_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CHECKIN.STAFF_SHEET_NAME);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '').trim();
    if (!id) continue;
    out.push({
      id: id,
      name: String(data[i][1] || id).trim(),
      role: String(data[i][2] || '').trim().toLowerCase() === 'admin' ? 'Admin' : 'Staff',
      active: String(data[i][3] || '').trim().toLowerCase() === 'yes',
      hash: String(data[i][4] || '').trim(),
      row: i + 1,
    });
  }
  return out;
}

function ciLogin_(req) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('ci_pinfails') || 0);
  if (fails >= CHECKIN.PIN_FAIL_LIMIT) {
    return { ok: false, code: 'LOCKED', error: 'Too many wrong PINs. Wait 10 minutes, then try again.' };
  }

  const pin = String(req.pin || '').trim();
  let staff = null;
  if (/^\d{6}$/.test(pin)) {
    const hash = ciHashPin_(pin);
    staff = ciLoadStaff_().filter(function (s) { return s.active && s.hash && s.hash === hash; })[0] || null;
  }

  if (!staff) {
    cache.put('ci_pinfails', String(fails + 1), CHECKIN.PIN_FAIL_WINDOW_SECONDS);
    return { ok: false, code: 'BAD_PIN', error: 'Wrong PIN, or this account is switched off.' };
  }

  const token = Utilities.getUuid();
  cache.put('ci_sess_' + token, staff.id, CHECKIN.SESSION_SECONDS);
  ciAudit_(staff, '', '', '', '', 'Signed in to check-in scanner');
  return {
    ok: true,
    token: token,
    staff: { name: staff.name, role: staff.role },
    expiresInSeconds: CHECKIN.SESSION_SECONDS,
  };
}

/** Session -> current staff record. Re-reads _Staff so switching someone to Active = No takes effect at once. */
function ciSessionStaff_(token) {
  if (!token) return null;
  const staffId = CacheService.getScriptCache().get('ci_sess_' + token);
  if (!staffId) return null;
  const staff = ciLoadStaff_().filter(function (s) { return s.id === staffId; })[0];
  if (!staff || !staff.active) return null;
  return staff;
}

// ============================================================
//  REGISTRATIONS SHEET HELPERS
// ============================================================

function ciRegSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
}

/** Header name -> 0-based column index, read from the live header row. */
function ciColumns_(sheet) {
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  header.forEach(function (h, i) {
    const key = String(h || '').trim();
    if (key && map[key] === undefined) map[key] = i;
  });
  return map;
}

/** Adds any missing check-in columns to the right end of the header row. */
function ciEnsureColumns_(sheet) {
  let cols = ciColumns_(sheet);
  const missing = CHECKIN.EXTRA_HEADERS.filter(function (h) { return cols[h] === undefined; });
  if (missing.length) {
    const start = sheet.getLastColumn() + 1;
    sheet
      .getRange(1, start, 1, missing.length)
      .setValues([missing])
      .setFontWeight('bold')
      .setBackground('#111111')
      .setFontColor('#ffffff');
    cols = ciColumns_(sheet);
  }
  ['Registration ID', 'Full Legal Name', 'Ticket Quantity', 'Status', 'QR Token', 'Checked In'].forEach(function (h) {
    if (cols[h] === undefined) throw new Error('Registrations sheet is missing the "' + h + '" column.');
  });
  return cols;
}

function ciCell_(rowValues, cols, header) {
  return cols[header] === undefined ? '' : rowValues[cols[header]];
}

function ciFormatTime_(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return Utilities.formatDate(d, CHECKIN.TZ, 'MMM d, h:mm a');
}

function ciIsYes_(value) {
  return String(value || '').trim().toLowerCase() === 'yes';
}

/** Builds the record the scanner page shows. Never includes email or phone. */
function ciRecord_(rowValues, cols, staff) {
  const regId = String(ciCell_(rowValues, cols, 'Registration ID') || '');
  const rec = {
    key: String(ciCell_(rowValues, cols, 'QR Token') || '').trim(),
    regId: regId,
    name: String(ciCell_(rowValues, cols, 'Full Legal Name') || ''),
    qty: Number(ciCell_(rowValues, cols, 'Ticket Quantity')) || 0,
    status: String(ciCell_(rowValues, cols, 'Status') || ''),
    adminNotes: String(ciCell_(rowValues, cols, 'Admin Notes') || ''),
    checkedIn: ciIsYes_(ciCell_(rowValues, cols, 'Checked In')),
    checkedInAt: ciFormatTime_(ciCell_(rowValues, cols, 'Checked In At')),
    checkedInBy: String(ciCell_(rowValues, cols, 'Checked In By') || ''),
    method: String(ciCell_(rowValues, cols, 'Check-in Method') || ''),
    admittedAs: String(ciCell_(rowValues, cols, 'Admitted As (Transfer)') || ''),
    isTest: regId.toUpperCase().indexOf(CHECKIN.TEST_PREFIX) === 0,
  };
  if (staff && staff.role === 'Admin') {
    rec.idPhotoUrl = String(ciCell_(rowValues, cols, 'ID Photo URL') || '');
  }
  return rec;
}

/** Built on demand so this file never depends on Code.gs having loaded first. */
function ciStatusReason_(status) {
  const reasons = {};
  reasons[STATUS.PENDING] = 'Payment not yet verified. This registration was never approved.';
  reasons[STATUS.NEEDS_CORRECTION] = 'Payment mismatch. This registration was never approved.';
  reasons[STATUS.REJECTED] = 'This registration was rejected.';
  reasons[STATUS.CANCELLED] = 'This registration was cancelled.';
  reasons[STATUS.EXPIRED] = 'This reservation expired and its seats were released.';
  return reasons[status] || 'Status is "' + (status || 'blank') + '", not Approved.';
}

/** VALID | USED | INVALID, plus a human reason for INVALID. */
function ciVerdict_(rec) {
  if (rec.checkedIn) return { verdict: 'USED', reason: 'This ticket has already been checked in.' };
  if (rec.status !== STATUS.APPROVED) {
    return {
      verdict: 'INVALID',
      reason: ciStatusReason_(rec.status),
    };
  }
  return { verdict: 'VALID', reason: '' };
}

/**
 * Finds the data row (0-based index into getValues()) by QR token.
 * Every operation after the first lookup identifies a ticket by its QR
 * token ("key"), never by Reg ID: Reg IDs come from the row count and
 * can repeat if rows were ever deleted, while tokens are random UUIDs.
 */
function ciFindRow_(data, cols, key) {
  const needle = String(key || '').trim().toLowerCase();
  if (!needle) return -1;
  const col = cols['QR Token'];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col] || '').trim().toLowerCase() === needle) return i;
  }
  return -1;
}

/** Pulls a token out of whatever the camera read (plain token, or a URL with ?t=). */
function ciNormalizeQr_(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/[?&](?:t|token|qr)=([^&#]+)/i);
  return m ? decodeURIComponent(m[1]).trim() : s;
}

// ============================================================
//  "SOMEONE ELSE HAS THIS OPEN" HOLDS
// ============================================================

function ciHoldKey_(key) {
  return 'ci_hold_' + String(key).toLowerCase();
}

/** Records that this staff member has the ticket open; returns a warning if someone else already does. */
function ciTakeHold_(key, staff) {
  const cache = CacheService.getScriptCache();
  const holdKey = ciHoldKey_(key);
  let warning = null;
  const raw = cache.get(holdKey);
  if (raw) {
    try {
      const hold = JSON.parse(raw);
      if (hold.staffId !== staff.id) {
        warning = {
          by: hold.name,
          secondsAgo: Math.max(0, Math.round((Date.now() - hold.at) / 1000)),
        };
      }
    } catch (err) {}
  }
  if (!warning) {
    cache.put(holdKey, JSON.stringify({ staffId: staff.id, name: staff.name, at: Date.now() }), CHECKIN.HOLD_SECONDS);
  }
  return warning;
}

function ciReleaseHold_(key, staff) {
  if (!key) return;
  const cache = CacheService.getScriptCache();
  const holdKey = ciHoldKey_(key);
  const raw = cache.get(holdKey);
  if (!raw) return;
  try {
    if (JSON.parse(raw).staffId === staff.id) cache.remove(holdKey);
  } catch (err) {
    cache.remove(holdKey);
  }
}

// ============================================================
//  OPERATIONS
// ============================================================

/** Scan (req.qr) or pick from search results (req.key). Read-only apart from the hold. */
function ciLookup_(req, staff) {
  const sheet = ciRegSheet_();
  const cols = ciColumns_(sheet);
  const data = sheet.getDataRange().getValues();

  const byQr = !!req.qr;
  const idx = ciFindRow_(data, cols, byQr ? ciNormalizeQr_(req.qr) : req.key);

  if (idx === -1) {
    return {
      ok: true,
      verdict: 'INVALID',
      reason: byQr
        ? 'This QR code is not in the registration list. It may be fake or from another event.'
        : 'That registration could not be found. Search again.',
      record: null,
    };
  }

  const rec = ciRecord_(data[idx], cols, staff);
  const v = ciVerdict_(rec);
  const result = { ok: true, verdict: v.verdict, reason: v.reason, record: rec, method: byQr ? 'QR scan' : 'Manual search' };
  if (v.verdict === 'VALID') result.holdWarning = ciTakeHold_(rec.key, staff);
  return result;
}

/** Name / Reg ID search for people without their QR. */
function ciSearch_(req, staff) {
  const q = String(req.q || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (q.length < 2) return { ok: true, results: [] };

  const sheet = ciRegSheet_();
  const cols = ciColumns_(sheet);
  const data = sheet.getDataRange().getValues();
  const words = q.split(' ');
  const results = [];

  for (let i = 1; i < data.length; i++) {
    const regId = String(ciCell_(data[i], cols, 'Registration ID') || '');
    if (!regId) continue;
    const hay = (String(ciCell_(data[i], cols, 'Full Legal Name') || '') + ' ' + regId).toLowerCase();
    const hit = words.every(function (w) { return hay.indexOf(w) !== -1; });
    if (!hit) continue;
    const rec = ciRecord_(data[i], cols, staff);
    results.push({
      key: rec.key,
      regId: rec.regId,
      name: rec.name,
      qty: rec.qty,
      verdict: ciVerdict_(rec).verdict,
      status: rec.status,
    });
  }

  results.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { ok: true, results: results.slice(0, 25), more: results.length > 25 };
}

/** The one write that matters. Locked + re-checked so a ticket can only ever be admitted once. */
function ciConfirm_(req, staff) {
  const key = String(req.key || '').trim();
  if (!key) return { ok: false, code: 'BAD_REQUEST', error: 'Missing ticket.' };

  const photo = String(req.photoBase64 || '');
  if (!photo) return { ok: false, code: 'NO_PHOTO', error: 'Take a photo of the ID before confirming.' };
  if (Math.floor((photo.length * 3) / 4) > CHECKIN.MAX_PHOTO_BYTES) {
    return { ok: false, code: 'PHOTO_TOO_BIG', error: 'ID photo is too large. Retake it and try again.' };
  }

  let transferName = String(req.transferName || '').trim().replace(/\s+/g, ' ');
  if (req.isTransfer) {
    if (transferName.length < 2 || transferName.length > 120) {
      return { ok: false, code: 'BAD_TRANSFER', error: 'Enter the full name of the person the ticket was transferred to.' };
    }
  } else {
    transferName = '';
  }

  const method = req.method === 'Manual search' ? 'Manual search' : 'QR scan';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return { ok: false, code: 'BUSY', error: 'The system is busy. Tap Confirm again in a few seconds.' };
  }

  let rowNum, cols, sheet, rec;
  const now = new Date();
  try {
    sheet = ciRegSheet_();
    cols = ciEnsureColumns_(sheet);
    const data = sheet.getDataRange().getValues();
    const idx = ciFindRow_(data, cols, key);
    if (idx === -1) return { ok: true, verdict: 'INVALID', reason: 'This ticket is no longer in the registration list.', record: null };

    rec = ciRecord_(data[idx], cols, staff);
    const v = ciVerdict_(rec);
    if (v.verdict !== 'VALID') {
      // Lost the race to another phone, or the status changed after the scan.
      return { ok: true, verdict: v.verdict, reason: v.reason, record: rec };
    }

    rowNum = idx + 1;
    const set = function (header, value) {
      if (cols[header] !== undefined) sheet.getRange(rowNum, cols[header] + 1).setValue(value);
    };
    set('Checked In', 'Yes');
    set('Checked In At', now);
    set('Checked In By', staff.name);
    set('Check-in Method', method);
    set('Admitted As (Transfer)', transferName ? sanitizeForSheet_(transferName) : '');
    set('Last Updated', now);
    ciStrikeRow_(sheet, rowNum, true);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // Outside the lock: the check-in is already final, the photo is the record of it.
  let photoSaved = false;
  try {
    const url = ciSaveIdPhoto_(photo, rec.regId);
    if (cols['ID Photo URL'] !== undefined) sheet.getRange(rowNum, cols['ID Photo URL'] + 1).setValue(url);
    photoSaved = true;
  } catch (err) {
    console.error('ID photo save failed for ' + rec.regId + ': ' + err.message);
  }

  ciAudit_(
    staff,
    rec.regId,
    'Checked In',
    'No',
    'Yes',
    'Admitted ' + rec.qty + ' ticket(s) via ' + method +
      (transferName ? '; transferred, admitted as ' + transferName : '') +
      (photoSaved ? '' : '; ID PHOTO FAILED TO SAVE')
  );

  CacheService.getScriptCache().remove(ciHoldKey_(rec.key));

  rec.checkedIn = true;
  rec.checkedInAt = ciFormatTime_(now);
  rec.checkedInBy = staff.name;
  rec.method = method;
  rec.admittedAs = transferName;
  return { ok: true, verdict: 'ADMITTED', record: rec, photoSaved: photoSaved };
}

/** Admin only. Reverses a check-in so the ticket can be scanned again. */
function ciUndo_(req, staff) {
  if (staff.role !== 'Admin') return { ok: false, code: 'FORBIDDEN', error: 'Only the admin can undo a check-in.' };
  const reason = String(req.reason || '').trim();
  if (reason.length < 3) return { ok: false, code: 'BAD_REQUEST', error: 'Type a reason for the undo.' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, code: 'BUSY', error: 'The system is busy. Try again in a few seconds.' };

  try {
    const sheet = ciRegSheet_();
    const cols = ciEnsureColumns_(sheet);
    const data = sheet.getDataRange().getValues();
    const idx = ciFindRow_(data, cols, req.key);
    if (idx === -1) return { ok: false, code: 'NOT_FOUND', error: 'That registration could not be found.' };

    const before = ciRecord_(data[idx], cols, staff);
    if (!before.checkedIn) return { ok: false, code: 'NOT_CHECKED_IN', error: 'This ticket is not checked in.' };

    const rowNum = idx + 1;
    const now = new Date();
    const note =
      '[' + ciFormatTime_(now) + '] Check-in undone by ' + staff.name + ': ' + reason +
      '. Was checked in ' + before.checkedInAt + ' by ' + before.checkedInBy +
      (before.admittedAs ? ', admitted as ' + before.admittedAs : '') +
      (before.idPhotoUrl ? '. ID photo: ' + before.idPhotoUrl : '') + '.';

    const set = function (header, value) {
      if (cols[header] !== undefined) sheet.getRange(rowNum, cols[header] + 1).setValue(value);
    };
    set('Checked In', 'No');
    set('Checked In At', '');
    set('Checked In By', '');
    set('Check-in Method', '');
    set('Admitted As (Transfer)', '');
    set('ID Photo URL', '');
    set('Admin Notes', sanitizeForSheet_(before.adminNotes ? before.adminNotes + '\n' + note : note));
    set('Last Updated', now);
    ciStrikeRow_(sheet, rowNum, false);
    SpreadsheetApp.flush();

    ciAudit_(staff, before.regId, 'Checked In', 'Yes', 'No', 'Check-in UNDONE: ' + reason);

    const after = ciRecord_(sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0], cols, staff);
    return { ok: true, verdict: ciVerdict_(after).verdict, record: after };
  } finally {
    lock.releaseLock();
  }
}

function ciStats_(staff) {
  const sheet = ciRegSheet_();
  const cols = ciColumns_(sheet);
  const data = sheet.getDataRange().getValues();
  const s = { approvedRegs: 0, approvedTickets: 0, inRegs: 0, inTickets: 0, testRows: 0 };
  const recent = [];

  for (let i = 1; i < data.length; i++) {
    const rec = ciRecord_(data[i], cols, null);
    if (!rec.regId) continue;
    if (rec.isTest) s.testRows++;
    if (rec.status === STATUS.APPROVED) {
      s.approvedRegs++;
      s.approvedTickets += rec.qty;
    }
    if (rec.checkedIn) {
      s.inRegs++;
      s.inTickets += rec.qty;
      const at = ciCell_(data[i], cols, 'Checked In At');
      recent.push({ name: rec.admittedAs || rec.name, qty: rec.qty, by: rec.checkedInBy, at: rec.checkedInAt, t: at ? new Date(at).getTime() : 0 });
    }
  }

  recent.sort(function (a, b) { return b.t - a.t; });
  return {
    ok: true,
    stats: s,
    recent: recent.slice(0, 8).map(function (r) { return { name: r.name, qty: r.qty, by: r.by, at: r.at }; }),
    me: { name: staff.name, role: staff.role },
  };
}

// ============================================================
//  SHEET FORMATTING, PHOTOS, AUDIT
// ============================================================

function ciStrikeRow_(sheet, rowNum, on) {
  const range = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn());
  if (on) {
    range.setFontLine('line-through').setFontColor('#9e9e9e').setBackground('#eeeeee');
  } else {
    range.setFontLine('none').setFontColor('#000000').setBackground(null);
  }
}

function ciIdFolder_() {
  const it = DriveApp.getFoldersByName(CHECKIN.ID_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(CHECKIN.ID_FOLDER_NAME);
}

function ciSaveIdPhoto_(base64, regId) {
  const stamp = Utilities.formatDate(new Date(), CHECKIN.TZ, 'yyyyMMdd-HHmmss');
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), MimeType.JPEG, regId + '_ID_' + stamp + '.jpg');
  // Deliberately NOT link-shared: only the spreadsheet owner can open these.
  return ciIdFolder_().createFile(blob).getUrl();
}

function ciAudit_(staff, regId, column, oldValue, newValue, note) {
  try {
    getOrCreateAuditSheet_().appendRow([
      new Date(),
      'Check-in: ' + staff.name + ' (' + staff.id + ')',
      CONFIG.SHEET_NAME,
      '',
      regId,
      column,
      oldValue,
      newValue,
      note || '',
    ]);
  } catch (err) {
    console.error('ciAudit_ error: ' + err.message);
  }
}

// ============================================================
//  SETUP (menu items — run from the spreadsheet)
// ============================================================

/** Menu: Set Up Event Check-in. Creates _Staff + check-in columns and shows the PINs once. */
function setupCheckin() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let staffSheet = ss.getSheetByName(CHECKIN.STAFF_SHEET_NAME);
  if (staffSheet && staffSheet.getLastRow() > 1) {
    const ans = ui.alert(
      'Check-in is already set up',
      'Generate NEW PINs for every staff account? Old PINs stop working immediately and anyone signed in stays signed in until their session ends.\n\n' +
        'To change just one person, use "Reset a Check-in PIN" instead.',
      ui.ButtonSet.YES_NO
    );
    if (ans !== ui.Button.YES) return;
  }

  ciEnsureColumns_(ciRegSheet_());
  ciIdFolder_();

  if (!staffSheet) staffSheet = ss.insertSheet(CHECKIN.STAFF_SHEET_NAME);
  const existing = ciLoadStaff_();
  const rows = (existing.length ? existing.map(function (s) { return [s.id, s.name, s.role]; }) : CHECKIN.DEFAULT_STAFF);

  const shown = [];
  const values = rows.map(function (r) {
    const pin = ciNewPin_();
    shown.push({ id: r[0], name: r[1], role: r[2], pin: pin });
    return [r[0], r[1], r[2], 'Yes', ciHashPin_(pin), r[2] === 'Admin' ? 'Can undo check-ins and open ID photos' : 'Check-in only'];
  });

  staffSheet.clear();
  staffSheet.getRange(1, 1, 1, CHECKIN.STAFF_HEADERS.length).setValues([CHECKIN.STAFF_HEADERS])
    .setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
  staffSheet.getRange(2, 1, values.length, CHECKIN.STAFF_HEADERS.length).setValues(values);
  staffSheet.setFrozenRows(1);
  staffSheet.autoResizeColumns(1, CHECKIN.STAFF_HEADERS.length);
  staffSheet.getRange(2, 4, 50, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).setAllowInvalid(false).build()
  );
  staffSheet.getRange(2, 3, 50, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Admin', 'Staff'], true).setAllowInvalid(false).build()
  );
  protectSheetOwnerOnly_(staffSheet, 'Check-in staff accounts — owner only');

  ciShowPins_('Check-in PINs', shown);
}

/** Menu: Reset a Check-in PIN. */
function resetCheckinPin() {
  const ui = SpreadsheetApp.getUi();
  const staff = ciLoadStaff_();
  if (!staff.length) {
    ui.alert('Run "Set Up Event Check-in" first.');
    return;
  }
  const list = staff.map(function (s) { return s.id + ' = ' + s.name + ' (' + s.role + ')'; }).join('\n');
  const res = ui.prompt('Reset a Check-in PIN', 'Type the Staff ID to reset:\n\n' + list, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const id = res.getResponseText().trim().toUpperCase();
  const target = staff.filter(function (s) { return s.id.toUpperCase() === id; })[0];
  if (!target) {
    ui.alert('No staff account with ID "' + id + '".');
    return;
  }
  const pin = ciNewPin_();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CHECKIN.STAFF_SHEET_NAME);
  sheet.getRange(target.row, 5).setValue(ciHashPin_(pin));
  sheet.getRange(target.row, 4).setValue('Yes');
  ciShowPins_('New PIN', [{ id: target.id, name: target.name, role: target.role, pin: pin }]);
}

function ciShowPins_(title, list) {
  const rows = list.map(function (p) {
    return '<tr><td>' + escapeHtml_(p.id) + '</td><td>' + escapeHtml_(p.name) + '</td><td>' + escapeHtml_(p.role) +
      '</td><td class="pin">' + p.pin + '</td></tr>';
  }).join('');
  const html =
    '<style>body{font-family:Arial,sans-serif;font-size:13px}table{border-collapse:collapse;width:100%}' +
    'td,th{border:1px solid #bbb;padding:6px 8px;text-align:left}th{background:#111;color:#fff}' +
    '.pin{font-family:monospace;font-size:18px;letter-spacing:3px;font-weight:bold}' +
    '.warn{background:#fff4d6;border:1px solid #e0b84a;padding:8px;margin:10px 0}</style>' +
    '<div class="warn">These PINs are shown <b>only now</b>. Only a scrambled copy is stored. Screenshot this or write them down, ' +
    'then give each person their own PIN privately.</div>' +
    '<table><tr><th>ID</th><th>Name</th><th>Role</th><th>PIN</th></tr>' + rows + '</table>' +
    '<p>Scanner page: <b>' + escapeHtml_(CONFIG.SITE_BASE_URL) + '/checkin/</b></p>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(420), title);
}

// ============================================================
//  TEST TICKETS (for rehearsals — remove before the event)
// ============================================================

/** Menu: Create Check-in Test Tickets. Adds 4 TEST- rows and shows their QR codes on screen. */
function createCheckinTestTickets() {
  const ui = SpreadsheetApp.getUi();
  const sheet = ciRegSheet_();
  ciEnsureColumns_(sheet);

  const existing = sheet.getDataRange().getValues().filter(function (r) {
    return String(r[HEADERS.indexOf('Registration ID')] || '').toUpperCase().indexOf(CHECKIN.TEST_PREFIX) === 0;
  });
  if (existing.length) {
    const ans = ui.alert('Test tickets already exist', 'Remove the old test tickets first? (Recommended)', ui.ButtonSet.YES_NO);
    if (ans === ui.Button.YES) removeCheckinTestTickets_(false);
  }

  const now = new Date();
  const tests = [
    ['TEST-001', 'TEST Juan Dela Cruz', 1, STATUS.APPROVED, 'Test ticket, normal single entry.'],
    ['TEST-002', 'TEST Maria Santos', 3, STATUS.APPROVED, 'Test ticket, group of 3.'],
    ['TEST-003', 'TEST Pedro Reyes', 2, STATUS.APPROVED, 'Test ticket. Transferred to TEST Ana Lim (pre-notified).'],
    ['TEST-004', 'TEST Unpaid Person', 1, STATUS.PENDING, 'Test ticket, should show INVALID (payment not verified).'],
  ];

  const shown = [];
  tests.forEach(function (t) {
    const row = new Array(HEADERS.length).fill('');
    const token = Utilities.getUuid();
    const put = function (h, v) { row[HEADERS.indexOf(h)] = v; };
    put('Timestamp', now);
    put('Registration ID', t[0]);
    put('Full Legal Name', t[1]);
    put('Email Address', '');
    put('Phone Number', '');
    put('Ticket Quantity', t[2]);
    put('Payment Channel', 'gcash');
    put('Payment Reference No.', 'TEST');
    put('Status', t[3]);
    put('QR Token', token);
    put('Checked In', 'No');
    put('DPA Consent Given', 'Yes');
    put('Terms Accepted', 'Yes');
    put('Admin Notes', t[4]);
    put('Last Updated', now);
    sheet.appendRow(row);
    shown.push({ regId: t[0], name: t[1], qty: t[2], status: t[3], token: token });
  });

  const cards = shown.map(function (s) {
    const img = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(s.token);
    return '<div class="c"><img src="' + img + '" width="220" height="220"><div><b>' + escapeHtml_(s.regId) + '</b> ' +
      escapeHtml_(s.name) + '<br>' + s.qty + ' ticket(s) · ' + escapeHtml_(s.status) + '</div></div>';
  }).join('');
  const html =
    '<style>body{font-family:Arial,sans-serif;font-size:12px}.g{display:flex;flex-wrap:wrap;gap:14px}' +
    '.c{width:230px}.n{background:#fff4d6;border:1px solid #e0b84a;padding:8px;margin-bottom:10px}</style>' +
    '<div class="n">Scan these from this screen with the scanner page. They use ' +
    shown.reduce(function (a, s) { return a + (s.status === STATUS.APPROVED || s.status === STATUS.PENDING ? s.qty : 0); }, 0) +
    ' seats from the public count until you run <b>Remove Check-in Test Tickets</b>. No emails are sent.</div>' +
    '<div class="g">' + cards + '</div>';
  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(560).setHeight(640), 'Check-in test tickets');
}

/** Menu: Remove Check-in Test Tickets. */
function removeCheckinTestTickets() {
  const n = removeCheckinTestTickets_(true);
  SpreadsheetApp.getUi().alert('Removed ' + n + ' test ticket row(s) and their test ID photos.');
}

function removeCheckinTestTickets_(trashPhotos) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ciRegSheet_();
    const data = sheet.getDataRange().getValues();
    const regIdCol = HEADERS.indexOf('Registration ID');
    let removed = 0;
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][regIdCol] || '').toUpperCase().indexOf(CHECKIN.TEST_PREFIX) === 0) {
        sheet.deleteRow(i + 1);
        removed++;
      }
    }
    if (trashPhotos) {
      const files = ciIdFolder_().getFiles();
      while (files.hasNext()) {
        const f = files.next();
        if (f.getName().toUpperCase().indexOf(CHECKIN.TEST_PREFIX) === 0) f.setTrashed(true);
      }
    }
    return removed;
  } finally {
    lock.releaseLock();
  }
}
