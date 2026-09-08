/**
 * ============================================================
 *  SB19 "WAKAS AT SIMULA" TRILOGY FINALE — BLOCK SCREENING
 *  Registration System — Backend (Google Apps Script)
 * ============================================================
 *  Event   : SB19 "Wakas at Simula" Trilogy Finale — Block Screening
 *  Date    : October 10, 2026, 3:00 PM
 *  Venue   : SM Mall of Asia Cinema — ScreenX
 *
 *  CAPACITY MODEL
 *  ---------------------------------------------------------
 *  Total venue capacity : 269
 *  Public pool           : 230  (what the registration page opens with)
 *  Admin reserve         : 39   (held back for organizer use)
 *
 *  The admin reserve is NOT permanently locked — if not all 39 get
 *  used, release some or all of it back into the public pool by
 *  editing one cell in the "_Config" sheet ("Reserve Released"). The
 *  public cap effectively becomes 230 + Reserve Released, capped at 269.
 *
 *  PAYMENT MISMATCH / EXPIRY MODEL
 *  ---------------------------------------------------------
 *  A registration holds its seats the moment it's submitted
 *  ("Pending Payment Verification"). If there's a problem verifying it
 *  (amount doesn't match ticket qty, reference not found, partial
 *  payment, etc.), set its Status cell to "Payment Mismatch - Awaiting
 *  Correction". That automatically:
 *    - stamps a 24-hour Correction Deadline on that row
 *    - emails the registrant a link to a self-service correction page
 *      where they can resubmit the right reference number/screenshot
 *      themselves, no back-and-forth needed
 *  An hourly check sweeps for rows past their deadline still stuck in
 *  that status, marks them "Expired - Auto-Released" (freeing the
 *  seats), and emails the registrant that their reservation was
 *  released.
 *
 *  APPROVAL
 *  ---------------------------------------------------------
 *  Set a row's Status to "Approved" and it automatically emails the
 *  registrant a "you're in" message with their entry QR code embedded
 *  (generated from their stored QR Token via a free QR image API) and
 *  a Terms & Conditions summary. This is the final step of a normal,
 *  successful registration.
 *
 *  ADMIN OVERRIDE (don't wait 24 hours) — AND HOW STATUS CHANGES WORK
 *  ---------------------------------------------------------
 *  You are never locked into the 24-hour wait — just change a row's
 *  Status cell (the dropdown) to "Rejected", "Cancelled", "Approved",
 *  "Payment Mismatch - Awaiting Correction", or "Expired -
 *  Auto-Released" yourself. The moment you do, a confirmation popup
 *  appears right there showing who the registration belongs to and what
 *  will happen — say Yes and the registrant is emailed within about a
 *  minute (and cannot be auto-undone); say No (or close the popup) and
 *  the cell reverts, nothing is sent. This is the ONLY path that emails
 *  those five statuses — see onEdit(e) below for why it can't happen
 *  instantly in the same step. The hourly auto-sweep (below) still
 *  emails automatically for its own case, since nothing manual is
 *  involved there.
 *
 *  SAFETY NETS
 *  ---------------------------------------------------------
 *  - Every edit to the Registrations sheet is logged to the "_AuditLog"
 *    tab: who, when, which cell, old value -> new value. Useful for
 *    "who changed this?" with a small admin team.
 *  - The Registrations data range is "warning-only" protected — Sheets
 *    itself will ask "are you sure?" before letting any edit or bulk
 *    delete go through, even though everyone can still say yes and edit
 *    normally. This is Sheets' own built-in feature, not custom code.
 *  - A timestamped copy of the whole spreadsheet is automatically saved
 *    to a "Wakas at Simula - Spreadsheet Backups" Drive folder once a
 *    day (see runBackup()), on top of Google Sheets' own built-in
 *    Version History (File > Version history > See version history),
 *    which is already a free, instant undo/restore for any accidental
 *    change — that's usually the fastest way to recover from a mistake.
 *
 *  SETUP NOTE: after pasting this code, run initializeSheet() once,
 *  then run installTriggers() once (see SETUP doc) — that second step
 *  is what makes the automatic emails, hourly expiry sweep, and daily
 *  backup actually run; without it, none of those happen automatically.
 * ============================================================
 */

const CONFIG = {
  EVENT_NAME: 'SB19 "Wakas at Simula" Trilogy Finale — Block Screening',
  EVENT_DATE_DISPLAY: 'October 10, 2026, 3:00 PM',
  VENUE: 'SM Mall of Asia Cinema — ScreenX',

  TOTAL_VENUE_CAP: 269,
  PUBLIC_CAP_DEFAULT: 230,
  ADMIN_RESERVE_TOTAL: 39,
  MAX_TICKETS_PER_REGISTRATION: 20,

  CORRECTION_WINDOW_HOURS: 24,

  SHEET_NAME: 'Registrations',
  CONFIG_SHEET_NAME: '_Config',
  DRIVE_FOLDER_NAME: 'Wakas at Simula - Payment Screenshots',

  // Update once the dedicated Gmail account is set up.
  SENDER_DISPLAY_NAME: 'Wakas at Simula Block Screening',
  // Shown in emails as the contact address for concerns.
  ORGANIZER_CONTACT_EMAIL: 'sbfanboyjason@gmail.com',

  // Base URL of the published registration site (GitHub Pages), no
  // trailing slash — e.g. https://yourname.github.io/wakas-simula-registration
  // Used to build the self-service correction link in emails. Leave the
  // placeholder until you've deployed the site; emails will just omit
  // the link until then and point people to the organizer email instead.
  SITE_BASE_URL: 'https://sbfanboyjason.github.io/wakas-simula-registration',

  // Fill in with the admin's own email(s) later — used for internal
  // "new registration" notifications, not required for this to work.
  ADMIN_NOTIFICATION_EMAILS: [],

  // Shown in the approval email. Keep this in sync with PRICE_PER_TICKET
  // in the site's assets/config.js if it ever changes.
  PRICE_PER_TICKET: 1000,
  CURRENCY: '₱',

  // Plain-language summary shown in the approval email. Keep this in
  // sync with TERMS_HTML in the site's assets/config.js — this is a
  // condensed copy so the email doesn't depend on the website being up.
  TERMS_SUMMARY_HTML:
    '<ul>' +
    '<li>Your registration is <strong>non-refundable but transferable</strong> — let us know in advance if someone else will use it.</li>' +
    '<li>Bring the QR code below and a valid ID matching the registered name (or the name of whoever it was transferred to).</li>' +
    '<li>This is an independently organized fan community screening, not an official SB19 or management production.</li>' +
    '</ul>',
};

const STATUS = {
  PENDING: 'Pending Payment Verification',
  NEEDS_CORRECTION: 'Payment Mismatch - Awaiting Correction',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired - Auto-Released',
};

// Statuses that still count against the ticket cap (i.e. still "hold" seats).
const HOLDING_STATUSES = [STATUS.PENDING, STATUS.NEEDS_CORRECTION, STATUS.APPROVED];

// Hidden form field real registrants never see or fill in (it's CSS-hidden
// on the site). Automated bots that blindly fill every field tend to fill
// it anyway — if it ever arrives non-empty, treat the submission as spam.
const HONEYPOT_FIELD = 'website';

// Column order — keep this in sync with initializeSheet() below.
const HEADERS = [
  'Timestamp',
  'Registration ID',
  'Full Legal Name',
  'Email Address',
  'Phone Number',
  'Ticket Quantity',
  'Payment Channel',
  'Payment Reference No.',
  'Payment Screenshot URL',
  'Status',
  'Correction Deadline',
  'QR Token',
  'Checked In',
  'DPA Consent Given',
  'Terms Accepted',
  'Admin Notes',
  'Last Updated',
];

/**
 * Run this once manually (menu: Wakas at Simula Admin > Initialize),
 * and again any time you want to reset the header row/formatting. It
 * does not touch existing data rows.
 */
function initializeSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME);

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  sheet
    .getRange(1, 1, 1, HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#111111')
    .setFontColor('#ffffff');
  sheet.autoResizeColumns(1, HEADERS.length);

  const statusCol = HEADERS.indexOf('Status') + 1;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(Object.values(STATUS), true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, statusCol, 2000, 1).setDataValidation(rule);

  // --- Warning-only protection: Sheets' own native "are you sure?" prompt
  // fires before any edit or bulk delete on the data rows goes through.
  // Nobody is blocked from editing — this is just a speed bump against an
  // accidental mass-clear or stray keystroke. Safe to re-run: removes its
  // own older copy first so re-running this doesn't stack duplicates.
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.getDescription() === 'Wakas registrations data - edit warning') p.remove();
  });
  const dataProtection = sheet
    .getRange(2, 1, 4998, HEADERS.length)
    .protect()
    .setDescription('Wakas registrations data - edit warning');
  dataProtection.setWarningOnly(true);

  // --- _AuditLog sheet: who changed what, and when ---
  getOrCreateAuditSheet_();

  // --- _Config sheet: where the admin-reserve release is controlled ---
  let configSheet = ss.getSheetByName(CONFIG.CONFIG_SHEET_NAME);
  if (!configSheet) configSheet = ss.insertSheet(CONFIG.CONFIG_SHEET_NAME);
  configSheet.clear();
  configSheet.getRange(1, 1, 1, 3).setValues([['Key', 'Value', 'Notes']]);
  configSheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  configSheet.getRange(2, 1, 1, 3).setValues([[
    'Reserve Released',
    0,
    `Of the ${CONFIG.ADMIN_RESERVE_TOTAL}-seat admin reserve, how many to open back up to the public. ` +
      `Public cap = ${CONFIG.PUBLIC_CAP_DEFAULT} + this number, capped at ${CONFIG.TOTAL_VENUE_CAP}. Edit freely.`,
  ]]);
  configSheet.autoResizeColumns(1, 3);

  SpreadsheetApp.getUi().alert(
    'Sheet initialized (data-edit warning, audit log, and _Config all set up).\n\nNext steps:\n' +
      '1) Run installTriggers() once (menu item below) to activate automatic emails, the hourly expiry sweep, and the daily backup.\n' +
      '2) Deploy > New deployment > Web app, Execute as "Me", Who has access "Anyone". Copy the /exec URL.'
  );
}

