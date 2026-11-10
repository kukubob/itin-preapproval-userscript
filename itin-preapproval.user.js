// ==UserScript==
// @name         ITIN Preapproval
// @namespace    local.itin.preapproval
// @version      0.2.0
// @match        https://*/web/oao/application/card*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  if (location.hostname.split('.')[0] !== 'secure' ||
      new URLSearchParams(location.search).get('cfgCode') !== 'PREAPPROVEDCONCC') return;

  const originalParseInt = window.parseInt;

  window.parseInt = function itinPreapprovalParseInt(value, radix) {
    const text = typeof value === 'string' ? value : String(value == null ? '' : value);
    if (/^9\d{2}$/.test(text)) return 888;

    return originalParseInt.apply(this, arguments);
  };
})();
