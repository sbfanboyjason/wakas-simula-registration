/**
 * Start the automatic event reminder send.
 * Open this file in the Apps Script editor and press Run: it sends as
 * many reminders as Gmail allows right now, then keeps checking every
 * 15 minutes and sends the rest once the daily limit refreshes.
 * Safe to run more than once; nobody receives the email twice.
 */
function startEventRemindersAuto() {
  sendEventRemindersAuto();
}
