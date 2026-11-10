// ==UserScript==
// @name         ITIN Preapproval
// @namespace    local.itin.preapproval
// @version      0.3.0
// @match        https://*/web/oao/application/card*
// @match        https://app.credit.com/sign-up*
// @match        https://www.capitalone.com/apply/credit-cards/preapprove*
// @match        https://www.capitalone.com/apply/small-business/preapprove*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// ==/UserScript==

(() => {
  'use strict';

  if (location.hostname === 'app.credit.com') {
    const original = String.prototype.startsWith;
    String.prototype.startsWith = function (search) {
      if (search === '9' && /^9\d{8}$/.test(String(this))) return false;
      return original.apply(this, arguments);
    };
    return;
  }

  if (location.hostname === 'www.capitalone.com') {
    const storageKey = 'itin-preapproval-address';
    const submitPath = '/credit-cards/decision-servicing/submit-application';
    const collectPath = '/prospects/collect-prospect-engagement';
    const fields = [
      ['applicantPhysicalAddressLine1', 'applicantPhysicalAddressLine2', 'applicantPhysicalAddressCity', 'applicantPhysicalAddressFederatedStateCode', 'applicantPhysicalAddressPostalCode', 'applicantPhysicalAddressAlpha3CountryCode', 'isApplicantPhysicalAddressValidatedByProcessingClient'],
      ['applicantMailingAddressLine1', 'applicantMailingAddressLine2', 'applicantMailingAddressCity', 'applicantMailingAddressFederatedStateCode', 'applicantMailingAddressPostalCode', 'applicantMailingAddressAlpha3CountryCode', 'isApplicantMailingAddressValidatedByProcessingClient'],
      ['prospectAddressLine1', null, 'prospectCity', 'prospectStateCode', 'prospectPostalCode', null, 'prospectAddressValidated'],
      ['businessAddressLine1', 'businessAddressLine2', 'businessCity', 'businessStateCode', 'businessPostalCode', null, null],
      ['businessApplicantPhysicalAddressLine1', 'businessApplicantPhysicalAddressLine2', 'businessApplicantPhysicalAddressCity', 'businessApplicantPhysicalAddressFederatedStateCode', 'businessApplicantPhysicalAddressPostalCode', 'businessApplicantPhysicalAddressAlpha3CountryCode', 'isBusinessApplicantPhysicalAddressValidatedByProcessingClient'],
      ['businessApplicantMailingAddressLine1', 'businessApplicantMailingAddressLine2', 'businessApplicantMailingAddressCity', 'businessApplicantMailingAddressFederatedStateCode', 'businessApplicantMailingAddressPostalCode', 'businessApplicantMailingAddressAlpha3CountryCode', null]
    ];
    const states = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR AA AE AP'.split(' '));

    function normalize(raw) {
      raw ||= {};
      const a = {
        line1: String(raw.line1 || '').trim(),
        line2: String(raw.line2 || '').trim(),
        city: String(raw.city || '').trim().replace(/\s+/g, ' '),
        state: String(raw.state || '').trim().toUpperCase(),
        zip: String(raw.zip || '').trim(),
        sameMailing: raw.sameMailing !== false
      };
      if (!a.line1 || a.line1.length > 40 || a.line2.length > 40) return null;
      if (!/^[A-Za-z ]{1,50}$/.test(a.city) || !states.has(a.state)) return null;
      if (!/^\d{5}$/.test(a.zip) || /^(\d)\1{4}$/.test(a.zip)) return null;
      return a;
    }

    let address = null;
    try {
      address = normalize(JSON.parse(sessionStorage.getItem(storageKey)));
    } catch (_) {}

    function endpoint(value) {
      try {
        const url = new URL(value, location.href);
        if (url.hostname !== 'capitalone.com' && !url.hostname.endsWith('.capitalone.com')) return null;
        if (url.pathname.endsWith(submitPath)) return 'submit';
        if (url.pathname.endsWith(collectPath)) return 'collect';
      } catch (_) {}
      return null;
    }

    function fill(node, map, force) {
      if (!node || typeof node !== 'object') return false;
      if (!force && ![map[0], map[2], map[3], map[4]].some((name) => name in node)) return false;
      const values = [address.line1, address.line2, address.city, address.state, address.zip, 'USA', true];
      for (let i = 0; i < map.length; i++) if (map[i]) node[map[i]] = values[i];
      return true;
    }

    function rewrite(text, kind) {
      if (!address || typeof text !== 'string') return text;
      let body;
      try { body = JSON.parse(text); } catch (_) { return text; }
      if (!body || typeof body !== 'object') return text;
      let changed = false;
      if (kind === 'collect') {
        changed = fill(body, fields[2], true) || changed;
        changed = fill(body, fields[3], true) || changed;
      }
      if (kind === 'submit' && body.applicant && typeof body.applicant === 'object') {
        changed = fill(body.applicant.physicalAddress, fields[0], false) || changed;
        if (address.sameMailing) {
          body.applicant.mailingAddress ||= {};
          changed = fill(body.applicant.mailingAddress, fields[1], true) || changed;
        }
      }
      const pending = [body];
      const seen = new Set();
      while (pending.length) {
        const node = pending.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        for (let i = 0; i < fields.length; i++) {
          if (!address.sameMailing && (i === 1 || i === 5)) continue;
          changed = fill(node, fields[i], false) || changed;
        }
        for (const value of Object.values(node)) if (value && typeof value === 'object') pending.push(value);
      }
      return changed ? JSON.stringify(body) : text;
    }

    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function (input, init) {
        const kind = endpoint(typeof input === 'string' ? input : input?.url);
        const method = String(init?.method || input?.method || 'GET').toUpperCase();
        if (!kind || !address || method === 'GET' || method === 'HEAD') return originalFetch.apply(this, arguments);
        if (typeof init?.body === 'string') {
          return originalFetch.call(this, input, { ...init, body: rewrite(init.body, kind) });
        }
        if (init?.body != null) return originalFetch.call(this, input, init);
        if (typeof Request !== 'undefined' && input instanceof Request) {
          return input.clone().text()
            .then(
              (text) => originalFetch.call(this, input, { ...init, body: rewrite(text, kind) }),
              () => originalFetch.call(this, input, init)
            );
        }
        return originalFetch.call(this, input, init);
      };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const requests = new WeakMap();
    XMLHttpRequest.prototype.open = function (method, url) {
      requests.set(this, { method: String(method).toUpperCase(), kind: endpoint(url) });
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const request = requests.get(this);
      const next = request?.kind && request.method !== 'GET' && request.method !== 'HEAD'
        ? rewrite(body, request.kind)
        : body;
      return originalSend.call(this, next);
    };

    if (typeof navigator.sendBeacon === 'function') {
      const originalBeacon = navigator.sendBeacon;
      navigator.sendBeacon = function (url, data) {
        const kind = endpoint(url);
        return originalBeacon.call(this, url, kind ? rewrite(data, kind) : data);
      };
    }

    if (window !== window.top) return;
    function mount() {
      if (!document.documentElement || document.getElementById('itin-address-panel')) return;
      const host = document.createElement('div');
      host.id = 'itin-address-panel';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = [
        '<style>:host{all:initial}details{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:260px;background:#fff;border:1px solid #888;border-radius:8px;box-shadow:0 4px 16px #0003;font:13px Arial,sans-serif;color:#111}summary{cursor:pointer;padding:10px;font-weight:bold}form{display:grid;gap:6px;padding:0 10px 10px}label{display:grid;gap:2px}input{box-sizing:border-box;width:100%;padding:5px}.check{display:flex;align-items:center}.check input{width:auto}button{padding:6px;cursor:pointer}.actions{display:flex;gap:6px}</style>',
        '<details><summary>Address override</summary><form>',
        '<label>Street<input name="line1" maxlength="40" required></label>',
        '<label>Apt<input name="line2" maxlength="40"></label>',
        '<label>City<input name="city" maxlength="50" required></label>',
        '<label>State<input name="state" maxlength="2" required></label>',
        '<label>ZIP<input name="zip" inputmode="numeric" maxlength="5" required></label>',
        '<label class="check"><input name="sameMailing" type="checkbox" checked>Same mailing address</label>',
        '<div class="actions"><button type="submit">Enable</button><button type="button" class="clear">Clear</button></div>',
        '<span role="status"></span></form></details>'
      ].join('');
      const form = root.querySelector('form');
      const status = root.querySelector('[role="status"]');
      const summary = root.querySelector('summary');
      const show = () => {
        summary.textContent = address ? 'Address override: on' : 'Address override';
        status.textContent = address ? 'Active in this tab' : 'Inactive';
      };
      if (address) {
        for (const name of ['line1', 'line2', 'city', 'state', 'zip']) form.elements.namedItem(name).value = address[name];
        form.elements.namedItem('sameMailing').checked = address.sameMailing;
      }
      show();
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const next = normalize(Object.fromEntries(new FormData(form)));
        if (!next) { status.textContent = 'Check address fields'; return; }
        next.sameMailing = form.elements.namedItem('sameMailing').checked;
        address = next;
        try { sessionStorage.setItem(storageKey, JSON.stringify(address)); } catch (_) {}
        show();
      });
      root.querySelector('.clear').addEventListener('click', () => {
        address = null;
        try { sessionStorage.removeItem(storageKey); } catch (_) {}
        show();
      });
      document.documentElement.appendChild(host);
    }
    if (document.documentElement) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
    return;
  }

  if (location.hostname.split('.')[0] !== 'secure' ||
      new URLSearchParams(location.search).get('cfgCode') !== 'PREAPPROVEDCONCC') return;
  const originalParseInt = window.parseInt;
  window.parseInt = function (value) {
    const text = typeof value === 'string' ? value : String(value == null ? '' : value);
    if (/^9\d{2}$/.test(text)) return 888;
    return originalParseInt.apply(this, arguments);
  };
})();
