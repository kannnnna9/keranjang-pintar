/* Logika murni retensi foto rak (F2). Tanpa DOM/IndexedDB -> testable node --test.
   Status foto: pending | matched_same | matched_diff | evidence. */
(function (root) {
  'use strict';
  var HOUR = 3600 * 1000;
  var RETENTION = {
    pending: 24 * HOUR,
    matched_same: 8 * HOUR,
    matched_diff: 24 * HOUR,
    evidence: null,
  };

  function nextExpiry(status, baseTs) {
    var dur = RETENTION[status];
    return dur == null ? null : baseTs + dur;
  }

  function mapMatchStatus(matchStatus) {
    // Status v2.8.0. 'lebih_murah' tetap matched_diff (24 jam): dia memang
    // ketidaksesuaian, dan 16 jam ekstra untuk satu foto itu murah.
    if (matchStatus === 'sama') return 'matched_same';
    if (matchStatus === 'lebih_mahal') return 'matched_diff';
    if (matchStatus === 'lebih_murah') return 'matched_diff';
    if (matchStatus === 'qty_beda') return 'matched_diff';
    return 'pending'; // tak_ketemu, tak_pasti, dan apa pun yang tak dikenal
  }

  function isExpired(rec, nowMs) {
    return rec.expiresAt != null && rec.expiresAt < nowMs;
  }

  function pickExpired(recs, nowMs) {
    return recs.filter(function (r) { return isExpired(r, nowMs); }).map(function (r) { return r.id; });
  }

  var api = {
    nextExpiry: nextExpiry,
    mapMatchStatus: mapMatchStatus,
    isExpired: isExpired,
    pickExpired: pickExpired,
    RETENTION: RETENTION,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Retention = api;
})(typeof self !== 'undefined' ? self : this);
