/**
 * Injects the "Developed by" credit into the bottom-right corner of
 * whatever page includes this script. Include on every page:
 *
 *   <link rel="stylesheet" href="../shared/credit-footer.css">
 *   <script src="../shared/credit-footer.js"></script>
 *
 * Kept in one shared file so the credit text only needs updating in
 * one place if it ever changes.
 */
(function () {
  var CREDIT_TEXT = 'Developed by: EsbiFanboyJason (Jason Sales)';

  function inject() {
    var el = document.createElement('div');
    el.className = 'dev-credit';
    el.textContent = CREDIT_TEXT;
    document.body.appendChild(el);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
