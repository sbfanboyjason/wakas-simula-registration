/**
 * ============================================================
 * EVENT CONFIG — edit these values, no other file should need
 * touching for day-to-day changes (price, payment details, etc.)
 * ============================================================
 */
const EVENT_CONFIG = {
  EVENT_NAME: 'SB19 "Wakas at Simula" Trilogy Finale',
  EVENT_TAGLINE: 'Block Screening',
  EVENT_DATE_DISPLAY: 'October 10, 2026 · 3:00 PM',
  VENUE: 'SM Mall of Asia Cinema — ScreenX',
  ORGANIZER_NOTE:
    "Fan-organized block screening by A'tin Fanboys. Not an official SB19 or management production.",

  // Public pool is 230 of the venue's 269 seats (39 held back as an
  // admin reserve, releasable later — see Code.gs). This value is only
  // a fallback shown before the live backend responds; the real,
  // possibly-adjusted cap always comes from the backend's ?action=slots
  // response.
  TOTAL_CAP: 230,

  // Max tickets a single registration can claim (out of whatever the
  // live remaining count is).
  MAX_TICKETS_PER_REGISTRATION: 20,

  PRICE_PER_TICKET: 1000,
  CURRENCY: '₱',
  TICKET_INCLUSIONS_NOTE: "Inclusive of tickets and freebies from SB19 A'tin Fanboys.",

  // TODO — paste the Step 1 Apps Script Web App URL here once deployed.
  // It looks like: https://script.google.com/macros/s/XXXXXXXXXXXX/exec
  BACKEND_URL: 'REPLACE_WITH_YOUR_APPS_SCRIPT_WEB_APP_URL',

  // GCash only.
  PAYMENT_CHANNELS: [
    {
      id: 'gcash',
      label: 'GCash',
      instructions: 'Send to +63 915 514 2491 (GCash) — Account Name: John Marvin Brazas',
    },
  ],

  // Max size (in MB) accepted for the payment-screenshot upload.
  MAX_SCREENSHOT_MB: 5,

  // Provisional text — replaced wholesale once Step 4 (T&C/DPA drafting) is done.
  DPA_NOTICE_HTML: `
    <p><strong>Data Privacy Notice (Provisional — final version pending)</strong></p>
    <p>By registering, you allow the organizers of ${'SB19 "Wakas at Simula" Trilogy Finale — Block Screening'} to collect and process
    your full legal name, email address, mobile number, ticket quantity, and payment
    verification details (reference number and screenshot), solely for the purposes of:</p>
    <ul>
      <li>Processing and verifying your registration and payment</li>
      <li>Sending you registration status updates, your entry QR code, and event-related announcements</li>
      <li>Validating your entry at the venue on the event date</li>
    </ul>
    <p>Your data will not be sold or shared with third parties outside of what is necessary to verify
    payment (e.g. your bank/e-wallet reference) and to coordinate entry with the venue. Data is retained
    only for as long as needed to complete the event and resolve any post-event concerns, after which it
    is deleted.</p>
    <p>Under the Data Privacy Act of 2012 (RA 10173), you have the right to access, correct, or request
    deletion of your data, and to file a complaint with the National Privacy Commission. For any
    data privacy concerns, contact the organizers at the email provided on this page.</p>
  `,

  TERMS_HTML: `
    <p><strong>Terms & Conditions (Provisional — final version pending)</strong></p>
    <ul>
      <li>All registrations are <strong>non-refundable</strong>, but <strong>transferable</strong> to
      another person, provided the original registrant informs the organizers in advance of the event.</li>
      <li>Registration is only confirmed once payment has been manually verified by the organizers. Until
      then, your status remains "Pending Payment Verification."</li>
      <li>If a problem is found with your payment (e.g. amount does not match your ticket quantity, or
      the reference number cannot be verified), you will be notified by email and given 24 hours to send
      corrected proof. If uncorrected after 24 hours, your reserved seat(s) are automatically released
      back to other registrants.</li>
      <li>Entry on the event date requires the QR code sent upon approval, and a valid ID matching the
      registered name (or the name of the person the ticket was transferred to, if applicable and
      pre-notified).</li>
      <li>The organizers reserve the right to reject a registration in cases of incomplete, fraudulent,
      or unverifiable payment information.</li>
      <li>This is an independently organized fan community screening and is not an official SB19 or
      management production.</li>
    </ul>
  `,
};