/**
 * Run this once manually (menu: Wakas at Simula Admin > Install
 * Automated Triggers). Sets up the two things that can't just run
 * inline: reacting to Status edits, and the hourly expiry sweep.
 * Safe to re-run — it clears old copies of these triggers first.
 */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'checkExpiredCorrections' || fn === 'runBackup' || fn === 'processConfirmedStatusChanges') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // NOTE: there is deliberately no installable onEdit trigger anymore.
  // Status-change confirmation now runs through the simple onEdit(e)
  // trigger below (auto-active just by existing in this project — it
  // needs no installation step), because only a simple trigger is
  // allowed to show a UI confirmation at the moment of the edit.

  ScriptApp.newTrigger('checkExpiredCorrections').timeBased().everyHours(1).create();

  ScriptApp.newTrigger('runBackup').timeBased().everyDays(1).atHour(2).create();

  // Sends the actual status-change email shortly after you confirm the
  // inline popup (Apps Script can't show a popup and send an authorized
  // email in the very same step — see onEdit(e) below for why).
  ScriptApp.newTrigger('processConfirmedStatusChanges').timeBased().everyMinutes(1).create();

  SpreadsheetApp.getUi().alert(
    'Triggers installed. The hourly expiry sweep and daily 2am spreadsheet ' +
      'backup are now active. Changing the Status dropdown will now pop up a ' +
      'confirmation immediately — say Yes and the registrant is emailed ' +
      'within about a minute; say No and it reverts, nothing is sent.'
  );
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Wakas at Simula Admin')
    .addItem('Initialize / Reset Sheet Structure', 'initializeSheet')
    .addItem('Install Automated Triggers (run once)', 'installTriggers')
    .addItem('Build / Refresh Dashboard', 'buildDashboard')
    .addItem('Print Attendee List (Approved)', 'showAttendeeListDialog')
    .addSeparator()
    .addItem('Run Backup Now', 'runBackupNow')
    .addToUi();
}

// ============================================================
//  CAPACITY
// ============================================================

function getReserveReleased() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName(CONFIG.CONFIG_SHEET_NAME);
  if (!configSheet) return 0;
  const data = configSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'Reserve Released') {
      return Number(data[i][1]) || 0;
    }
  }
  return 0;
}

function getEffectivePublicCap() {
  const released = getReserveReleased();
  return Math.min(CONFIG.PUBLIC_CAP_DEFAULT + released, CONFIG.TOTAL_VENUE_CAP);
}

/** Sums ticket quantities across every row still holding a seat. */
function getClaimedTicketCount(sheet) {
  const data = sheet.getDataRange().getValues();
  const qtyCol = HEADERS.indexOf('Ticket Quantity');
  const statusCol = HEADERS.indexOf('Status');
  let claimed = 0;
  for (let i = 1; i < data.length; i++) {
    if (HOLDING_STATUSES.indexOf(data[i][statusCol]) !== -1) {
      claimed += Number(data[i][qtyCol]) || 0;
    }
  }
  return claimed;
}

// ============================================================
//  WEB ENDPOINTS
// ============================================================

/**
 * GET <web-app-url>?action=slots
 *   Public read-only ticket-availability count.
 * GET <web-app-url>?action=lookup&regId=...&email=...
 *   Used by the correction page to confirm a registration exists
 *   before showing the correction form.
 */
function doGet(e) {
  const action = e.parameter.action;

  if (action === 'slots') {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
    const cap = getEffectivePublicCap();
    const claimed = getClaimedTicketCount(sheet);
    return jsonResponse({
      ok: true,
      totalCap: cap,
      claimed: claimed,
      remaining: Math.max(0, cap - claimed),
    });
  }

  if (action === 'lookup') {
    return handleLookup(e.parameter.regId, e.parameter.email);
  }

  return jsonResponse({ ok: false, error: 'Unknown action.' });
}

/**
 * POST <web-app-url>                  → new registration
 * POST <web-app-url>?action=correct   → self-service payment correction
 *
 * Content-Type must be text/plain on the client side to avoid a CORS
 * preflight — see script.js / correct.js comments.
 */
function doPost(e) {
  const action = e.parameter && e.parameter.action;
  if (action === 'correct') {
    return handleCorrection(e);
  }
  return handleNewRegistration(e);
}

function handleNewRegistration(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonResponse({ ok: false, error: 'Malformed request.' });
    }

    const validationError = validateRegistration(payload);
    if (validationError) {
      return jsonResponse({ ok: false, error: validationError });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
    const cap = getEffectivePublicCap();
    const claimed = getClaimedTicketCount(sheet);
    const requestedQty = Number(payload.ticketQuantity);

    if (claimed + requestedQty > cap) {
      const remaining = Math.max(0, cap - claimed);
      return jsonResponse({
        ok: false,
        error:
          remaining === 0
            ? 'All tickets have been claimed. Registration is now closed.'
            : `Only ${remaining} ticket(s) remaining. Please lower your ticket quantity.`,
      });
    }

    const regId = generateRegistrationId(sheet);
    const qrToken = Utilities.getUuid();
    const now = new Date();

    let screenshotUrl = '';
    let adminNote = '';
    try {
      screenshotUrl = saveScreenshotToDrive(
        payload.paymentScreenshotBase64,
        payload.paymentScreenshotFilename,
        regId
      );
    } catch (err) {
      adminNote = 'Screenshot upload failed server-side — ask registrant to resend proof.';
    }

    sheet.appendRow([
      now,
      regId,
      sanitizeForSheet_(payload.fullName),
      sanitizeForSheet_(payload.email),
      sanitizeForSheet_(payload.phone),
      requestedQty,
      sanitizeForSheet_(payload.paymentChannel) || '',
      sanitizeForSheet_(payload.paymentReference) || '',
      screenshotUrl,
      STATUS.PENDING,
      '', // Correction Deadline — set only if flagged for correction
      qrToken,
      'No',
      payload.dpaConsent ? 'Yes' : 'No',
      payload.termsAccepted ? 'Yes' : 'No',
      adminNote,
      now,
    ]);

    try {
      sendPendingConfirmationEmail(payload, regId);
    } catch (err) {
      // Row is already saved; don't fail the registration over a bounced email.
    }

    return jsonResponse({ ok: true, registrationId: regId });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'Server error: ' + err.message });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Self-service correction: a registrant resubmits a corrected payment
 * reference and/or a new screenshot against their existing Registration
 * ID. Only allowed while the row is still "Pending" or "Payment
 * Mismatch - Awaiting Correction" — once approved/rejected/cancelled/
 * expired, this is no longer editable (matches the row being a
 * finalized outcome).
 */
function handleCorrection(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonResponse({ ok: false, error: 'Malformed request.' });
    }

    if (payload[HONEYPOT_FIELD]) {
      return jsonResponse({ ok: false, error: 'Submission blocked.' });
    }
    if (!payload.registrationId || !payload.email) {
      return jsonResponse({ ok: false, error: 'Registration ID and email are required.' });
    }
    if (!payload.paymentReference && !payload.paymentScreenshotBase64) {
      return jsonResponse({
        ok: false,
        error: 'Please provide a corrected reference number and/or a new screenshot.',
      });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
    const targetRow = findRowByRegIdAndEmail(sheet, payload.registrationId, payload.email);

    if (targetRow === -1) {
      return jsonResponse({
        ok: false,
        error:
          "We couldn't find a matching registration. Please check your Registration ID and the email you registered with.",
      });
    }

    const statusCol = HEADERS.indexOf('Status') + 1;
    const currentStatus = sheet.getRange(targetRow, statusCol).getValue();
    if (currentStatus !== STATUS.PENDING && currentStatus !== STATUS.NEEDS_CORRECTION) {
      return jsonResponse({
        ok: false,
        error:
          `This registration is already "${currentStatus}" and can no longer be edited here. ` +
          `Contact ${CONFIG.ORGANIZER_CONTACT_EMAIL} if you need help, or submit a new registration if slots remain.`,
      });
    }

    const noteParts = [];
    if (payload.paymentReference) {
      sheet
        .getRange(targetRow, HEADERS.indexOf('Payment Reference No.') + 1)
        .setValue(sanitizeForSheet_(payload.paymentReference));
      noteParts.push('reference updated');
    }
    if (payload.paymentScreenshotBase64) {
      try {
        const url = saveScreenshotToDrive(
          payload.paymentScreenshotBase64,
          payload.paymentScreenshotFilename,
          payload.registrationId
        );
        sheet.getRange(targetRow, HEADERS.indexOf('Payment Screenshot URL') + 1).setValue(url);
        noteParts.push('screenshot updated');
      } catch (err) {
        noteParts.push('screenshot re-upload failed server-side');
      }
    }

    sheet.getRange(targetRow, statusCol).setValue(STATUS.PENDING);
    sheet.getRange(targetRow, HEADERS.indexOf('Correction Deadline') + 1).setValue('');
    const now = new Date();
    sheet.getRange(targetRow, HEADERS.indexOf('Last Updated') + 1).setValue(now);

    const notesCol = HEADERS.indexOf('Admin Notes') + 1;
    const existingNotes = sheet.getRange(targetRow, notesCol).getValue();
    const noteLine = `[${now.toLocaleString()}] Registrant self-corrected (${noteParts.join(', ')}).`;
    sheet.getRange(targetRow, notesCol).setValue(existingNotes ? existingNotes + '\n' + noteLine : noteLine);

    try {
      const updatedRowValues = sheet.getRange(targetRow, 1, 1, HEADERS.length).getValues()[0];
      sendCorrectionReceivedEmail(rowValuesToObject(updatedRowValues));
    } catch (err) {
      // Best-effort — the correction itself already succeeded.
    }

    return jsonResponse({
      ok: true,
      message: 'Correction received. Your registration is back in the verification queue.',
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'Server error: ' + err.message });
  } finally {
    lock.releaseLock();
  }
}

