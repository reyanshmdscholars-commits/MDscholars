/* Test Student View — shared hooks
 * Include on every portal page (after Supabase SDK + `sb` client is created).
 * If the current session belongs to a test-*@mdscholars.com user:
 *   1) A persistent yellow banner is injected across the top of the page.
 *   2) window.__isTestStudent = true is set for downstream code to detect.
 *   3) A helper window.tagIfTest(obj) marks payloads with is_test_data:true.
 * The banner's Exit button signs out and returns to admin.html.
 */
(function() {
  if (window.__testStudentHooksLoaded) return;
  window.__testStudentHooksLoaded = true;

  function isTest(email) {
    return !!(email && email.indexOf('test-') === 0 && email.endsWith('@mdscholars.com'));
  }

  window.tagIfTest = function(obj) {
    if (!window.__isTestStudent) return obj;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) obj.is_test_data = true;
    if (Array.isArray(obj)) obj.forEach(function(r){ if (r && typeof r === 'object') r.is_test_data = true; });
    return obj;
  };

  function injectBanner(email) {
    if (document.getElementById('testStudentBanner')) return;
    var trackLabel = (email.replace('test-','').replace('@mdscholars.com','')).toUpperCase();
    var bar = document.createElement('div');
    bar.id = 'testStudentBanner';
    bar.style.cssText = 'position:sticky; top:0; z-index:9999; background:#facc15; color:#78350f; padding:0.75rem 1.5rem; display:flex; align-items:center; justify-content:space-between; gap:1rem; font-weight:600; border-bottom:3px solid #d97706; font-family:inherit; font-size:0.92rem; box-shadow:0 2px 8px rgba(0,0,0,0.08);';
    bar.innerHTML =
      '<span>🎭 You are viewing as <strong>Test Student &mdash; ' + trackLabel + '</strong>. Actions here are for testing only.</span>' +
      '<button id="exitTestStudentBtn" style="background:#78350f; color:#facc15; border:0; padding:0.55rem 1rem; border-radius:6px; cursor:pointer; font-weight:700; white-space:nowrap; font-family:inherit;">Exit Student View</button>';
    document.body.insertBefore(bar, document.body.firstChild);
    document.getElementById('exitTestStudentBtn').onclick = async function() {
      if (window.sb && window.sb.auth) { await window.sb.auth.signOut(); }
      try { window.close(); } catch(e){}
      // Fallback: go to admin
      var here = location.pathname;
      var up = here.indexOf('/portal/') !== -1 ? here.replace(/\/portal\/.*$/, '/admin.html') : '/admin.html';
      setTimeout(function(){ location.href = up; }, 200);
    };
  }

  function bindClient() {
    // Portal pages create `sb` inside the module scope; also expose to window for shared use
    try { if (typeof sb !== 'undefined' && !window.sb) window.sb = sb; } catch(e) {}
    if (!window.sb) return setTimeout(bindClient, 100);
    window.sb.auth.getSession().then(function(res) {
      var email = res && res.data && res.data.session && res.data.session.user && res.data.session.user.email;
      if (isTest(email)) {
        window.__isTestStudent = true;
        window.__testStudentEmail = email;
        injectBanner(email);
      }
    });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') bindClient();
  else document.addEventListener('DOMContentLoaded', bindClient);
})();
