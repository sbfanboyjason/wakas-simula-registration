# Event-day check-in: setup and use

Scanner page: https://sbfanboyjason.github.io/wakas-simula-registration/checkin/

The registration team opens this link on their phones, signs in with a PIN, and scans each ticket QR. A ticket can only be admitted once. Every check-in records who did it, when, and a photo of the ID.

## One-time setup in Apps Script (about 10 minutes)

The website files update through GitHub. The backend runs in the Apps Script project attached to the registration spreadsheet, so these steps are done by hand.

1. Open the registration spreadsheet, then Extensions > Apps Script.
2. Add the new file. Click + next to Files, choose Script, name it `Checkin`. Delete the empty function it starts with and paste in the whole of `backend/Checkin.gs` from this repo.
3. Update `Code.gs`. If you have not edited the live script since this repo was last updated (Sep 10), select everything in `Code.gs` and replace it with `backend/Code.gs` from this repo. If you have edited it, make only these three changes by hand:
   - In `doPost`, add these lines just above `if (action === 'correct') {`:
     ```js
     if (action === 'checkin') {
       return handleCheckin_(e);
     }
     ```
   - In `onOpen`, add these lines after the `Print Attendee List (Approved)` item:
     ```js
     .addSeparator()
     .addItem('Set Up Event Check-in (staff PINs)', 'setupCheckin')
     .addItem('Reset a Check-in PIN', 'resetCheckinPin')
     .addItem('Create Check-in Test Tickets', 'createCheckinTestTickets')
     .addItem('Remove Check-in Test Tickets', 'removeCheckinTestTickets')
     ```
   - Replace `generateRegistrationId` with the version in `backend/Code.gs`. The old one counts rows, which hands out a duplicate Reg ID after any row is deleted.
4. Save (Ctrl+S).
5. Redeploy without changing the URL: Deploy > Manage deployments > pencil icon > Version: New version > Deploy. Do not use "New deployment", which creates a new URL and breaks the registration site.
6. Go back to the spreadsheet and reload it. The "Wakas at Simula Admin" menu now has the check-in items.
7. Run Wakas at Simula Admin > Set Up Event Check-in. Approve the permissions prompt if it appears. This creates:
   - a `_Staff` sheet with Jason (Admin) and Team 1 to Team 4 (Staff)
   - five new columns at the right end of Registrations: Checked In At, Checked In By, Check-in Method, Admitted As (Transfer), ID Photo URL
   - a private Drive folder, "Wakas at Simula - Check-in ID Photos"

   A window then shows each person's 6-digit PIN. This is the only time the PINs are shown, because the sheet stores only a scrambled copy. Screenshot it and send each person their own PIN privately.

You can rename Team 1 to Team 4 in the Name column of `_Staff`. The names show on the scanner and in the sheet.

## Rehearsal

1. Run Wakas at Simula Admin > Create Check-in Test Tickets. Four test rows are added and their QR codes appear on screen. No emails go out.
   - TEST-001: 1 ticket, normal
   - TEST-002: 3 tickets, a group
   - TEST-003: 2 tickets, has a transfer note
   - TEST-004: payment not verified, should show INVALID
2. Each team member signs in on their phone and scans the codes from the laptop screen.
3. Try these on purpose: two phones scanning TEST-002 at the same moment, scanning a ticket twice, searching by name, a transfer on TEST-003, and an undo from Jason's phone.
4. Run Wakas at Simula Admin > Remove Check-in Test Tickets when finished. Test rows hold 7 seats in the public count until removed. Remove them before doors open.

Run the rehearsal once more on site if you can, to check the phone signal at the venue.

## On the day

- Valid (green): check the ID matches the name, tick "transferred" if the person entering is not the registrant and type the name on their ID, take the ID photo, release the tickets, tap Confirm entry.
- Already checked in (red): do not release tickets. The screen says when and by whom. Send disputes to Jason.
- Invalid (amber): the reason is shown (fake QR, payment not approved, cancelled, expired). Send to Jason.
- No QR: use "Search by name or Reg ID". The ID photo is still required.
- If two people open the same ticket, the second sees a warning. Whoever confirms first wins and the other phone gets "Already checked in".
- A checked-in row turns grey with a line through it in the sheet.

Only Jason can undo a check-in, and only with a reason. The reason, the old details and the ID photo link are written to the row's Admin Notes and to `_AuditLog`.

## Managing accounts

- Lost phone or someone leaves the team: set their Active cell in `_Staff` to No. They are signed out on their next action.
- New PIN for one person: Wakas at Simula Admin > Reset a Check-in PIN, then type their Staff ID (S1 to S5).
- 15 wrong PIN attempts across all phones block new sign-ins for 10 minutes. People already signed in are not affected.
- A sign-in lasts 6 hours. After that the phone asks for the PIN again.

## Backup plan

Print the approved list before the event (Wakas at Simula Admin > Print Attendee List). If the signal drops, tick names on paper, then search and confirm them in the scanner once the connection is back.

## After the event

Delete the "Wakas at Simula - Check-in ID Photos" Drive folder once there are no more concerns to resolve, in line with the Data Privacy Notice.