function handleLookup(regId, email) {
  if (!regId || !email) {
    return jsonResponse({ ok: false, error: 'Registration ID and email are required.' });
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  const targetRow = findRowByRegIdAndEmail(sheet, regId, email);
  if (targetRow === -1) {
    return jsonResponse({ ok: false, error: "We couldn't find a matching registration." });
  }
  const rowValues = sheet.getRange(targetRow, 1, 1, HEADERS.length).getValues()[0];
  const rowObj = rowValuesToObject(rowValues);
  return jsonResponse({
    ok: true,
    fullName: rowObj['Full Legal Name'],
    status: rowObj['Status'],
    ticketQuantity: rowObj['Ticket Quantity'],
    currentReference: rowObj['Payment Reference No.'],
    editable: rowObj['Status'] === STATUS.PENDING || rowObj['Status'] === STATUS.NEEDS_CORRECTION,
  });
}

function findRowByRegIdAndEmail(sheet, regId, email) {
  const data = sheet.getDataRange().getValues();
  const regIdCol = HEADERS.indexOf('Registration ID');
  const emailCol = HEADERS.indexOf('Email Address');
  for (let i = 1; i < data.length; i++) {
    if (
      String(data[i][regIdCol]).trim().toLowerCase() === String(regId).trim().toLowerCase() &&
      String(data[i][emailCol]).trim().toLowerCase() === String(email).trim().toLowerCase()
    ) {
      return i + 1;
    }
  }
  return -1;
}

function validateRegistration(payload) {
  if (!payload) return 'Missing submission data.';
  if (payload[HONEYPOT_FIELD]) return 'Submission blocked.';
  if (!payload.fullName || payload.fullName.trim().length < 2) {
    return 'Full legal name is required.';
  }
  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return 'A valid email address is required.';
  }
  const cleanedPhone = String(payload.phone || '').replace(/\s|-/g, '');
  if (!/^(\+?63|0)9\d{9}$/.test(cleanedPhone)) {
    return 'A valid Philippine mobile number is required (e.g. 09171234567).';
  }
  if (!payload.ticketQuantity || Number(payload.ticketQuantity) < 1) {
    return 'Ticket quantity must be at least 1.';
  }
  if (Number(payload.ticketQuantity) > CONFIG.MAX_TICKETS_PER_REGISTRATION) {
    return `A single registration can claim at most ${CONFIG.MAX_TICKETS_PER_REGISTRATION} tickets.`;
  }
  if (!payload.paymentChannel) return 'Please select a payment channel.';
  if (!payload.paymentReference) return 'Please enter your payment reference number.';
  if (!payload.paymentScreenshotBase64) return 'Please upload a screenshot of your payment.';
  if (!payload.dpaConsent) {
    return 'You must agree to the Data Privacy consent before registering.';
  }
  if (!payload.termsAccepted) {
    return 'You must accept the Terms & Conditions before registering.';
  }
  return null;
}

function generateRegistrationId(sheet) {
  const lastRow = sheet.getLastRow(); // header occupies row 1
  return 'WAS-' + String(lastRow).padStart(5, '0');
}

/**
 * Google Sheets (like Excel) treats any cell starting with =, +, - or @
 * as a formula. Without this, a registrant could put something like
 * =IMPORTXML(...) or =HYPERLINK(...) in their name or reference number,
 * and it would silently execute the moment an admin opens the sheet.
 * Prefixing with a leading apostrophe forces Sheets to treat it as plain
 * text (the apostrophe itself doesn't show up in the cell).
 */
function sanitizeForSheet_(value) {
  const str = String(value == null ? '' : value);
  return /^[=+\-@]/.test(str) ? "'" + str : str;
}

/** Escapes HTML-sensitive characters so submitted text (names, etc.) can't break out of the HTML emails. */
function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ============================================================
//  DRIVE STORAGE (payment screenshots)
// ============================================================

function saveScreenshotToDrive(base64Data, filename, regId) {
  if (!base64Data) return '';
  const folder = getOrCreateDriveFolder();
  const contentType = guessContentType(filename);
  const safeName = (regId || 'unknown') + '_' + (filename || 'payment.png');
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), contentType, safeName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getOrCreateDriveFolder() {
  const folders = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(CONFIG.DRIVE_FOLDER_NAME);
}

function guessContentType(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  if (ext === 'png') return MimeType.PNG;
  if (ext === 'jpg' || ext === 'jpeg') return MimeType.JPEG;
  if (ext === 'gif') return MimeType.GIF;
  return MimeType.PNG; // Apps Script has no native WEBP constant
}

// ============================================================
//  PAYMENT MISMATCH / EXPIRY / ADMIN-OVERRIDE FLOW
// ============================================================

/**
 * SIMPLE trigger (not installed via installTriggers() — Apps Script
 * auto-activates any function literally named onEdit(e) just by it
 * existing in the project). Fires synchronously, in the same instant as
 * the edit, WITH a UI context — which is exactly why this is the one
 * that can show the confirmation popup. It cannot call MailApp (simple
 * triggers aren't allowed to touch authorized services), so it doesn't
 * send email itself — see queueStatusNotification_() and
 * processConfirmedStatusChanges() below for how the email actually goes
 * out a few seconds to ~1 minute later, once you've said Yes.
 *
 * Also does the general "who changed what" audit logging for every edit
 * on the Registrations sheet, not just Status.
 */
function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() === DASHBOARD_SHEET_NAME) return;
    if (sheet.getName() === AUDIT_SHEET_NAME) return;
    if (sheet.getName() !== CONFIG.SHEET_NAME) return;
    if (e.range.getRow() === 1) return; // header row

    const statusCol = HEADERS.indexOf('Status') + 1;
    const lastUpdatedCol = HEADERS.indexOf('Last Updated') + 1;
    const isSingleCell = e.range.getNumRows() === 1 && e.range.getNumColumns() === 1;
    const isStatusEdit = isSingleCell && e.range.getColumn() === statusCol;

    if (!isStatusEdit) {
      // Any other edit (including a multi-cell paste or a bulk delete) —
      // just log it quietly and stamp Last Updated for every touched row.
      logAudit_(sheet, e.range, e.oldValue, e.value, 'Direct cell edit');
      for (let r = e.range.getRow(); r < e.range.getRow() + e.range.getNumRows(); r++) {
        if (r > 1) sheet.getRange(r, lastUpdatedCol).setValue(new Date());
      }
      return;
    }

    const row = e.range.getRow();
    const newStatus = e.value;
    const oldStatus = e.oldValue;

    if (!newStatus || newStatus === oldStatus) {
      logAudit_(sheet, e.range, oldStatus, newStatus, 'Direct cell edit');
      return;
    }

    const regId = sheet.getRange(row, HEADERS.indexOf('Registration ID') + 1).getValue();
    const name = sheet.getRange(row, HEADERS.indexOf('Full Legal Name') + 1).getValue();
    const willEmail = [STATUS.APPROVED, STATUS.NEEDS_CORRECTION, STATUS.EXPIRED, STATUS.REJECTED, STATUS.CANCELLED].indexOf(newStatus) !== -1;

    const ui = SpreadsheetApp.getUi();
    const confirmMsg =
      'Change status of ' + regId + ' (' + name + ')\n' +
      'from "' + (oldStatus || '(blank)') + '"\n' +
      'to "' + newStatus + '"?\n\n' +
      (willEmail
        ? 'This will email the registrant within about a minute, and cannot be auto-undone.'
        : 'This status does not trigger an email.');
    const response = ui.alert('Confirm Status Change', confirmMsg, ui.ButtonSet.YES_NO);

    if (response !== ui.Button.YES) {
      e.range.setValue(oldStatus || '');
      logAudit_(sheet, e.range, oldStatus, newStatus, 'Change declined — reverted, nothing sent');
      return;
    }

    sheet.getRange(row, lastUpdatedCol).setValue(new Date());
    logAudit_(
      sheet,
      e.range,
      oldStatus,
      newStatus,
      willEmail ? 'Confirmed — notification queued (~1 min)' : 'Confirmed — no email needed for this status'
    );

    if (willEmail) queueStatusNotification_(row, regId, newStatus);
  } catch (err) {
    console.error('onEdit error: ' + err.message);
  }
}

/** Adds a confirmed status change to the queue processConfirmedStatusChanges() drains every minute. */
function queueStatusNotification_(row, regId, newStatus) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('pendingStatusNotifications');
  const queue = raw ? JSON.parse(raw) : [];
  queue.push({
    row: row,
    regId: regId,
    newStatus: newStatus,
    confirmedAt: new Date().toISOString(),
    confirmedBy: safeActiveUserEmail_(),
  });
  props.setProperty('pendingStatusNotifications', JSON.stringify(queue));
}

