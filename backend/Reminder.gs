/**
 * ============================================================
 *  EVENT REMINDER EMAIL — one-time send to every Approved registrant
 * ============================================================
 *  Add as a script file in the same Apps Script project as Code.gs
 *  (it uses CONFIG, STATUS, HEADERS, buildEmailShell_, infoBox_,
 *  infoRow_, warningBox_, escapeHtml_ from there).
 *
 *  Menu: Wakas at Simula Admin >
 *    Preview Event Reminder        - shows the email on screen, sends nothing
 *    Send Event Reminder to Me     - sends one test copy to the organizer inbox
 *    Send Event Reminder to All    - sends to every Approved registrant
 *    Refresh Reminder Status       - rebuilds the "Reminder Status" tab
 *
 *  Hands-off: run sendEventRemindersAuto() once (RunReminders.gs). It
 *  sends what today's limit allows, then re-checks every 15 minutes and
 *  sends the rest as soon as the limit refreshes, then switches off.
 *
 *  Gmail limits how many people a script can email per day (about 100
 *  for a free Gmail account). "Send to All" stops when that runs out and
 *  stamps each row it sent in the "Event Reminder Sent" column, so
 *  running it again later only sends to the people still missing it.
 *  Nobody gets it twice.
 * ============================================================
 */

const REMINDER = {
  SENT_HEADER: 'Event Reminder Sent',
  STATUS_SHEET: 'Reminder Status',
  TRANSFER_DEADLINE: '3:00 PM on Friday, October 9',
  QUOTA_RESERVE: 2, // leave a couple of sends for urgent one-off emails
  TIME_LIMIT_MS: 4.5 * 60 * 1000, // Apps Script stops runs at 6 minutes
};

/** Approval email subject, so registrants can find it in their inbox. */
function reminderApprovalSubject_(regId) {
  return `[${CONFIG.EVENT_NAME}] You're In! Registration Approved — ${regId}`;
}

