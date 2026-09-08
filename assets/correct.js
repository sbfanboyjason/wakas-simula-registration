/**
 * Self-service payment correction page logic. Relies on EVENT_CONFIG
 * from config.js (same file the main registration page uses).
 */
(function () {
  const cfg = EVENT_CONFIG;
  let screenshotBase64 = null;
  let screenshotFilename = null;
  let verifiedRegId = null;
  let verifiedEmail = null;

  function showStatus(type, message) {
    const el = document.getElementById('statusBanner');
    el.className = 'status-banner show ' + type;
    el.textContent = message;
  }

  function hideStatus() {
    document.getElementById('statusBanner').className = 'status-banner';
  }

  // Registration data (name, reference no., etc.) comes straight from what
  // whoever registered typed in — it must be escaped before going into
  // innerHTML, or a registrant could put a script tag in their own name
  // and have it run in the browser of anyone who looks their record up.
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function populateEventInfo() {
    document.getElementById('eventName').textContent = cfg.EVENT_NAME;

    // Prefill Registration ID from ?regId=... if the visitor arrived via
    // the link in their mismatch-notice email.
    const params = new URLSearchParams(window.location.search);
    const regId = params.get('regId');
    if (regId) document.getElementById('regId').value = regId;

    if (cfg.BACKEND_URL.indexOf('REPLACE_WITH') === 0) {
      showStatus('error', 'Developer notice: BACKEND_URL in assets/config.js has not been set yet.');
    }
  }

  function setupLookup() {
    document.getElementById('lookupBtn').addEventListener('click', function () {
      hideStatus();
      const regId = document.getElementById('regId').value.trim();
      const email = document.getElementById('lookupEmail').value.trim();

      document.getElementById('field-regId').classList.toggle('invalid', !regId);
      document.getElementById('field-lookupEmail').classList.toggle('invalid', !email);
      if (!regId || !email) return;

      const btn = document.getElementById('lookupBtn');
      btn.disabled = true;
      btn.textContent = 'Looking up…';

      fetch(
        `${cfg.BACKEND_URL}?action=lookup&regId=${encodeURIComponent(regId)}&email=${encodeURIComponent(email)}`
      )
        .then((r) => r.json())
        .then((data) => {
          btn.disabled = false;
          btn.textContent = 'Find My Registration';

          if (!data.ok) {
            showStatus('error', data.error || 'Registration not found.');
            return;
          }
          if (!data.editable) {
            showStatus(
              'error',
              `This registration is already "${data.status}" and can no longer be edited here. Contact the organizers if you need help.`
            );
            return;
          }

          verifiedRegId = regId;
          verifiedEmail = email;

          document.getElementById('lookupSummary').innerHTML =
            `<strong>${escapeHtml(data.fullName)}</strong> — ${escapeHtml(data.ticketQuantity)} ticket(s)<br>` +
            `Current status: ${escapeHtml(data.status)}<br>` +
            `Current reference on file: ${escapeHtml(data.currentReference) || '(none)'}`;

          document.getElementById('lookupCard').style.display = 'none';
          document.getElementById('correctionCard').style.display = 'block';
        })
        .catch(() => {
          btn.disabled = false;
          btn.textContent = 'Find My Registration';
          showStatus('error', 'Network error — please check your connection and try again.');
        });
    });
  }

  function setupUpload() {
    const box = document.getElementById('uploadBox');
    const input = document.getElementById('screenshotInput');
    const preview = document.getElementById('uploadPreview');
    const boxText = document.getElementById('uploadBoxText');

    box.addEventListener('click', () => input.click());
    input.addEventListener('change', function () {
      const file = input.files[0];
      if (!file) return;
      const maxBytes = cfg.MAX_SCREENSHOT_MB * 1024 * 1024;
      if (file.size > maxBytes) {
        alert(`File is too large. Max size is ${cfg.MAX_SCREENSHOT_MB}MB.`);
        input.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = function () {
        screenshotBase64 = reader.result.split(',')[1];
        screenshotFilename = file.name;
        preview.src = reader.result;
        preview.style.display = 'block';
        box.classList.add('has-file');
        boxText.textContent = `Selected: ${file.name}`;
      };
      reader.readAsDataURL(file);
    });
  }

  function setupSubmit() {
    document.getElementById('submitCorrectionBtn').addEventListener('click', function () {
      hideStatus();
      const newReference = document.getElementById('newReference').value.trim();

      if (!newReference && !screenshotBase64) {
        showStatus('error', 'Please update the reference number and/or upload a new screenshot.');
        return;
      }

      const btn = document.getElementById('submitCorrectionBtn');
      btn.disabled = true;
      btn.textContent = 'Submitting…';

      const honeypotEl = document.getElementById('website');

      const payload = {
        registrationId: verifiedRegId,
        email: verifiedEmail,
        paymentReference: newReference || undefined,
        paymentScreenshotBase64: screenshotBase64 || undefined,
        paymentScreenshotFilename: screenshotFilename || undefined,
        website: honeypotEl ? honeypotEl.value : '',
      };

      fetch(cfg.BACKEND_URL + '?action=correct', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      })
        .then((r) => r.json())
        .then((data) => {
          if (!data.ok) {
            showStatus('error', data.error || 'Something went wrong. Please try again.');
            btn.disabled = false;
            btn.textContent = 'Submit Correction';
            return;
          }
          document.getElementById('correctionCard').style.display = 'none';
          document.getElementById('successPanel').style.display = 'block';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        })
        .catch(() => {
          showStatus('error', 'Network error — please check your connection and try again.');
          btn.disabled = false;
          btn.textContent = 'Submit Correction';
        });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    populateEventInfo();
    setupLookup();
    setupUpload();
    setupSubmit();
  });
})();