/**
 * Time-driven trigger (every minute, see installTriggers()). This is
 * where the actual "authorized" work happens for a confirmed status
 * change: stamping the correction deadline if needed, and sending the
 * matching email — the popup in onEdit(e) above can't do either of
 * those itself (no authorization from a simple trigger), so it hands
 * off here once you've said Yes.
 */
function processConfirmedStatusChanges() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('pendingStatusNotifications');
  if (!raw) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // another run is already draining the queue

  try {
    const queue = JSON.parse(props.getProperty('pendingStatusNotifications') || '[]');
    if (!queue.length) {
      props.deleteProperty('pendingStatusNotifications');
      return;
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
    const statusCol = HEADERS.indexOf('Status') + 1;
    const auditSheet = getOrCreateAuditSheet_();

    queue.forEach(function (item) {
      try {
        const currentStatus = sheet.getRange(item.row, statusCol).getValue();
        if (currentStatus !== item.newStatus) {
          // Status was changed again (or reverted) after this was queued —
          // don't email based on a status that's no longer current.
          auditSheet.appendRow([
            new Date(), item.confirmedBy, CONFIG.SHEET_NAME, 'Status (row ' + item.row + ')',
            item.regId, 'Status', '', item.newStatus,
            'Skipped queued notification — status changed again before it could send',
          ]);
          return;
        }

        let deadline = null;
        if (item.newStatus === STATUS.NEEDS_CORRECTION) {
          deadline = new Date(Date.now() + CONFIG.CORRECTION_WINDOW_HOURS * 60 * 60 * 1000);
          sheet.getRange(item.row, HEADERS.indexOf('Correction Deadline') + 1).setValue(deadline);
        }

        const rowValues = sheet.getRange(item.row, 1, 1, HEADERS.length).getValues()[0];
        const rowObj = rowValuesToObject(rowValues);
        sendStatusChangeEmail_(item.newStatus, rowObj, deadline);

        auditSheet.appendRow([
          new Date(), item.confirmedBy, CONFIG.SHEET_NAME, 'Status (row ' + item.row + ')',
          item.regId, 'Status', '', item.newStatus,
          'Notification sent (confirmed ' + item.confirmedAt + ')',
        ]);
      } catch (err) {
        console.error('processConfirmedStatusChanges item error: ' + err.message);
      }
    });

    props.deleteProperty('pendingStatusNotifications');
  } finally {
    lock.releaseLock();
  }
}

/** Routes a confirmed status change to the matching notification email. */
function sendStatusChangeEmail_(newStatus, rowObj, deadline) {
  if (newStatus === STATUS.APPROVED) {
    sendApprovalEmailWithQr(rowObj);
  } else if (newStatus === STATUS.NEEDS_CORRECTION) {
    sendMismatchNoticeEmail(rowObj, deadline);
  } else if (newStatus === STATUS.EXPIRED) {
    sendExpiredReleaseEmail(rowObj);
  } else if (newStatus === STATUS.REJECTED) {
    sendRejectionEmail(rowObj);
  } else if (newStatus === STATUS.CANCELLED) {
    sendCancellationEmail(rowObj);
  }
}

/** Session.getActiveUser().getEmail() can return '' for accounts the script can't identify — never let that break a caller. */
function safeActiveUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '(unknown — email not shared with script)';
  } catch (err) {
    return '(unknown — email not shared with script)';
  }
}

// ============================================================
//  AUDIT LOG  (who changed what, and when — see _AuditLog sheet)
// ============================================================

const AUDIT_SHEET_NAME = '_AuditLog';
const AUDIT_HEADERS = ['Timestamp', 'Editor', 'Sheet', 'Cell / Range', 'Registration ID', 'Column', 'Old Value', 'New Value', 'Note'];

/** Creates the _AuditLog sheet if missing, restricted to the spreadsheet owner so the 4 admins can't edit/delete history. */
function getOrCreateAuditSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(AUDIT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(AUDIT_SHEET_NAME);
    sheet.getRange(1, 1, 1, AUDIT_HEADERS.length).setValues([AUDIT_HEADERS])
      .setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, AUDIT_HEADERS.length);
    protectSheetOwnerOnly_(sheet, 'Audit log — read-only history, restricted to the spreadsheet owner');
  }
  return sheet;
}

/** Appends one row to the audit log. Best-effort — never lets a logging failure break the edit it's logging. */
function logAudit_(sheet, range, oldValue, newValue, note) {
  try {
    const auditSheet = getOrCreateAuditSheet_();
    const row = range.getRow();
    const col = range.getColumn();
    const isSingleCell = range.getNumRows() === 1 && range.getNumColumns() === 1;
    const regIdCol = HEADERS.indexOf('Registration ID') + 1;
    let regId = '';
    if (row > 1) {
      try { regId = sheet.getRange(row, regIdCol).getValue(); } catch (err) {}
    }
    const columnName = isSingleCell && col >= 1 && col <= HEADERS.length ? HEADERS[col - 1] : '(multiple)';
    auditSheet.appendRow([
      new Date(),
      safeActiveUserEmail_(),
      sheet.getName(),
      range.getA1Notation(),
      regId,
      columnName,
      isSingleCell ? oldValue : '(multiple cells)',
      isSingleCell ? newValue : '(multiple cells)',
      note || '',
    ]);
  } catch (err) {
    console.error('logAudit_ error: ' + err.message);
  }
}

// ============================================================
//  BACKUPS
// ============================================================

const BACKUP_FOLDER_NAME = 'Wakas at Simula - Spreadsheet Backups';
const BACKUP_RETENTION_COUNT = 30; // keep the most recent 30 automatic backups

/** Time-driven trigger (daily 2am, see installTriggers()). Also callable on demand via the menu. */
function runBackup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const folder = getOrCreateBackupFolder_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Manila', 'yyyy-MM-dd HH-mm');
  DriveApp.getFileById(ss.getId()).makeCopy('Registrations Backup - ' + stamp, folder);
  pruneOldBackups_(folder);
}

function getOrCreateBackupFolder_() {
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

/** Keeps only the most recent BACKUP_RETENTION_COUNT backups so the Drive folder doesn't grow forever. */
function pruneOldBackups_(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  if (files.length <= BACKUP_RETENTION_COUNT) return;
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  for (let i = BACKUP_RETENTION_COUNT; i < files.length; i++) {
    files[i].setTrashed(true);
  }
}

/** Menu item: "Run Backup Now". */
function runBackupNow() {
  runBackup();
  SpreadsheetApp.getUi().alert(
    'Backup complete. A timestamped copy was saved to the "' + BACKUP_FOLDER_NAME + '" folder in your Drive.'
  );
}

/**
 * Time-driven trigger (hourly, see installTriggers()). Sweeps for
 * rows stuck in "Payment Mismatch - Awaiting Correction" whose
 * deadline has passed, releases their seats, and notifies them. This
 * is the fallback for when nobody manually intervened — the admin
 * override above handles the "don't wait" case.
 */
function checkExpiredCorrections() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const statusCol = HEADERS.indexOf('Status');
  const deadlineCol = HEADERS.indexOf('Correction Deadline');
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    if (data[i][statusCol] !== STATUS.NEEDS_CORRECTION) continue;
    const deadline = data[i][deadlineCol];
    if (!deadline || new Date(deadline) >= now) continue;

    const rowNum = i + 1;
    sheet.getRange(rowNum, statusCol + 1).setValue(STATUS.EXPIRED);
    sheet.getRange(rowNum, HEADERS.indexOf('Last Updated') + 1).setValue(now);

    const rowObj = rowValuesToObject(data[i]);
    try {
      sendExpiredReleaseEmail(rowObj);
    } catch (err) {
      // Seat is released either way; the email is best-effort.
    }
  }
}

function rowValuesToObject(rowValues) {
  const obj = {};
  HEADERS.forEach(function (header, idx) {
    obj[header] = rowValues[idx];
  });
  return obj;
}

// ============================================================
//  EMAIL BRANDING (shared HTML template used by every email below)
// ============================================================

function buildCorrectionLink(regId) {
  if (!CONFIG.SITE_BASE_URL || CONFIG.SITE_BASE_URL.indexOf('REPLACE_WITH') === 0) return '';
  const base = CONFIG.SITE_BASE_URL.replace(/\/$/, '');
  return `${base}/correct/?regId=${encodeURIComponent(regId)}`;
}

/**
 * Fetches the site's white SB19 A'tin Fanboys logo so every email can
 * embed it inline (cid:logoImg). Returns null if it can't be fetched
 * (e.g. SITE_BASE_URL isn't configured yet) — emails still send fine,
 * just with a text wordmark instead of the logo image.
 */
function getLogoBlob_() {
  if (!CONFIG.SITE_BASE_URL || CONFIG.SITE_BASE_URL.indexOf('REPLACE_WITH') === 0) return null;
  try {
    const url = CONFIG.SITE_BASE_URL.replace(/\/$/, '') + '/assets/logo.png';
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      return response.getBlob().setName('logo.png');
    }
  } catch (err) {
    // Fall through to null — caller handles it.
  }
  return null;
}

/** One "Label: value" row inside an info box. */
function infoRow_(label, value) {
  return (
    '<tr>' +
    '<td style="padding:5px 10px 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;' +
    'color:#c9a24b;font-weight:bold;width:160px;vertical-align:top;white-space:nowrap;">' +
    label +
    '</td>' +
    '<td style="padding:5px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;' +
    'color:#f5f0e6;vertical-align:top;">' +
    value +
    '</td>' +
    '</tr>'
  );
}