function reminderBody_(rowObj) {
  const name = escapeHtml_(rowObj['Full Legal Name']);
  const regId = escapeHtml_(rowObj['Registration ID']);
  const qty = Number(rowObj['Ticket Quantity']) || 0;
  const contact = '<a href="mailto:' + CONFIG.ORGANIZER_CONTACT_EMAIL + '" style="color:#c9a24b;">' +
    CONFIG.ORGANIZER_CONTACT_EMAIL + '</a>';

  const item = function (title, text) {
    return (
      '<tr><td style="padding:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#f5f0e6;">' +
      '<strong style="color:#c9a24b;">' + title + '</strong><br>' + text +
      '</td></tr>'
    );
  };
  const faq = function (q, a) {
    return (
      '<tr><td style="padding:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:rgba(245,240,230,0.82);">' +
      '<strong style="color:#f5f0e6;">' + q + '</strong><br>' + a +
      '</td></tr>'
    );
  };
  const list = function (rows) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">' + rows + '</table>';
  };
  const heading = function (text) {
    return '<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;' +
      'color:#c9a24b;font-weight:bold;margin:26px 0 12px;">' + text + '</p>';
  };
  const goldNote = function (html) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
      'style="background-color:#1e1a10;border:1px solid #6b5322;border-radius:8px;margin:0 0 22px;">' +
      '<tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#e6c987;line-height:1.6;">' +
      html + '</td></tr></table>';
  };

  return (
    '<p>Hi <strong>' + name + '</strong>,</p>' +
    '<p>The screening is this <strong>Saturday, October 10, at 3:00 PM</strong>. Below is your ticket summary, ' +
    'what to bring, and answers to the questions we get asked most.</p>' +
    goldNote(
      '<strong style="color:#f0d9a3;">Please read this email in full</strong> before the event. It covers entry, ' +
      'arrival and seating, and we can\'t make exceptions on the day for anything already explained here.'
    ) +
    infoBox_(
      infoRow_('Registration ID', '<strong>' + regId + '</strong>') +
      infoRow_('Tickets', '<strong>' + qty + '</strong>') +
      infoRow_('When', escapeHtml_(CONFIG.EVENT_DATE_DISPLAY) + '<br>Our team is on-site from around lunchtime') +
      infoRow_('Where', 'SM Mall of Asia Cinema<br>ScreenX Hall')
    ) +

    heading('Bring these to the entrance') +
    list(
      item('1. A valid ID',
        'A government or school ID with the same name as your registration. We check it against our list at the door.') +
      item('2. Your QR code',
        'It is in your approval email, the one titled <em>"You\'re In! Registration Approved — ' + regId + '"</em>. ' +
        'A screenshot or the email open on your phone is fine. No need to print it.' +
        (qty > 1 ? ' This one QR covers all ' + qty + ' of your tickets.' : ''))
    ) +

    heading('Before you go') +
    list(
      item('Come as early as you can',
        'There is no fixed gate time. Our team hands out tickets in person from around lunchtime, first come, first served. ' +
        'The earlier you are in line, the earlier you are seated.') +
      item('Seats go by arrival order',
        'Seating is random, in the order people arrive. If you registered more than one ticket, your group is seated together.')
    ) +
    warningBox_(
      '<strong>Arriving late isn\'t really an option.</strong> Our team hands out every ticket ourselves, and once the ' +
      'screening starts we will be inside watching it too. There won\'t be anyone left outside to give you yours.'
    ) +
    list(
      item('Elesbi lightsticks are welcome',
        'Bring your Elesbi. Please be mindful of the people around you: keep it low so it does not block anyone\'s view of the screen.') +
      item('Bring your light roses for Project Nebula',
        'Our fan project for the screening. Bring your light roses and let\'s relive the concert together.') +
      item('No outside food or drinks',
        'Standard SM Cinema house rules apply. Concessions are available at the venue.') +
      item('No recording during the screening',
        'Photos before and after are welcome. No professional cameras, and please don\'t record the film itself.')
    ) +

    heading('Can\'t make it? Transfer your slot') +
    warningBox_(
      'Reply to your approval email (the one with your QR code), <strong>CC the person taking your slot</strong>, ' +
      'and tell us your request, including their full name as it appears on their ID. ' +
      'Please send it at least 24 hours before the screening, by <strong>' + REMINDER.TRANSFER_DEADLINE + '</strong>. ' +
      'If a slot is used by someone else without telling us first, we reserve the right to cancel that registration.'
    ) +

    heading('Frequently asked questions') +
    list(
      faq('What is ScreenX?',
        'ScreenX extends the movie onto the side walls for a 270° view, so expect a wraparound picture during certain scenes.') +
      faq('Can I get a refund?',
        'Registrations are non-refundable. If you can no longer attend, transfer your slot as explained above.') +
      faq('I lost my QR code or can\'t find the approval email.',
        'Email ' + contact + ' with your registered name and Registration ID and we will resend it.') +
      faq('Can minors attend?',
        'The screening is open to all ages. Minors must come with a guardian who has their own registered, paid ticket.') +
      faq('Is there parking?',
        'SM Mall of Asia has paid on-site parking at mall rates. Come early, since mall traffic gets heavy on event days.') +
      faq('What if the screening is moved or cancelled?',
        'We will email every registered attendee right away. This is very unlikely, since the venue is booked and confirmed.') +
      faq('Other questions?',
        'Reply to this email or write to ' + contact + '. We are happy to help.')
    ) +

    '<p>See you at ScreenX. Same time, same fandom, one last chapter.<br>— SB19 A\'tin Fanboys</p>'
  );
}

function reminderPlainText_(rowObj) {
  const qty = Number(rowObj['Ticket Quantity']) || 0;
  const c = CONFIG.ORGANIZER_CONTACT_EMAIL;
  return (
    `Hi ${rowObj['Full Legal Name']},\n\n` +
    `The screening is this Saturday, October 10, at 3:00 PM at SM Mall of Asia Cinema, ScreenX Hall.\n` +
    `Registration ID: ${rowObj['Registration ID']} | Tickets: ${qty}\n` +
    `Please read this email in full. We can't make exceptions on the day for anything explained here.\n\n` +
    `BRING: a valid ID with the same name as your registration, and the QR code from your approval email ` +
    `("You're In! Registration Approved"). A screenshot is fine.\n\n` +
    `BEFORE YOU GO: Come as early as you can. Tickets are handed out in person from around lunchtime, first come, first served. ` +
    `Seats go by arrival order; groups sit together.\n` +
    `ARRIVING LATE ISN'T REALLY AN OPTION: once the screening starts our team is inside watching too, so no one is left outside to hand out tickets.\n\n` +
    `Elesbi lightsticks are welcome, keep them low so you don't block anyone's view. ` +
    `Bring your light roses for Project Nebula. No outside food or drinks. No recording during the screening.\n\n` +
    `TRANSFERS: reply to your approval email, CC the person taking your slot, and send your request with their full name ` +
    `by ${REMINDER.TRANSFER_DEADLINE}. Registrations are non-refundable.\n\n` +
    `FAQ: Lost your QR? Email ${c} with your name and Registration ID. Minors need a guardian with their own paid ticket. ` +
    `SM MOA has paid parking. Other questions: ${c}\n\n— ${CONFIG.SENDER_DISPLAY_NAME}`
  );
}

