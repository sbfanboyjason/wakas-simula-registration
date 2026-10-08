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
  FAQ_URL: 'https://sbfanboyjason.github.io/wakas-simula-registration/EMAIL-REMINDER.html',
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

  const item = function (title, text) {
    return (
      '<tr><td style="padding:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#f5f0e6;">' +
      '<strong style="color:#c9a24b;">' + title + '</strong><br>' + text +
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

  return (
    '<p>Hi <strong>' + name + '</strong>,</p>' +
    '<p>The screening is this <strong>Saturday, October 10, at 3:00 PM</strong>. Here is what you need to know before you head out.</p>' +
    infoBox_(
      infoRow_('Registration ID', '<strong>' + regId + '</strong>') +
      infoRow_('Tickets', '<strong>' + qty + '</strong>') +
      infoRow_('When', escapeHtml_(CONFIG.EVENT_DATE_DISPLAY)) +
      infoRow_('Where', escapeHtml_(CONFIG.VENUE))
    ) +

    heading('Bring these to the entrance') +
    list(
      item('1. A valid ID',
        'A government or school ID with the same name as your registration. We check it against our list at the door.') +
      item('2. Your QR code',
        'It is in your approval email, the one titled <em>"You\'re In! Registration Approved — ' + regId + '"</em>. ' +
        'A screenshot or the email open on your phone is fine. No need to print it.' +
        (qty > 1
          ? ' This one QR covers all ' + qty + ' of your tickets, and your group is seated together.'
          : ''))
    ) +

    heading('Reminders') +
    list(
      item('Come early',
        'Our team is on-site from around lunchtime and hands out tickets in person, first come, first served. ' +
        'Once the film starts we are inside watching too, so late arrivals cannot be let in.') +
      item('Elesbi lightsticks are welcome',
        'Bring your Elesbi. Please be mindful of the people around you: keep it low so it does not block anyone\'s view of the screen.') +
      item('Bring your light roses for Project Nebula',
        'Our fan project for the screening. Bring your light roses and let\'s relive the concert together.') +
      item('Cinema rules',
        'No outside food or drinks inside SM Cinema. Photos before and after are welcome, but please do not record the screening.')
    ) +

    heading('Can\'t make it? Transfer your slot') +
    warningBox_(
      'Reply to your approval email (the one with your QR code), <strong>CC the person taking your slot</strong>, ' +
      'and tell us your request, including their full name as it appears on their ID. ' +
      'Please send it at least 24 hours before the screening, by <strong>' + REMINDER.TRANSFER_DEADLINE + '</strong>. ' +
      'A slot used by someone else without telling us may be cancelled. Registrations are non-refundable.'
    ) +

    '<p>Everything else, including parking and what to do if you lost your QR, is in the full FAQ: ' +
    '<a href="' + REMINDER.FAQ_URL + '" style="color:#c9a24b;">Wakas at Simula FAQs</a>.</p>' +
    '<p>See you at ScreenX.<br>— SB19 A\'tin Fanboys</p>'
  );
}

function reminderPlainText_(rowObj) {
  const qty = Number(rowObj['Ticket Quantity']) || 0;
  return (
    `Hi ${rowObj['Full Legal Name']},\n\n` +
    `The screening is this Saturday, October 10, at 3:00 PM at ${CONFIG.VENUE}.\n` +
    `Registration ID: ${rowObj['Registration ID']} | Tickets: ${qty}\n\n` +
    `BRING: a valid ID with the same name as your registration, and the QR code from your approval email ` +
    `("You're In! Registration Approved"). A screenshot is fine.\n\n` +
    `REMINDERS: Come early, tickets are handed out first come, first served and late arrivals cannot be let in. ` +
    `Elesbi lightsticks are welcome, keep them low so you don't block anyone's view. ` +
    `Bring your light roses for Project Nebula. No outside food or drinks, no recording during the screening.\n\n` +
    `TRANSFERS: reply to your approval email, CC the person taking your slot, and send your request ` +
    `by ${REMINDER.TRANSFER_DEADLINE}.\n\n` +
    `Full FAQs: ${REMINDER.FAQ_URL}\n\n— ${CONFIG.SENDER_DISPLAY_NAME}`
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

/** Menu: Send Event Reminder to All. Safe to run again: skips anyone already sent. */
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

    const started = Date.now();
    let sent = 0, failed = 0;
    for (let k = 0; k < pending.length && sent < canSend; k++) {
      if (Date.now() - started > REMINDER.TIME_LIMIT_MS) break;
      const x = pending[k];
      try {
        reminderSend_(x.rowObj['Email Address'], x.rowObj, false);
        info.sheet.getRange(x.rowNum, info.sentCol).setValue(new Date());
        sent++;
      } catch (err) {
        failed++;
        console.error('Reminder failed for ' + x.rowObj['Registration ID'] + ': ' + err.message);
        if (/limit|quota/i.test(err.message)) break;
      }
    }
    SpreadsheetApp.flush();

    try {
      getOrCreateAuditSheet_().appendRow([new Date(), safeActiveUserEmail_(), CONFIG.SHEET_NAME, '', '', REMINDER.SENT_HEADER, '', '',
        'Event reminder: sent ' + sent + ', failed ' + failed + ', still to send ' + (pending.length - sent)]);
    } catch (err) {}

    const left = pending.length - sent;
    ui.alert(
      'Sent ' + sent + ' reminder(s).' +
        (failed ? ' ' + failed + ' failed (see Executions log).' : '') +
        (left > 0
          ? '\n\n' + left + ' still to send. Run "Send Event Reminder to All" again later; it skips everyone already sent.'
          : '\n\nEveryone approved has the reminder now.')
    );
  } finally {
    lock.releaseLock();
  }
}