/** Boxed table of infoRow_() rows — used for the "here's what you submitted" summaries. */
function infoBox_(rowsHtml) {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="background-color:#1c1a14;border:1px solid rgba(201,162,75,0.3);border-radius:8px;margin:4px 0 22px;">' +
    '<tr><td style="padding:16px 20px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    rowsHtml +
    '</table></td></tr></table>'
  );
}

/** Crimson call-to-action button (used for the "fix my payment" link). */
function buttonHtml_(url, label) {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr>' +
    '<td style="border-radius:6px;background-color:#8b1e2f;">' +
    '<a href="' +
    url +
    '" style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;' +
    'font-size:14px;font-weight:bold;letter-spacing:0.3px;color:#ffffff;text-decoration:none;">' +
    label +
    '</a></td></tr></table>'
  );
}

/** Muted red callout box — used for warnings/deadlines. */
function warningBox_(html) {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="background-color:rgba(139,30,47,0.18);border:1px solid rgba(139,30,47,0.55);border-radius:8px;margin:0 0 22px;">' +
    '<tr><td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#f5f0e6;line-height:1.6;">' +
    html +
    '</td></tr></table>'
  );
}

/**
 * Wraps body content in the shared branded email shell: dark header
 * with the inline white A'tin Fanboys logo + a colored status pill,
 * the content itself, and a consistent footer with event details and
 * the organizer contact. Returns { html, inlineImages } — spread
 * inlineImages into MailApp's options so cid:logoImg (and cid:entryQr
 * when applicable) resolve.
 */
function buildEmailShell_(options) {
  const logoBlob = getLogoBlob_();
  const inlineImages = {};

  const logoImg = logoBlob
    ? '<img src="cid:logoImg" width="70" height="70" alt="SB19 A\'tin Fanboys" ' +
      'style="display:block;margin:0 auto;width:70px;height:70px;border:0;" />'
    : '<div style="font-family:Georgia,\'Times New Roman\',serif;color:#c9a24b;font-size:20px;' +
      'letter-spacing:2px;">SB19 A\'TIN FANBOYS</div>';
  if (logoBlob) inlineImages.logoImg = logoBlob;

  const pill = options.pillLabel
    ? '<span style="display:inline-block;margin-top:18px;padding:7px 20px;border-radius:999px;' +
      'font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.5px;font-weight:bold;' +
      'text-transform:uppercase;background-color:' +
      (options.pillColor || '#c9a24b') +
      ';color:' +
      (options.pillTextColor || '#0a0a0a') +
      ';">' +
      options.pillLabel +
      '</span>'
    : '';

  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>' +
    escapeHtml_(CONFIG.EVENT_NAME) +
    '</title></head>' +
    '<body style="margin:0;padding:0;background-color:#0a0a0a;">' +
    '<div style="width:100%;background-color:#0a0a0a;padding:28px 12px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;' +
    'background-color:#141210;border:1px solid rgba(201,162,75,0.35);border-radius:12px;overflow:hidden;">' +
    '<tr><td style="background-color:#0a0a0a;background-image:linear-gradient(180deg,#161310,#0a0a0a);' +
    'text-align:center;padding:34px 24px 22px;border-bottom:1px solid rgba(201,162,75,0.3);">' +
    logoImg +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;color:#c9a24b;font-size:19px;' +
    'letter-spacing:0.5px;margin-top:16px;">SB19 &quot;Wakas at Simula&quot; Trilogy Finale</div>' +
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#f5f0e6;opacity:0.7;font-size:11px;' +
    'letter-spacing:2.5px;text-transform:uppercase;margin-top:6px;">Block Screening</div>' +
    pill +
    '</td></tr>' +
    '<tr><td style="padding:30px 30px 6px;font-family:Georgia,\'Times New Roman\',serif;color:#f5f0e6;' +
    'font-size:15px;line-height:1.65;">' +
    options.bodyHtml +
    '</td></tr>' +
    '<tr><td style="padding:22px 30px 32px;text-align:center;font-family:Arial,Helvetica,sans-serif;' +
    'color:rgba(245,240,230,0.55);font-size:12px;line-height:1.8;border-top:1px solid rgba(201,162,75,0.2);">' +
    '<strong style="color:#c9a24b;">' +
    escapeHtml_(CONFIG.EVENT_DATE_DISPLAY) +
    '</strong> — ' +
    escapeHtml_(CONFIG.VENUE) +
    '<br>Questions? Email <a href="mailto:' +
    CONFIG.ORGANIZER_CONTACT_EMAIL +
    '" style="color:#c9a24b;">' +
    CONFIG.ORGANIZER_CONTACT_EMAIL +
    '</a><br><br>Fan-organized by SB19 A\'tin Fanboys. Not an official SB19 or management production.' +
    '</td></tr></table></div></body></html>';

  return { html: html, inlineImages: inlineImages };
}

// ============================================================
//  EMAILS
// ============================================================

/**
 * Sent immediately on submission. Personalized, fully branded copy of
 * everything the registrant just submitted, so they have a record of
 * it even before verification happens.
 */
function sendPendingConfirmationEmail(payload, regId) {
  const amount = CONFIG.PRICE_PER_TICKET
    ? CONFIG.CURRENCY + (Number(payload.ticketQuantity) * CONFIG.PRICE_PER_TICKET).toLocaleString()
    : '';

  const rows =
    infoRow_('Registration ID', '<strong>' + escapeHtml_(regId) + '</strong>') +
    infoRow_('Full Name', escapeHtml_(payload.fullName)) +
    infoRow_('Email', escapeHtml_(payload.email)) +
    infoRow_('Phone', escapeHtml_(payload.phone)) +
    infoRow_('Tickets', '<strong>' + escapeHtml_(payload.ticketQuantity) + '</strong>') +
    (amount ? infoRow_('Amount Due', '<strong>' + amount + '</strong>') : '') +
    infoRow_('Payment Channel', escapeHtml_(payload.paymentChannel)) +
    infoRow_('Reference No.', escapeHtml_(payload.paymentReference));

  const bodyHtml =
    '<p>Hi <strong>' + escapeHtml_(payload.fullName) + '</strong>,</p>' +
    '<p>We\'ve received your registration for <strong>' +
    escapeHtml_(CONFIG.EVENT_NAME) +
    '</strong>. Here\'s a copy of everything you submitted, for your records:</p>' +
    infoBox_(rows) +
    '<p>Your status is currently <strong>Pending Payment Verification</strong>. Our team checks each ' +
    'payment manually — you\'ll get a follow-up email the moment it\'s confirmed.</p>' +
    warningBox_(
      'If we find an issue with your payment (amount doesn\'t match, reference not found, incomplete ' +
        'payment, etc.), we\'ll email you a link to correct it yourself, with a <strong>' +
        CONFIG.CORRECTION_WINDOW_HOURS +
        '-hour window</strong> to fix it before your seat(s) are released back to other registrants.'
    ) +
    '<p style="font-size:13px;color:rgba(245,240,230,0.7);">This is an automated message — no need to reply. ' +
    'For any concerns, reach us at <strong>' +
    CONFIG.ORGANIZER_CONTACT_EMAIL +
    '</strong>.</p>';

  const shell = buildEmailShell_({
    pillLabel: 'Pending Verification',
    pillColor: '#c9a24b',
    pillTextColor: '#0a0a0a',
    bodyHtml: bodyHtml,
  });

  MailApp.sendEmail({
    to: payload.email,
    subject: `[${CONFIG.EVENT_NAME}] Registration Received — ${regId}`,
    htmlBody: shell.html,
    body:
      `Hi ${payload.fullName},\n\nWe've received your registration (${regId}) for ${CONFIG.EVENT_NAME}. ` +
      `Status: Pending Payment Verification. Tickets: ${payload.ticketQuantity}. Please view this email in ` +
      `an HTML-capable mail app for full details.\n\n— ${CONFIG.SENDER_DISPLAY_NAME}`,
    name: CONFIG.SENDER_DISPLAY_NAME,
    inlineImages: shell.inlineImages,
  });
}

/**
 * Sent the moment you set a row's Status to "Approved". Generates a
 * scannable QR code from the row's stored QR Token and embeds it
 * directly in the branded email, along with the Terms & Conditions.
 */