function reminderSend_(to, rowObj, isTest) {
  const shell = buildEmailShell_({
    pillLabel: 'See you Saturday',
    pillColor: '#c9a24b',
    pillTextColor: '#0a0a0a',
    bodyHtml: reminderBody_(rowObj),
  });
  MailApp.sendEmail({
    to: to,
    subject: (isTest ? '[TEST] ' : '') + `[${CONFIG.EVENT_NAME}] See you this Saturday: what to bring — ${rowObj['Registration ID']}`,
    htmlBody: shell.html,
    body: reminderPlainText_(rowObj),
    name: CONFIG.SENDER_DISPLAY_NAME,
    inlineImages: shell.inlineImages,
  });
}

/** Rows that should get the reminder: Approved, has tickets and an email, not a TEST- row. */
function reminderTargets_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  let header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  let sentIdx = header.indexOf(REMINDER.SENT_HEADER);
  if (sentIdx === -1) {
    sentIdx = header.length;
    sheet.getRange(1, sentIdx + 1).setValue(REMINDER.SENT_HEADER)
      .setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
  }
  const data = sheet.getDataRange().getValues();
  const col = function (h) { return header.indexOf(h); };
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const rowObj = {
      'Registration ID': String(r[col('Registration ID')] || ''),
      'Full Legal Name': String(r[col('Full Legal Name')] || ''),
      'Email Address': String(r[col('Email Address')] || '').trim(),
      'Ticket Quantity': Number(r[col('Ticket Quantity')]) || 0,
      'Status': String(r[col('Status')] || ''),
    };
    if (rowObj.Status !== STATUS.APPROVED) continue;
    if (rowObj['Ticket Quantity'] <= 0) continue;
    if (rowObj['Registration ID'].toUpperCase().indexOf('TEST-') === 0) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rowObj['Email Address'])) continue;
    out.push({ rowNum: i + 1, rowObj: rowObj, sent: !!r[sentIdx] });
  }
  return { sheet: sheet, sentCol: sentIdx + 1, targets: out };
}

/** Menu: Preview Event Reminder. Sends nothing. */
function previewEventReminder() {
  const t = reminderTargets_().targets;
  const sample = t.length ? t[0].rowObj : { 'Full Legal Name': 'Juan Dela Cruz', 'Registration ID': 'WAS-00000', 'Ticket Quantity': 2 };
  const shell = buildEmailShell_({ pillLabel: 'See you Saturday', bodyHtml: reminderBody_(sample) });
  const html = shell.html.replace('cid:logoImg', CONFIG.SITE_BASE_URL + '/assets/logo.png');
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(680).setHeight(720),
    'Preview (sample: ' + sample['Registration ID'] + ') · nothing was sent'
  );
}

/** Menu: Send Event Reminder to Me. One test copy to the organizer inbox. */
function sendEventReminderTest() {
  const t = reminderTargets_().targets;
  const sample = t.length ? t[0].rowObj : { 'Full Legal Name': 'Juan Dela Cruz', 'Registration ID': 'WAS-00000', 'Ticket Quantity': 2 };
  reminderSend_(CONFIG.ORGANIZER_CONTACT_EMAIL, sample, true);
  SpreadsheetApp.getUi().alert('Test copy sent to ' + CONFIG.ORGANIZER_CONTACT_EMAIL + '. No registrant was emailed.');
}

/**
 * Sends to everyone approved who hasn't received it yet, as far as the
 * daily Gmail limit and the 6-minute run limit allow. No pop-ups, so it
 * can run from a timer. Returns { sent, failed, left, quota }.
 */
