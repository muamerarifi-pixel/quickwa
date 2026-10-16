/* QuickWA v3 — Direct & Bulk WhatsApp launcher. 100% client-side. */
(function () {
  'use strict';

  /* ---------------- helpers ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var KEY = 'qwa3.';
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(KEY + k); } catch (e) {} }
  };
  var UA = navigator.userAgent;
  var isIOS = /iPhone|iPad|iPod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isMobile = isIOS || /Android|Mobile/i.test(UA);
  document.documentElement.classList.toggle('mobile', isMobile);
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var debounce = function (fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; };
  var buzz = function () { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} };
  var digits = function (s) { return String(s || '').replace(/\D/g, ''); };

  /* ---------------- state ---------------- */
  var DEFAULTS = {
    cc: 'XK',               // default country (Kosovo)
    openWith: 'auto',       // auto | app | web | wa
    instantPaste: true,     // Paste & Chat opens immediately
    saveHistory: true,
    theme: 'auto',
    advance: isMobile ? 'return' : 'return',
    delay: 5
  };
  var settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
  if (isMobile && settings.advance === 'timer') settings.advance = 'return';
  var saveSettings = function () { store.set('settings', settings); };

  var DEFAULT_TEMPLATES = [
    'Hello! 👋',
    'Hi {first}, ',
    'Thank you for your message. I will get back to you shortly.',
    'Are you available for a quick call today?',
    'Përshëndetje! Si mund t’ju ndihmoj?'
  ];
  var templates = store.get('templates', null);
  if (!templates) templates = DEFAULT_TEMPLATES.map(function (t, i) { return { id: 't' + i, text: t }; });
  var history = store.get('history', []);
  var recentCC = store.get('recentCC', []);
  var queue = store.get('queue', null);

  /* ---------------- countries ---------------- */
  var COUNTRIES = window.COUNTRIES || [];
  var byIso = {};
  COUNTRIES.forEach(function (c) { byIso[c.iso] = c; });
  var DIALS = COUNTRIES.slice().sort(function (a, b) { return b.dial.length - a.dial.length; });
  if (!byIso[settings.cc]) settings.cc = 'XK';

  function detectCountry(n) {
    if (!n) return null;
    var def = byIso[settings.cc];
    if (def && n.indexOf(def.dial) === 0) return def;
    for (var i = 0; i < DIALS.length; i++) {
      var d = DIALS[i].dial;
      if (n.indexOf(d) === 0) {
        var pref = window.PREFERRED_DIAL && window.PREFERRED_DIAL[d];
        return pref && byIso[pref] ? byIso[pref] : DIALS[i];
      }
    }
    return null;
  }

  /* ---------------- phone logic ---------------- */
  // Turn anything a person might paste into an international number (digits only).
  function normalize(raw, iso) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var d = digits(s);
    if (!d) return '';
    if (/^\+/.test(s)) return d;
    if (d.indexOf('00') === 0) return d.slice(2);
    var c = byIso[iso || settings.cc];
    var cc = c ? c.dial : '';
    if (cc && d.charAt(0) !== '0' && d.indexOf(cc) === 0 && d.length >= cc.length + 7) return d;
    d = d.replace(/^0+/, '');
    return cc + d;
  }
  function isValid(n) {
    if (!n || n.length < 8 || n.length > 15) return false;
    var c = detectCountry(n);
    return !!c && n.length - c.dial.length >= 5;
  }
  function pretty(n) {
    if (!n) return '';
    var c = detectCountry(n);
    var cc = c ? c.dial : '';
    var nat = n.slice(cc.length);
    var g;
    var L = nat.length;
    if (L <= 6) g = [nat];
    else if (L === 7) g = [nat.slice(0, 3), nat.slice(3)];
    else if (L === 8) g = [nat.slice(0, 2), nat.slice(2, 5), nat.slice(5)];
    else if (L === 9) g = [nat.slice(0, 2), nat.slice(2, 5), nat.slice(5)];
    else if (L === 10) g = [nat.slice(0, 3), nat.slice(3, 6), nat.slice(6)];
    else g = [nat.slice(0, 3), nat.slice(3, 7), nat.slice(7)];
    return ('+' + cc + ' ' + g.join(' ')).trim();
  }
  // Find phone-number-looking things in free text
  var PHONE_RE = /(?:\+|\b00)?\d[\d\s().\-\/]{5,}\d/g;
  function extractNumbers(text) {
    var out = [];
    var m;
    PHONE_RE.lastIndex = 0;
    while ((m = PHONE_RE.exec(String(text || ''))) !== null) {
      var dc = digits(m[0]).length;
      if (dc >= 7 && dc <= 16) out.push(m[0].trim());
    }
    return out;
  }
  // wa.me / api.whatsapp.com / whatsapp:// links
  function parseWaLink(text) {
    var s = String(text || '').trim();
    var m = s.match(/(?:wa\.me\/|whatsapp\.com\/send\/?\?(?:[^#\s]*&)?phone=|whatsapp:\/\/send\?(?:[^#\s]*&)?phone=)(\+?\d+)/i);
    if (!m) return null;
    var text2 = '';
    var t = s.match(/[?&]text=([^&#\s]*)/i);
    if (t) { try { text2 = decodeURIComponent(t[1].replace(/\+/g, ' ')); } catch (e) { text2 = t[1]; } }
    return { n: digits(m[1]), text: text2 };
  }

  /* ---------------- link building & launching ---------------- */
  function resolveKind() {
    if (settings.openWith !== 'auto') return settings.openWith;
    return isMobile ? 'wa' : 'web';
  }
  function buildUrl(n, text, kind) {
    var t = text ? encodeURIComponent(text) : '';
    switch (kind) {
      case 'app': return 'whatsapp://send?' + (n ? 'phone=' + n + '&' : '') + 'text=' + t;
      case 'web': return 'https://web.whatsapp.com/send?' + (n ? 'phone=' + n + '&' : '') + 'text=' + t;
      default: return 'https://wa.me/' + (n || '') + (t ? '?text=' + t : '');
    }
  }
  var shareUrl = function (n, text) { return buildUrl(n, text, 'wa'); };

  var chatWin = null;
  // Returns true if we think it launched.
  function launch(url, kind, opts) {
    opts = opts || {};
    if (kind === 'app') { window.location.href = url; return true; }
    if (isMobile) {
      // A real link click keeps this page alive (bulk queue) and lets the OS hand off to the app.
      var a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      return true;
    }
    // Desktop: reuse one tab so you don't end up with 30 WhatsApp tabs.
    try {
      if (chatWin && !chatWin.closed) { chatWin.location.href = url; chatWin.focus(); return true; }
    } catch (e) {}
    if (opts.noGesture) return false;
    chatWin = window.open(url, 'quickwa_chat');
    if (!chatWin) {
      toast('Pop-up blocked — allow pop-ups for this site', { action: 'Open', fn: function () { window.open(url, '_blank'); } });
      return false;
    }
    return true;
  }

  /* ---------------- toast ---------------- */
  var toastTimer;
  function toast(msg, o) {
    o = o || {};
    var el = $('#toast');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (o.action ? '<button type="button">' + esc(o.action) + '</button>' : '');
    el.hidden = false;
    if (o.action) $('button', el).onclick = function () { el.hidden = true; o.fn && o.fn(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, o.ms || (o.action ? 5000 : 2200));
  }

  /* ---------------- sheet ---------------- */
  var sheetOnClose = null;
  var lastFocus = null;
  function openSheet(title, html, onMount, onClose) {
    lastFocus = document.activeElement;
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = html;
    $('#sheetWrap').hidden = false;
    sheetOnClose = onClose || null;
    document.body.style.overflow = 'hidden';
    if (onMount) onMount($('#sheetBody'));
  }
  function closeSheet() {
    if ($('#sheetWrap').hidden) return;
    $('#sheetWrap').hidden = true;
    document.body.style.overflow = '';
    var cb = sheetOnClose; sheetOnClose = null;
    if (cb) cb();
    if (lastFocus && lastFocus.focus && !isMobile) lastFocus.focus();
  }
  $('#sheetWrap').addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeSheet(); });

  /* ---------------- theme ---------------- */
  function applyTheme() {
    if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
  }
  applyTheme();

  /* ---------------- tabs ---------------- */
  var currentTab = 'chat';
  function showTab(name, noFocus) {
    currentTab = name;
    $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== name; });
    $$('.tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.tab === name)); });
    if (name === 'history') renderHistory();
    if (name === 'bulk') renderBulk();
    if (name === 'chat') renderRecentQuick();
    window.scrollTo(0, 0);
    store.set('tab', name);
    if (!noFocus && !isMobile && name === 'chat') $('#phone').focus();
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab]');
    if (t) { showTab(t.dataset.tab); }
  });

  /* =========================================================
     DIRECT CHAT
     ========================================================= */
  var phoneEl = $('#phone'), msgEl = $('#msg');

  function currentNumber() { return normalize(phoneEl.value); }

  function renderCC() {
    var raw = phoneEl.value.trim();
    var n = currentNumber();
    var c = byIso[settings.cc];
    // If they typed an international number, show its real country
    if (raw && (/^\+/.test(raw) || digits(raw).indexOf('00') === 0)) c = detectCountry(n) || c;
    $('#ccFlag').textContent = c ? c.flag : '🌐';
    $('#ccDial').textContent = c ? '+' + c.dial : '+';
  }

  function updatePhoneUI() {
    var raw = phoneEl.value.trim();
    var n = currentNumber();
    var hint = $('#phoneHint');
    var row = $('#phoneRow');
    $('#clearPhone').hidden = !raw;
    row.classList.remove('valid', 'invalid');
    hint.className = 'hint';
    if (!raw) {
      hint.textContent = 'Any format works: 044…, +383…, 00383…, or a wa.me link';
    } else if (isValid(n)) {
      var c = detectCountry(n);
      row.classList.add('valid');
      hint.className = 'hint ok';
      hint.textContent = '✓ ' + pretty(n) + (c ? ' · ' + c.name : '');
    } else {
      row.classList.add('invalid');
      hint.className = 'hint warn';
      hint.textContent = digits(raw).length < 6 ? 'Keep typing…' : 'This number looks incomplete — check it';
    }
    renderCC();
    var label = $('#openLabel');
    if (!raw && msgEl.value.trim()) label.textContent = 'Send to a contact…';
    else label.textContent = 'Open chat';
  }

  // Direct chat has no name, but templates may contain {first} etc.
  function directText(n) {
    var v = msgEl.value;
    return /\{\w+\}/.test(v) ? fill(v, { n: n || '', name: '' }, 0) : v;
  }
  function openDirect(opts) {
    opts = opts || {};
    var raw = phoneEl.value.trim();
    var text = directText(currentNumber());
    if (!raw) {
      if (text.trim()) { // let WhatsApp pick a contact
        launch(buildUrl('', text, resolveKind()), resolveKind());
        return;
      }
      $('#phoneRow').classList.remove('shake'); void $('#phoneRow').offsetWidth; $('#phoneRow').classList.add('shake');
      phoneEl.focus();
      return;
    }
    var n = currentNumber();
    if (!isValid(n) && !opts.force) {
      toast('Number looks incomplete', { action: 'Open anyway', fn: function () { openDirect({ force: true }); } });
      return;
    }
    buzz();
    store.set('draft', { p: phoneEl.value, m: msgEl.value });
    addHistory(n, text);
    launch(buildUrl(n, text, resolveKind()), resolveKind());
    rememberCC(detectCountry(n));
    setTimeout(renderRecentQuick, 400);
  }

  function rememberCC(c) {
    if (!c) return;
    recentCC = [c.iso].concat(recentCC.filter(function (x) { return x !== c.iso; })).slice(0, 5);
    store.set('recentCC', recentCC);
  }

  // Fill fields from any text: number, wa.me link, or several numbers (-> bulk)
  function ingestText(text, opts) {
    opts = opts || {};
    text = String(text || '').trim();
    if (!text) { toast('Clipboard is empty'); return false; }
    var link = parseWaLink(text);
    if (link) {
      phoneEl.value = '+' + link.n;
      if (link.text) msgEl.value = link.text;
      updatePhoneUI(); saveDraft();
      return true;
    }
    if (/BEGIN:VCARD/i.test(text) || extractNumbers(text).length > 1) {
      var list = parseRecipients(text);
      if (list.length > 1) {
        var bi = $('#bulkInput');
        bi.value = (bi.value.trim() ? bi.value.trim() + '\n' : '') + text;
        saveBulkDraft(); showTab('bulk'); onBulkInput();
        toast(list.length + ' numbers moved to Bulk');
        return false;
      }
    }
    var nums = extractNumbers(text);
    if (!nums.length) {
      if (opts.fromShare) { msgEl.value = text; updatePhoneUI(); saveDraft(); phoneEl.focus(); return false; }
      toast('No phone number found in what you copied');
      return false;
    }
    phoneEl.value = nums[0];
    updatePhoneUI(); saveDraft();
    return true;
  }

  async function pasteAndGo() {
    var text = '';
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('nope');
      text = await navigator.clipboard.readText();
    } catch (e) {
      phoneEl.focus();
      toast('Allow clipboard access, or long-press the field and paste');
      return;
    }
    if (!ingestText(text)) return;
    if (settings.instantPaste && isValid(currentNumber()) && !isIOS) {
      openDirect();
    } else {
      var b = $('#openBtn');
      b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
      if (!isMobile) b.focus();
    }
  }

  var saveDraft = debounce(function () { store.set('draft', { p: phoneEl.value, m: msgEl.value }); }, 250);

  phoneEl.addEventListener('input', function () { updatePhoneUI(); saveDraft(); });
  phoneEl.addEventListener('paste', function (e) {
    var t = (e.clipboardData || window.clipboardData);
    t = t ? t.getData('text') : '';
    if (t && (parseWaLink(t) || extractNumbers(t).length > 1 || /BEGIN:VCARD/i.test(t))) {
      e.preventDefault();
      ingestText(t);
    }
  });
  phoneEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); openDirect(); } });
  msgEl.addEventListener('input', function () { updatePhoneUI(); saveDraft(); renderTplChips(); });
  msgEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openDirect(); } });
  $('#clearPhone').addEventListener('click', function () { phoneEl.value = ''; updatePhoneUI(); saveDraft(); phoneEl.focus(); });
  $('#openBtn').addEventListener('click', function () { openDirect(); });
  $('#pasteGo').addEventListener('click', pasteAndGo);
  $('#ccBtn').addEventListener('click', function () { openCountryPicker(function () { updatePhoneUI(); onBulkInput(); }); });

  function needNumber() {
    var n = currentNumber();
    if (!n && !msgEl.value.trim()) { phoneEl.focus(); toast('Enter a number first'); return null; }
    return n || '';
  }
  $('#copyBtn').addEventListener('click', function () {
    var n = needNumber(); if (n === null) return;
    copyText(shareUrl(n, directText(n)), 'Link copied');
  });
  $('#shareBtn').addEventListener('click', function () {
    var n = needNumber(); if (n === null) return;
    var url = shareUrl(n, directText(n));
    if (navigator.share) navigator.share({ title: 'WhatsApp', text: n ? 'Chat with ' + pretty(n) : 'WhatsApp message', url: url }).catch(function () {});
    else copyText(url, 'Sharing not supported — link copied');
  });
  $('#qrBtn').addEventListener('click', function () {
    var n = needNumber(); if (n === null) return;
    showQR(n, directText(n));
  });

  function copyText(t, okMsg) {
    var done = function () { toast(okMsg || 'Copied'); buzz(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done, function () { fallbackCopy(t); done(); });
    } else { fallbackCopy(t); done(); }
  }
  function fallbackCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  /* ---------------- QR ---------------- */
  function drawQR(canvas, text) {
    var qr = window.qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    var count = qr.getModuleCount(), margin = 3, scale = 8;
    var size = (count + margin * 2) * scale;
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#0b1411';
    for (var r = 0; r < count; r++) for (var c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
  }
  function showQR(n, text) {
    var url = shareUrl(n, text);
    openSheet('Scan to chat', '<div class="qr-box"><canvas id="qrCanvas" aria-label="QR code"></canvas></div>' +
      '<p class="qr-cap">' + esc(n ? pretty(n) : 'Any contact') + '</p><p class="qr-url">' + esc(url) + '</p>' +
      '<div class="btn-row"><button class="btn soft" id="qrDl" type="button">Download PNG</button><button class="btn soft" id="qrCopy" type="button">Copy link</button></div>',
      function (root) {
        var cv = $('#qrCanvas', root);
        try { drawQR(cv, url); } catch (e) { cv.replaceWith(Object.assign(document.createElement('p'), { textContent: 'Message too long for a QR code.' })); }
        $('#qrDl', root).onclick = function () {
          var a = document.createElement('a');
          a.download = 'whatsapp-' + (n || 'link') + '.png';
          a.href = cv.toDataURL('image/png'); a.click();
        };
        $('#qrCopy', root).onclick = function () { copyText(url, 'Link copied'); };
      });
  }

  /* ---------------- templates ---------------- */
  function saveTemplates() { store.set('templates', templates); renderTplChips(); renderBulkTplChips(); }
  function insertAtCursor(el, text) {
    var v = el.value;
    if (!v.trim()) { el.value = text; }
    else {
      var s = el.selectionStart != null ? el.selectionStart : v.length;
      var e = el.selectionEnd != null ? el.selectionEnd : v.length;
      var before = v.slice(0, s), after = v.slice(e);
      var sep = before && !/\s$/.test(before) ? ' ' : '';
      el.value = before + sep + text + after;
      var pos = (before + sep + text).length;
      try { el.setSelectionRange(pos, pos); } catch (er) {}
    }
    el.dispatchEvent(new Event('input'));
    if (!isMobile) el.focus();
  }
  function tplChipsHTML(withSave, val) {
    var html = templates.map(function (t) {
      return '<button type="button" class="chip" data-tpl="' + esc(t.id) + '" title="' + esc(t.text) + '">' + esc(t.text) + '</button>';
    }).join('');
    var v = (val || '').trim();
    if (withSave && v && !templates.some(function (t) { return t.text.trim() === v; })) {
      html = '<button type="button" class="chip add" data-save-tpl>＋ Save as template</button>' + html;
    }
    return html;
  }
  function renderTplChips() { $('#tplChips').innerHTML = tplChipsHTML(true, msgEl.value); }
  function renderBulkTplChips() { $('#bulkTplChips').innerHTML = tplChipsHTML(true, $('#bulkMsg').value); }
  function bindChips(container, target) {
    container.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-save-tpl')) {
        templates.unshift({ id: 't' + Date.now(), text: target.value.trim() });
        saveTemplates(); toast('Template saved'); return;
      }
      var t = templates.find(function (x) { return x.id === b.dataset.tpl; });
      if (t) insertAtCursor(target, t.text);
      if (b.dataset.var) insertAtCursor(target, b.dataset.var);
    });
  }
  bindChips($('#tplChips'), msgEl);
  bindChips($('#bulkTplChips'), $('#bulkMsg'));
  bindChips($('#varChips'), $('#bulkMsg'));

  function openTemplateManager() {
    var render = function (root) {
      $('#tplList', root).innerHTML = templates.length ? templates.map(function (t) {
        return '<div class="tpl-item" data-id="' + esc(t.id) + '"><p>' + esc(t.text) + '</p>' +
          '<button class="icon-btn ghost sm" type="button" data-act="edit" aria-label="Edit"><svg><use href="#i-edit"/></svg></button>' +
          '<button class="icon-btn ghost sm" type="button" data-act="del" aria-label="Delete"><svg><use href="#i-trash"/></svg></button></div>';
      }).join('') : '<p class="muted">No templates yet.</p>';
    };
    var editing = null;
    openSheet('Message templates',
      '<div id="tplList"></div><div class="tpl-new"><textarea id="tplText" rows="3" placeholder="New template… use {first}, {name}, {number}, {date}"></textarea>' +
      '<button class="btn primary" id="tplSave" type="button">Add template</button></div>',
      function (root) {
        render(root);
        $('#tplList', root).addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          var id = b.closest('.tpl-item').dataset.id;
          var t = templates.find(function (x) { return x.id === id; });
          if (b.dataset.act === 'del') {
            templates = templates.filter(function (x) { return x.id !== id; });
            saveTemplates(); render(root);
          } else if (b.dataset.act === 'edit' && t) {
            editing = t; $('#tplText', root).value = t.text; $('#tplText', root).focus();
            $('#tplSave', root).textContent = 'Save changes';
          }
        });
        $('#tplSave', root).onclick = function () {
          var v = $('#tplText', root).value.trim(); if (!v) return;
          if (editing) { editing.text = v; editing = null; }
          else templates.unshift({ id: 't' + Date.now(), text: v });
          $('#tplText', root).value = ''; $('#tplSave', root).textContent = 'Add template';
          saveTemplates(); render(root);
        };
      });
  }
  $('#manageTpl').addEventListener('click', openTemplateManager);
  $$('[data-manage-tpl]').forEach(function (b) { b.addEventListener('click', openTemplateManager); });

  /* ---------------- country picker ---------------- */
  function openCountryPicker(after) {
    var row = function (c) {
      return '<li><button type="button" data-iso="' + c.iso + '" class="' + (c.iso === settings.cc ? 'sel' : '') + '">' +
        '<span class="flag">' + c.flag + '</span><span class="cname">' + esc(c.name) + '</span><span class="cdial">+' + c.dial + '</span></button></li>';
    };
    var render = function (root, q) {
      q = (q || '').trim().toLowerCase();
      var qd = digits(q);
      var list = COUNTRIES.filter(function (c) {
        return !q || c.name.toLowerCase().indexOf(q) !== -1 || c.iso.toLowerCase() === q || (qd && c.dial.indexOf(qd) === 0);
      });
      var html = '';
      if (!q) {
        var rec = [settings.cc].concat(recentCC).filter(function (x, i, a) { return byIso[x] && a.indexOf(x) === i; }).slice(0, 5);
        html += '<li class="group-label">Recent</li>' + rec.map(function (x) { return row(byIso[x]); }).join('') + '<li class="group-label">All countries</li>';
      }
      html += list.map(row).join('') || '<li class="muted" style="padding:16px 6px">No match</li>';
      $('#ccList', root).innerHTML = html;
    };
    openSheet('Default country code',
      '<input type="search" id="ccSearch" placeholder="Search country or code" autocomplete="off"><ul class="country-list" id="ccList"></ul>',
      function (root) {
        render(root);
        var s = $('#ccSearch', root);
        s.addEventListener('input', function () { render(root, s.value); });
        s.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var f = $('#ccList button', root); if (f) f.click(); } });
        if (!isMobile) s.focus();
        $('#ccList', root).addEventListener('click', function (e) {
          var b = e.target.closest('button[data-iso]'); if (!b) return;
          settings.cc = b.dataset.iso; saveSettings(); rememberCC(byIso[settings.cc]);
          closeSheet(); after && after();
          toast('Default: ' + byIso[settings.cc].name + ' +' + byIso[settings.cc].dial);
        });
      });
  }

  /* =========================================================
     HISTORY
     ========================================================= */
  function addHistory(n, msg, name) {
    if (!settings.saveHistory || !n) return;
    var existing = history.find(function (h) { return h.n === n; });
    if (existing) {
      history = history.filter(function (h) { return h !== existing; });
      existing.t = Date.now(); existing.c = (existing.c || 1) + 1;
      if (msg) existing.m = msg;
      if (name && !existing.name) existing.name = name;
      history.unshift(existing);
    } else {
      history.unshift({ n: n, m: msg || '', t: Date.now(), c: 1, name: name || '', pin: false });
    }
    // keep pinned + latest 300
    var pinned = history.filter(function (h) { return h.pin; });
    var rest = history.filter(function (h) { return !h.pin; }).slice(0, 300);
    history = sortHist(pinned.concat(rest));
    store.set('history', history);
  }
  function sortHist(arr) { return arr.sort(function (a, b) { return (b.pin - a.pin) || (b.t - a.t); }); }
  function ago(t) {
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    var m = Math.round(s / 60); if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 24) return h + ' h ago';
    var d = Math.round(h / 24); if (d < 7) return d + ' d ago';
    return new Date(t).toLocaleDateString();
  }
  var COLORS = ['#0f9f6e', '#2f80ed', '#9b51e0', '#eb5757', '#f2994a', '#219653', '#56ccf2', '#bb6bd9', '#e2a50b', '#27ae60'];
  function avatar(h, cls) {
    var label = h.name ? h.name.trim().charAt(0).toUpperCase() : '#';
    var col = COLORS[parseInt(h.n.slice(-2), 10) % COLORS.length] || COLORS[0];
    return '<span class="avatar ' + (cls || '') + '" style="background:' + col + '">' + esc(label) + '</span>';
  }
  function histRow(h, compact) {
    var title = h.name || pretty(h.n);
    var sub = (h.name ? pretty(h.n) + ' · ' : '') + ago(h.t) + (h.m ? ' · ' + h.m : '');
    return '<li data-n="' + h.n + '">' +
      '<button class="row-main" type="button" data-act="open" title="Open chat">' + avatar(h) +
      '<span class="row-text"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></span></button>' +
      '<span class="row-actions">' +
      (compact ? '' : '<button class="icon-btn ghost sm pin' + (h.pin ? ' on' : '') + '" type="button" data-act="pin" aria-label="Pin"><svg><use href="#i-star"/></svg></button>') +
      '<button class="icon-btn ghost sm" type="button" data-act="fill" aria-label="Edit before sending" title="Load into form"><svg><use href="#i-edit"/></svg></button>' +
      (compact ? '' : '<button class="icon-btn ghost sm" type="button" data-act="more" aria-label="More"><svg><use href="#i-down"/></svg></button>') +
      '</span></li>';
  }
  function renderRecentQuick() {
    var items = history.slice(0, 5);
    $('#recentWrap').hidden = !items.length;
    $('#recentQuick').innerHTML = items.map(function (h) { return histRow(h, true); }).join('');
  }
  function renderHistory() {
    var q = $('#histSearch').value.trim().toLowerCase();
    var qd = digits(q);
    var items = history.filter(function (h) {
      if (!q) return true;
      return (h.name || '').toLowerCase().indexOf(q) !== -1 || (h.m || '').toLowerCase().indexOf(q) !== -1 || (qd && h.n.indexOf(qd) !== -1);
    });
    $('#historyList').innerHTML = items.map(function (h) { return histRow(h, false); }).join('');
    $('#histEmpty').hidden = history.length > 0;
    $('#histCount').textContent = history.length ? history.length + ' contact' + (history.length === 1 ? '' : 's') : 'History';
  }
  function onHistClick(e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var li = b.closest('li'); var n = li.dataset.n;
    var h = history.find(function (x) { return x.n === n; }); if (!h) return;
    var act = b.dataset.act;
    if (act === 'open') {
      var text = msgEl.value.trim() ? fill(msgEl.value, h, 0) : '';
      buzz(); addHistory(n, text); launch(buildUrl(n, text, resolveKind()), resolveKind());
      setTimeout(function () { renderRecentQuick(); if (currentTab === 'history') renderHistory(); }, 300);
    } else if (act === 'fill') {
      phoneEl.value = '+' + n; if (h.m && !msgEl.value.trim()) msgEl.value = h.m;
      updatePhoneUI(); saveDraft(); renderTplChips(); showTab('chat', true);
      if (!isMobile) msgEl.focus();
    } else if (act === 'pin') {
      h.pin = !h.pin; history = sortHist(history); store.set('history', history); renderHistory();
    } else if (act === 'more') {
      openSheet(h.name || pretty(n),
        '<label class="field-label" for="hName">Name / label</label><input type="text" id="hName" value="' + esc(h.name) + '" placeholder="e.g. Plumber, Arta, Client X">' +
        '<div class="btn-row"><button class="btn primary" id="hSave" type="button">Save</button></div>' +
        '<div class="btn-row"><button class="btn soft" id="hCopy" type="button"><svg><use href="#i-copy"/></svg>Copy number</button><button class="btn soft" id="hQr" type="button"><svg><use href="#i-qr"/></svg>QR</button></div>' +
        '<div class="btn-row"><button class="btn soft" id="hDel" type="button" style="color:var(--danger)"><svg><use href="#i-trash"/></svg>Remove from history</button></div>',
        function (root) {
          var inp = $('#hName', root);
          var save = function () { h.name = inp.value.trim(); store.set('history', history); closeSheet(); renderHistory(); renderRecentQuick(); };
          $('#hSave', root).onclick = save;
          inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') save(); });
          $('#hCopy', root).onclick = function () { copyText('+' + n, 'Number copied'); };
          $('#hQr', root).onclick = function () { showQR(n, ''); };
          $('#hDel', root).onclick = function () {
            history = history.filter(function (x) { return x.n !== n; }); store.set('history', history);
            closeSheet(); renderHistory(); renderRecentQuick();
            toast('Removed', { action: 'Undo', fn: function () { history.push(h); history = sortHist(history); store.set('history', history); renderHistory(); renderRecentQuick(); } });
          };
        });
    }
  }
  $('#historyList').addEventListener('click', onHistClick);
  $('#recentQuick').addEventListener('click', onHistClick);
  $('#histSearch').addEventListener('input', renderHistory);
  $('#histClear').addEventListener('click', function () {
    if (!history.length) return;
    var backup = history.slice();
    var keep = history.filter(function (h) { return h.pin; });
    history = keep; store.set('history', history); renderHistory(); renderRecentQuick();
    toast(keep.length ? 'Cleared (pinned kept)' : 'History cleared', { action: 'Undo', fn: function () { history = backup; store.set('history', history); renderHistory(); renderRecentQuick(); } });
  });
  $('#histExport').addEventListener('click', function () {
    if (!history.length) { toast('Nothing to export'); return; }
    var rows = [['name', 'number', 'last_message', 'last_opened', 'times', 'pinned']].concat(history.map(function (h) {
      return [h.name || '', '+' + h.n, h.m || '', new Date(h.t).toISOString(), h.c || 1, h.pin ? 'yes' : ''];
    }));
    downloadCSV(rows, 'quickwa-history.csv');
  });

  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function downloadCSV(rows, name) {
    var csv = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name);
  }
  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* =========================================================
     BULK
     ========================================================= */
  var parsed = [];          // [{n, name, valid, raw}]
  var removed = {};         // numbers the user removed from preview

  function parseVCards(text) {
    var out = [];
    text.split(/BEGIN:VCARD/i).slice(1).forEach(function (card) {
      var fn = (card.match(/^FN[^:\n]*:(.*)$/im) || [])[1] || '';
      if (!fn) { var nn = (card.match(/^N[;:][^:\n]*:?(.*)$/im) || [])[1] || ''; fn = nn.split(';').reverse().join(' ').trim(); }
      var tels = card.match(/^(?:item\d+\.)?TEL[^:\n]*:(.*)$/gim) || [];
      tels.forEach(function (line) { out.push({ raw: line.replace(/^[^:]*:/, '').trim(), name: fn.trim() }); });
    });
    return out;
  }
  function parseRecipients(text) {
    var entries = [];
    if (/BEGIN:VCARD/i.test(text)) entries = parseVCards(text);
    else {
      String(text || '').split(/\r?\n/).forEach(function (line) {
        if (!line.trim()) return;
        var nums = extractNumbers(line);
        if (!nums.length) return;
        if (nums.length === 1) {
          var name = line.replace(nums[0], ' ').replace(/["']/g, '').replace(/[,;\t|]+/g, ' ').replace(/\s+/g, ' ').trim();
          if (/^\W*$/.test(name) || /^(phone|tel|mobile|number|nr|numri)$/i.test(name)) name = '';
          entries.push({ raw: nums[0], name: name.slice(0, 60) });
        } else {
          nums.forEach(function (x) { entries.push({ raw: x, name: '' }); });
        }
      });
    }
    var seen = {};
    var out = [];
    entries.forEach(function (e) {
      var n = normalize(e.raw);
      if (!n || seen[n]) return;
      seen[n] = 1;
      out.push({ n: n, name: e.name, valid: isValid(n), raw: e.raw });
    });
    return out;
  }

  var bulkInput = $('#bulkInput'), bulkMsg = $('#bulkMsg');
  var saveBulkDraft = debounce(function () { store.set('bulkDraft', { list: bulkInput.value, msg: bulkMsg.value }); }, 300);

  function firstName(name) { return (name || '').trim().split(/\s+/)[0] || ''; }
  function fill(tpl, it, i) {
    var d = new Date();
    var out = String(tpl || '')
      .replace(/\{first\}/gi, firstName(it.name))
      .replace(/\{name\}/gi, it.name || '')
      .replace(/\{number\}/gi, '+' + it.n)
      .replace(/\{index\}/gi, String(i + 1))
      .replace(/\{date\}/gi, d.toLocaleDateString())
      .replace(/\{time\}/gi, d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    // tidy "Hi , " when a name is missing
    return out.replace(/[ \t]+([,!.?])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/^\s*[,]\s*/, '');
  }

  function onBulkInput() {
    parsed = parseRecipients(bulkInput.value).filter(function (p) { return !removed[p.n]; });
    var valid = parsed.filter(function (p) { return p.valid; });
    var bad = parsed.length - valid.length;
    var stats = $('#bulkStats');
    if (!bulkInput.value.trim()) stats.textContent = 'Paste numbers, a spreadsheet column, or a contacts file.';
    else stats.innerHTML = '<b>' + valid.length + '</b> ready' + (bad ? ' · <span style="color:var(--warn)">' + bad + ' look invalid (skipped)</span>' : '') + ' · duplicates removed automatically';
    var show = parsed.slice(0, 60);
    $('#bulkPreview').innerHTML = show.map(function (p) {
      return '<span class="token' + (p.valid ? '' : ' bad') + '" title="' + esc(pretty(p.n)) + '">' + esc(p.name ? p.name + ' · ' : '') + esc(pretty(p.n)) +
        '<button type="button" data-rm="' + p.n + '" aria-label="Remove"><svg><use href="#i-x"/></svg></button></span>';
    }).join('') + (parsed.length > show.length ? '<span class="token"><span class="more">+' + (parsed.length - show.length) + ' more</span></span>' : '');
    var sb = $('#startBulk');
    sb.disabled = !valid.length;
    $('#startLabel').textContent = valid.length ? 'Start · ' + valid.length + ' chat' + (valid.length === 1 ? '' : 's') : 'Add recipients to start';
    updateBadge();
    renderBulkPreviewMsg();
  }
  function renderBulkPreviewMsg() {
    var v = bulkMsg.value;
    var first = parsed.find(function (p) { return p.valid; });
    var box = $('#bulkMsgPreview');
    if (!v.trim() || !first || !/\{\w+\}/.test(v)) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<b>Preview for ' + esc(first.name || pretty(first.n)) + ':</b>\n' + esc(fill(v, first, 0));
  }
  bulkInput.addEventListener('input', function () { removed = {}; onBulkInput(); saveBulkDraft(); });
  bulkMsg.addEventListener('input', function () { renderBulkPreviewMsg(); renderBulkTplChips(); saveBulkDraft(); });
  $('#bulkPreview').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rm]'); if (!b) return;
    removed[b.dataset.rm] = 1; onBulkInput();
  });
  $('#bulkPasteBtn').addEventListener('click', async function () {
    try {
      var t = await navigator.clipboard.readText();
      if (!t.trim()) { toast('Clipboard is empty'); return; }
      bulkInput.value = (bulkInput.value.trim() ? bulkInput.value.trim() + '\n' : '') + t;
      onBulkInput(); saveBulkDraft();
    } catch (e) { bulkInput.focus(); toast('Long-press the box and paste'); }
  });
  $('#importBtn').addEventListener('click', function () { $('#fileInput').click(); });
  $('#fileInput').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      var before = parsed.length;
      bulkInput.value = (bulkInput.value.trim() ? bulkInput.value.trim() + '\n' : '') + String(r.result);
      onBulkInput(); saveBulkDraft();
      toast('Imported ' + Math.max(0, parsed.length - before) + ' recipients from ' + f.name);
    };
    r.readAsText(f);
    e.target.value = '';
  });

  // advance mode
  function renderAdvance() {
    if (isMobile && settings.advance === 'timer') settings.advance = 'return';
    $$('#advanceSeg button').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.adv === settings.advance)); });
    $('#timerRow').hidden = settings.advance !== 'timer';
    $('#delaySel').value = String(settings.delay);
    var help = {
      'return': 'Send in WhatsApp, come back — the next chat is ready. One tap per person.',
      timer: 'Opens the next chat in the same tab automatically. Keep this tab open.',
      manual: 'You tap “Next” after each chat.'
    };
    $('#advanceHelp').textContent = help[settings.advance];
  }
  $('#advanceSeg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-adv]'); if (!b) return;
    settings.advance = b.dataset.adv; saveSettings(); renderAdvance();
  });
  $('#delaySel').addEventListener('change', function () { settings.delay = parseInt(this.value, 10) || 5; saveSettings(); });

  /* ---- queue runner ---- */
  var awaitingReturn = false, openedAt = 0, timer = null, timerLeft = 0, paused = false;

  function saveQueue() { if (queue) store.set('queue', queue); else store.del('queue'); updateBadge(); }
  function remaining() { return queue ? queue.items.filter(function (i) { return i.s === 'p' || i.s === 'o'; }).length : 0; }
  function updateBadge() {
    var b = $('#bulkBadge');
    var n = queue ? (queue.done ? 0 : remaining()) : parsed.filter(function (p) { return p.valid; }).length;
    b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
  }

  function startBulk() {
    var items = parsed.filter(function (p) { return p.valid; }).map(function (p) { return { n: p.n, name: p.name, s: 'p' }; });
    if (!items.length) return;
    queue = { items: items, idx: 0, msg: bulkMsg.value, created: Date.now(), done: false };
    saveQueue();
    renderBulk();
    if (!isMobile) $('#runPrimary').focus();
  }
  $('#startBulk').addEventListener('click', startBulk);

  function cur() { return queue && queue.items[queue.idx]; }

  function runOpen(auto) {
    var it = cur(); if (!it) return;
    var text = fill(queue.msg, it, queue.idx);
    var ok = launch(buildUrl(it.n, text, resolveKind()), resolveKind(), { noGesture: !!auto });
    if (!ok && auto) { stopTimer(); toast('Tap “Open chat” to continue'); renderRun(); return; }
    buzz();
    it.s = 'o';
    addHistory(it.n, text, it.name);
    awaitingReturn = true; openedAt = Date.now();
    saveQueue(); renderRun();
    if (settings.advance === 'timer' && !isMobile) startTimer();
  }
  function goNext(mark) {
    var it = cur();
    if (it && mark) it.s = mark;
    stopTimer();
    awaitingReturn = false;
    var next = -1;
    for (var i = queue.idx + 1; i < queue.items.length; i++) { if (queue.items[i].s === 'p') { next = i; break; } }
    if (next === -1) { for (var j = 0; j < queue.items.length; j++) { if (queue.items[j].s === 'p') { next = j; break; } } }
    if (next === -1) { queue.done = true; queue.idx = queue.items.length; }
    else queue.idx = next;
    saveQueue(); renderRun();
  }
  function goBack() {
    if (!queue || queue.idx <= 0) return;
    stopTimer(); awaitingReturn = false;
    queue.done = false; queue.idx = Math.min(queue.idx, queue.items.length) - 1;
    saveQueue(); renderRun();
  }

  function startTimer() {
    stopTimer(); paused = false;
    timerLeft = settings.delay;
    $('#runTimer').hidden = false; $('#runPause').textContent = 'Pause';
    tick();
    timer = setInterval(function () {
      if (paused) return;
      timerLeft--;
      if (timerLeft <= 0) {
        stopTimer();
        goNext('s');
        if (queue && !queue.done) runOpen(true);
      } else tick();
    }, 1000);
  }
  function tick() { $('#runTimerText').textContent = 'Next chat in ' + timerLeft + 's'; }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; var t = $('#runTimer'); if (t) t.hidden = true; }
  $('#runPause').addEventListener('click', function () {
    paused = !paused; this.textContent = paused ? 'Resume' : 'Pause';
    $('#runTimerText').textContent = paused ? 'Paused' : 'Next chat in ' + timerLeft + 's';
  });

  // When the user comes back from WhatsApp, mark as sent and get the next one ready.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (!queue || queue.done || !awaitingReturn || settings.advance !== 'return') return;
    if (Date.now() - openedAt < 1200) return;
    var it = cur();
    var who = it ? (it.name || pretty(it.n)) : '';
    goNext('s');
    if (queue && !queue.done) {
      var b = $('#runPrimary'); b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
      toast('✓ ' + who + ' done — tap for the next one', { action: 'Undo', fn: function () { goBack(); var c = cur(); if (c) { c.s = 'o'; saveQueue(); renderRun(); } } });
    }
  });

  function primaryAction() {
    if (!queue || queue.done) return;
    var it = cur(); if (!it) return;
    if (it.s === 'o') goNext('s'); else runOpen(false);
  }
  $('#runPrimary').addEventListener('click', primaryAction);
  $('#runSkip').addEventListener('click', function () { goNext('k'); });
  $('#runBack').addEventListener('click', goBack);
  $('#runReopen').addEventListener('click', function () { runOpen(false); });
  $('#runStop').addEventListener('click', function () {
    stopTimer(); awaitingReturn = false;
    if (queue) { queue.paused = true; saveQueue(); }
    showSetup();
  });
  $('#runList').addEventListener('click', function (e) {
    var li = e.target.closest('li[data-i]'); if (!li || !queue) return;
    stopTimer(); awaitingReturn = false;
    queue.idx = parseInt(li.dataset.i, 10); queue.done = false;
    var it = cur(); if (it && it.s !== 'o') it.s = 'p';
    saveQueue(); renderRun();
  });
  $('#newBroadcast').addEventListener('click', function () { queue = null; saveQueue(); showSetup(); });
  $('#retrySkipped').addEventListener('click', function () {
    if (!queue) return;
    var any = false;
    queue.items.forEach(function (i) { if (i.s === 'k') { i.s = 'p'; any = true; } });
    if (!any) { toast('Nothing was skipped'); return; }
    queue.done = false; queue.idx = -1; goNext(null);
  });
  $('#exportReport').addEventListener('click', function () {
    if (!queue) return;
    var label = { s: 'sent', k: 'skipped', p: 'pending', o: 'opened' };
    downloadCSV([['index', 'name', 'number', 'status', 'message']].concat(queue.items.map(function (it, i) {
      return [i + 1, it.name || '', '+' + it.n, label[it.s] || it.s, fill(queue.msg, it, i)];
    })), 'quickwa-broadcast-report.csv');
  });
  $('#resumeBtn').addEventListener('click', function () { if (queue) { queue.paused = false; saveQueue(); renderBulk(); } });
  $('#discardBtn').addEventListener('click', function () {
    var b = queue; queue = null; saveQueue(); renderBulk();
    toast('Broadcast discarded', { action: 'Undo', fn: function () { queue = b; saveQueue(); renderBulk(); } });
  });

  function showSetup() {
    $('#bulkSetup').hidden = false; $('#bulkRun').hidden = true;
    var showResume = !!(queue && !queue.done && remaining());
    $('#resumeBanner').hidden = !showResume;
    if (showResume) $('#resumeText').textContent = 'Unfinished broadcast: ' + remaining() + ' of ' + queue.items.length + ' left.';
    onBulkInput(); renderAdvance(); renderBulkTplChips();
  }
  function renderBulk() {
    if (queue && !queue.paused) { $('#bulkSetup').hidden = true; $('#bulkRun').hidden = false; $('#resumeBanner').hidden = true; renderRun(); }
    else showSetup();
  }
  function renderRun() {
    if (!queue) { showSetup(); return; }
    var items = queue.items;
    var sent = items.filter(function (i) { return i.s === 's'; }).length;
    var skipped = items.filter(function (i) { return i.s === 'k'; }).length;
    var handled = sent + skipped;
    $('#runCount').textContent = handled + ' of ' + items.length + ' done';
    $('#runBar').style.width = (items.length ? (handled / items.length) * 100 : 0) + '%';
    $('#queueMeta').textContent = sent + ' sent · ' + skipped + ' skipped';
    var done = queue.done || !cur();
    $('#runDone').hidden = !done;
    $('.run-card').hidden = done;
    if (done) {
      stopTimer();
      $('#doneSummary').textContent = sent + ' sent, ' + skipped + ' skipped, out of ' + items.length + '.';
    } else {
      var it = cur();
      $('#runAvatar').outerHTML = avatar(it, 'lg').replace('<span ', '<span id="runAvatar" ');
      $('#runName').textContent = it.name || pretty(it.n);
      $('#runNumber').textContent = (it.name ? pretty(it.n) + ' · ' : '') + '#' + (queue.idx + 1);
      var text = fill(queue.msg, it, queue.idx);
      $('#runMsg').textContent = text || '(no message — chat opens empty)';
      var p = $('#runPrimary');
      if (it.s === 'o') p.innerHTML = '<svg><use href="#i-check"/></svg><span>Sent · Next ›</span>';
      else p.innerHTML = '<svg><use href="#i-send"/></svg><span>Open chat with ' + esc(firstName(it.name) || pretty(it.n)) + '</span>';
      $('#runBack').disabled = queue.idx <= 0;
      $('#runReopen').disabled = it.s !== 'o';
    }
    var LBL = { s: 'Sent', k: 'Skipped', p: 'Pending', o: 'Opened' };
    $('#runList').innerHTML = items.map(function (x, i) {
      return '<li data-i="' + i + '" class="' + (i === queue.idx && !done ? 'current' : '') + '">' + avatar(x) +
        '<span class="row-text"><b>' + esc(x.name || pretty(x.n)) + '</b><span>' + esc(x.name ? pretty(x.n) : '#' + (i + 1)) + '</span></span>' +
        '<span class="status ' + x.s + '">' + LBL[x.s] + '</span></li>';
    }).join('');
    var curLi = $('#runList li.current');
    if (curLi && curLi.scrollIntoView && items.length > 8) curLi.scrollIntoView({ block: 'nearest' });
    updateBadge();
  }

  /* =========================================================
     SETTINGS
     ========================================================= */
  function sw(id, on) { return '<label class="switch"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '><span></span></label>'; }
  function openSettings() {
    var c = byIso[settings.cc];
    openSheet('Settings',
      '<div class="setting"><div class="s-text"><b>Default country</b><span>Used for local numbers like 044…</span></div><button class="btn soft sm" id="sCC" type="button">' + c.flag + ' +' + c.dial + '</button></div>' +
      '<div class="setting"><div class="s-text"><b>Open chats with</b><span>“Auto” = app on phones, WhatsApp Web on computers</span></div><select id="sOpen">' +
        '<option value="auto">Auto (fastest)</option><option value="app">WhatsApp app</option><option value="web">WhatsApp Web</option><option value="wa">wa.me link</option></select></div>' +
      '<div class="setting"><div class="s-text"><b>Paste &amp; Chat opens instantly</b><span>Skip the extra tap after pasting</span></div>' + sw('sInstant', settings.instantPaste) + '</div>' +
      '<div class="setting"><div class="s-text"><b>Keep history</b><span>Stored only on this device</span></div>' + sw('sHist', settings.saveHistory) + '</div>' +
      '<div class="setting"><div class="s-text"><b>Theme</b></div><select id="sTheme"><option value="auto">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>' +
      '<p class="sheet-section">Backup</p>' +
      '<div class="btn-row"><button class="btn soft" id="sExport" type="button">Export backup</button><button class="btn soft" id="sImport" type="button">Import backup</button></div>' +
      '<input type="file" id="sImportFile" accept=".json,application/json" hidden>' +
      '<p class="sheet-section">Shortcut link</p>' +
      '<p class="muted" style="font-size:14px;margin:4px 0 0">Open this app with a number pre-filled:<br><code style="word-break:break-all">' + esc(location.origin) + '/?phone=38344123456&amp;text=Hello</code></p>' +
      '<div class="btn-row" style="margin-top:18px"><button class="btn soft" id="sReset" type="button" style="color:var(--danger)">Reset app data</button></div>',
      function (root) {
        $('#sOpen', root).value = settings.openWith;
        $('#sTheme', root).value = settings.theme;
        $('#sCC', root).onclick = function () { openCountryPicker(function () { updatePhoneUI(); onBulkInput(); openSettings(); }); };
        $('#sOpen', root).onchange = function () { settings.openWith = this.value; saveSettings(); };
        $('#sTheme', root).onchange = function () { settings.theme = this.value; saveSettings(); applyTheme(); };
        $('#sInstant', root).onchange = function () { settings.instantPaste = this.checked; saveSettings(); };
        $('#sHist', root).onchange = function () { settings.saveHistory = this.checked; saveSettings(); };
        $('#sExport', root).onclick = function () {
          var data = { app: 'QuickWA', v: 3, exported: new Date().toISOString(), settings: settings, templates: templates, history: history };
          downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'quickwa-backup.json');
        };
        $('#sImport', root).onclick = function () { $('#sImportFile', root).click(); };
        $('#sImportFile', root).onchange = function (e) {
          var f = e.target.files[0]; if (!f) return;
          var r = new FileReader();
          r.onload = function () {
            try {
              var d = JSON.parse(r.result);
              if (d.settings) { settings = Object.assign({}, DEFAULTS, d.settings); saveSettings(); applyTheme(); }
              if (Array.isArray(d.templates)) { templates = d.templates; saveTemplates(); }
              if (Array.isArray(d.history)) {
                var map = {}; history.concat(d.history).forEach(function (h) { if (h && h.n && (!map[h.n] || map[h.n].t < h.t)) map[h.n] = h; });
                history = sortHist(Object.keys(map).map(function (k) { return map[k]; })); store.set('history', history);
              }
              closeSheet(); updatePhoneUI(); renderRecentQuick(); toast('Backup restored');
            } catch (er) { toast('That file is not a QuickWA backup'); }
          };
          r.readAsText(f);
        };
        $('#sReset', root).onclick = function () {
          if (!confirm('Delete history, templates, drafts and settings on this device?')) return;
          Object.keys(localStorage).forEach(function (k) { if (k.indexOf(KEY) === 0) localStorage.removeItem(k); });
          location.reload();
        };
      });
  }
  $('#settingsBtn').addEventListener('click', openSettings);

  /* ---------------- keyboard ---------------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSheet(); return; }
    var typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
    if (!$('#sheetWrap').hidden || typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); showTab('chat'); phoneEl.focus(); return; }
    if (currentTab === 'bulk' && queue && !queue.paused && !queue.done && !$('#bulkRun').hidden) {
      if (e.key === 'Enter' && document.activeElement === document.body) { e.preventDefault(); primaryAction(); }
      else if (e.key === 's' || e.key === 'S') goNext('k');
      else if (e.key === 'b' || e.key === 'B') goBack();
    }
    if (e.key === '1') showTab('chat'); else if (e.key === '2') showTab('bulk'); else if (e.key === '3') showTab('history');
  });

  /* ---------------- install prompt ---------------- */
  var deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', function () {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    deferredInstall.userChoice.finally(function () { deferredInstall = null; $('#installBtn').hidden = true; });
  });
  window.addEventListener('appinstalled', function () { $('#installBtn').hidden = true; toast('Installed — find QuickWA on your home screen'); });

  /* ---------------- service worker ---------------- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing;
          nw && nw.addEventListener('statechange', function () {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('New version available', { action: 'Reload', fn: function () { location.reload(); }, ms: 10000 });
            }
          });
        });
      }).catch(function () {});
    });
  }

  /* ---------------- init ---------------- */
  (function init() {
    var d = store.get('draft', null);
    if (d) { phoneEl.value = d.p || ''; msgEl.value = d.m || ''; }
    var bd = store.get('bulkDraft', null);
    if (bd) { bulkInput.value = bd.list || ''; bulkMsg.value = bd.msg || ''; }

    // Deep links + Share Target:  /?phone=...&text=...   or shared text/url
    var q = new URLSearchParams(location.search);
    var startTab = q.get('tab') || store.get('tab', 'chat');
    var p = q.get('phone') || q.get('p') || q.get('number');
    var t = q.get('text') || q.get('t') || q.get('msg');
    var sharedTitle = q.get('title'), sharedUrl = q.get('url');
    if (p) { phoneEl.value = p.charAt(0) === ' ' ? '+' + p.trim() : p; startTab = 'chat'; if (t) msgEl.value = t; }
    else if (t || sharedUrl || sharedTitle) {
      startTab = 'chat';
      ingestText([sharedTitle, t, sharedUrl].filter(Boolean).join('\n'), { fromShare: true });
    }
    if (q.get('action') === 'paste') { startTab = 'chat'; setTimeout(function () { $('#pasteGo').classList.add('pulse'); }, 300); }
    if (location.search) history_replace();

    if (!['chat', 'bulk', 'history'].includes(startTab)) startTab = 'chat';
    updatePhoneUI();
    renderTplChips();
    renderBulkTplChips();
    renderAdvance();
    onBulkInput();
    showTab(startTab, true);
    if (p && isValid(currentNumber())) { var b = $('#openBtn'); b.classList.add('pulse'); }
    if (!isMobile && startTab === 'chat') phoneEl.focus();
  })();
  function history_replace() { try { window.history.replaceState(null, '', location.pathname); } catch (e) {} }

  // expose for tests
  window.QuickWA = { normalize: normalize, isValid: isValid, pretty: pretty, parseRecipients: parseRecipients, parseWaLink: parseWaLink, fill: fill, buildUrl: buildUrl, extractNumbers: extractNumbers };
})();