function sendApprovalEmailWithQr(rowObj) {
  const regId = rowObj['Registration ID'];
  const qrToken = rowObj['QR Token'];
  const qrImageUrl =
    'https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=' + encodeURIComponent(qrToken);

  let qrBlob = null;
  try {
    const response = UrlFetchApp.fetch(qrImageUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      qrBlob = response.getBlob().setName('entry-qr.png');
    }
  } catch (err) {
    qrBlob = null; // Email still sends below, just without the QR image.
  }

  const amount = CONFIG.PRICE_PER_TICKET
    ? CONFIG.CURRENCY + (Number(rowObj['Ticket Quantity']) * CONFIG.PRICE_PER_TICKET).toLocaleString()
    : '';

  const rows =
    infoRow_('Registration ID', '<strong>' + escapeHtml_(regId) + '</strong>') +
    infoRow_('Tickets', '<strong>' + escapeHtml_(rowObj['Ticket Quantity']) + '</strong>') +
    (amount ? infoRow_('Amount Paid', '<strong>' + amount + '</strong>') : '') +
    infoRow_('Event', escapeHtml_(CONFIG.EVENT_NAME)) +
    infoRow_('When', '<strong>' + escapeHtml_(CONFIG.EVENT_DATE_DISPLAY) + '</strong>') +
    infoRow_('Where', '<strong>' + escapeHtml_(CONFIG.VENUE) + '</strong>');

  const qrSection = qrBlob
    ? '<div style="text-align:center;background-color:#ffffff;border-radius:10px;padding:20px;margin:0 0 22px;">' +
      '<img src="cid:entryQr" width="240" height="240" alt="Entry QR code" style="display:block;margin:0 auto;" />' +
      '</div>'
    : warningBox_(
        'Your QR code couldn\'t be generated automatically — please contact <strong>' +
          CONFIG.ORGANIZER_CONTACT_EMAIL +
          '</strong> before the event and we\'ll send it manually. Your Registration ID above still confirms your approval.'
      );

  const bodyHtml =
    '<p>Hi <strong>' + escapeHtml_(rowObj['Full Legal Name']) + '</strong>,</p>' +
    '<p>Your payment has been verified — your registration is <strong>Approved</strong>. You\'re in! 🎉</p>' +
    warningBox_(
      '<strong>ARRIVE 1–2 HOURS BEFORE SCREEN TIME (' +
        escapeHtml_(CONFIG.EVENT_DATE_DISPLAY) +
        ').</strong> The organizers (SB19 A\'tin Fanboys admin team) are watching this screening too and want ' +
        'it to start on time — we personally handle ticket/QR verification at the door, so please be mindful ' +
        'of the time. <strong>We reserve the right to deny entry if you arrive late.</strong>'
    ) +
    infoBox_(rows) +
    '<p><strong>Show this QR code at the entrance:</strong></p>' +
    qrSection +
    '<p><strong>Terms &amp; Conditions</strong></p>' +
    '<div style="font-size:13px;line-height:1.6;">' +
    CONFIG.TERMS_SUMMARY_HTML +
    '</div>' +
    '<p>See you at the screening!</p>';

  const shell = buildEmailShell_({
    pillLabel: 'Approved ✓',
    pillColor: '#2e7d46',
    pillTextColor: '#ffffff',
    bodyHtml: bodyHtml,
  });

  const inlineImages = Object.assign({}, shell.inlineImages);
  if (qrBlob) inlineImages.entryQr = qrBlob;

  MailApp.sendEmail({
    to: rowObj['Email Address'],
    subject: `[${CONFIG.EVENT_NAME}] You're In! Registration Approved — ${regId}`,
    htmlBody: shell.html,
    body:
      `Hi ${rowObj['Full Legal Name']}, your registration (${regId}) is Approved. Please arrive 1-2 hours ` +
      `before screen time (${CONFIG.EVENT_DATE_DISPLAY}) — late arrivals may be denied entry. Please view this ` +
      `email in an HTML-capable mail app to see your entry QR code and full details.\n\n— ${CONFIG.SENDER_DISPLAY_NAME}`,
    name: CONFIG.SENDER_DISPLAY_NAME,
    inlineImages: inlineImages,
  });
}

/** Sent when a row's Status is set to "Payment Mismatch - Awaiting Correction". */
function sendMismatchNoticeEmail(rowObj, deadline) {
  const regId = rowObj['Registration ID'];
  const link = buildCorrectionLink(regId);

  const rows =
    infoRow_('Registration ID', '<strong>' + escapeHtml_(regId) + '</strong>') +
    infoRow_('Tickets', escapeHtml_(rowObj['Ticket Quantity'])) +
    infoRow_('Reference on File', escapeHtml_(rowObj['Payment Reference No.']));

  const fixSection = link
    ? buttonHtml_(link, 'Fix My Payment Info') +
      '<p style="font-size:13px;color:rgba(245,240,230,0.7);">Or copy this link into your browser: <br>' +
      '<a href="' +
      link +
      '" style="color:#c9a24b;word-break:break-all;">' +
      link +
      '</a></p>' +
      '<p>Enter your Registration ID and the email you registered with, then submit the correct reference ' +
      'number and/or a new payment screenshot. No need to register again — this updates your existing registration.</p>'
    : '<p>Please contact us at <strong>' +
      CONFIG.ORGANIZER_CONTACT_EMAIL +
      '</strong> with the corrected reference number and/or a new payment screenshot.</p>';

  const bodyHtml =
    '<p>Hi <strong>' + escapeHtml_(rowObj['Full Legal Name']) + '</strong>,</p>' +
    '<p>We found an issue verifying the payment for your registration — most commonly this means the ' +
    'amount paid doesn\'t match the ticket quantity, or we couldn\'t match your reference number.</p>' +
    infoBox_(rows) +
    warningBox_(
      'You have until <strong>' +
        escapeHtml_(deadline.toString()) +
        '</strong> (about ' +
        CONFIG.CORRECTION_WINDOW_HOURS +
        ' hours from now) to fix this, or your reserved seat(s) will be automatically released back into ' +
        'the pool for other registrants.'
    ) +
    fixSection;

  const shell = buildEmailShell_({
    pillLabel: 'Action Needed',
    pillColor: '#8b1e2f',
    pillTextColor: '#ffffff',
    bodyHtml: bodyHtml,
  });

  MailApp.sendEmail({
    to: rowObj['Email Address'],
    subject: `[${CONFIG.EVENT_NAME}] Action Needed — Payment Issue on ${regId}`,
    htmlBody: shell.html,
    body:
      `Hi ${rowObj['Full Legal Name']}, there's a payment issue on your registration (${regId}). You have ` +
      `until ${deadline.toString()} to fix it${link ? ' here: ' + link : ', contact ' + CONFIG.ORGANIZER_CONTACT_EMAIL} ` +
      `or your seat(s) will be released.\n\n— ${CONFIG.SENDER_DISPLAY_NAME}`,
    name: CONFIG.SENDER_DISPLAY_NAME,
    inlineImages: shell.inlineImages,
  });
}

/** Sent after a registrant successfully uses the self-service correction page. */
function sendCorrectionReceivedEmail(rowObj) {
  const regId = rowObj['Registration ID'];
  const rows =
    infoRow_('Registration ID', '<strong>' + escapeHtml_(regId) + '</strong>') +
    infoRow_('Tickets', escapeHtml_(rowObj['Ticket Quantity'])) +
    infoRow_('Reference No.', escapeHtml_(rowObj['Payment Reference No.']));

  const bodyHtml =
    '<p>Hi <strong>' + escapeHtml_(rowObj['Full Legal Name']) + '</strong>,</p>' +
    '<p>We\'ve received your corrected payment information. Your registration is back in the verification ' +
    'queue as <strong>Pending Payment Verification</strong> — we\'ll follow up once it\'s checked.</p>' +
    infoBox_(rows);

  const shell = buildEmailShell_({
    pillLabel: 'Back in Queue',
    pillColor: '#c9a24b',
    pillTextColor: '#0a0a0a',
    bodyHtml: bodyHtml,
  });

  MailApp.sendEmail({
    to: rowObj['Email Address'],
    subject: `[${CONFIG.EVENT_NAME}] Corrected Payment Info Received — ${regId}`,
    htmlBody: shell.html,
    body:
      `Hi ${rowObj['Full Legal Name']}, we've received your corrected payment info for ${regId}. Your ` +
      `registration is back in the verification queue.\n\n— ${CONFIG.SENDER_DISPLAY_NAME}`,
    name: CONFIG.SENDER_DISPLAY_NAME,
    inlineImages: shell.inlineImages,
  });
}

/** Sent when a row's seat(s) are released — either the 24-hour sweep, or you setting Status to "Expired" directly. */
function sendExpiredReleaseEmail(rowObj) {
  const regId = rowObj['Registration ID'];
  const bodyHtml =
    '<p>Hi <strong>' + escapeHtml_(rowObj['Full Legal Name']) + '</strong>,</p>' +
    '<p>Your reserved seat(s) under <strong>' +
    escapeHtml_(regId) +
    '</strong> have been released back to other registrants because the payment issue on this registration ' +
    'wasn\'t resolved in time.</p>' +
    '<p>If you\'d still like to attend and slots are available, you\'re welcome to register again with the ' +
    'correct payment details. If you believe this was a mistake, contact us right away at <strong>' +
    CONFIG.ORGANIZER_CONTACT_EMAIL +
    '</strong>.</p>';

  const shell = buildEmailShell_({
    pillLabel: 'Reservation Released',
    pillColor: '#5a5a5a',
    pillTextColor: '#ffffff',
    bodyHtml: bodyHtml,
  });

  MailApp.sendEmail({
    to: rowObj['Email Address'],
    subject: `[${CONFIG.EVENT_NAME}] Reservation Released — ${regId}`,
    htmlBody: shell.html,
    body:
      `Hi ${rowObj['Full Legal Name']}, your reserved seat(s) under ${regId} have been released. Contact ` +
      `${CONFIG.ORGANIZER_CONTACT_EMAIL} if this was a mistake.\n\n— ${CONFIG.SENDER_DISPLAY_NAME}`,
    name: CONFIG.SENDER_DISPLAY_NAME,
    inlineImages: shell.inlineImages,
  });
}