function reminderSendBatch_() {
  const info = reminderTargets_();
  const pending = info.targets.filter(function (x) { return !x.sent; });
  const quota = MailApp.getRemainingDailyQuota();
  const canSend = Math.max(0, Math.min(pending.length, quota - REMINDER.QUOTA_RESERVE));
  const failures = reminderLoadFailures_();
  const started = Date.now();
  let sent = 0, failed = 0;

  for (let k = 0; k < pending.length && sent < canSend; k++) {
    if (Date.now() - started > REMINDER.TIME_LIMIT_MS) break;
    const x = pending[k];
    try {
      reminderSend_(x.rowObj['Email Address'], x.rowObj, false);
      info.sheet.getRange(x.rowNum, info.sentCol).setValue(new Date());
      delete failures[x.rowObj['Registration ID']];
      sent++;
    } catch (err) {
      failed++;
      failures[x.rowObj['Registration ID']] = err.message;
      console.error('Reminder failed for ' + x.rowObj['Registration ID'] + ': ' + err.message);
      if (/limit|quota|too many times/i.test(err.message)) break;
    }
  }
  SpreadsheetApp.flush();
  PropertiesService.getScriptProperties().setProperty('reminderFailures', JSON.stringify(failures));
  try { refreshReminderStatus_(); } catch (err) { console.error('Reminder Status tab: ' + err.message); }

  // Rows that failed for a reason other than the limit (bad address) are not retried forever.
  const left = pending.length - sent;
  try {
    getOrCreateAuditSheet_().appendRow([new Date(), safeActiveUserEmail_(), CONFIG.SHEET_NAME, '', '', REMINDER.SENT_HEADER, '', '',
      'Event reminder: sent ' + sent + ', failed ' + failed + ', still to send ' + left + ' (quota was ' + quota + ')']);
  } catch (err) {}
  return { sent: sent, failed: failed, left: left, quota: quota };
}

/** Menu: Send Event Reminder to All. Asks first, then sends one batch. */
function sendEventReminders() {
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    ui.alert('Another send is already running. Try again in a minute.');
    return;
  }
  try {
    const info = reminderTargets_();
    const pending = info.targets.filter(function (x) { return !x.sent; });
    const quota = MailApp.getRemainingDailyQuota();
    const canSend = Math.max(0, Math.min(pending.length, quota - REMINDER.QUOTA_RESERVE));
    if (!pending.length) {
      ui.alert('Everyone approved has already received the reminder (' + info.targets.length + ' registrations).');
      return;
    }
    const ans = ui.alert(
      'Send event reminder',
      pending.length + ' approved registration(s) have not received it yet.\n' +
        'Gmail lets this account email ' + quota + ' more people today.\n\n' +
        'Send to ' + canSend + ' now?' +
        (canSend < pending.length ? '\n\nThe other ' + (pending.length - canSend) + ' will need a second run once the daily limit resets.' : ''),
      ui.ButtonSet.YES_NO
    );
    if (ans !== ui.Button.YES || canSend === 0) return;
    const r = reminderSendBatch_();
    ui.alert(
      'Sent ' + r.sent + ' reminder(s).' +
        (r.failed ? ' ' + r.failed + ' failed (see the Reminder Status tab).' : '') +
        (r.left > 0
          ? '\n\nSee the "Reminder Status" tab for who still needs it.\n' + r.left + ' still to send. Run "Send Event Reminder to All" again later; it skips everyone already sent.'
          : '\n\nEveryone approved has the reminder now.')
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hands-off mode. Sends one batch now, and while anyone is still
 * waiting it keeps a 15-minute timer running that calls this again;
 * each run sends as many as Gmail's limit allows at that moment (zero
 * until the limit refreshes). When everyone has it, the timer removes
 * itself and a short summary goes to the organizer inbox.
 */
function sendEventRemindersAuto() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // a run is already in progress
  let r;
  try {
    const before = reminderTargets_().targets.filter(function (x) { return !x.sent; }).length;
    if (!before) {
      reminderStopAuto_();
      return;
    }
    r = reminderSendBatch_();
  } finally {
    lock.releaseLock();
  }

  const failures = reminderLoadFailures_();
  const stillMissing = reminderTargets_().targets.filter(function (x) { return !x.sent; });
  const onlyBadAddresses = stillMissing.length > 0 && stillMissing.every(function (x) {
    const m = failures[x.rowObj['Registration ID']];
    return m && !/limit|quota|too many times/i.test(m);
  });

  if (stillMissing.length === 0 || onlyBadAddresses) {
    reminderStopAuto_();
    try {
      MailApp.sendEmail({
        to: CONFIG.ORGANIZER_CONTACT_EMAIL,
        subject: '[Wakas admin] Event reminder emails finished',
        body:
          'The event reminder email has gone out to every approved registrant it could reach.\n\n' +
          (stillMissing.length
            ? stillMissing.length + ' could not be delivered (bad address). See the "Reminder Status" tab for who they are.\n'
            : 'No failures.\n') +
          '\nThe automatic 15-minute check has switched itself off.',
        name: CONFIG.SENDER_DISPLAY_NAME,
      });
    } catch (err) {}
  } else {
    reminderStartAuto_();
  }
}

