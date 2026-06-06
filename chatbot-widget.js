/* MD Scholars chatbot widget — drop in via <script src="chatbot-widget.js" defer></script> */
(function(){
  if (window.__mdsChatbotLoaded) return;
  window.__mdsChatbotLoaded = true;

  var ENDPOINT = 'https://nygeinaoevzyptkgchqb.supabase.co/functions/v1/chatbot-answer';
  var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55Z2VpbmFvZXZ6eXB0a2djaHFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NTY5OTgsImV4cCI6MjA5MDIzMjk5OH0.73LgchISCs4puQJ1-RKIjepKZeZKXTzopkV-8L8btWQ';

  var SUGGESTIONS = [
    'How much is the High School track?',
    'When does Fall 2026 start?',
    'How do I pay?',
    'What is the refund policy?'
  ];

  var history = [];
  var open = false;

  var css = '\
  .mds-chat-launch{position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#134E4A,#0d9488);color:#fff;border:none;box-shadow:0 8px 24px rgba(0,0,0,0.25);cursor:pointer;font-size:26px;z-index:99998;display:flex;align-items:center;justify-content:center;transition:transform 0.2s;}\
  .mds-chat-launch:hover{transform:scale(1.08);}\
  .mds-chat-panel{position:fixed;bottom:96px;right:24px;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.28);font-family:"DM Sans",-apple-system,Segoe UI,Arial,sans-serif;display:flex;flex-direction:column;overflow:hidden;z-index:99999;animation:mdsSlideUp 0.25s ease;}\
  @keyframes mdsSlideUp{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}\
  .mds-chat-header{background:linear-gradient(135deg,#001F3F,#134E4A);color:#fff;padding:18px 20px;display:flex;justify-content:space-between;align-items:center;}\
  .mds-chat-title{font-family:"Playfair Display",Georgia,serif;font-size:18px;font-weight:700;line-height:1.2;margin:0;}\
  .mds-chat-sub{font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#14b8a6;margin-top:2px;}\
  .mds-chat-close{background:transparent;border:none;color:#fff;font-size:24px;cursor:pointer;padding:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;opacity:0.8;}\
  .mds-chat-close:hover{opacity:1;background:rgba(255,255,255,0.1);}\
  .mds-chat-body{flex:1;overflow-y:auto;padding:18px;background:#f8f5ef;display:flex;flex-direction:column;gap:12px;}\
  .mds-msg{max-width:88%;padding:11px 14px;border-radius:14px;font-size:14.5px;line-height:1.5;word-wrap:break-word;}\
  .mds-msg.bot{background:#fff;color:#0f172a;align-self:flex-start;border:1px solid #e0dbd0;border-bottom-left-radius:4px;}\
  .mds-msg.user{background:#0d9488;color:#fff;align-self:flex-end;border-bottom-right-radius:4px;}\
  .mds-msg a{color:inherit;text-decoration:underline;}\
  .mds-msg.bot a{color:#0d9488;}\
  .mds-suggestions{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;}\
  .mds-suggest{background:#fff;border:1px solid #e0dbd0;color:#134E4A;font-size:12.5px;padding:7px 12px;border-radius:18px;cursor:pointer;font-family:inherit;}\
  .mds-suggest:hover{background:#ecfdf5;border-color:#0d9488;}\
  .mds-typing{display:flex;gap:4px;padding:4px 0;}\
  .mds-typing span{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:mdsBlink 1.2s infinite;}\
  .mds-typing span:nth-child(2){animation-delay:0.15s;}\
  .mds-typing span:nth-child(3){animation-delay:0.30s;}\
  @keyframes mdsBlink{0%,80%,100%{opacity:0.3;}40%{opacity:1;}}\
  .mds-chat-footer{padding:12px 14px;background:#fff;border-top:1px solid #e0dbd0;display:flex;gap:8px;align-items:flex-end;}\
  .mds-chat-input{flex:1;border:1px solid #e0dbd0;border-radius:20px;padding:10px 14px;font-size:14px;font-family:inherit;resize:none;max-height:80px;outline:none;}\
  .mds-chat-input:focus{border-color:#0d9488;}\
  .mds-chat-send{background:#0d9488;color:#fff;border:none;width:38px;height:38px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}\
  .mds-chat-send:hover{background:#0f766e;}\
  .mds-chat-send:disabled{background:#94a3b8;cursor:not-allowed;}\
  .mds-chat-disclaimer{font-size:10.5px;color:#94a3b8;text-align:center;padding:4px 14px 8px;background:#fff;}\
  .mds-chat-disclaimer a{color:#0d9488;}\
  @media (max-width:480px){.mds-chat-panel{right:8px;left:8px;width:auto;height:calc(100vh - 100px);bottom:80px;}.mds-chat-launch{bottom:16px;right:16px;}}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var launch = document.createElement('button');
  launch.className = 'mds-chat-launch';
  launch.title = 'Ask MD Scholars';
  launch.setAttribute('aria-label', 'Open MD Scholars chat');
  launch.innerHTML = '💬';
  document.body.appendChild(launch);

  var panel = null;
  var body = null;
  var input = null;

  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'mds-chat-panel';
    panel.innerHTML = '\
      <div class="mds-chat-header">\
        <div>\
          <h3 class="mds-chat-title">MD Scholars Assistant</h3>\
          <div class="mds-chat-sub">Ask anything about the program</div>\
        </div>\
        <button class="mds-chat-close" aria-label="Close chat">×</button>\
      </div>\
      <div class="mds-chat-body" id="mds-body"></div>\
      <div class="mds-chat-footer">\
        <textarea class="mds-chat-input" id="mds-input" rows="1" placeholder="Type your question…" maxlength="1000"></textarea>\
        <button class="mds-chat-send" id="mds-send" aria-label="Send">→</button>\
      </div>\
      <div class="mds-chat-disclaimer">AI assistant — for account-specific questions email <a href="mailto:support@mdscholars.com">support@mdscholars.com</a>.</div>';
    document.body.appendChild(panel);

    body = panel.querySelector('#mds-body');
    input = panel.querySelector('#mds-input');
    var sendBtn = panel.querySelector('#mds-send');
    var closeBtn = panel.querySelector('.mds-chat-close');

    closeBtn.addEventListener('click', togglePanel);
    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', function(e){
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    input.addEventListener('input', function(){
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 80) + 'px';
    });

    // Greeting + suggestions
    addBotMsg("Hi! I'm the MD Scholars assistant. Ask me anything about the program — tracks, tuition, applying, the portal, refunds, anything.");
    addSuggestions();
  }

  function togglePanel() {
    open = !open;
    if (open) {
      if (!panel) buildPanel();
      else panel.style.display = 'flex';
      setTimeout(function(){ input && input.focus(); }, 100);
      launch.innerHTML = '×';
      launch.style.fontSize = '32px';
    } else {
      if (panel) panel.style.display = 'none';
      launch.innerHTML = '💬';
      launch.style.fontSize = '26px';
    }
  }
  launch.addEventListener('click', togglePanel);

  function escapeHtml(t){
    return String(t).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function linkify(t) {
    // basic markdown-link [text](url) and bare https URLs
    var html = escapeHtml(t);
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function addBotMsg(text) {
    var el = document.createElement('div');
    el.className = 'mds-msg bot';
    el.innerHTML = linkify(text);
    body.appendChild(el);
    scrollToBottom();
    return el;
  }

  function addUserMsg(text) {
    var el = document.createElement('div');
    el.className = 'mds-msg user';
    el.textContent = text;
    body.appendChild(el);
    scrollToBottom();
  }

  function addTyping() {
    var el = document.createElement('div');
    el.className = 'mds-msg bot mds-typing-wrap';
    el.innerHTML = '<div class="mds-typing"><span></span><span></span><span></span></div>';
    body.appendChild(el);
    scrollToBottom();
    return el;
  }

  function addSuggestions() {
    var wrap = document.createElement('div');
    wrap.className = 'mds-suggestions';
    SUGGESTIONS.forEach(function(s){
      var b = document.createElement('button');
      b.className = 'mds-suggest';
      b.textContent = s;
      b.addEventListener('click', function(){
        wrap.remove();
        input.value = s;
        sendMessage();
      });
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
    scrollToBottom();
  }

  function scrollToBottom() {
    setTimeout(function(){ body.scrollTop = body.scrollHeight; }, 30);
  }

  function sendMessage() {
    var q = input.value.trim();
    if (!q) return;
    input.value = '';
    input.style.height = 'auto';
    addUserMsg(q);
    history.push({ role: 'user', text: q });
    var typing = addTyping();
    var sendBtn = panel.querySelector('#mds-send');
    sendBtn.disabled = true;

    fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + ANON_KEY,
        'apikey': ANON_KEY
      },
      body: JSON.stringify({ question: q, history: history.slice(-8) })
    })
    .then(function(r){ return r.json().then(function(j){ return { status: r.status, body: j }; }); })
    .then(function(res){
      typing.remove();
      sendBtn.disabled = false;
      if (res.status === 200 && res.body.ok) {
        addBotMsg(res.body.answer);
        history.push({ role: 'assistant', text: res.body.answer });
      } else {
        var msg = (res.body && res.body.error) || 'Something went wrong. Please try again, or email contact@mdscholars.com.';
        addBotMsg(msg);
      }
    })
    .catch(function(err){
      typing.remove();
      sendBtn.disabled = false;
      addBotMsg('Network issue — please check your connection or email contact@mdscholars.com.');
    });
  }
})();