/** Sent when you set a row's Status directly to "Rejected". */
function sendRejectionEmail(rowObj) {
  const regId = rowObj['Registration ID'];
  const bodyHtml =
    '<p>Hi <strong>' + escapeHtml_(rowObj['Full Legal Name']) + '</strong>,</p>' +
    '<p>We were unable to approve your registration <strong>' +
    escapeHtml_(regId) +
    '</strong> and your reserved seat(s) have been released.</p>' +
    '<p>If you believe this was a mistake or would like to register again, contact us at <strong>' +
    CONFIG.ORGANIZER_CONTACT_EMAIL +
    '</strong>.</p>';

  const shell = buildEmailShell_({
    pillLabel: 'Not Approved',
    pillColor: '#8b1e2f',
    pillTextColor: '#ffffff',
    bodyHtml: bodyHtml,
  });

  MailApp.sendEmail({
    to: rowObj['Email Address'],
    subject: `[${CONFIG.EVENT_NAME}] Registration Not Approved — ${regId}`,
    htmlBody: shell.html,
    body:
      `Hi ${rowObj['Full Legal Name']}, your registration ${regId} was not approved and your seat(s) were ` +
      `released. Contact ${CONFIG.ORGANIZER_CONTACT_EMAIL} with questions.\n\n— ${CONFIG.SENDER_DISPLAY_NAME}`,
    name: CONFIG.SENDER_DISPLAY_NAME,
    inlineImages: shell.inlineImages,
  });
}

/** Sent when you set a row's Status directly to "Cancelled". */
function sendCancellationEmail(rowObj) {
  const regId = rowObj['Registration ID'];
  const bodyHtml =
    '<p>Hi <strong>' + escapeHtml_(rowObj['Full Legal Name']) + '</strong>,</p>' +
    '<p>Your registration <strong>' +
    escapeHtml_(regId) +
    '</strong> has been cancelled and your reserved seat(s) released back to the pool.</p>' +
    '<p>If this wasn\'t expected, contact us right away at <strong>' +
    CONFIG.ORGANIZER_CONTACT_EMAIL +
    '</strong>.</p>';

  const shell = buildEmailShell_({
    pillLabel: 'Cancelled',
    pillColor: '#5a5a5a',
    pillTextColor: '#ffffff',
    bodyHtml: bodyHtml,
  });

  MailApp.sendEmail({
    to: rowObj['Email Address'],
    subject: `[${CONFIG.EVENT_NAME}] Registration Cancelled — ${regId}`,
    htmlBody: shell.html,
    body:
      `Hi ${rowObj['Full Legal Name']}, your registration ${regId} was cancelled and your seat(s) released. ` +
      `Contact ${CONFIG.ORGANIZER_CONTACT_EMAIL} if unexpected.\n\n— ${CONFIG.SENDER_DISPLAY_NAME}`,
    name: CONFIG.SENDER_DISPLAY_NAME,
    inlineImages: shell.inlineImages,
  });
}

// ============================================================
//  DASHBOARD  (menu: Wakas at Simula Admin > Build / Refresh Dashboard)
// ============================================================

const DASHBOARD_SHEET_NAME = 'Dashboard';

/**
 * Builds (or fully rebuilds) the "Dashboard" tab: live KPI cards, a
 * capacity/seats gauge, a "Needs Attention" table of pending payment
 * corrections, a recent-registrations table, and a status-breakdown pie
 * chart — all formula-driven off the Registrations sheet, so it updates
 * automatically. Also drops a checkbox "button" (row 3) that opens the
 * printable Approved Attendee List, and locks the whole tab to the owner
 * only. Safe to re-run any time — it deletes and recreates the tab.
 */
function buildDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const old = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  if (old) ss.deleteSheet(old);
  const sheet = ss.insertSheet(DASHBOARD_SHEET_NAME, 0);
  sheet.setHiddenGridlines(true);

  const DARK = '#0a0a0a';
  const GOLD = '#c9a24b';
  const CREAM = '#f5f0e6';
  const RED = '#8b1e2f';
  const GREEN = '#2e7d46';
  const GRAY = '#3d3d3d';
  const PANEL = '#1c1a14';

  sheet.getRange(1, 1, 90, 14).setBackground(DARK).setFontColor(CREAM);

  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 110);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 110);
  sheet.setColumnWidth(5, 110);
  sheet.setColumnWidth(6, 110);
  sheet.setColumnWidth(7, 110);
  sheet.setColumnWidth(8, 110);
  sheet.setColumnWidth(9, 110);
  sheet.setColumnWidth(10, 110);
  sheet.setColumnWidth(11, 30);
  sheet.setColumnWidth(12, 230);
  sheet.setColumnWidth(13, 70);

  sheet.getRange(1, 1, 1, 10).merge().setValue('SB19 "WAKAS AT SIMULA" -- LIVE DASHBOARD')
    .setBackground(DARK).setFontColor(GOLD).setFontSize(20).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 46);

  sheet.getRange(2, 1, 1, 10).merge()
    .setValue('Block Screening - Oct 10, 2026, 3:00 PM - SM Mall of Asia Cinema, ScreenX  |  Live: updates automatically as the Registrations sheet changes')
    .setBackground(DARK).setFontColor(CREAM).setFontSize(10).setFontStyle('italic')
    .setHorizontalAlignment('center');
  sheet.setRowHeight(2, 24);

  // Row 3: instructions for printing the attendee list. (A checkbox-driven
  // "button" here can't work -- Apps Script won't allow a UI dialog to be
  // opened from an onEdit trigger's execution context -- so this points to
  // the menu item instead, which runs with a real UI context.)
  sheet.getRange(3, 1, 1, 10).merge()
    .setValue('To print the Approved Attendee List for door-check: use the "Wakas at Simula Admin" menu above -> "Print Attendee List (Approved)"')
    .setFontColor(GOLD).setFontWeight('bold').setFontSize(10).setVerticalAlignment('middle')
    .setHorizontalAlignment('center');
  sheet.setRowHeight(3, 26);

  sheet.getRange(4, 1, 1, 10).merge().setValue('AT A GLANCE')
    .setBackground(PANEL).setFontColor(GOLD).setFontWeight('bold').setFontSize(11);
  sheet.setRowHeight(4, 24);

  const cardCols = [1, 3, 5, 7, 9];
  const cardLabels = ['TOTAL REGISTRATIONS', 'PENDING VERIFICATION', 'NEEDS CORRECTION', 'APPROVED', 'SEATS REMAINING'];
  const cardBg = [DARK, GOLD, RED, GREEN, DARK];
  const cardFg = [CREAM, DARK, CREAM, CREAM, GOLD];
  const kpiFormulas = [
    '=COUNTA(Registrations!B2:B)',
    '=COUNTIF(Registrations!J2:J,"Pending Payment Verification")',
    '=COUNTIF(Registrations!J2:J,"Payment Mismatch - Awaiting Correction")',
    '=COUNTIF(Registrations!J2:J,"Approved")',
    '=MAX(0,MIN(230+_Config!B2,269)-(SUMIF(Registrations!J2:J,"Pending Payment Verification",Registrations!F2:F)+SUMIF(Registrations!J2:J,"Payment Mismatch - Awaiting Correction",Registrations!F2:F)+SUMIF(Registrations!J2:J,"Approved",Registrations!F2:F)))',
  ];
  for (let i = 0; i < cardCols.length; i++) {
    const c = cardCols[i];
    sheet.getRange(5, c, 1, 2).merge().setValue(cardLabels[i])
      .setBackground(cardBg[i]).setFontColor(cardFg[i]).setFontSize(9).setFontWeight('bold')
      .setHorizontalAlignment('center');
    sheet.getRange(6, c, 1, 2).merge().setFormula(kpiFormulas[i])
      .setBackground(cardBg[i]).setFontColor(cardFg[i]).setFontSize(26).setFontWeight('bold')
      .setHorizontalAlignment('center');
  }
  sheet.setRowHeight(5, 22);
  sheet.setRowHeight(6, 50);

  const needsCorrectionRange = sheet.getRange(6, 5, 1, 2);
  const ncRule = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0)
    .setBackground('#b22b3f')
    .setRanges([needsCorrectionRange])
    .build();
  sheet.setConditionalFormatRules([ncRule]);

  sheet.getRange(8, 1, 1, 10).merge().setValue('OTHER OUTCOMES')
    .setBackground(PANEL).setFontColor(GOLD).setFontWeight('bold').setFontSize(11);
  sheet.setRowHeight(8, 22);

  const smallCards = [
    [1, 'REJECTED', '=COUNTIF(Registrations!J2:J,"Rejected")'],
    [4, 'CANCELLED', '=COUNTIF(Registrations!J2:J,"Cancelled")'],
    [7, 'EXPIRED / AUTO-RELEASED', '=COUNTIF(Registrations!J2:J,"Expired - Auto-Released")'],
  ];
  smallCards.forEach(function (card) {
    const c = card[0];
    sheet.getRange(9, c, 1, 3).merge().setValue(card[1])
      .setBackground(GRAY).setFontColor(CREAM).setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
    sheet.getRange(10, c, 1, 3).merge().setFormula(card[2])
      .setBackground(GRAY).setFontColor(CREAM).setFontSize(18).setFontWeight('bold').setHorizontalAlignment('center');
  });
  sheet.setRowHeight(9, 20);
  sheet.setRowHeight(10, 32);

  sheet.getRange(12, 1, 1, 10).merge().setValue('CAPACITY & SEATS')
    .setBackground(PANEL).setFontColor(GOLD).setFontWeight('bold').setFontSize(11);
  sheet.setRowHeight(12, 22);

  const capRows = [
    ['Total Venue Capacity', '=269'],
    ['Admin Reserve (total held back)', '=39'],
    ['Admin Reserve Released so far (edit in _Config tab)', '=_Config!B2'],
    ['Effective Public Cap (230 + Released, max 269)', '=MIN(230+_Config!B2,269)'],
    ['Seats Claimed (Pending + Needs Correction + Approved)', '=SUMIF(Registrations!J2:J,"Pending Payment Verification",Registrations!F2:F)+SUMIF(Registrations!J2:J,"Payment Mismatch - Awaiting Correction",Registrations!F2:F)+SUMIF(Registrations!J2:J,"Approved",Registrations!F2:F)'],
    ['Seats Remaining (Public)', '=MAX(0,MIN(230+_Config!B2,269)-(SUMIF(Registrations!J2:J,"Pending Payment Verification",Registrations!F2:F)+SUMIF(Registrations!J2:J,"Payment Mismatch - Awaiting Correction",Registrations!F2:F)+SUMIF(Registrations!J2:J,"Approved",Registrations!F2:F)))'],
  ];
  for (let i = 0; i < capRows.length; i++) {
    const r = 13 + i;
    sheet.getRange(r, 1, 1, 6).merge().setValue(capRows[i][0])
      .setFontColor(CREAM).setFontSize(10);
    sheet.getRange(r, 7, 1, 3).merge().setFormula(capRows[i][1])
      .setFontColor(GOLD).setFontSize(12).setFontWeight('bold').setHorizontalAlignment('right');
  }

  const barRow = 13 + capRows.length;
  sheet.getRange(barRow, 1, 1, 6).merge().setValue('Capacity Used')
    .setFontColor(CREAM).setFontSize(10);
  sheet.getRange(barRow, 7, 1, 3).merge().setFormula(
    '=REPT("#",ROUND((SUMIF(Registrations!J2:J,"Pending Payment Verification",Registrations!F2:F)+SUMIF(Registrations!J2:J,"Payment Mismatch - Awaiting Correction",Registrations!F2:F)+SUMIF(Registrations!J2:J,"Approved",Registrations!F2:F))/MIN(230+_Config!B2,269)*18,0))&REPT("-",18-ROUND((SUMIF(Registrations!J2:J,"Pending Payment Verification",Registrations!F2:F)+SUMIF(Registrations!J2:J,"Payment Mismatch - Awaiting Correction",Registrations!F2:F)+SUMIF(Registrations!J2:J,"Approved",Registrations!F2:F))/MIN(230+_Config!B2,269)*18,0))&"  "&TEXT((SUMIF(Registrations!J2:J,"Pending Payment Verification",Registrations!F2:F)+SUMIF(Registrations!J2:J,"Payment Mismatch - Awaiting Correction",Registrations!F2:F)+SUMIF(Registrations!J2:J,"Approved",Registrations!F2:F))/MIN(230+_Config!B2,269),"0%")'
  ).setFontColor(GOLD).setFontSize(12).setHorizontalAlignment('right');
  sheet.setRowHeight(barRow, 22);

  const naHeaderRow = barRow + 2;
  sheet.getRange(naHeaderRow, 1, 1, 10).merge().setValue('NEEDS ATTENTION -- Payment Corrections Pending')
    .setBackground(RED).setFontColor(CREAM).setFontWeight('bold').setFontSize(11);
  sheet.setRowHeight(naHeaderRow, 24);

  const naFormulaRow = naHeaderRow + 1;
  sheet.getRange(naFormulaRow, 1).setFormula(
    '=IFERROR(QUERY(Registrations!A2:Q,"select B,C,F,K,(K-NOW())*24 where J=\'Payment Mismatch - Awaiting Correction\' order by K asc limit 15 label B \'Reg ID\', C \'Full Name\', F \'Tickets\', K \'Deadline\', (K-NOW())*24 \'Hours Left\'",0),"No payment corrections pending right now.")'
  ).setFontColor(CREAM).setFontSize(10);
  // QUERY renders the Deadline/Hours-Left columns as raw serials until
  // formatted explicitly -- pre-format the whole 15-row result block.
  sheet.getRange(naFormulaRow, 4, 16, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange(naFormulaRow, 5, 16, 1).setNumberFormat('0.0');

  const recentHeaderRow = naFormulaRow + 17;
  sheet.getRange(recentHeaderRow, 1, 1, 10).merge().setValue('RECENT REGISTRATIONS (Last 10)')
    .setBackground(PANEL).setFontColor(GOLD).setFontWeight('bold').setFontSize(11);
  sheet.setRowHeight(recentHeaderRow, 24);

  const recentFormulaRow = recentHeaderRow + 1;
  sheet.getRange(recentFormulaRow, 1).setFormula(
    '=IFERROR(QUERY(Registrations!A2:Q,"select B,C,F,J,A order by A desc limit 10 label B \'Reg ID\', C \'Full Name\', F \'Tickets\', J \'Status\', A \'Submitted\'",0),"No registrations yet.")'
  ).setFontColor(CREAM).setFontSize(10);
  // Same fix for the "Submitted" column in this table.
  sheet.getRange(recentFormulaRow, 5, 11, 1).setNumberFormat('yyyy-mm-dd hh:mm');

  const chartHeaderRow = recentFormulaRow + 11;
  sheet.getRange(chartHeaderRow, 1, 1, 10).merge().setValue('STATUS BREAKDOWN')
    .setBackground(PANEL).setFontColor(GOLD).setFontWeight('bold').setFontSize(11);
  sheet.setRowHeight(chartHeaderRow, 24);

  sheet.getRange(5, 12).setValue('Status').setFontColor(GRAY).setFontSize(8);
  sheet.getRange(5, 13).setValue('Count').setFontColor(GRAY).setFontSize(8);
  const chartStatuses = [
    'Pending Payment Verification',
    'Payment Mismatch - Awaiting Correction',
    'Approved',
    'Rejected',
    'Cancelled',
    'Expired - Auto-Released',
  ];
  for (let i = 0; i < chartStatuses.length; i++) {
    const r = 6 + i;
    sheet.getRange(r, 12).setValue(chartStatuses[i]).setFontColor(GRAY).setFontSize(8);
    sheet.getRange(r, 13).setFormula('=COUNTIF(Registrations!J2:J,L' + r + ')').setFontColor(GRAY).setFontSize(8);
  }

  const chartRange = sheet.getRange(5, 12, 7, 2);
  const chart = sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(chartRange)
    .setPosition(chartHeaderRow + 1, 1, 0, 0)
    .setOption('title', 'Status Breakdown')
    .setOption('pieHole', 0.4)
    .setOption('backgroundColor', DARK)
    .setOption('titleTextStyle', { color: CREAM })
    .setOption('legend', { textStyle: { color: CREAM } })
    .setOption('colors', [GOLD, RED, GREEN, '#8a8a8a', '#5a5a5a', '#2a2a2a'])
    .setOption('width', 480)
    .setOption('height', 300)
    .build();
  sheet.insertChart(chart);

  sheet.setFrozenRows(2);
  protectSheetOwnerOnly_(sheet, 'Dashboard - restricted to owner only');

  SpreadsheetApp.getUi().alert('Dashboard built. It is restricted to your account only and updates automatically as the Registrations sheet changes.');
}