function reminderStartAuto_() {
  const exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'sendEventRemindersAuto';
  });
  if (!exists) ScriptApp.newTrigger('sendEventRemindersAuto').timeBased().everyMinutes(15).create();
}

function reminderStopAuto_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendEventRemindersAuto') ScriptApp.deleteTrigger(t);
  });
}

// ============================================================
//  "Reminder Status" tab
// ============================================================

function reminderLoadFailures_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('reminderFailures') || '{}');
  } catch (err) {
    return {};
  }
}

/** Menu: Refresh Reminder Status. */
function refreshReminderStatus() {
  refreshReminderStatus_();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REMINDER.STATUS_SHEET)
  );
}

/**
 * Rebuilds the "Reminder Status" tab from the Registrations sheet: a
 * summary at the top, then one row per Approved registrant showing
 * Sent / Not sent yet / Failed. Read-only view; safe to rebuild anytime.
 */
function refreshReminderStatus_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const info = reminderTargets_();
  const failures = reminderLoadFailures_();
  const sheet = info.sheet;
  const sentValues = sheet.getRange(1, info.sentCol, sheet.getLastRow(), 1).getValues();

  let tab = ss.getSheetByName(REMINDER.STATUS_SHEET);
  if (!tab) tab = ss.insertSheet(REMINDER.STATUS_SHEET);
  tab.clear();
  tab.getRange(1, 1, tab.getMaxRows(), 6).clearDataValidations();

  const rows = info.targets.map(function (x) {
    const at = sentValues[x.rowNum - 1][0];
    const fail = failures[x.rowObj['Registration ID']];
    const state = at ? 'Sent' : fail ? 'Failed' : 'Not sent yet';
    return [x.rowObj['Registration ID'], x.rowObj['Full Legal Name'], x.rowObj['Email Address'],
      x.rowObj['Ticket Quantity'], state, at ? at : (fail || '')];
  });
  const order = { 'Failed': 0, 'Not sent yet': 1, 'Sent': 2 };
  rows.sort(function (a, b) { return order[a[4]] - order[b[4]] || String(a[0]).localeCompare(String(b[0])); });

  const nSent = rows.filter(function (r) { return r[4] === 'Sent'; }).length;
  const nFail = rows.filter(function (r) { return r[4] === 'Failed'; }).length;
  let quota = '';
  try { quota = MailApp.getRemainingDailyQuota(); } catch (err) {}

  tab.getRange(1, 1, 5, 2).setValues([
    ['Event reminder email', ''],
    ['Sent', nSent + ' of ' + rows.length],
    ['Not sent yet', rows.length - nSent - nFail],
    ['Failed', nFail],
    ['Emails this account can still send now', quota + '   (checked ' +
      Utilities.formatDate(new Date(), 'Asia/Manila', 'MMM d, h:mm a') + ')'],
  ]);
  tab.getRange(1, 1).setFontSize(13).setFontWeight('bold');
  tab.getRange(2, 1, 4, 1).setFontWeight('bold');

  const head = ['Registration ID', 'Full Legal Name', 'Email Address', 'Tickets', 'Reminder', 'Sent At / Error'];
  tab.getRange(7, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
  if (rows.length) {
    tab.getRange(8, 1, rows.length, head.length).setValues(rows);
    tab.getRange(8, 6, rows.length, 1).setNumberFormat('mmm d, h:mm am/pm');
    const colors = rows.map(function (r) {
      const c = r[4] === 'Sent' ? '#d9f2e0' : r[4] === 'Failed' ? '#f8d7da' : '#fff4d6';
      return [c, c, c, c, c, c];
    });
    tab.getRange(8, 1, rows.length, head.length).setBackgrounds(colors);
  }
  tab.setFrozenRows(7);
  tab.autoResizeColumns(1, head.length);
}
