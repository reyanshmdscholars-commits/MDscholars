/*
  MD Scholars — Cloudflare Turnstile Integration
  ────────────────────────────────────────────────
  Adds an invisible-ish CAPTCHA widget to any form with class="mds-captcha".
  Gracefully no-ops until a site key is configured.

  Setup:
    1. In Cloudflare dashboard → Turnstile → Add site → Domain: mdscholars.com
       Choose widget mode: "Managed" (invisible unless suspicious)
    2. Copy the SITE KEY and paste it below (public — safe to commit)
    3. Copy the SECRET KEY and set it as env var TURNSTILE_SECRET_KEY on
       Supabase Edge Functions
    4. Deploy the verify-turnstile edge function

  Once configured:
    - Every form with class="mds-captcha" auto-mounts a Turnstile widget
    - Forms won't submit until the widget returns a valid token
    - The token is added as `cf-turnstile-response` to the form data OR
      accessible via `window.mdsCaptchaToken(form)`
    - Edge functions that receive the token verify it against
      Cloudflare's siteverify endpoint before acting

  For local dev / when key not set:
    - Widget is skipped, forms submit normally
    - Edge functions treat empty tokens as valid (dev mode)
*/

// PASTE YOUR TURNSTILE SITE KEY HERE (public):
window.MDS_TURNSTILE_SITE_KEY = '';  // e.g., '0x4AAAAAAABkMYinukE8nzY'

(function() {
  if (!window.MDS_TURNSTILE_SITE_KEY) {
    // Not configured yet — no-op.
    window.mdsCaptchaToken = function() { return ''; };
    return;
  }

  // Load the Turnstile script once
  if (!document.querySelector('script[src*="challenges.cloudflare.com"]')) {
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__mdsCaptchaReady';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }

  // Track widget IDs per form
  window.__mdsCaptchaWidgets = window.__mdsCaptchaWidgets || new WeakMap();

  window.__mdsCaptchaReady = function() {
    document.querySelectorAll('form.mds-captcha').forEach(mountWidget);
  };
  // Re-mount widgets for any dynamically added forms (e.g., webinar cards rendered after fetch)
  window.mdsCaptchaRefresh = function() {
    if (window.turnstile) document.querySelectorAll('form.mds-captcha').forEach(mountWidget);
  };

  function mountWidget(form) {
    if (window.__mdsCaptchaWidgets.has(form)) return;
    // Find or create a container inside the form (before the submit button)
    var container = form.querySelector('.mds-captcha-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'mds-captcha-container';
      container.style.margin = '1rem 0';
      // Insert before the last submit button
      var submit = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submit) submit.parentNode.insertBefore(container, submit);
      else form.appendChild(container);
    }
    if (window.turnstile) {
      var id = window.turnstile.render(container, {
        sitekey: window.MDS_TURNSTILE_SITE_KEY,
        theme: 'light',
        action: form.id || 'submit',
      });
      window.__mdsCaptchaWidgets.set(form, id);
    }
  }

  window.mdsCaptchaToken = function(form) {
    var id = window.__mdsCaptchaWidgets.get(form);
    if (id && window.turnstile) return window.turnstile.getResponse(id) || '';
    return '';
  };

  window.mdsCaptchaReset = function(form) {
    var id = window.__mdsCaptchaWidgets.get(form);
    if (id && window.turnstile) window.turnstile.reset(id);
  };

  // Auto-block submission if no token
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form.classList || !form.classList.contains('mds-captcha')) return;
    var token = window.mdsCaptchaToken(form);
    if (!token) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var msg = form.querySelector('.mds-captcha-msg');
      if (!msg) {
        msg = document.createElement('div');
        msg.className = 'mds-captcha-msg';
        msg.style.cssText = 'color:#dc2626;font-size:0.85rem;margin-top:0.5rem;';
        var container = form.querySelector('.mds-captcha-container');
        if (container) container.appendChild(msg);
        else form.appendChild(msg);
      }
      msg.textContent = 'Please complete the security challenge above.';
    }
  }, true);
})();