/** Fully protects a sheet, leaving only the spreadsheet owner able to edit it. */
function protectSheetOwnerOnly_(sheet, description) {
  const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  existing.forEach(function (p) { if (p.canEdit()) p.remove(); });
  const protection = sheet.protect().setDescription(description);
  protection.removeEditors(protection.getEditors());
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}

/**
 * Opens a print-ready dialog listing every currently "Approved"
 * registration (name, Reg ID, ticket count, a blank check-off box), for
 * use at the door on event day. Reachable from the Dashboard's checkbox
 * "button" (row 3) or the Wakas at Simula Admin menu.
 */
function showAttendeeListDialog() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const nameCol = HEADERS.indexOf('Full Legal Name');
  const regIdCol = HEADERS.indexOf('Registration ID');
  const qtyCol = HEADERS.indexOf('Ticket Quantity');
  const statusCol = HEADERS.indexOf('Status');

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][statusCol] === STATUS.APPROVED) {
      rows.push({ regId: data[i][regIdCol], name: data[i][nameCol], qty: data[i][qtyCol] });
    }
  }
  rows.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

  let tableRows = '';
  let totalTickets = 0;
  rows.forEach(function (r, idx) {
    totalTickets += Number(r.qty) || 0;
    tableRows +=
      '<tr>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml_(r.regId) + '</td>' +
      '<td>' + escapeHtml_(r.name) + '</td>' +
      '<td style="text-align:center;">' + r.qty + '</td>' +
      '<td style="text-align:center;">&#9633;</td>' +
      '</tr>';
  });

  const html =
    '<html><head><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;padding:16px;color:#111;}' +
    'h1{font-size:16px;margin:0 0 4px;} .meta{font-size:11px;color:#555;margin-bottom:14px;}' +
    'table{width:100%;border-collapse:collapse;font-size:12px;}' +
    'th,td{border:1px solid #999;padding:5px 8px;text-align:left;}' +
    'th{background:#111;color:#fff;}' +
    '.btnRow{margin-bottom:14px;}' +
    'button{padding:8px 18px;font-size:13px;font-weight:bold;cursor:pointer;}' +
    '@media print { .btnRow { display:none; } }' +
    '</style></head><body>' +
    '<div class="btnRow"><button onclick="window.print()">Print This List</button></div>' +
    '<h1>' + escapeHtml_(CONFIG.EVENT_NAME) + ' - Approved Attendee List</h1>' +
    '<div class="meta">' + escapeHtml_(CONFIG.EVENT_DATE_DISPLAY) + ' - ' + escapeHtml_(CONFIG.VENUE) +
    ' | Generated ' + new Date().toLocaleString() +
    ' | ' + rows.length + ' registrations, ' + totalTickets + ' tickets</div>' +
    '<table><tr><th>#</th><th>Reg ID</th><th>Full Name</th><th>Tickets</th><th>Checked In</th></tr>' +
    tableRows +
    '</table></body></html>';

  const output = HtmlService.createHtmlOutput(html).setWidth(700).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(output, 'Approved Attendee List');
}
