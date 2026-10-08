/**
 * Event-day check-in scanner (phone).
 * Talks to the Apps Script backend at EVENT_CONFIG.BACKEND_URL?action=checkin
 * (see backend/Checkin.gs). Every request is a text/plain POST so the browser
 * skips the CORS preflight that Apps Script can't answer.
 */
(function () {
  'use strict';

  // config.js declares `const EVENT_CONFIG`, which is global but not a window property.
  var cfg = typeof EVENT_CONFIG !== 'undefined' ? EVENT_CONFIG : {};
  var ENDPOINT = (cfg.BACKEND_URL || '') + '?action=checkin';
  var SESSION_KEY = 'wakasCheckinSession';
  var STATS_EVERY_MS = 20000;

  // ---------- state ----------
  var session = null; // {token, name, role, exp}
  var current = null; // {key, method, qr, record}
  var photoBase64 = '';
  var scanner = null;
  var camRunning = false;
  var camStarting = false;
  var camStopping = Promise.resolve();
  var handlingScan = false;
  var confirmInFlight = false;
  var statsTimer = null;
  var wakeLock = null;
  var searchTimer = null;
  var searchSeq = 0;
  var navSeq = 0; // bumps on every screen change, so late answers can be ignored

  // ---------- dom ----------
  function $(id) { return document.getElementById(id); }
  var views = ['viewLogin', 'viewScan', 'viewSearch', 'viewResult'];

  function show(viewId) {
    navSeq++;
    views.forEach(function (v) { $(v).hidden = v !== viewId; });
    $('topbar').hidden = viewId === 'viewLogin';
    window.scrollTo(0, 0);
    if (viewId !== 'viewScan') stopCamera();
  }

  function toast(msg, isError) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' t-error' : '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, isError ? 5000 : 3000);
  }

  function buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  // ---------- session ----------
  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (s && s.token && s.exp > Date.now()) return s;
    } catch (e) {}
    return null;
  }

  function saveSession(s) {
    session = s;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function clearSession() {
    session = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    clearInterval(statsTimer);
  }

  function applySessionToUi() {
    $('staffName').textContent = session.name;
    $('menuName').textContent = session.name + ' (' + session.role + ')';
    $('roleChip').hidden = session.role !== 'Admin';
  }

  // ---------- api ----------
  function api(op, data, timeoutMs) {
    var body = Object.assign({ op: op, token: session ? session.token : '' }, data || {});
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 25000) : null;

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) { return r.json(); })
      .catch(function () {
        var err = new Error('No connection. Check your signal and try again.');
        err.network = true;
        throw err;
      })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok && res.code === 'AUTH') {
          clearSession();
          show('viewLogin');
          $('loginError').textContent = res.error;
          var err = new Error(res.error);
          err.auth = true;
          throw err;
        }
        return res;
      });
  }

  // ---------- sign in ----------
  function onLogin(ev) {
    ev.preventDefault();
    var pin = $('pinInput').value.trim();
    $('loginError').textContent = '';
    if (!/^\d{6}$/.test(pin)) {
      $('loginError').textContent = 'Enter your 6-digit PIN.';
      return;
    }
    var btn = $('loginBtn');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    api('login', { pin: pin })
      .then(function (res) {
        if (!res.ok) {
          $('loginError').textContent = res.error || 'Could not sign in.';
          $('pinInput').value = '';
          return;
        }
        saveSession({
          token: res.token,
          name: res.staff.name,
          role: res.staff.role,
          exp: Date.now() + (res.expiresInSeconds - 60) * 1000,
        });
        $('pinInput').value = '';
        enterApp();
      })
      .catch(function (err) { $('loginError').textContent = err.message; })
      .then(function () {
        btn.disabled = false;
        btn.textContent = 'Sign in';
      });
  }

  function enterApp() {
    applySessionToUi();
    goScan(false);
    refreshStats();
    clearInterval(statsTimer);
    statsTimer = setInterval(function () {
      if (!document.hidden && session) refreshStats();
    }, STATS_EVERY_MS);
  }

  function signOut() {
    var tok = session && session.token;
    if (tok) api('logout', {}).catch(function () {});
    clearSession();
    $('menuSheet').hidden = true;
    show('viewLogin');
  }

  // ---------- stats ----------
  function refreshStats() {
    if (!session) return;
    api('stats', {}, 15000)
      .then(function (res) {
        if (!res.ok) return;
        $('statIn').textContent = res.stats.inTickets;
        $('statTotal').textContent = res.stats.approvedTickets;
        if (res.me) {
          session.name = res.me.name;
          session.role = res.me.role;
          saveSession(session);
          applySessionToUi();
        }
        var note = $('menuTestNote');
        if (res.stats.testRows > 0) {
          note.hidden = false;
          note.textContent = res.stats.testRows + ' test ticket(s) are still in the sheet. Remove them before doors open.';
        } else {
          note.hidden = true;
        }
        var list = $('recentList');
        list.textContent = '';
        res.recent.forEach(function (r) {
          var li = document.createElement('li');
          var n = document.createElement('span');
          n.className = 'r-name';
          n.textContent = r.name + ' · ' + r.qty;
          var m = document.createElement('span');
          m.className = 'r-meta';
          m.textContent = r.at.replace(/^[A-Za-z]{3} \d+, /, '') + ' · ' + r.by;
          li.appendChild(n);
          li.appendChild(m);
          list.appendChild(li);
        });
        $('recentWrap').hidden = res.recent.length === 0;
      })
      .catch(function () {});
  }

  // ---------- camera ----------
  function startCamera() {
    if (camRunning || camStarting) return;
    if (typeof Html5Qrcode === 'undefined') {
      $('camHint').textContent = 'Scanner failed to load. Refresh the page.';
      return;
    }
    camStarting = true;
    $('startCamBtn').disabled = true;
    $('camHint').textContent = 'Starting camera…';

    // Wait for any stop still in progress, or the library refuses to start.
    camStopping.then(function () {
    if (!scanner) {
      scanner = new Html5Qrcode('reader', {
        verbose: false,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });
    }

    scanner
      .start(
        { facingMode: 'environment' },
        {
          fps: 12,
          qrbox: function (w, h) {
            var s = Math.floor(Math.min(w, h) * 0.72);
            return { width: s, height: s };
          },
          aspectRatio: 1,
        },
        onScan,
        function () {}
      )
      .then(function () {
        camRunning = true;
        // The user may have left the scanner while the camera was starting.
        if ($('viewScan').hidden) {
          stopCamera();
          return;
        }
        $('scannerOverlay').hidden = true;
        keepScreenOn();
      })
      .catch(function (err) {
        var msg = String(err && (err.name || err.message || err));
        $('camHint').textContent = /NotAllowed|Permission/i.test(msg)
          ? 'Camera is blocked. Allow camera access for this site in your browser settings, then tap Start again. You can still use search.'
          : 'Could not start the camera (' + msg + '). Tap Start again, or use search.';
        $('scannerOverlay').hidden = false;
      })
      .then(function () {
        camStarting = false;
        $('startCamBtn').disabled = false;
      });
    });
  }

  function stopCamera() {
    if (!scanner || !camRunning) return camStopping;
    camRunning = false;
    $('scannerOverlay').hidden = false;
    $('camHint').textContent = 'Allow camera access when your phone asks.';
    camStopping = scanner.stop().catch(function () {});
    return camStopping;
  }

  function keepScreenOn() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        navigator.wakeLock.request('screen').then(function (l) {
          wakeLock = l;
          l.addEventListener('release', function () { wakeLock = null; });
        }).catch(function () {});
      }
    } catch (e) {}
  }

  function onScan(text) {
    if (handlingScan || $('viewScan').hidden) return;
    handlingScan = true;
    buzz(40);
    $('scannerBusy').hidden = false;
    var seq = navSeq;
    api('lookup', { qr: text })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'Lookup failed.');
        if (seq !== navSeq) {
          // Staff moved to another screen while this was loading: drop it.
          if (res.record && res.record.key) api('release', { key: res.record.key }).catch(function () {});
          return;
        }
        current = { key: res.record ? res.record.key : '', method: 'QR scan', record: res.record };
        renderResult(res);
      })
      .catch(function (err) {
        if (!err.auth) toast(err.message, true);
      })
      .then(function () {
        $('scannerBusy').hidden = true;
        // Short pause so the same QR isn't read twice while the view switches.
        setTimeout(function () { handlingScan = false; }, 800);
      });
  }

  function goScan(autoStart) {
    current = null;
    show('viewScan');
    if (autoStart) startCamera();
    refreshStats();
  }

  // ---------- search ----------
  function runSearch() {
    var q = $('searchInput').value.trim();
    var list = $('searchResults');
    if (q.length < 2) {
      list.textContent = '';
      return;
    }
    var seq = ++searchSeq;
    list.innerHTML = '<li class="empty">Searching…</li>';
    api('search', { q: q })
      .then(function (res) {
        if (seq !== searchSeq) return;
        list.textContent = '';
        if (!res.ok) throw new Error(res.error);
        if (!res.results.length) {
          list.innerHTML = '<li class="empty">No registration matches that name or ID.</li>';
          return;
        }
        res.results.forEach(function (r) {
          var li = document.createElement('li');
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'result-btn';
          var main = document.createElement('div');
          main.className = 'result-main';
          var n = document.createElement('div');
          n.className = 'result-name';
          n.textContent = r.name;
          var sub = document.createElement('div');
          sub.className = 'result-sub';
          sub.textContent = r.regId + ' · ' + r.qty + ' ticket' + (r.qty === 1 ? '' : 's') + (r.verdict === 'INVALID' ? ' · ' + r.status : '');
          main.appendChild(n);
          main.appendChild(sub);
          var pill = document.createElement('span');
          pill.className = 'pill pill-' + r.verdict;
          pill.textContent = r.verdict === 'USED' ? 'Checked in' : r.verdict === 'VALID' ? 'Valid' : 'Invalid';
          b.appendChild(main);
          b.appendChild(pill);
          b.addEventListener('click', function () { pickResult(r.key); });
          li.appendChild(b);
          list.appendChild(li);
        });
        if (res.more) {
          var more = document.createElement('li');
          more.className = 'empty';
          more.textContent = 'More matches not shown. Type more of the name.';
          list.appendChild(more);
        }
      })
      .catch(function (err) {
        if (seq !== searchSeq) return;
        list.textContent = '';
        if (!err.auth) toast(err.message, true);
      });
  }

  function pickResult(key) {
    if (!key) {
      toast('This registration has no ticket code. Ask the admin.', true);
      return;
    }
    var seq = navSeq;
    api('lookup', { key: key })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'Lookup failed.');
        if (seq !== navSeq) return;
        current = { key: key, method: 'Manual search', record: res.record };
        renderResult(res);
      })
      .catch(function (err) { if (!err.auth) toast(err.message, true); });
  }

  // ---------- result ----------
  var ICONS = {
    ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" opacity=".18"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    used: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" opacity=".18"/><path d="M8 8l8 8M16 8l-8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    invalid: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" opacity=".18"/><path d="M12 6.5v7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.4" fill="currentColor"/></svg>',
  };

  function plural(n) { return n === 1 ? '' : 's'; }

  function renderResult(res) {
    var v = res.verdict;
    var rec = res.record;
    var me = session ? session.name : '';

    var banner = $('verdictBanner');
    banner.className = 'verdict v-' + v;
    $('verdictIcon').innerHTML = v === 'USED' ? ICONS.used : v === 'INVALID' ? ICONS.invalid : ICONS.ok;
    $('verdictTitle').textContent =
      v === 'VALID' ? 'Valid ticket' : v === 'ADMITTED' ? 'Admitted' : v === 'USED' ? 'Already checked in' : 'Invalid ticket';
    $('verdictReason').textContent =
      v === 'VALID'
        ? 'Check the ID, take a photo, then confirm.'
        : v === 'ADMITTED'
          ? 'Release ' + rec.qty + ' ticket' + plural(rec.qty) + ' now.'
          : res.reason || '';

    // record
    $('recordCard').hidden = !rec;
    if (rec) {
      $('qtyNum').textContent = rec.qty;
      $('qtyLabel').textContent =
        v === 'VALID' || v === 'ADMITTED' ? 'ticket' + plural(rec.qty) + ' to release' : 'ticket' + plural(rec.qty) + ' on this registration';
      $('recName').textContent = rec.admittedAs ? rec.admittedAs : rec.name;
      $('recRegId').textContent = rec.regId + (rec.admittedAs ? ' · transferred from ' + rec.name : '');
      $('recStatus').textContent = rec.status;
      $('testFlag').hidden = !rec.isTest;
      $('notesBox').hidden = !rec.adminNotes;
      $('notesText').textContent = rec.adminNotes || '';

      var used = $('usedInfo');
      if (rec.checkedIn && v !== 'ADMITTED') {
        used.hidden = false;
        used.textContent = '';
        var line = document.createElement('div');
        line.innerHTML = 'Checked in <strong></strong> by <strong></strong>';
        line.querySelectorAll('strong')[0].textContent = rec.checkedInAt || '(time not recorded)';
        line.querySelectorAll('strong')[1].textContent = (rec.checkedInBy || 'unknown') + (rec.checkedInBy === me ? ' (you)' : '');
        used.appendChild(line);
        if (rec.method) {
          var m = document.createElement('div');
          m.textContent = 'Via ' + rec.method + (rec.admittedAs ? ', admitted as ' + rec.admittedAs : '');
          used.appendChild(m);
        }
        var d = document.createElement('div');
        d.textContent = 'Do not release tickets again. Send the person to the admin if there is a dispute.';
        d.style.marginTop = '6px';
        used.appendChild(d);
      } else {
        used.hidden = true;
      }
    }

    // someone else has it open
    var hw = $('holdWarn');
    if (v === 'VALID' && res.holdWarning) {
      hw.hidden = false;
      hw.textContent =
        res.holdWarning.by + ' opened this same ticket ' + res.holdWarning.secondsAgo +
        's ago. Make sure you are not both admitting the same group.';
    } else {
      hw.hidden = true;
    }

    // admit flow
    $('admitCard').hidden = v !== 'VALID';
    if (v === 'VALID') resetAdmitForm();

    // admin undo
    var canUndo = session && session.role === 'Admin' && rec && rec.checkedIn;
    $('undoCard').hidden = !canUndo;
    if (canUndo) {
      $('undoReason').value = '';
      $('undoError').textContent = '';
      var link = $('idPhotoLink');
      link.hidden = !rec.idPhotoUrl;
      if (rec.idPhotoUrl) link.href = rec.idPhotoUrl;
    }

    $('nextBtn').hidden = v === 'VALID';
    $('cancelBtn').hidden = v !== 'VALID';

    show('viewResult');

    if (v === 'ADMITTED') buzz([80, 60, 80]);
    else if (v === 'USED' || v === 'INVALID') buzz([250, 80, 250]);
    else buzz(40);

    if (v === 'ADMITTED' && res.photoSaved === false) {
      toast('Checked in, but the ID photo did not upload. Tell the admin.', true);
    }
  }

  function resetAdmitForm() {
    if (current) current.retried = false;
    photoBase64 = '';
    $('photoInput').value = '';
    $('photoPreview').hidden = true;
    $('photoPreview').removeAttribute('src');
    $('photoBtnText').textContent = 'Take ID photo';
    $('transferToggle').checked = false;
    $('transferField').hidden = true;
    $('transferName').value = '';
    $('admitError').textContent = '';
    var btn = $('confirmBtn');
    btn.textContent = 'Confirm entry';
    updateConfirmState();
  }

  function updateConfirmState() {
    var needName = $('transferToggle').checked;
    var nameOk = !needName || $('transferName').value.trim().length >= 2;
    $('confirmBtn').disabled = confirmInFlight || !photoBase64 || !nameOk;
  }

  // ---------- ID photo ----------
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var max = 1280;
          var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          var w = Math.round(img.naturalWidth * scale);
          var h = Math.round(img.naturalHeight * scale);
          var c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          var q = 0.75;
          var data = c.toDataURL('image/jpeg', q);
          while (data.length > 1400000 && q > 0.4) {
            q -= 0.1;
            data = c.toDataURL('image/jpeg', q);
          }
          URL.revokeObjectURL(url);
          resolve(data);
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read that photo. Try again.'));
      };
      img.src = url;
    });
  }

  function onPhotoPicked() {
    var file = $('photoInput').files && $('photoInput').files[0];
    if (!file) return;
    $('photoBtnText').textContent = 'Processing photo…';
    compressImage(file)
      .then(function (dataUrl) {
        photoBase64 = dataUrl.split(',')[1];
        var p = $('photoPreview');
        p.src = dataUrl;
        p.hidden = false;
        $('photoBtnText').textContent = 'Retake ID photo';
        $('admitError').textContent = '';
      })
      .catch(function (err) {
        photoBase64 = '';
        $('photoBtnText').textContent = 'Take ID photo';
        $('admitError').textContent = err.message;
      })
      .then(updateConfirmState);
  }

  // ---------- confirm / undo ----------
  function onConfirm() {
    if (!current || !current.key || confirmInFlight) return;
    var isTransfer = $('transferToggle').checked;
    var transferName = $('transferName').value.trim();
    if (!photoBase64) {
      $('admitError').textContent = 'Take a photo of the ID first.';
      return;
    }
    if (isTransfer && transferName.length < 2) {
      $('admitError').textContent = 'Enter the name on the ID of the person entering.';
      return;
    }

    confirmInFlight = true;
    $('admitError').textContent = '';
    $('confirmBtn').textContent = 'Confirming…';
    updateConfirmState();

    api('confirm', {
      key: current.key,
      method: current.method,
      photoBase64: photoBase64,
      isTransfer: isTransfer,
      transferName: transferName,
    }, 60000)
      .then(function (res) {
        if (!res.ok) {
          $('admitError').textContent = res.error || 'Could not confirm. Try again.';
          return;
        }
        // A retry after a dropped connection can come back as "already
        // checked in" by this same phone. That is our own check-in landing.
        if (res.verdict === 'USED' && res.record && res.record.checkedInBy === session.name && current.retried) {
          res.verdict = 'ADMITTED';
        }
        renderResult(res);
        refreshStats();
      })
      .catch(function (err) {
        if (err.auth) return;
        current.retried = true;
        $('admitError').textContent = err.network
          ? 'No connection. The photo is kept. Tap Confirm again when you have signal.'
          : err.message;
      })
      .then(function () {
        confirmInFlight = false;
        $('confirmBtn').textContent = 'Confirm entry';
        updateConfirmState();
      });
  }

  function onUndo() {
    if (!current || !current.record) return;
    var reason = $('undoReason').value.trim();
    if (reason.length < 3) {
      $('undoError').textContent = 'Type a reason first.';
      return;
    }
    if (!window.confirm('Undo the check-in for ' + current.record.name + '? Their QR will work again.')) return;
    var btn = $('undoBtn');
    btn.disabled = true;
    api('undo', { key: current.key, reason: reason })
      .then(function (res) {
        if (!res.ok) {
          $('undoError').textContent = res.error || 'Undo failed.';
          return;
        }
        toast('Check-in undone. The ticket can be scanned again.');
        current.record = res.record;
        renderResult({ verdict: res.verdict, record: res.record, reason: '' });
        refreshStats();
      })
      .catch(function (err) { if (!err.auth) $('undoError').textContent = err.message; })
      .then(function () { btn.disabled = false; });
  }

  function onCancel() {
    if (current && current.key) api('release', { key: current.key }).catch(function () {});
    goScan(true);
  }

  // ---------- wire up ----------
  function init() {
    if (!cfg.BACKEND_URL) {
      $('loginError').textContent = 'BACKEND_URL is missing from assets/config.js.';
    }

    $('loginForm').addEventListener('submit', onLogin);
    $('pinInput').addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 6);
      if (this.value.length === 6) $('loginForm').requestSubmit ? $('loginForm').requestSubmit() : onLogin(new Event('submit'));
    });

    $('startCamBtn').addEventListener('click', startCamera);
    $('openSearchBtn').addEventListener('click', function () {
      show('viewSearch');
      $('searchInput').value = '';
      $('searchResults').textContent = '';
      setTimeout(function () { $('searchInput').focus(); }, 50);
    });
    $('searchBtn').addEventListener('click', runSearch);
    $('searchInput').addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 400);
    });
    $('searchInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        clearTimeout(searchTimer);
        runSearch();
      }
    });
    $('searchBackBtn').addEventListener('click', function () { goScan(true); });

    $('photoInput').addEventListener('change', onPhotoPicked);
    $('transferToggle').addEventListener('change', function () {
      $('transferField').hidden = !this.checked;
      if (this.checked) setTimeout(function () { $('transferName').focus(); }, 50);
      updateConfirmState();
    });
    $('transferName').addEventListener('input', updateConfirmState);
    $('confirmBtn').addEventListener('click', onConfirm);
    $('undoBtn').addEventListener('click', onUndo);
    $('nextBtn').addEventListener('click', function () { goScan(true); });
    $('cancelBtn').addEventListener('click', onCancel);

    $('menuBtn').addEventListener('click', function () { $('menuSheet').hidden = false; });
    $('menuClose').addEventListener('click', function () { $('menuSheet').hidden = true; });
    $('menuSheet').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
    $('menuRefresh').addEventListener('click', function () {
      refreshStats();
      $('menuSheet').hidden = true;
      toast('Counts refreshed.');
    });
    $('menuSignOut').addEventListener('click', signOut);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopCamera();
      } else if (session) {
        refreshStats();
        if (!$('viewScan').hidden) keepScreenOn();
      }
    });

    var s = loadSession();
    if (s) {
      session = s;
      enterApp();
    } else {
      show('viewLogin');
    }
  }

  init();
})();
