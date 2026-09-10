// Token公益站 — Frontend Application
// Enterprise-grade, component-driven, page-aware

(function() {
  'use strict';

  var API = '/api';
  var token = localStorage.getItem('token');
  var user = null;
  try {
    user = JSON.parse(localStorage.getItem('user') || 'null');
  } catch (_) {
    // 残缺 JSON 会让整个 IIFE 崩掉（主题/弹窗/搜索全失效）——清掉坏值按未登录处理
    try { localStorage.removeItem('user'); } catch (_) {}
  }

  // ============================================================
  // Utilities
  // ============================================================
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 分享链接统一用 SEO 主域（读本页 canonical，保证外链权重向主域集中，而非散到两个域名）
  function canonicalBase() {
    try {
      var l = document.querySelector('link[rel="canonical"]');
      if (l && l.href) return l.href.replace(/\/+$/, '').split('/').slice(0, 3).join('/');
    } catch (_) {}
    return location.origin;
  }
  function badgeClass(t) {
    t = (t || '').toLowerCase();
    if (t.indexOf('openai') !== -1 || t.indexOf('gpt') !== -1) return 'badge--openai';
    if (t.indexOf('anthropic') !== -1 || t.indexOf('claude') !== -1) return 'badge--anthropic';
    if (t.indexOf('gemini') !== -1 || t.indexOf('google') !== -1) return 'badge--gemini';
    if (t.indexOf('deepseek') !== -1) return 'badge--deepseek';
    if (t.indexOf('qwen') !== -1 || t.indexOf('通义') !== -1) return 'badge--qwen';
    return 'badge--other';
  }
  // Lucide icon — references the sprite inlined in the same document.
  function svgIcon(name, extraClass) {
    return '<svg class="ic' + (extraClass ? ' ' + extraClass : '') + '" aria-hidden="true" focusable="false"><use href="#lucide-' + name + '"/></svg>';
  }
  // 小圆头像：有图出图、无图回退首字母；img 带 data-letter 供加载失败时回退（不留破图）
  function miniAvatar(avatar, name) {
    var letter = String(name || '?').charAt(0).toUpperCase();
    if (avatar) return '<span class="mini-avatar"><img src="' + esc(avatar) + '" alt="" data-letter="' + esc(letter) + '"></span>';
    return '<span class="mini-avatar mini-avatar--letter">' + esc(letter) + '</span>';
  }
  // 头像图加载失败（已换头像/已删除但 URL 还在 API 或 Nginx 缓存窗口内）→ 原地回退字母
  function fallbackAvatar(img) {
    var host = img.closest && img.closest('.mini-avatar');
    if (!host) return;
    host.classList.add('mini-avatar--letter');
    host.textContent = img.getAttribute('data-letter') || '?';
  }
  document.addEventListener('error', function(e) {
    if (e.target && e.target.tagName === 'IMG') fallbackAvatar(e.target);
  }, true);
  // SSR 直出的头像若在 app.js 执行前就已 404（error 事件错过），初始化补扫一次
  function sweepBrokenAvatars() {
    document.querySelectorAll('.mini-avatar img').forEach(function(img) {
      if (img.complete && img.naturalWidth === 0) fallbackAvatar(img);
    });
  }
  sweepBrokenAvatars();
  window.addEventListener('load', function() { setTimeout(sweepBrokenAvatars, 0); });
  // 展示名：优先昵称，为空回退账号
  function displayName(u) {
    return (u && (u.nickname || u.username)) || (u ? u.username : '');
  }
  // Token 脱敏：仅展示首尾，复制才拿到真实值
  function maskToken(t) {
    t = String(t || '');
    if (!t) return '';
    if (t.length <= 10) return '••••••••';
    return t.slice(0, 4) + '••••••••' + t.slice(-4);
  }
  // Category → icon name for card iconography
  function categoryIcon(category, provider) {
    var c = (category || '') + ' ' + (provider || '');
    c = c.toLowerCase();
    if (c.indexOf('对话') !== -1 || c.indexOf('chat') !== -1) return 'message-square';
    if (c.indexOf('图像') !== -1 || c.indexOf('image') !== -1 || c.indexOf('画图') !== -1) return 'image';
    if (c.indexOf('视频') !== -1 || c.indexOf('video') !== -1) return 'video';
    if (c.indexOf('编程') !== -1 || c.indexOf('code') !== -1) return 'code';
    if (c.indexOf('聚合') !== -1 || c.indexOf('平台') !== -1) return 'layers';
    if (c.indexOf('openai') !== -1 || c.indexOf('gpt') !== -1) return 'sparkles';
    if (c.indexOf('anthropic') !== -1 || c.indexOf('claude') !== -1) return 'brain';
    if (c.indexOf('gemini') !== -1 || c.indexOf('google') !== -1) return 'sparkles';
    if (c.indexOf('deepseek') !== -1) return 'bot';
    if (c.indexOf('qwen') !== -1 || c.indexOf('通义') !== -1) return 'cloud';
    return 'box';
  }
  function headers() {
    var h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }
  function api(method, path, body, contentType) {
    var headersObj = headers();
    var bodyPayload;
    if (body == null) {
      bodyPayload = undefined;
    } else if (typeof Blob !== 'undefined' && (body instanceof Blob || body instanceof File)) {
      bodyPayload = body;
      if (contentType) headersObj['Content-Type'] = contentType;
    } else {
      bodyPayload = JSON.stringify(body);
      headersObj['Content-Type'] = 'application/json';
    }
    return fetch(API + path, { method: method, headers: headersObj, body: bodyPayload });
  }
  function showToast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function() { t.classList.add('toast--show'); });
    setTimeout(function() {
      t.classList.remove('toast--show');
      setTimeout(function() { t.remove(); }, 300);
    }, 1800);
  }
  function copyText(text, msg) {
    if (!text) return;
    var done = function() { showToast(msg || '已复制'); };
    navigator.clipboard.writeText(text).then(done).catch(function() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (_) { showToast('复制失败'); }
      document.body.removeChild(ta);
    });
  }

  // ============================================================
  // Auth
  // ============================================================
  function updateAuthUI() {
    var authBtn = document.getElementById('authBtn');
    var userMenu = document.getElementById('userMenu');
    var adminMenuLink = document.getElementById('adminMenuLink');
    var userMenuName = document.getElementById('userMenuName');
    var userMenuAvatar = document.getElementById('userMenuAvatar');
    var loginBtn = document.getElementById('headerLoginBtn');
    if (!authBtn || !userMenu) return;
    if (user) {
      authBtn.style.display = 'inline-flex';
      if (loginBtn) loginBtn.style.display = 'none';
      userMenu.style.display = 'inline-flex';
      if (userMenuName) userMenuName.textContent = displayName(user);
      // 头像：上传过用图片，否则昵称/账号首字母（与个人主页回退一致）
      if (userMenuAvatar) {
        userMenuAvatar.innerHTML = user.avatar
          ? '<img src="' + esc(user.avatar) + '" alt="我的头像">'
          : esc(displayName(user).charAt(0).toUpperCase() || '?');
      }
      var isAdminRole = (user.role === 'admin' || user.role === 'moderator');
      // 用空串移除内联覆盖，让 .user-menu__item 的 display:flex 生效（保持图标/文字对齐）
      if (adminMenuLink) adminMenuLink.style.display = isAdminRole ? '' : 'none';
    } else {
      authBtn.style.display = 'none';
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      userMenu.style.display = 'none';
      if (adminMenuLink) adminMenuLink.style.display = 'none';
    }
    refreshAdminBadge();
  }

  // Refresh user profile (role) from server on load
  async function refreshUserProfile() {
    if (!token) return;
    try {
      var res = await api('GET', '/auth/me');
      if (res.status === 401) {
        // token 已失效（过期/密码变更吊销）：清登录态回未登录 UI，避免后续操作反复 401
        try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch (_) {}
        token = null; user = null;
        updateAuthUI();
        return;
      }
      if (!res.ok) return;
      var data = await res.json();
      if (data.user) {
        user = data.user;
        localStorage.setItem('user', JSON.stringify(user));
        updateAuthUI();
      }
    } catch (e) { /* keep local user */ }
  }

  // 「管理后台」入口角标：待审核条目 + 教程总数（仅 staff，登录/加载 + 60s 轮询刷新）
  function setAdminBadge(n) {
    var el = document.getElementById('adminMenuBadge');
    if (!el) return;
    n = Number(n) || 0;
    el.textContent = n > 99 ? '99+' : n;
    el.style.display = n > 0 ? '' : 'none';
  }
  function refreshAdminBadge() {
    var isStaff = user && (user.role === 'admin' || user.role === 'moderator');
    if (!isStaff || !token) { setAdminBadge(0); return; }
    try {
      api('GET', '/admin/review-counts').then(async function (res) {
        if (!res.ok) return;
        var d = await res.json();
        setAdminBadge((d.pendingItems || 0) + (d.pendingTutorials || 0));
      }).catch(function () {});
    } catch (_) {}
  }

  var authModal = document.getElementById('authModal');
  var authView = document.getElementById('authView');
  function openAuth(view) {
    if (!authModal || !authView) return;
    authView.innerHTML = view === 'register' ? renderRegister() : (view === 'recover' ? renderRecover() : renderLogin());
    authModal.classList.add('modal--open');
    setTimeout(function() {
      var firstInput = authView.querySelector('input');
      if (firstInput) firstInput.focus();
    }, 100);
  }
  function closeAuth() { if (authModal) authModal.classList.remove('modal--open'); }
  function renderLogin() {
    return '<h2 class="modal__title">' + svgIcon('log-in') + ' 登录</h2>' +
      '<div class="form-group"><label>用户名</label><input class="input" id="loginUser" placeholder="输入用户名" autocomplete="username"></div>' +
      '<div class="form-group"><label>密码</label><input class="input" type="password" id="loginPass" placeholder="输入密码" autocomplete="current-password"></div>' +
      '<button class="btn btn--primary btn--full" id="loginBtn">登录</button>' +
      '<p class="auth-switch">还没有账号？<a href="#" id="switchToRegister">立即注册</a></p>' +
      '<p class="auth-switch">忘记密码？<a href="#" id="switchToRecover">用邮箱/手机号找回</a></p>';
  }
  function renderRegister() {
    return '<h2 class="modal__title">' + svgIcon('user-plus') + ' 注册</h2>' +
      '<div class="form-group"><label>用户名</label><input class="input" id="regUser" placeholder="2-20个字符" autocomplete="username"></div>' +
      '<div class="form-group"><label>密码</label><input class="input" type="password" id="regPass" placeholder="至少8位，含字母和数字" autocomplete="new-password"></div>' +
      '<div class="form-group"><label>邀请码</label><input class="input" id="regInvite" placeholder="入群后向管理员索取" autocomplete="off"></div>' +
      '<p class="auth-hint">' + svgIcon('key-round') + ' 需邀请码注册，<a href="#" class="auth-hint-link" id="wechatInviteLink">添加微信 → 进群 → 群公告取码</a></p>' +
      '<div class="form-group"><label>邮箱</label><input class="input" id="regEmail" type="email" placeholder="选填，忘记密码时找回用" autocomplete="email"></div>' +
      '<div class="form-group"><label>手机号</label><input class="input" id="regPhone" placeholder="选填，忘记密码时找回用" autocomplete="tel"></div>' +
      '<button class="btn btn--primary btn--full" id="registerBtn">注册并登录</button>' +
      '<p class="auth-switch">已有账号？<a href="#" id="switchToLogin">去登录</a></p>';
  }
  function renderRecover() {
    // 若 URL 带 token → 直接展示重置表单，否则展示“发邮箱链接”表单
    var qs = new URLSearchParams(location.search);
    var rt = qs.get('token');
    if (rt) {
      return '<h2 class="modal__title">' + svgIcon('key-round') + ' 重置密码</h2>' +
        '<p class="auth-hint">链接 30 分钟有效，单次使用。</p>' +
        '<div class="form-group"><label>新密码</label><input class="input" type="password" id="resetPass" placeholder="至少8位，含字母和数字" autocomplete="new-password"></div>' +
        '<div class="form-group"><label>确认新密码</label><input class="input" type="password" id="resetPass2" placeholder="再次输入" autocomplete="new-password"></div>' +
        '<button class="btn btn--primary btn--full" id="doResetBtn" data-token="' + esc(rt) + '">确认重置</button>' +
        '<p class="auth-switch"><a href="#" id="switchToLogin">去登录</a></p>';
    }
    return '<h2 class="modal__title">' + svgIcon('mail') + ' 邮箱找回</h2>' +
      '<p class="auth-hint">输入用户名与注册邮箱，系统将向该邮箱发送 30 分钟有效的重置链接。</p>' +
      '<div class="form-group"><label>用户名</label><input class="input" id="forgotUser" placeholder="输入用户名" autocomplete="username"></div>' +
      '<div class="form-group"><label>注册邮箱</label><input class="input" id="forgotEmail" type="email" placeholder="注册时绑定的邮箱" autocomplete="email"></div>' +
      '<button class="btn btn--primary btn--full" id="forgotBtn">发送重置邮件</button>' +
      '<p class="auth-hint" style="margin-top:10px">没绑邮箱？先用手机号找回：</p>' +
      '<div class="form-group"><label>手机号</label><input class="input" id="recPhone" placeholder="注册时填的手机号" autocomplete="tel"></div>' +
      '<div class="form-group"><label>新密码（备用通道）</label><input class="input" type="password" id="recPass" placeholder="至少8位，含字母和数字"></div>' +
      '<div class="form-group"><label>确认</label><input class="input" type="password" id="recPass2" placeholder="再次输入"></div>' +
      '<button class="btn btn--ghost btn--full" id="recoverBtn">用手机号直接重置</button>' +
      '<p class="auth-switch">想起来了？<a href="#" id="switchToLogin">去登录</a></p>';
  }

  if (authView) {
    authView.addEventListener('click', async function(e) {
      if (e.target.id === 'switchToRegister') { e.preventDefault(); openAuth('register'); return; }
      if (e.target.id === 'switchToLogin') { e.preventDefault(); openAuth('login'); return; }
      if (e.target.id === 'switchToRecover') { e.preventDefault(); openAuth('recover'); return; }
      if (e.target.id === 'wechatInviteLink') { e.preventDefault(); openWechat(); return; }
      if (e.target.id === 'loginBtn') {
        var username = document.getElementById('loginUser')?.value.trim();
        var password = document.getElementById('loginPass')?.value;
        if (!username || !password) { showToast('请填写完整'); return; }
        try {
          var res = await api('POST', '/auth/login', { username: username, password: password });
          var data = await res.json();
          if (!res.ok) { showToast(data.error || '登录失败'); return; }
          token = data.token; user = data.user;
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(user));
          updateAuthUI(); closeAuth(); showToast('登录成功');
          window.dispatchEvent(new CustomEvent('auth-changed'));
        } catch (err) { showToast('登录失败'); }
      }
      if (e.target.id === 'registerBtn') {
        var rUsername = document.getElementById('regUser')?.value.trim();
        var rPassword = document.getElementById('regPass')?.value;
        var rInvite = document.getElementById('regInvite')?.value.trim();
        var rEmail = document.getElementById('regEmail')?.value.trim();
        var rPhone = document.getElementById('regPhone')?.value.trim();
        if (!rUsername || !rPassword) { showToast('请填写完整'); return; }
        if (rUsername.length < 2) { showToast('用户名至少2个字符'); return; }
        if (rPassword.length < 8) { showToast('密码至少8个字符'); return; }
        if (!/[A-Za-z]/.test(rPassword) || !/\d/.test(rPassword)) { showToast('密码需同时包含字母和数字'); return; }
        if (!rInvite) { showToast('请填写邀请码'); return; }
        try {
          var rRes = await api('POST', '/auth/register', { username: rUsername, password: rPassword, email: rEmail, phone: rPhone, inviteCode: rInvite });
          var rData = await rRes.json();
          if (!rRes.ok) { showToast(rData.error || '注册失败'); return; }
          token = rData.token; user = rData.user;
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(user));
          updateAuthUI(); closeAuth(); showToast('注册成功');
          window.dispatchEvent(new CustomEvent('auth-changed'));
        } catch (err) { showToast('注册失败'); }
      }
      // 邮箱发送重置链接
      if (e.target.id === 'forgotBtn') {
        var fUser = document.getElementById('forgotUser')?.value.trim();
        var fEmail = document.getElementById('forgotEmail')?.value.trim();
        if (!fUser || !fEmail) { showToast('请填写用户名与邮箱'); return; }
        e.target.disabled = true; e.target.textContent = '发送中...';
        try {
          var fr = await api('POST', '/auth/forgot', { username: fUser, email: fEmail });
          var fd = await fr.json();
          showToast(fd.error ? fd.error : (fd.message || '已发送，请查收邮箱'));
        } catch (err) { showToast('发送失败'); }
        e.target.disabled = false; e.target.textContent = '发送重置邮件';
        return;
      }
      if (e.target.id === 'doResetBtn') {
        var tok = e.target.getAttribute('data-token');
        var p1 = document.getElementById('resetPass')?.value;
        var p2 = document.getElementById('resetPass2')?.value;
        if (!p1 || p1.length < 8) { showToast('新密码至少8个字符'); return; }
        if (!/[A-Za-z]/.test(p1) || !/\d/.test(p1)) { showToast('新密码需同时包含字母和数字'); return; }
        if (p1 !== p2) { showToast('两次输入不一致'); return; }
        try {
          var rr = await api('POST', '/auth/reset', { token: tok, password: p1 });
          var rd = await rr.json();
          if (!rr.ok) { showToast(rd.error || '重置失败'); return; }
          showToast('重置成功，请用新密码登录'); history.replaceState(null, '', location.pathname); openAuth('login');
        } catch (err) { showToast('重置失败'); }
        return;
      }
      if (e.target.id === 'recoverBtn') {
        var rUser = document.getElementById('recPhone')?.value.trim() ? document.getElementById('recUser')?.value.trim() || document.getElementById('forgotUser')?.value.trim() : document.getElementById('recUser')?.value.trim() || document.getElementById('forgotUser')?.value.trim();
        // 兼容旧布局：优先取 recUser，否则 forgotUser
        rUser = rUser || document.getElementById('recUser')?.value.trim() || document.getElementById('forgotUser')?.value.trim();
        var rEmail = '';
        var rPhone = document.getElementById('recPhone')?.value.trim();
        var rPass = document.getElementById('recPass')?.value;
        var rPass2 = document.getElementById('recPass2')?.value;
        if (!rUser) { showToast('请填写用户名'); return; }
        if (!rPhone) { showToast('请填写手机号（邮箱请用上方发送链接）'); return; }
        if (!rPass || rPass.length < 8) { showToast('新密码至少8个字符'); return; }
        if (!/[A-Za-z]/.test(rPass) || !/\d/.test(rPass)) { showToast('新密码需同时包含字母和数字'); return; }
        if (rPass !== rPass2) { showToast('两次输入的密码不一致'); return; }
        try {
          var rR = await api('POST', '/auth/recovery', { username: rUser, email: rEmail, phone: rPhone, password: rPass });
          var rD = await rR.json();
          if (!rR.ok) { showToast(rD.error || '重置失败'); return; }
          showToast('密码已重置，请用新密码登录'); openAuth('login');
        } catch (err) { showToast('重置失败'); }
      }
    });
  }

  // 邮箱重置链接直达：/reset?token=xxx 自动弹重置表单
  (function(){
    try {
      var qs = new URLSearchParams(location.search);
      var t = qs.get('token');
      if (location.pathname === '/reset' && t) {
        setTimeout(function(){ openAuth('recover'); }, 400);
      }
    } catch(e){}
  })();

  // ============================================================
  // Publish Modal
  // ============================================================
  var publishModal = document.getElementById('publishModal');
  var publishView = document.getElementById('publishView');
  function openPublish() {
    if (!publishModal || !publishView) return;
    if (!user) { showToast('请先登录'); openAuth('login'); return; }
    publishView.innerHTML = renderPublishForm();
    var pTokenInput = document.getElementById('pToken');
    if (pTokenInput) pTokenInput.addEventListener('input', syncPublishUrlLabel);
    // 一键粘贴填充：粘进框里立即解析填表（无需点按钮，最短路径）
    var smartBox = document.getElementById('pSmartPaste');
    if (smartBox) smartBox.addEventListener('paste', function() {
      setTimeout(applySmartPaste, 0); // 等 paste 事件把文本写进 textarea 后再取值
    });
    syncPublishUrlLabel();
    publishModal.classList.add('modal--open');
  }
  function closePublish() { if (publishModal) publishModal.classList.remove('modal--open'); }
  // 与 CLI add 对齐：本站只收录真实可用 Token，链接字段语义恒为 API Base URL（厂商端点）
  function syncPublishUrlLabel() {
    var url = document.getElementById('pUrl');
    if (url) url.placeholder = 'https://x-api.cfd/v1';
  }
  function renderPublishForm() {
    return '<h2 class="modal__title">' + svgIcon('gift') + ' 发布公益 Token</h2>' +
      // 智能粘贴：最快路径，放最顶并做成醒目卡片
      '<div class="pub-paste">' +
        '<div class="pub-paste__head">' + svgIcon('copy') + '<b>一键粘贴填充</b><span class="pub-paste__tag">最快方式</span></div>' +
        '<textarea class="input pub-paste__area" id="pSmartPaste" rows="3" placeholder="把整段配置直接粘到这里，自动识别填充&#10;支持：本站「复制完整配置」格式 / OPENAI_BASE_URL=... / 裸 URL + sk-xxx 混合文本"></textarea>' +
        '<div class="pub-paste__note">粘贴后自动填好下方必填项（地址 / API Key / 类型），名称和厂商仍需手填</div>' +
      '</div>' +
      '<div class="pub-section"><div class="pub-section__title">' + svgIcon('key-round') + ' 必填信息</div>' +
      '<div class="form-group is-required"><label>名称</label><input class="input" id="pName" placeholder="如：DeepSeek 免费额度"></div>' +
      '<div class="form-row"><div class="form-group is-required"><label>厂商</label><input class="input" id="pProvider" placeholder="如：DeepSeek"></div>' +
      '<div class="form-group"><label>分类</label><select class="input" id="pCategory"><option>对话模型</option><option>图像生成</option><option>视频工具</option><option>编程工具</option><option>聚合平台</option><option>其他</option></select></div></div>' +
      '<div class="form-group is-required"><label>base_url（API 地址）</label><input class="input input--mono" id="pUrl" placeholder="https://x-api.cfd/v1"></div>' +
      '<div class="form-group is-required"><label>API_KEY（Token 值）</label><input class="input input--mono" id="pToken" placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></div>' +
      '<div class="form-note" id="pTokenNote">本站只收录真实可用 Token：上面的 base_url 需填 <b>API Base URL</b>（如 <code>https://x-api.cfd/v1</code>）。发布时会先做有效性测试并自动检测 OpenAI/Anthropic 兼容模式，测试不通过将拒绝发布。</div>' +
      '</div>' +
      '<div class="pub-section pub-section--optional"><div class="pub-section__title">' + svgIcon('settings') + ' 选填信息</div>' +
      '<div class="form-group"><label>描述</label><textarea class="input" id="pDesc" rows="2" placeholder="简单描述这个 Token 的用途和额度"></textarea></div>' +
      '<div class="form-row"><div class="form-group"><label>Token 类型</label><select class="input" id="pTokenType"><option value="">不标注</option><option>OpenAI</option><option>OpenAI兼容</option><option>Anthropic</option><option>Gemini</option></select></div>' +
      '<div class="form-group"><label>标签</label><input class="input" id="pTags" placeholder="逗号分隔，如: 免费,国产"></div></div>' +
      '</div>' +
      '<div class="form-actions"><button class="btn btn--primary btn--lg pub-submit" id="submitPublish">' + svgIcon('send') + ' 发布公益 Token</button></div>';
  }
  // 一键粘贴智能填充：从整段配置文本里解析 base_url / API Key / 模型 / 类型
  // 兼容格式：本站「复制完整配置」块（Base URL:/API Key:/模型:/类型: 行）、
  // env 风格（OPENAI_BASE_URL=/ANTHROPIC_AUTH_TOKEN=/GEMINI_API_KEY=...）、裸 URL + sk-xxx 混合文本
  function smartParseConfig(text) {
    var out = { url: '', token: '', model: '', tokenType: '' };
    if (!text) return out;
    var t = String(text).trim();
    // 1) env 风格 KEY=VALUE（每行）
    var envMap = {};
    t.split(/\r?\n/).forEach(function(line) {
      var m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(\S+)\s*$/.exec(line);
      if (m) envMap[m[1]] = m[2];
    });
    if (envMap.OPENAI_BASE_URL) { out.url = envMap.OPENAI_BASE_URL; out.tokenType = out.tokenType || 'OpenAI兼容'; }
    if (envMap.ANTHROPIC_BASE_URL) { out.url = out.url || envMap.ANTHROPIC_BASE_URL; out.tokenType = out.tokenType || 'Anthropic'; }
    if (envMap.OPENAI_API_KEY) { out.token = envMap.OPENAI_API_KEY; out.tokenType = out.tokenType || 'OpenAI兼容'; }
    if (envMap.ANTHROPIC_AUTH_TOKEN || envMap.ANTHROPIC_API_KEY) { out.token = out.token || envMap.ANTHROPIC_AUTH_TOKEN || envMap.ANTHROPIC_API_KEY; out.tokenType = out.tokenType || 'Anthropic'; }
    if (envMap.GEMINI_API_KEY) { out.token = out.token || envMap.GEMINI_API_KEY; out.tokenType = out.tokenType || 'Gemini'; }
    if (envMap.OPENAI_MODEL || envMap.ANTHROPIC_MODEL || envMap.GEMINI_MODEL) out.model = envMap.OPENAI_MODEL || envMap.ANTHROPIC_MODEL || envMap.GEMINI_MODEL;
    // 2) 本站「复制完整配置」行式（Base URL: xxx / API Key: xxx / 模型: xxx / 类型: xxx）
    var line = function(label) {
      var m = new RegExp('^\\s*' + label + '\\s*[:：]\\s*(.+?)\\s*$', 'm').exec(t);
      return m ? m[1] : '';
    };
    if (!out.url) out.url = line('Base URL') || line('base_url');
    if (!out.token) out.token = line('API Key') || line('API_KEY') || line('Token');
    if (!out.model) out.model = line('模型') || line('Model');
    if (!out.tokenType) {
      var tt = line('类型') || line('Type');
      if (/anthropic/i.test(tt)) out.tokenType = 'Anthropic';
      else if (/gemini/i.test(tt)) out.tokenType = 'Gemini';
      else if (/openai/i.test(tt)) out.tokenType = 'OpenAI兼容';
    }
    // 3) 兜底：裸 URL 与 sk-xxx / ghp_ / AIza 等常见 Key 前缀
    if (!out.url) {
      var um = t.match(/https?:\/\/[^\s"'<>]+/);
      if (um) out.url = um[0];
    }
    if (!out.token) {
      var km = t.match(/\b(sk-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_\-]{20,}|[A-Za-z0-9_\-]{32,})\b/);
      if (km) out.token = km[1];
    }
    // URL 尾部清理：本站配置块可能带尾随标点
    out.url = out.url.replace(/[，。；、,;]+$/, '');
    return out;
  }
  function applySmartPaste() {
    var box = document.getElementById('pSmartPaste');
    if (!box) return;
    var parsed = smartParseConfig(box.value);
    var filled = [];
    if (parsed.url) { var u = document.getElementById('pUrl'); if (u && !u.value) { u.value = parsed.url; filled.push('地址'); } }
    if (parsed.token) { var k = document.getElementById('pToken'); if (k && !k.value) { k.value = parsed.token; filled.push('API Key'); } }
    if (parsed.tokenType) { var s = document.getElementById('pTokenType'); if (s) { s.value = parsed.tokenType; filled.push('类型'); } }
    if (filled.length) {
      showToast('已自动填充：' + filled.join('、'));
      box.value = '';
    } else {
      showToast('没识别出可填充的字段，请检查粘贴内容');
    }
  }
  if (publishView) {
    publishView.addEventListener('click', async function(e) {
      if (e.target.closest('#submitPublish')) {
        var name = document.getElementById('pName').value.trim();
        var url = document.getElementById('pUrl').value.trim();
        var tokenVal = document.getElementById('pToken').value.trim();
        if (!name || !url || !tokenVal) { showToast('名称、API Base URL 和 Token 必填'); return; }
        try { new URL(url); } catch (_) { showToast('链接格式无效'); return; }
        var body = {
          name: name, desc: document.getElementById('pDesc').value.trim(),
          provider: document.getElementById('pProvider').value.trim(),
          category: document.getElementById('pCategory').value, url: url,
          token: tokenVal,
          tokenType: document.getElementById('pTokenType').value,
          tags: document.getElementById('pTags').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
        };
        try {
          var res = await api('POST', '/items', body);
          var data = await res.json();
          if (!res.ok) { showToast(data.error); return; }
          showToast('发布成功，已自动上线');
          closePublish();
          // SSE 通常会静默插入新卡片；但 EventSource 不可用/已断线时兜底刷新列表与侧栏
          if (typeof fetchPage === 'function') { fetchPage(true); loadSidebar(); }
        } catch (err) { showToast('发布失败'); }
      }
    });
  }

  // ============================================================
  // Wechat Modal
  // ============================================================
  var wechatModal = document.getElementById('wechatModal');
  function openWechat() {
    if (!wechatModal) return;
    wechatModal.classList.add('modal--open');
    loadQR();
  }
  function closeWechat() { if (wechatModal) wechatModal.classList.remove('modal--open'); }
  function loadQR() {
    var c = document.getElementById('wechatQrContainer');
    if (!c || c.querySelector('img')) return;
    c.innerHTML = '<img src="/wechat-group.jpg?v=1" alt="微信群二维码">';
  }

  // ============================================================
  // Detail Modal (global scope for ESC handler)
  // ============================================================
  var detailModal = document.getElementById('modal');
  var detailContent = document.getElementById('modalContent');
  // 详情弹窗请求竞态守卫：每次打开/关闭自增；迟到的旧响应（seq 落后）直接丢弃，
  // 防「看着 B 弹窗突然被迟到的 A 响应覆盖」
  var detailSeq = 0;
  function closeDetail() { detailSeq++; if (detailModal) detailModal.classList.remove('modal--open'); }

  // 完整榜单/全部动态弹窗（首页侧栏"查看完整"共用）
  var listModal = document.getElementById('listModal');
  function closeList() { if (listModal) listModal.classList.remove('modal--open'); }

  // ============================================================
  // Detail Modal 簇（IIFE 顶层，全站可用：首页卡片 / ?id= 深链 / 个人主页贡献
  // 卡片共用，与首页 init 解耦——个人主页点 Token 卡片原地开弹窗，不跳首页）
  // ============================================================
async function openDetail(id) {
  if (!detailModal || !detailContent) return;
  var seq = ++detailSeq;
  detailContent.innerHTML = '<div class="modal__loading"><div class="spinner"></div></div>';
  detailModal.classList.add('modal--open');
  try {
    var res = await api('GET', '/items/' + encodeURIComponent(id));
    if (!res.ok) {
      if (seq !== detailSeq) return;
      if (res.status === 402) {
        var errData = {};
        try { errData = await res.json(); } catch (_) {}
        detailContent.innerHTML = '<div class="empty"><p>' + esc(errData.error || '积分不足，需发布赚分') + '</p><p class="muted" style="margin-top:10px">新用户初始5积分，首次查看每张卡片扣1（已看过的免费）；发布 Token/教程/Skill、邀请、测评可赚分，CLI拉取另计</p><button class="btn btn--primary" data-action="open-publish" style="margin-top:14px">' + svgIcon('gift') + ' 去发布赚积分</button><button class="btn btn--ghost" data-action="close-modal" style="margin-top:10px;margin-left:8px">关闭</button></div>';
        var pubBtn = detailContent.querySelector('[data-action="open-publish"]');
        if (pubBtn) pubBtn.addEventListener('click', function(){ closeDetail(); setTimeout(openPublish, 200); });
        return;
      }
      detailContent.innerHTML = '<div class="empty"><p>加载失败</p></div>';
      return;
    }
    var i = await res.json();
    if (seq !== detailSeq) return; // 已打开别的条目/已关闭，丢弃迟到响应
    // 查看扣费成功后刷新本地积分（查看按卡去重，首次扣1）
    if (user) { api('GET', '/points').then(function(r){ return r.json(); }).then(function(d){ if(d && typeof d.points==='number'){ user.points=d.points; try{localStorage.setItem('user', JSON.stringify(user));}catch(_){} updateAuthUI(); } }).catch(function(){}); }
    var tagsHtml = '';
    if (i.tags && i.tags.length) {
      for (var t = 0; t < i.tags.length; t++) tagsHtml += '<span class="tag">#' + esc(i.tags[t]) + '</span>';
    }
    var tokenHtml = '';
    if (i.tokenLocked) {
      tokenHtml = '<div class="modal__section"><div class="modal__label">API Key</div>' +
        '<div class="token-lock">' + svgIcon('lock') + '<span><button class="token-lock__login" id="tokenLoginLink">登录</button>后可查看 Base URL、API Key 与可用模型</span></div></div>';
    } else if (i.token) {
      // 发布时探测到的可用模型：登录后直接展示；每个模型可独立「测试」发真实调用验证
      var storedChips = renderModelRows(i.models || []);
      tokenHtml = '<div class="modal__section"><div class="modal__label">API Key</div>' +
        '<div class="token-box"><code class="token-masked copy-btn" data-token="' + esc(i.token) + '" title="点击复制真实 Token">' + esc(maskToken(i.token)) + '</code></div>' +
        '<div class="token-mask-hint">' + svgIcon('lock') + ' 已脱敏展示，复制或点击上方获取真实值</div>' +
        '<div class="modal__btn-row">' +
          '<button class="btn btn--sm" data-action="copyfull" data-url="' + esc(i.url || '') + '" data-token="' + esc(i.token) + '" data-compat="' + esc((i.compat || []).join(',')) + '" data-tokentype="' + esc(i.tokenType || '') + '" data-model="' + esc(i.models && i.models.length ? i.models[0] : '') + '" title="复制完整配置（Base URL + API Key + 模型，OpenAI/Anthropic 格式）">' + svgIcon('copy') + ' 复制完整配置</button>' +
          '<button class="btn btn--sm cc-switch-btn" data-action="ccswitch" data-name="' + esc(i.name) + '" data-url="' + esc(i.url || '') + '" data-token="' + esc(i.token) + '" data-compat="' + esc((i.compat || []).join(',')) + '" data-tokentype="' + esc(i.tokenType || '') + '" data-model="' + esc(i.models && i.models.length ? i.models[0] : '') + '" title="一键导入到 CC Switch（Claude Code / Codex / Gemini 等工具）">' + svgIcon('download') + ' 导入 CC Switch</button>' +
          '<button class="cc-help-btn" data-action="cchelp" title="导入说明与自检" aria-label="导入说明">' + svgIcon('help-circle') + '</button>' +
        '</div>' +
        '<div id="ccPicker" class="cc-picker" style="display:none"></div>' +
        '<div id="ccFallback" class="cc-fallback" style="display:none"></div>' +
        '<div id="ccHelp" class="cc-help" style="display:none"></div>' +
        '<div id="modelList" class="modal__tags model-list" data-token="' + esc(i.token) + '" data-type="' + esc(i.tokenType || 'OpenAI') + '" data-url="' + esc(i.url || '') + '">' + (storedChips || '<span class="model-list-label">暂无可用模型</span>') + '</div></div>';
    }
    // Base URL：含 API Key 的条目未登录时同样锁定（视觉一致，避免误以为 BaseURL 缺失）
    var baseUrlHtml = '';
    if (i.urlLocked) {
      baseUrlHtml = '<div class="modal__section"><div class="modal__label">Base URL</div>' +
        '<div class="token-lock">' + svgIcon('lock') + '<span>登录后可查看 Base URL</span></div></div>';
    } else if (i.token && i.url) {
      baseUrlHtml = '<div class="modal__section"><div class="modal__label">Base URL</div>' +
        '<div class="token-box"><code class="token-masked copy-btn" data-copy="' + esc(i.url) + '" title="点击复制 Base URL">' + esc(i.url) + '</code></div></div>';
    }
    var compatBadges = '';
    if (i.compat && i.compat.length) {
      if (i.compat.indexOf('openai') !== -1) compatBadges += '<span class="badge badge--openai">OpenAI 兼容</span>';
      if (i.compat.indexOf('anthropic') !== -1) compatBadges += '<span class="badge badge--anthropic">Anthropic 兼容</span>';
    }
    // 打赏区：本人看被认可数；未登录显示按钮（点击引导登录）；登录 + 非本人 + 未打赏可点
    var tipHtml = '';
    if (i.createdBy && user && user.id === i.createdBy) {
      tipHtml = '<div class="modal__tip"><span class="tip-done">' + svgIcon('gem') + ' 被认可 ' + (i.tipCount || 0) + ' 次</span></div>';
    } else if (i.createdBy && user && i.tipped) {
      tipHtml = '<div class="modal__tip"><span class="tip-done">' + svgIcon('gem') + ' 已打赏 · 被认可 ' + (i.tipCount || 0) + ' 次</span></div>';
    } else if (i.createdBy) {
      tipHtml = '<div class="modal__tip"><button class="btn btn--sm btn--ghost" id="tipBtn" data-item="' + esc(i.id) + '" data-count="' + (i.tipCount || 0) + '">' + svgIcon('gem') + ' 打赏 1 积分</button></div>';
    }
    detailContent.innerHTML =
      '<button class="modal__x" data-action="close-modal" aria-label="关闭">' + svgIcon('x') + '</button>' +
      '<h2 class="modal__title">' + esc(i.name) + '</h2>' +
      '<button class="modal__share" data-share data-share-url="' + esc(canonicalBase() + '/item/' + i.id) + '" data-share-title="' + esc(i.name) + '" data-share-text="' + esc((i.desc || i.provider || '') + ' — free-tokens Token公益站') + '" title="分享" aria-label="分享">' + svgIcon('share-2') + '<span>分享</span></button>' +
      '<div class="modal__meta">' +
        (i.provider ? svgIcon('server') + ' ' + esc(i.provider) : '') +
        (i.provider && i.category ? ' · ' : '') +
        (i.category ? esc(i.category) : '') +
        (i.createdBy ? ' · ' + svgIcon('user') + ' <a class="user-link" href="/user/' + esc(i.createdBy) + '">' + esc(i.authorName || i.createdBy) + '</a>' : '') +
      '</div>' +
      ((i.tokenType || compatBadges) ? '<div class="modal__badges">' + (i.tokenType ? '<span class="badge ' + badgeClass(i.tokenType) + '">' + esc(i.tokenType) + '</span>' : '') + compatBadges + (i.verified ? '<span class="badge badge--verified">' + svgIcon('shield-check') + ' 已验证</span>' : '') + '</div>' : '') +
      '<div class="modal__section"><div class="modal__label">描述</div><div class="modal__value">' + esc(i.desc || '暂无描述') + '</div></div>' +
      baseUrlHtml +
      tokenHtml +
      tipHtml +
      (tagsHtml ? '<div class="modal__section"><div class="modal__label">标签</div><div class="modal__tags modal__tags--in-label">' + tagsHtml + '</div></div>' : '') +
      // 可信度说明：众测仅供参考，官方以下线为准（防「提醒」误导为官方定论）
      '<div class="modal__trust">众测结果仅供参考（多人实测共享），官方状态以「已验证 / 自动下线」为准 · 提醒不会自动下线</div>' +
      // Token 评论：默认折叠保持首屏极简，点击展开；条目下架随详情一起不可见
      '<details class="modal__section ic-section ic-details"><summary class="modal__label">' + svgIcon('message-square') + ' 评论 · 实测交流（<span id="icCount">…</span>，点击展开）</summary>' +
      '<div class="ic-list" id="icList"><div class="ic-empty">加载中…</div></div>' +
      (user
        ? '<div class="ic-composer"><input class="input ic-input" id="icInput" maxlength="200" placeholder="这个 Token 实测如何？说说你的体验…"><button class="btn btn--sm btn--primary" id="icSend" title="发送评论">' + svgIcon('send') + '</button></div>'
        : '<button class="ic-login-hint" id="icLoginHint">' + svgIcon('log-in') + ' 登录后可评论</button>') +
      '</details>' +
      '<button class="wechat-tip wechat-tip--link" data-action="open-wechat">' + svgIcon('gift') + ' 加微信群获取邀请码</button>';
    loadItemComments(i.id, seq);
    // 模型测活众测徽标（最近实测结果 + 不可用标记数）
    currentItemId = i.id;
    loadModelCrowd(i.id);
  } catch (e) {
    if (seq === detailSeq) detailContent.innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p></div>';
  }
}

// Token 评论加载/渲染/发送（详情弹窗内；条目下架后随详情一起 404 不可见）
function renderIcRow(c) {
  var mine = user && c.authorId === user.id;
  var nameHtml = c.authorId
    ? '<a class="ic-name" href="/user/' + esc(c.authorId) + '">' + miniAvatar(c.avatar, c.authorName) + esc(c.authorName) + '</a>'
    : '<span class="ic-name">' + esc(c.authorName) + '</span>';
  return '<div class="ic-row" data-cid="' + esc(c.id) + '">' + nameHtml +
    '<div class="ic-body"><div class="ic-text">' + esc(c.content) + '</div>' +
    '<div class="ic-meta">' + esc((c.createdAt || '').slice(0, 16).replace('T', ' ')) +
    (mine ? ' · <button class="ic-del" data-cid="' + esc(c.id) + '" title="删除我的评论">删除</button>' : '') +
    '</div></div></div>';
}
async function loadItemComments(itemId, seq) {
  var listEl = document.getElementById('icList');
  var countEl = document.getElementById('icCount');
  if (!listEl) return;
  try {
    var res = await api('GET', '/items/' + encodeURIComponent(itemId) + '/comments');
    var data = await res.json();
    if (seq !== undefined && seq !== detailSeq) return; // 弹窗已切换/关闭，丢弃迟到评论
    if (!res.ok) { listEl.innerHTML = '<div class="ic-empty">评论加载失败</div>'; return; }
    var list = data.comments || [];
    if (countEl) countEl.textContent = list.length;
    listEl.innerHTML = list.length ? list.map(renderIcRow).join('') : '<div class="ic-empty">还没有评论，来说说这个 Token 的实测体验～</div>';
    listEl.querySelectorAll('.ic-del').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('删除这条评论？')) return;
        try {
          var r = await api('DELETE', '/comments/' + encodeURIComponent(this.getAttribute('data-cid')));
          if (!r.ok) { var d = await r.json(); showToast(d.error || '删除失败'); return; }
          loadItemComments(itemId, seq);
        } catch (e) { showToast('删除失败'); }
      });
    });
    var sendBtn = document.getElementById('icSend');
    var inputEl = document.getElementById('icInput');
    async function send() {
      var v = inputEl ? inputEl.value.trim() : '';
      if (!v) { showToast('评论不能为空'); return; }
      try {
        var r = await api('POST', '/items/' + encodeURIComponent(itemId) + '/comments', { content: v });
        var d = await r.json();
        if (!r.ok) { showToast(d.error || '发送失败'); return; }
        inputEl.value = '';
        loadItemComments(itemId, seq);
      } catch (e) { showToast('发送失败'); }
    }
    if (sendBtn) sendBtn.addEventListener('click', send);
    if (inputEl) inputEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    var loginHint = document.getElementById('icLoginHint');
    if (loginHint) loginHint.addEventListener('click', function() { openAuth('login'); });
  } catch (e) {
    listEl.innerHTML = '<div class="ic-empty">评论加载失败</div>';
  }
}

// 打赏确认弹窗（仪式感 UX）：宝石动画 + 确认 → 成功加分效果
// 用一个全屏遮罩 + 居中卡片，替代原生 confirm()；成功时宝石变绿 + 积分飞升
var tipConfirmEl = null;
function openTipConfirm(itemId, btn, authorName) {
  if (tipConfirmEl) { try { tipConfirmEl.remove(); } catch (_) {} }
  var myPoints = Number(user && user.points) || 0;
  tipConfirmEl = document.createElement('div');
  tipConfirmEl.className = 'tip-confirm';
  tipConfirmEl.innerHTML =
    '<div class="tip-confirm__overlay" data-tip-close></div>' +
    '<div class="tip-confirm__card" role="dialog" aria-modal="true" aria-label="打赏确认">' +
      '<div class="tip-confirm__gem">' + svgIcon('gem') + '</div>' +
      '<div class="tip-confirm__title">打赏 1 积分</div>' +
      '<div class="tip-confirm__desc">认可 <b>' + esc(authorName || '这条 Token 的发布者') + '</b> 的贡献，给 TA 加 1 分</div>' +
      '<div class="tip-confirm__balance">我的积分 <b id="tipBalance">' + myPoints + '</b><span id="tipDelta" class="tip-confirm__delta"></span></div>' +
      '<div class="tip-confirm__actions">' +
        '<button class="btn btn--ghost" data-tip-close>再想想</button>' +
        '<button class="btn btn--primary" id="tipGo">' + svgIcon('gem') + ' 确认打赏</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(tipConfirmEl);
  // 防止遮罩/关闭重复执行
  tipConfirmEl.addEventListener('click', function (e) {
    if (e.target.closest('[data-tip-close]')) closeTipConfirm();
  });
  var go = tipConfirmEl.querySelector('#tipGo');
  go.addEventListener('click', async function () {
    go.disabled = true;
    go.innerHTML = '<span class="testing">打赏中…</span>';
    try {
      var res = await api('POST', '/items/' + encodeURIComponent(itemId) + '/tip', {});
      var data = await res.json();
      if (!res.ok) { closeTipConfirm(); showToast(data.error || '打赏失败'); return; }
      // 成功：宝石变绿、积分 +1 飞升、短暂停留后自动关闭
      var card = tipConfirmEl.querySelector('.tip-confirm__card');
      card.classList.add('is-done');
      tipConfirmEl.querySelector('.tip-confirm__gem').classList.add('is-done');
      tipConfirmEl.querySelector('.tip-confirm__title').innerHTML = '已打赏，感谢你的认可！';
      tipConfirmEl.querySelector('.tip-confirm__desc').innerHTML = '<b>' + esc(authorName || 'TA') + '</b> 收获了一份认可，积分已送出';
      var bal = tipConfirmEl.querySelector('#tipBalance');
      bal.textContent = myPoints - 1;
      var delta = tipConfirmEl.querySelector('#tipDelta');
      delta.textContent = ' -1';
      delta.classList.add('show');
      if (btn) {
        var wrap = btn.closest('.modal__tip');
        if (wrap) {
          wrap.innerHTML = '<span class="tip-done">' + svgIcon('gem') + ' 已打赏 · 被认可 ' + (Number(btn.getAttribute('data-count') || 0) + 1) + ' 次</span>';
        } else {
          var n = Number(btn.getAttribute('data-count') || 0) + 1;
          btn.classList.add('is-done');
          btn.disabled = true;
          btn.title = '已打赏';
          var cb = btn.querySelector('b');
          if (cb) cb.textContent = n;
          else { var bEl = document.createElement('b'); bEl.textContent = n; btn.appendChild(bEl); }
          btn.setAttribute('data-count', n);
        }
      }
      if (user) { user.points = myPoints - 1; try { localStorage.setItem('user', JSON.stringify(user)); } catch (_) {} }
      setTimeout(closeTipConfirm, 1400);
    } catch (e) {
      closeTipConfirm(); showToast('打赏失败');
    }
  });
}
function closeTipConfirm() {
  if (tipConfirmEl) { try { tipConfirmEl.remove(); } catch (_) {} tipConfirmEl = null; }
}
// ESC 关闭打赏确认
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeTipConfirm(); });

// 打赏：花 1 积分认可他人 Token（幂等，成功后按钮变「已打赏」；弹窗与卡片两种入口共用）
async function tipItem(itemId, btn) {
  if (!user) { showToast('请先登录'); openAuth('login'); return; }
  // 作者名：详情弹窗内从发布者链接取，卡片入口兜底显示「发布者」
  var authorName = '';
  var authorLink = document.querySelector('#modal .user-link');
  if (authorLink) authorName = authorLink.textContent.trim();
  openTipConfirm(itemId, btn, authorName);
}

// 错误文本截断展示 + 完整错误悬停（title）：弹窗/模型行空间有限，防止长错误撑破布局
function errHtml(text, maxLen) {
  var s = String(text || '').trim();
  if (!s) return '';
  var cut = s.length > (maxLen || 40) ? s.slice(0, (maxLen || 40)) + '…' : s;
  return '<span class="err-text" title="' + esc(s) + '">' + esc(cut) + '</span>';
}

// 模型列表渲染：每模型一行（复制 + 名称 + 可用性检测 + 掺水检测 + 众测提醒 + 内联结果区）
// 可用性 = 对该模型发真实一问一答（/test-token 带 model），2xx 才算可用，端点通≠可用；
// 掺水 = 质量电池（/verify/model 评分+逐项结论），仅可用模型可跑；
// 提醒 = 众测标记，仅展示给后来人看，不会自动下线（多人标记会提示版主优先复测）。
// 模型多时默认只展开前 COLLAPSE_LIMIT 个，超出收起 + 「展开全部」按钮
var MODEL_COLLAPSE_LIMIT = 8;
function renderModelRows(models, expanded) {
  if (!models || !models.length) return '';
  var html = '<div class="model-rows"' + (models.length > MODEL_COLLAPSE_LIMIT ? ' data-collapsible="1"' : '') + '>';
  for (var m = 0; m < models.length; m++) {
    var mn = models[m].id || models[m].name || models[m];
    if (!mn) continue;
    var collapsed = !expanded && models.length > MODEL_COLLAPSE_LIMIT && m >= MODEL_COLLAPSE_LIMIT;
    html += '<div class="model-row' + (collapsed ? ' model-row--collapsed' : '') + '" data-usable="">' +
      '<code class="model-row__name" title="' + esc(mn) + '">' + esc(mn) + '</code>' +
      '<button type="button" class="btn btn--sm btn--ghost model-row__copy" data-model-copy="' + esc(mn) + '" title="复制模型名称">' + svgIcon('copy') + '</button>' +
      '<span class="model-row__actions">' +
      '<button type="button" class="btn btn--sm btn--ghost model-row__check" data-model-check="' + esc(mn) + '" title="可用性检测：对该模型发一次真实问答，2xx 才算可用">' + svgIcon('zap') + ' 可用性</button>' +
      '<button type="button" class="btn btn--sm btn--ghost model-row__verify" data-model-verify="' + esc(mn) + '" title="掺水检测：对话/回显/usage/知识/身份/思维链评分，仅可用模型可跑">' + svgIcon('shield-check') + ' 掺水</button>' +
      '<button type="button" class="btn btn--sm btn--ghost model-row__flag" data-model-flag="' + esc(mn) + '" title="众测提醒：实测不可用？标记给后来人看（不会自动下线，多人标记会提示版主优先复测）">' + svgIcon('alert-triangle') + ' 提醒</button>' +
      '<span class="model-row__crowd" data-model-crowd="' + esc(mn) + '"></span>' +
      '<span class="model-row__result" aria-live="polite"></span>' +
      '</span>' +
      '<div class="model-row__report is-collapsed" data-model-report="' + esc(mn) + '"></div>' +
    '</div>';
  }
  html += '</div>';
  html += '<div class="model-rows__hint">可用性 = 真实问答实测（端点通≠可用）· 掺水 = 质量评分 · 提醒 = 众测（不下线） <a href="/verify" target="_blank" rel="noopener">去深度检测 →</a></div>';
  // 折叠提示：超过 8 个时显示「展开全部 N 个」；展开后显示「收起」
  if (models.length > MODEL_COLLAPSE_LIMIT) {
    html += '<button type="button" class="model-rows__toggle" data-collapsed="' + (expanded ? '0' : '1') + '">' +
      (expanded ? svgIcon('arrow-up') + ' 收起' : svgIcon('chevron-down') + ' 展开全部 ' + models.length + ' 个') + '</button>';
  }
  // 一键检测全部 / 停止：只跑可用性（省成本），掺水需逐个点；运行时变「停止」
  html += '<button type="button" class="model-rows__testall" id="checkAllModels">' + svgIcon('play') + ' 一键测可用性</button>';
  return html;
}

// 展开/收起模型列表（默认只显示前 8 个，超出的收起）
function toggleModelList(btn) {
  var rows = btn.parentElement ? btn.parentElement.querySelectorAll('.model-row--collapsed') : [];
  var expanded = btn.getAttribute('data-collapsed') === '0';
  for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('model-row--collapsed', expanded);
  btn.setAttribute('data-collapsed', expanded ? '1' : '0');
  btn.innerHTML = (expanded ? svgIcon('chevron-down') + ' 展开全部' : svgIcon('arrow-up') + ' 收起');
}

// 一键测可用性：串行逐个真实问答（限制并发，避免打爆上游；只跑可用性不跑掺水，省成本）
// 运行时按钮变「停止」仍可点；停止后恢复手工逐个模式
var modelBatchRunning = false;
var modelBatchStop = false;
async function checkAllModels(btn) {
  var rows = document.querySelectorAll('#modelList .model-row');
  if (!rows.length) return;
  if (!user || !token) { showToast('请先登录后检测'); openAuth('login'); return; }
  if (modelBatchRunning) { modelBatchStop = true; return; }
  var collapsedCount = 0;
  for (var c = 0; c < rows.length; c++) if (rows[c].classList.contains('model-row--collapsed')) collapsedCount++;
  if (collapsedCount > 0) {
    showToast('已跳过 ' + collapsedCount + ' 个折叠模型，点「展开全部」后可一键检测');
  }
  modelBatchRunning = true;
  modelBatchStop = false;
  if (btn) {
    btn.classList.add('is-running');
    btn.innerHTML = svgIcon('pause') + ' 停止';
  }
  var checkBtns = document.querySelectorAll('#modelList .model-row__check');
  for (var i = 0; i < checkBtns.length; i++) checkBtns[i].disabled = true;
  var done = 0, failed = 0, limited = 0, stopped = false;
  for (var j = 0; j < rows.length; j++) {
    if (modelBatchStop) { stopped = true; break; }
    var checkBtn = rows[j].querySelector('.model-row__check');
    if (!checkBtn) continue;
    if (rows[j].classList.contains('model-row--collapsed')) continue;
    await checkModelAvailability(checkBtn);
    var resultEl = rows[j].querySelector('.model-row__result');
    var txt = resultEl ? resultEl.textContent : '';
    if (txt && txt.indexOf('✓ 可用') !== -1) done++;
    else if (txt && txt.indexOf('限流') !== -1) limited++;
    else if (txt && txt.indexOf('✗') !== -1) failed++;
  }
  for (var k = 0; k < checkBtns.length; k++) checkBtns[k].disabled = false;
  modelBatchRunning = false;
  modelBatchStop = false;
  if (btn) {
    btn.classList.remove('is-running');
    btn.innerHTML = svgIcon('play') + ' 一键测可用性';
  }
  var summary = '可用性检测完成：' + done + ' 可用' + (failed ? '，' + failed + ' 不可用' : '') + (limited ? '，' + limited + ' 限流' : '') + '（掺水需逐个点）';
  if (collapsedCount) summary += '（已跳过 ' + collapsedCount + ' 个折叠）';
  showToast(stopped ? '已停止，剩余模型恢复为逐个手工检测' : summary);
}

// 可用性检测：对该模型发一次真实问答（/test-token 带 model），2xx 才算可用
// 端点通≠可用：/models 200 但 chat 404/400 一律判不可用；结果写入 row[data-usable] 供掺水门控
async function checkModelAvailability(btn) {
  var row = btn.closest('.model-row');
  var resultEl = row ? row.querySelector('.model-row__result') : null;
  if (!resultEl) return;
  var model = btn.getAttribute('data-model-check');
  var list = document.getElementById('modelList');
  if (!list || !list.getAttribute('data-token')) { showToast('缺少端点配置'); return; }
  if (!user || !token) { showToast('请先登录后检测'); openAuth('login'); return; }
  var tokenVal = list.getAttribute('data-token') || '';
  var type = list.getAttribute('data-type') || 'OpenAI';
  var url = list.getAttribute('data-url') || '';
  var seqAtStart = detailSeq;
  var itemAtStart = currentItemId;
  resultEl.innerHTML = '<span class="testing">可用性检测中…（真实问答）</span>';
  btn.disabled = true;
  try {
    var connRes = await api('POST', '/test-token', { token: tokenVal, tokenType: type, baseUrl: url, model: model });
    if (seqAtStart !== detailSeq || itemAtStart !== currentItemId) { btn.disabled = false; return; }
    if (connRes.status === 401) { showToast('登录已过期，请重新登录'); openAuth('login'); resultEl.innerHTML = '<span class="bad">✗ 未登录 (401)</span>'; btn.disabled = false; return; }
    var conn = await connRes.json();
    var st = conn && typeof conn.status === 'number' ? conn.status : null;
    var codeTag = st === null || st === 0 ? '(连接失败)' : '(' + st + ')';
    var usable = !!conn.ok;
    // 本次会话我的实测（最新鲜）：供众测徽标优先展示“我·刚刚”，压过路人历史，避免新旧打架
    if (row) {
      row.setAttribute('data-usable', usable ? '1' : '0');
      row.setAttribute('data-my-result', usable ? 'ok' : (conn.status === 429 || conn.kind === 'ratelimit' ? 'limited' : 'bad'));
      row.setAttribute('data-my-at', String(Date.now()));
      row.setAttribute('data-my-status', st === null ? 0 : st);
    }
    if (conn.ok) resultEl.innerHTML = '<span class="ok">✓ 可用 ' + (st ? '(' + st + ')' : '(200)') + '</span> <span class="muted">真实问答通过</span>';
    else if (conn.status === 429 || conn.kind === 'ratelimit') resultEl.innerHTML = '<span class="warn">⚠ 限流中 (429)</span> <span class="muted">Token 有效，稍后再测</span>';
    else if (conn.kind === 'no_models') resultEl.innerHTML = '<span class="warn">⚠ 疑似假端点 (200) ' + errHtml(conn.error, 26) + '</span>';
    else {
      var reason = conn && conn.error ? String(conn.error) : '';
      resultEl.innerHTML = '<span class="bad" title="' + esc(reason) + '">✗ 不可用 ' + codeTag + (reason ? ' ' + esc(reason.slice(0, 30)) : '') + '</span>';
    }
    if (itemAtStart) reportModelProbe(itemAtStart, model, usable, st === null ? 0 : st, 0);
  } catch (e) {
    if (seqAtStart === detailSeq && itemAtStart === currentItemId) resultEl.innerHTML = '<span class="bad">✗ 检测失败 ' + errHtml(e.message, 32) + '</span>';
  }
  btn.disabled = false;
}

// 掺水检测：质量电池（/verify/model 评分+逐项结论），仅可用模型可跑
// 未先测可用性时自动先跑可用性，不可用直接拒绝，避免电池空跑浪费
async function checkModelQuality(btn) {
  var row = btn.closest('.model-row');
  var resultEl = row ? row.querySelector('.model-row__result') : null;
  if (!resultEl) return;
  var model = btn.getAttribute('data-model-verify');
  var reportEl = row ? row.querySelector('.model-row__report') : null;
  var list = document.getElementById('modelList');
  if (!list || !list.getAttribute('data-token')) { showToast('缺少端点配置'); return; }
  if (!user || !token) { showToast('请先登录后检测'); openAuth('login'); return; }
  // 已有报告：点击展开/收起（不重复请求）
  if (reportEl && reportEl.getAttribute('data-done') === '1') {
    var wasHidden = reportEl.classList.toggle('is-collapsed');
    if (row) row.classList.toggle('is-report-open', !wasHidden);
    return;
  }
  var tokenVal = list.getAttribute('data-token') || '';
  var type = list.getAttribute('data-type') || 'OpenAI';
  var url = list.getAttribute('data-url') || '';
  var seqAtStart = detailSeq;
  var itemAtStart = currentItemId;
  // 门控：未确认可用先跑可用性
  var usable = row ? row.getAttribute('data-usable') : '';
  if (usable !== '1') {
    resultEl.innerHTML = '<span class="testing">先确认可用性…</span>';
    var tmpBtn = row ? row.querySelector('.model-row__check') : null;
    if (tmpBtn) await checkModelAvailability(tmpBtn);
    if (seqAtStart !== detailSeq || itemAtStart !== currentItemId) return;
    usable = row ? row.getAttribute('data-usable') : '';
    if (usable !== '1') {
      resultEl.innerHTML += ' <span class="muted">（不可用，掺水已跳过）</span>';
      return;
    }
  }
  resultEl.innerHTML += ' <span class="testing"><span class="spinner spinner--sm"></span> 掺水检测中…</span>';
  btn.disabled = true;
  if (row) row.classList.add('is-testing');
  if (reportEl) { reportEl.innerHTML = '<div class="verify-skeleton"><div class="verify-skeleton__bar" style="width:60%"></div><div class="verify-skeleton__bar" style="width:80%"></div><div class="verify-skeleton__bar" style="width:45%"></div></div>'; reportEl.classList.remove('is-collapsed'); }
  // 失败报告卡：错误原因 + 已跑出的逐项 checks（点结果可展开看明细，不让失败变黑盒）
  function showVerifyErrorReport(vd) {
    if (reportEl && vd && window.VerifyRelay && window.VerifyRelay.errorHtml) {
      reportEl.innerHTML = window.VerifyRelay.errorHtml(vd);
      reportEl.setAttribute('data-done', '1');
      reportEl.classList.remove('is-collapsed');
      if (window.VerifyRelay.bindAiToggle) window.VerifyRelay.bindAiToggle(reportEl);
      if (row) row.classList.add('is-report-open');
    }
  }
  try {
    var vd = null;
    var vdHttpStatus = 0;
    var timedOut = false;
    var useStream = true;
    // 尝试流式：逐条推送 checks，体感从 8s 干等变为秒级有反馈
    try {
      var streamRes = await fetch('/api/verify/model/stream', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, (function(){ var h={}; if(token) h['Authorization']='Bearer '+token; return h; })()),
        body: JSON.stringify({ token: tokenVal, tokenType: type, baseUrl: url, model: model })
      });
      if (streamRes.status === 401) { showToast('登录已过期，请重新登录'); openAuth('login'); resultEl.innerHTML += ' <span class="bad">掺水·未登录</span>'; btn.disabled = false; return; }
      if (streamRes.ok && streamRes.body && window.ReadableStream) {
        var reader = streamRes.body.getReader();
        var decoder = new TextDecoder();
        var buf = '';
        var streamChecks = [];
        var finalResult = null;
        var gotDone = false;
        // 初始化流式容器：骨架替换为流式列表
        if (reportEl) {
          reportEl.innerHTML = '<div class="verify-stream" id="verifyStream"></div>';
          reportEl.classList.remove('is-collapsed');
          if (row) row.classList.add('is-report-open');
        }
        var streamContainer = reportEl ? reportEl.querySelector('#verifyStream') : null;
        function addStreamCheck(c) {
          streamChecks.push(c);
          if (!streamContainer) return;
          var st = c.status === 'pass' ? 'pass' : (c.status === 'fail' ? 'fail' : 'warn');
          var icon = st === 'pass' ? '✓' : (st === 'fail' ? '✗' : '⚠');
          var html = '<div class="verify-stream__item"><span class="verify-stream__status verify-stream__status--' + st + '">' + icon + ' ' + esc(c.label) + '</span><span class="verify-stream__label">' + esc(c.detail||'') + '</span></div>';
          var div = document.createElement('div');
          div.innerHTML = html;
          // 逐条动画：先占位再替换，避免闪烁
          streamContainer.appendChild(div.firstChild);
          // 同步更新 resultEl 的简要进度
          resultEl.innerHTML = resultEl.innerHTML.replace(/<span class="testing">[\s\S]*?<\/span>/, '<span class="testing"><span class="spinner spinner--sm"></span> 检测中 ' + streamChecks.length + '/~7…</span>');
        }
        while (true) {
          var r = await reader.read();
          if (r.done) break;
          buf += decoder.decode(r.value, { stream: true });
          var parts = buf.split('\n\n');
          buf = parts.pop();
          for (var pi=0; pi<parts.length; pi++) {
            var block = parts[pi];
            if (!block.trim() || block.indexOf('data:') === -1) continue;
            var lines = block.split('\n');
            var ev = 'message', dataStr = '';
            for (var li=0; li<lines.length; li++) {
              var l = lines[li];
              if (l.indexOf('event:')===0) ev = l.slice(6).trim();
              else if (l.indexOf('data:')===0) dataStr = l.slice(5).trim();
            }
            if (!dataStr) continue;
            try {
              var data = JSON.parse(dataStr);
              if (ev === 'check' && data && data.key) {
                addStreamCheck(data);
              } else if (ev === 'done' && data) {
                finalResult = data;
                gotDone = true;
              } else if (ev === 'error') {
                finalResult = data;
                gotDone = true;
              }
            } catch(_){}
          }
          if (gotDone) { try { await reader.cancel(); } catch(_){} break; }
        }
        if (finalResult) {
          vd = finalResult;
          vdHttpStatus = 200;
          useStream = false; // 已通过流式拿到结果，跳过后续轮询
          // 清理流式占位，准备渲染完整报告
          if (reportEl && streamChecks.length) {
            // 保留流式列表，done 事件后由下面统一渲染完整报告（覆盖流式）
          }
        } else {
          // 流式未拿到 done，回退到传统轮询
          useStream = true;
        }
      } else {
        useStream = true;
      }
    } catch (e) {
      // 流式失败，回退到传统接口
      useStream = true;
    }
    if (useStream) {
      var attempt = 0;
      while (attempt <= 45) {
        if (seqAtStart !== detailSeq || itemAtStart !== currentItemId) { btn.disabled = false; return; }
        var vdRes = await api('POST', '/verify/model', { token: tokenVal, tokenType: type, baseUrl: url, model: model });
        if (seqAtStart !== detailSeq || itemAtStart !== currentItemId) { btn.disabled = false; return; }
        if (vdRes.status === 401) { showToast('登录已过期，请重新登录'); openAuth('login'); resultEl.innerHTML += ' <span class="bad">掺水·未登录</span>'; btn.disabled = false; return; }
        vdHttpStatus = vdRes.status;
        vd = await vdRes.json();
        if (vd && vd.inProgress) { await new Promise(function(r){ setTimeout(r, 1000); }); attempt++; continue; }
        break;
      }
      if (vd && vd.inProgress) timedOut = true;
    }
    // 清理“检测中”动效
    (function cleanTesting(){
      try {
        resultEl.innerHTML = resultEl.innerHTML.replace(/<span class="testing">[\s\S]*?<\/span>/, '').replace(/掺水检测中…/, '');
        if (row) row.classList.remove('is-testing');
      } catch(_){}
    })();
    if (vd && vd.kind === 'vision_skip') {
      var vb = resultEl.textContent.trim();
      resultEl.innerHTML = esc(vb) + ' <span class="warn" title="' + esc((vd.checks&&vd.checks[0]&&vd.checks[0].detail)||'') + '">Vision 模型，已跳过掺水检测</span>';
      showVerifyErrorReport(vd);
    } else if (vd && vd.ok) {
      var vcls = vd.score >= 80 ? 'ok' : (vd.score >= 60 ? 'warn' : 'bad');
      var vtxt = vd.score >= 80 ? '基本可信' : (vd.score >= 60 ? '存在疑点' : '疑似掺水');
      var base = resultEl.textContent.trim();
      resultEl.innerHTML = esc(base) + ' <span class="' + vcls + '">掺水·' + vtxt + ' (' + vd.score + ')</span>';
      // 报告卡展示在行下方，点击可用性可收起；AI 判定段需手动绑定折叠（弹窗系直接渲染，不走组件流程）
      if (reportEl && window.VerifyRelay && window.VerifyRelay.reportHtml) {
        reportEl.innerHTML = window.VerifyRelay.reportHtml(vd);
        reportEl.setAttribute('data-done', '1');
        reportEl.classList.remove('is-collapsed');
        if (window.VerifyRelay.bindAiToggle) window.VerifyRelay.bindAiToggle(reportEl);
        if (row) row.classList.add('is-report-open');
      }
    } else if (vd && vd.kind === 'ratelimit') {
      resultEl.innerHTML += ' <span class="warn" title="429 限流：Token 有效只是限额，稍后再测">掺水·限流</span>';
    } else if (vd && (vd.status === 401 || vd.status === 403)) {
      // 钥匙问题：整个端点都验不了，不是模型掺水
      resultEl.innerHTML += ' <span class="bad" title="' + esc(vd.error || '') + '">✗ Key无效 (' + vd.status + ')</span>';
      showVerifyErrorReport(vd);
    } else if (vd && (vd.status === 404 || vd.status === 400)) {
      // 模型在该端点不存在：掺水无从谈起，跳过并附明细
      resultEl.innerHTML += ' <span class="bad" title="' + esc(vd.error || '') + '">该模型不可用 (' + vd.status + ')，掺水已跳过</span>';
      if (row) row.setAttribute('data-usable', '0');
      showVerifyErrorReport(vd);
    } else if (vd && vd.status === 0) {
      resultEl.innerHTML += ' <span class="bad" title="' + esc(vd.error || '') + '">无法连接，掺水已跳过</span>';
      if (row) row.setAttribute('data-usable', '0');
      showVerifyErrorReport(vd);
    } else if (timedOut) {
      resultEl.innerHTML += ' <span class="bad">掺水·超时（45秒无结果，请重试）</span>';
    } else if (vdHttpStatus >= 500) {
      // 本站工具侧异常（非上游模型问题）：明确说工具失败，不甩锅给模型
      var toolErr = vd && vd.error ? ' ' + errHtml(vd.error, 32) : '';
      resultEl.innerHTML += ' <span class="bad">掺水·工具异常，请重试' + toolErr + '</span>';
    } else {
      // 参数错误等其他：把原因写全（悬停看全文）
      var vErr = vd && vd.error ? '：' + errHtml(vd.error, 32) : '';
      resultEl.innerHTML += ' <span class="bad">掺水·检测失败' + vErr + '</span>';
    }
  } catch (e) {
    try { resultEl.innerHTML = resultEl.innerHTML.replace(/<span class="testing">[\s\S]*?<\/span>/, '').replace(/掺水检测中…/, ''); if (row) row.classList.remove('is-testing'); } catch(_){}
    if (seqAtStart === detailSeq && itemAtStart === currentItemId) resultEl.innerHTML += ' <span class="bad">掺水·请求失败（网络错误，请重试）</span>';
  }
  btn.disabled = false;
  if (row) row.classList.remove('is-testing');
  if (reportEl && reportEl.innerHTML.indexOf('verify-skeleton') !== -1 && !(vd && vd.ok)) {
    // 非成功时清空骨架，避免一直转
    try { if (vd && vd.checks) reportEl.innerHTML = window.VerifyRelay ? window.VerifyRelay.reportHtml(vd) : ''; else reportEl.innerHTML = ''; } catch(_){ reportEl.innerHTML=''; }
    if (reportEl.innerHTML) { reportEl.classList.remove('is-collapsed'); if (row) row.classList.add('is-report-open'); }
  }
}

// 兼容旧调用：一键/外部仍调 checkModelRow 即走可用性（掺水需单独点）
async function checkModelRow(btn) { return checkModelAvailability(btn); }

// ===== 模型测活众测：上报 + 徽标渲染 =====
var currentItemId = '';
// 上报一次测活（检测完成自动 / 「不可用」手动标记）
function reportModelProbe(itemId, model, ok, status, latencyMs, source) {
  if (!user || !itemId || !model) return;
  api('POST', '/items/' + itemId + '/model-probe', { model: model, ok: !!ok, status: status || 0, latencyMs: latencyMs || 0, source: source || 'user' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.ok) loadModelCrowd(itemId);
      else if (source === 'report' && d && d.error) showToast(d.error);
    })
    .catch(function () { /* 静默：上报失败不打断 */ });
}
// 拉取并渲染各模型众测徽标：我的本次实测置顶（署名“我·”，最新鲜，以它为准），
// 路人聚合降为“最近·”并带时间，避免“别人10分钟前的失败”和“我刚测的成功”并排打架却分不清是谁的
function crowdAgoText(ts) {
  var ago = Math.round((Date.now() - ts) / 60000);
  if (isNaN(ago)) return '';
  return ago < 1 ? '刚刚' : ago < 60 ? ago + ' 分钟前' : Math.round(ago / 60) + ' 小时前';
}
function crowdParseAt(lastAt) {
  // 兼容两种落库格式：ISO（含毫秒与 Z）与 SQLite datetime（空格分隔无时区，后者按 UTC 解）
  // 旧代码无条件 + 'Z'，遇到 ISO 会拼出非法 '..Z' 导致时间空白
  var raw = String(lastAt || '').trim().replace(' ', 'T');
  if (!raw) return NaN;
  if (!/[Zz]$/.test(raw) && raw.indexOf('+') === -1) raw += 'Z';
  return Date.parse(raw);
}
function loadModelCrowd(itemId) {
  if (!itemId) return;
  fetch('/api/items/' + itemId + '/model-status').then(function (r) { return r.json(); }).then(function (st) {
    document.querySelectorAll('[data-model-crowd]').forEach(function (el) {
      var mn = el.getAttribute('data-model-crowd');
      var s = st && st[mn];
      var bits = [];
      // 我的本次实测（本弹窗会话内刚测的）：永远置顶，以它为准
      var row = el.closest ? el.closest('.model-row') : null;
      var myRes = row ? row.getAttribute('data-my-result') : '';
      var myAt = row ? parseInt(row.getAttribute('data-my-at') || '0', 10) : 0;
      if (myRes) {
        var myAgo = crowdAgoText(myAt);
        if (myRes === 'ok') bits.push('<span class="crowd-mine crowd-mine--ok" title="你本次打开弹窗后的实测结果（最新鲜，以它为准）">我·' + esc(myAgo) + ' ✓可用</span>');
        else if (myRes === 'limited') bits.push('<span class="crowd-mine crowd-mine--warn" title="你本次的实测遇到限流：Token 有效只是限额">我·' + esc(myAgo) + ' ⚠限流</span>');
        else bits.push('<span class="crowd-mine crowd-mine--bad" title="你本次打开弹窗后的实测结果（最新鲜，以它为准）">我·' + esc(myAgo) + ' ✗不可用</span>');
      }
      if (s && s.lastAt) {
        var agoTxt = crowdAgoText(crowdParseAt(s.lastAt));
        if (s.reports1h >= 2) bits.push('<span class="crowd-bad" title="1 小时内 ' + s.reports1h + ' 人众测提醒不可用（仅供参考，不会自动下线）">✗ ' + s.reports1h + ' 人提醒·众测</span>');
        else if (s.lastOk) bits.push('<span class="crowd-ok" title="最近一次众测' + esc(agoTxt) + '可用（含他人实测，仅供参考）">最近·' + esc(agoTxt) + ' ✓' + (s.lastLatencyMs ? ' · ' + s.lastLatencyMs + 'ms' : '') + '</span>');
        else bits.push('<span class="crowd-warn" title="最近一次众测' + esc(agoTxt) + '不可用（含他人实测，仅供参考；以你自己的实测为准）">最近·' + esc(agoTxt) + ' ✗</span>');
        if (s.fail24h >= 2) bits.push('<span class="crowd-warn" title="24 小时内失败 ' + s.fail24h + ' 次（含他人实测，仅供参考）">24h 失败 ' + s.fail24h + ' 次</span>');
      }
      el.innerHTML = bits.join(' ');
    });
  }).catch(function () { /* 静默 */ });
}

// 一键导入 CC Switch（ccswitch://v1/import 深度链接，官方协议）
// 按兼容模式自动映射目标工具：Anthropic→claude、Gemini→gemini、OpenAI 系→codex
function ccSwitchAppFor(compat, tokenType) {
  if (compat.indexOf('anthropic') !== -1) return 'claude';
  if (compat.indexOf('gemini') !== -1) return 'gemini';
  if (compat.indexOf('openai') !== -1) return 'codex';
  var tt = String(tokenType || '').toLowerCase();
  if (tt.indexOf('anthropic') !== -1) return 'claude';
  if (tt.indexOf('gemini') !== -1) return 'gemini';
  return 'codex'; // OpenAI 协议为默认兜底
}

// 该条目「可用导入的 app」列表（按 compat 推导；OpenAI 兼容可能有多个目标工具，需用户选）
var CC_APP_LABELS = { claude: 'Claude Code', codex: 'Codex (OpenAI)', gemini: 'Gemini CLI', opencode: 'OpenCode', grokbuild: 'Grok Build', openclaw: 'OpenClaw', hermes: 'Hermes' };
function availableCcApps(compat, tokenType) {
  var apps = [];
  if (compat.indexOf('anthropic') !== -1) apps.push('claude');
  if (compat.indexOf('gemini') !== -1) apps.push('gemini');
  if (compat.indexOf('openai') !== -1) apps.push('codex', 'opencode', 'grokbuild');
  // tokenType 兜底（无 compat 的老条目）
  var tt = String(tokenType || '').toLowerCase();
  if (!apps.length) {
    if (tt.indexOf('anthropic') !== -1) apps.push('claude');
    else if (tt.indexOf('gemini') !== -1) apps.push('gemini');
    else apps.push('codex');
  }
  return apps;
}

// 点「导入 CC Switch」入口：单 app 直接导入；多 app（OpenAI 系）弹选择器让用户选目标工具
function openCcAppPicker(name, endpoint, apiKey, compat, tokenType, model) {
  var apps = availableCcApps(compat, tokenType);
  if (apps.length === 1) { launchCcSwitch(name, endpoint, apiKey, compat, tokenType, model, apps[0]); return; }
  var picker = document.getElementById('ccPicker');
  if (!picker) return;
  picker.style.display = 'block';
  var html = '<div class="cc-picker__title">导入到哪个应用？</div>' +
    '<div class="cc-picker__desc">这条 Token 兼容多种 OpenAI 系工具，选一个目标应用导入</div>' +
    '<div class="cc-picker__apps">' + apps.map(function (a) {
      return '<button class="btn btn--sm btn--ghost cc-picker__app" data-cc-app="' + a + '">' + svgIcon('arrow-right') + ' ' + (CC_APP_LABELS[a] || a) + '</button>';
    }).join('') + '</div>' +
    '<button class="cc-picker__close" data-cc-picker-close>' + svgIcon('x') + ' 关闭</button>';
  picker.innerHTML = html;
  // 绑定选择
  picker.querySelectorAll('[data-cc-app]').forEach(function (b) {
    b.addEventListener('click', function () {
      picker.style.display = 'none';
      launchCcSwitch(name, endpoint, apiKey, compat, tokenType, model, b.getAttribute('data-cc-app'));
    });
  });
  var close = picker.querySelector('[data-cc-picker-close]');
  if (close) close.addEventListener('click', function () { picker.style.display = 'none'; });
}

function launchCcSwitch(name, endpoint, apiKey, compat, tokenType, model, app) {
  if (!endpoint || !apiKey) { showToast('缺少 Base URL 或 API Key，无法导入'); return; }
  // app 由调用方传入（openCcAppPicker 选定或单 app 直传）；未传时按 compat 兜底推断
  var target = app || ccSwitchAppFor(compat, tokenType);
  var p = new URLSearchParams();
  p.set('resource', 'provider');
  p.set('app', target);
  p.set('name', name || 'free-tokens');
  p.set('endpoint', endpoint);
  p.set('apiKey', apiKey);
  if (model) p.set('model', model);
  var link = 'ccswitch://v1/import?' + p.toString();
  // 用真实 <a> 点击触发自定义协议（比 location.href 更可靠，Chrome 会走系统协议处理）
  var a = document.createElement('a');
  a.href = link;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { try { document.body.removeChild(a); } catch (_) {} }, 100);
  // 失焦是弱信号（Windows/Chrome 常不触发），不能当「装没装」判据。
  // 只用来「没检测到失焦 → 给可靠兜底」，且兜底不武断说没装。
  var launched = false;
  var failTimer = setTimeout(function () {
    if (!launched) showCcSwitchFallback(apiKey, name, endpoint, compat, tokenType, model);
  }, 1500);
  var onBlur = function () {
    launched = true;
    clearTimeout(failTimer);
    window.removeEventListener('blur', onBlur);
  };
  window.addEventListener('blur', onBlur);
  setTimeout(function () { window.removeEventListener('blur', onBlur); }, 4000);
}

// 复制完整配置：按兼容模式生成可粘贴的 env 块（OpenAI/Anthropic/Gemini），URL 与 API Key 仍可点击单独复制
function copyFullConfig(item) {
  if (!item.url || !item.token) { showToast('缺少 Base URL 或 API Key'); return; }
  var compat = item.compat || [];
  var tt = String(item.tokenType || '').toLowerCase();
  var model = item.model || '';
  var lines = ['free-tokens Token 完整配置'];
  lines.push('Base URL: ' + item.url);
  lines.push('API Key: ' + item.token);
  if (model) lines.push('模型: ' + model);
  if (item.tokenType) lines.push('类型: ' + item.tokenType);
  var wantOpenai = compat.indexOf('openai') !== -1 || (!compat.length && tt.indexOf('anthropic') === -1 && tt.indexOf('gemini') === -1);
  var wantAnthropic = compat.indexOf('anthropic') !== -1 || tt.indexOf('anthropic') !== -1;
  var wantGemini = compat.indexOf('gemini') !== -1 || tt.indexOf('gemini') !== -1;
  if (wantOpenai) {
    lines.push('');
    lines.push('# OpenAI 兼容 (Codex / OpenAI 系 Agent)');
    lines.push('OPENAI_BASE_URL=' + item.url);
    lines.push('OPENAI_API_KEY=' + item.token);
    if (model) lines.push('OPENAI_MODEL=' + model);
  }
  if (wantAnthropic) {
    lines.push('');
    lines.push('# Anthropic 兼容 (Claude Code / Claude 桌面版)');
    lines.push('ANTHROPIC_BASE_URL=' + item.url);
    lines.push('ANTHROPIC_AUTH_TOKEN=' + item.token);
    if (model) lines.push('ANTHROPIC_MODEL=' + model);
  }
  if (wantGemini) {
    lines.push('');
    lines.push('# Gemini 兼容');
    lines.push('GEMINI_API_KEY=' + item.token);
    if (model) lines.push('GEMINI_MODEL=' + model);
  }
  copyText(lines.join('\n'), '已复制完整配置');
}

// 兜底：自动复制 API Key + 显示手动粘贴引导（CC Switch 不监听剪贴板，需用户手动粘贴）
function showCcSwitchFallback(apiKey, name, endpoint, compat, tokenType, model) {
  copyText(apiKey);
  var fb = document.getElementById('ccFallback');
  if (!fb) { showToast('已复制 API Key：打开 CC Switch 会自动识别并提示导入'); return; }
  fb.style.display = 'block';
  fb.innerHTML =
    '<div class="cc-fallback__title">没自动打开 CC Switch？</div>' +
    '<div class="cc-fallback__tip">已为你复制 API Key —— 打开 CC Switch → 新建供应商 → 在「API Key」输入框粘贴即可' +
    '（CC Switch 不会自动监听剪贴板，需手动粘贴）。若想一键导入：点「重试唤起」，并允许浏览器「打开 CC Switch」。</div>' +
    '<div class="cc-fallback__row">' +
      '<button class="btn btn--sm copy-btn" data-token="' + esc(apiKey) + '">' + svgIcon('copy') + ' 复制 Key</button>' +
      '<button class="btn btn--sm btn--ghost" id="ccRetry">重试唤起</button>' +
    '</div>';
  var retry = document.getElementById('ccRetry');
  if (retry) retry.addEventListener('click', function () {
    var f = document.getElementById('ccFallback'); if (f) f.style.display = 'none';
    launchCcSwitch(name, endpoint, apiKey, compat, tokenType, model);
  });
}

// 「i」说明面板：懒加载一次
function ccHelpHtml() {
  return '<div class="cc-help__title">一键导入 CC Switch</div>' +
    '<div class="cc-help__item">需要：CC Switch 已安装，且 Windows 已注册 <code>ccswitch://</code> 协议（官方安装版会自动注册）。</div>' +
    '<div class="cc-help__item">绿色/便携版（解压即用的 exe）<b>默认不注册协议</b> —— 下载下方脚本运行一次即可注册。</div>' +
    '<div class="cc-help__row">' +
      '<button class="btn btn--sm" data-action="ccdiag">' + svgIcon('refresh-cw') + ' 检测本地 CC Switch</button>' +
      '<a class="btn btn--sm btn--ghost" href="/download/cc-switch-register.bat" download>' + svgIcon('download') + ' 下载一键修复脚本</a>' +
    '</div>' +
    '<div id="ccDiagResult" class="cc-help__result"></div>' +
    '<div class="cc-help__item cc-help__muted">或复制导入：复制 API Key → CC Switch 新建供应商 → 粘贴。</div>';
}
function toggleCcHelp() {
  var h = document.getElementById('ccHelp');
  if (!h) return;
  if (h.style.display === 'none') {
    if (!h.getAttribute('data-loaded')) { h.innerHTML = ccHelpHtml(); h.setAttribute('data-loaded', '1'); }
    h.style.display = 'block';
  } else {
    h.style.display = 'none';
  }
}
// 自检：实际唤起一次 ccswitch://（检测会真的弹一次导入确认框），用失焦判断协议是否可用
function diagnoseCcSwitch() {
  var res = document.getElementById('ccDiagResult');
  if (!res) return;
  res.innerHTML = '<span class="testing">正在尝试唤起 CC Switch...</span>';
  var launched = false;
  var timer = setTimeout(function () {
    if (!launched) res.innerHTML = '<span class="bad">✗ 未检测到唤起</span> —— 可能是便携版未注册协议，或浏览器未放行「打开 CC Switch」。<a href="/download/cc-switch-register.bat" download>下载一键修复脚本</a>，或用复制导入。';
  }, 1500);
  var onBlur = function () {
    launched = true; clearTimeout(timer);
    window.removeEventListener('blur', onBlur);
    res.innerHTML = '<span class="ok">✓ 检测到 CC Switch 已唤起</span> —— 现在可以直接点「导入 CC Switch」一键导入。';
  };
  window.addEventListener('blur', onBlur);
  var a = document.createElement('a');
  a.href = 'ccswitch://v1/import?resource=provider&app=claude&name=free-tokens-Diagnose';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { try { document.body.removeChild(a); } catch (_) {} }, 100);
  setTimeout(function () { window.removeEventListener('blur', onBlur); }, 4000);
}

  if (detailModal) detailModal.addEventListener('click', function(e) {
    var tipBtn = e.target.closest('#tipBtn');
    if (tipBtn) { tipItem(tipBtn.getAttribute('data-item'), tipBtn); return; }
    // 一键检测全部 / 停止：串行逐个调用（复用单模型检测）；运行中再点即停止
    var checkAllBtn = e.target.closest('#checkAllModels');
    if (checkAllBtn) { checkAllModels(checkAllBtn); return; }
    // 模型名称复制
    var copyBtn = e.target.closest('[data-model-copy]');
    if (copyBtn) { copyText(copyBtn.getAttribute('data-model-copy'), '已复制模型名称'); return; }
    // 模型列表折叠展开
    var toggleBtn = e.target.closest('.model-rows__toggle');
    if (toggleBtn) { toggleModelList(toggleBtn); return; }
    // 单模型可用性（真实问答）与掺水（质量评分）已拆分：两个独立按钮
    var modelCheckBtn = e.target.closest('[data-model-check]');
    if (modelCheckBtn) { checkModelAvailability(modelCheckBtn); return; }
    var modelVerifyBtn = e.target.closest('[data-model-verify]');
    if (modelVerifyBtn) { checkModelQuality(modelVerifyBtn); return; }
    var modelFlagBtn = e.target.closest('[data-model-flag]');
    if (modelFlagBtn) {
      if (!user) { showToast('请先登录'); openAuth('login'); return; }
      var flagModel = modelFlagBtn.getAttribute('data-model-flag');
      if (confirm('提醒后来人：模型「' + flagModel + '」你实测不可用？\n\n这只是众测提醒，会展示给后来人看，不会自动下线该 Token。\n多人提醒（1小时≥2人）会提示版主优先复测。')) {
        reportModelProbe(currentItemId, flagModel, false, 0, 0, 'report');
      }
      return;
    }
    if (e.target.closest('[data-action="close-modal"]')) closeDetail();
    var loginLink = e.target.closest('#tokenLoginLink');
    if (loginLink) { closeDetail(); setTimeout(function() { openAuth('login'); }, 200); return; }
    var ccBtn = e.target.closest('[data-action="ccswitch"]');
    if (ccBtn) {
      openCcAppPicker(
        ccBtn.getAttribute('data-name') || '',
        ccBtn.getAttribute('data-url') || '',
        ccBtn.getAttribute('data-token') || '',
        (ccBtn.getAttribute('data-compat') || '').split(',').filter(function (s) { return s; }),
        ccBtn.getAttribute('data-tokentype') || '',
        ccBtn.getAttribute('data-model') || ''
      );
      return;
    }
    var cfBtn = e.target.closest('[data-action="copyfull"]');
    if (cfBtn) {
      copyFullConfig({
        url: cfBtn.getAttribute('data-url') || '',
        token: cfBtn.getAttribute('data-token') || '',
        compat: (cfBtn.getAttribute('data-compat') || '').split(',').filter(function (s) { return s; }),
        tokenType: cfBtn.getAttribute('data-tokentype') || '',
        model: cfBtn.getAttribute('data-model') || ''
      });
      return;
    }
    if (e.target.closest('[data-action="cchelp"]')) { toggleCcHelp(); return; }
    if (e.target.closest('[data-action="ccdiag"]')) { diagnoseCcSwitch(); return; }
  });

if (detailContent) {
  detailContent.addEventListener('click', function(e) {
    if (e.target.closest('[data-action="open-wechat"]')) {
      closeDetail();
      setTimeout(openWechat, 300);
    }
  });
}

  // 个人主页贡献卡片：原地打开详情弹窗（SEO 链接已统一为 /item/:id；无 JS/爬虫走落地页；教程卡片是真实页面照常跳转）
  document.addEventListener('click', function(e) {
    var card = e.target.closest('a.user-card');
    if (!card) return;
    var href = card.getAttribute('href') || '';
    var m = href.match(/[?&]id=([A-Za-z0-9_-]+)/) || href.match(/\/item\/([A-Za-z0-9_-]+)/);
    if (!m) return;
    e.preventDefault();
    openDetail(m[1]);
  });

  // ============================================================
  // 完整榜单弹窗 + 一键分享（IIFE 顶层，全站可用，与首页 init 解耦）
  // ============================================================
  var listModalBody = document.getElementById('listModalBody');
  function openListModal(title, html) {
    if (!listModal) return;
    listModalBody.innerHTML = '<h2 class="modal__title">' + esc(title) + '</h2>' + html;
    listModal.classList.add('modal--open');
  }
  function shareContent(title, text, url) {
    // 统一走二维码卡片弹窗：Windows/桌面端 navigator.share 会弹系统分享，
    // 看不到我们设计的卡片。系统分享保留在弹窗里手动点。
    openShareModal(url || location.href, title || document.title);
  }
  // 根据页面 URL 选择对应的二维码海报端点
  // 规范地址：/item/:id、/tutorials/:id、/skills/:slug；/?id= 仅兼容旧分享深链
  function posterUrlFor(url) {
    var u;
    try { u = new URL(url, location.href); } catch (_) { return '/poster/site.png'; }
    var path = u.pathname || '';
    if (path === '/' || path === '') {
      var id = u.searchParams && u.searchParams.get('id');
      if (id) return '/poster/item/' + encodeURIComponent(id) + '.png';
      return '/poster/site.png';
    }
    var mItem = /^\/item\/([^/]+)$/.exec(path);
    if (mItem) return '/poster/item/' + encodeURIComponent(mItem[1]) + '.png';
    var m = /^\/tutorials\/([^/]+)$/.exec(path);
    if (m) return '/poster/tutorial/' + encodeURIComponent(m[1]) + '.png';
    var mSkill = /^\/skills\/([^/]+)$/.exec(path);
    if (mSkill) return '/poster/skill/' + encodeURIComponent(mSkill[1]) + '.png';
    return '/poster/site.png';
  }
  // 复制整张卡片图片到剪贴板；不支持则回退下载
  function copyCardImage(url) {
    var posterUrl = posterUrlFor(url);
    function downloadPoster(blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'freeapis-share.png';
      document.body.appendChild(a);
      a.click();
      setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
    }
    fetch(posterUrl).then(function(r) { return r.blob(); }).then(function(blob) {
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function() {
          showToast('卡片已复制，去微信聊天框粘贴即可');
        }).catch(function() {
          downloadPoster(blob);
          showToast('浏览器不支持复制图片，已改为下载');
        });
      }
      downloadPoster(blob);
      showToast('浏览器不支持复制图片，已改为下载');
    }).catch(function() {
      showToast('图片生成失败，请改用复制链接');
    });
  }
  function openShareModal(url, title) {
    openListModal('分享',
      '<div class="share-panel">' +
        '<p class="share-panel__title">' + esc(title) + '</p>' +
        '<div class="share-panel__poster"><div class="spinner"></div></div>' +
        '<button class="btn share-copy-img">' + svgIcon('image') + ' 复制图片</button>' +
        '<div class="share-panel__row">' +
          '<button class="btn btn--sm copy-btn" data-copy="' + esc(url) + '">' + svgIcon('link') + ' 复制链接</button>' +
          (navigator.share ? '<button class="btn btn--sm" id="shareNativeBtn">' + svgIcon('share-2') + ' 系统分享</button>' : '') +
        '</div>' +
        '<p class="share-panel__hint">' + svgIcon('message-circle') + ' 长按保存 · 发朋友圈/小红书直接可用 · 复制后粘贴到微信</p>' +
      '</div>');
    var box = listModalBody.querySelector('.share-panel__poster');
    var img = new Image();
    img.className = 'share-panel__poster-img';
    img.alt = '分享卡片';
    img.onload = function() { if (box) { box.innerHTML = ''; box.appendChild(img); } };
    img.onerror = function() { // 卡片不可用则回退到纯二维码
      fetch(API + '/qrcode?text=' + encodeURIComponent(url)).then(function(r) { return r.json(); }).then(function(d) {
        if (box && d.qrcode) box.innerHTML = '<img class="share-panel__poster-img" src="' + d.qrcode + '" alt="二维码">';
      }).catch(function() { if (box) box.innerHTML = ''; });
    };
    img.src = posterUrlFor(url);
    var copyBtn = listModalBody.querySelector('.share-copy-img');
    if (copyBtn) copyBtn.addEventListener('click', function() { copyCardImage(url); });
    var nativeBtn = document.getElementById('shareNativeBtn');
    if (nativeBtn) nativeBtn.addEventListener('click', function() {
      navigator.share({ title: title || '', url: url }).catch(function() {});
    });
  }
  function doShare(el) {
    if (!el) return;
    shareContent(
      el.getAttribute('data-share-title') || document.title,
      el.getAttribute('data-share-text') || '',
      el.getAttribute('data-share-url') || location.href
    );
  }
  // 任何带 data-share 的按钮都触发分享（详情弹窗 / 教程页 / 其他页面）
  document.addEventListener('click', function(e) {
    var shareBtn = e.target.closest('[data-share]');
    if (shareBtn) { e.preventDefault(); doShare(shareBtn); }
  });

  // 免责声明弹窗（全站 footer）
  var disclaimerModal = document.getElementById('disclaimerModal');
  function openDisclaimer() { if (disclaimerModal) disclaimerModal.classList.add('modal--open'); }
  function closeDisclaimer() { if (disclaimerModal) disclaimerModal.classList.remove('modal--open'); }

  // ============================================================
  // 公社信箱（反馈 / Bug 上报，单入口双标签）
  // ============================================================
  var feedbackModal = document.getElementById('feedbackModal');
  var feedbackView = document.getElementById('feedbackView');
  function openFeedback() {
    if (!feedbackModal || !feedbackView) return;
    if (!user) { showToast('请先登录'); openAuth('login'); return; }
    renderFeedbackForm('feedback');
    feedbackModal.classList.add('modal--open');
  }
  function closeFeedback() { if (feedbackModal) feedbackModal.classList.remove('modal--open'); }
  function renderFeedbackForm(kind) {
    kind = kind === 'bug' ? 'bug' : 'feedback';
    var cur = location.pathname + location.search;
    feedbackView.innerHTML =
      '<h2 class="modal__title">' + svgIcon('mail') + ' 公社信箱</h2>' +
      '<p class="fb-intro">' + (kind === 'bug' ? '抓到虫了？告诉我们，维护公社靠大家。' : '对公社有什么想法、建议或夸奖？都欢迎。') + '</p>' +
      '<div class="fb-points">' + svgIcon('award') + '高质量反馈 / 抓到虫，版主认可后 <b>+1 积分</b> —— 积分 = 贡献的账本</div>' +
      '<div class="fb-kind">' +
        '<button type="button" class="fb-kind__btn' + (kind === 'feedback' ? ' is-active' : '') + '" data-kind="feedback">' + svgIcon('message-square') + ' 反馈建议</button>' +
        '<button type="button" class="fb-kind__btn' + (kind === 'bug' ? ' is-active' : '') + '" data-kind="bug">' + svgIcon('bug') + ' 抓个虫</button>' +
      '</div>' +
      '<input type="hidden" id="fbKindVal" value="' + kind + '">' +
      '<div class="form-group"><label>内容 <span class="muted">（1-1000字）</span></label>' +
        '<textarea class="input" id="fbContent" rows="5" maxlength="1000" placeholder="' + (kind === 'bug' ? '描述 bug：现象、触发步骤、复现方法…' : '说说你的想法、建议或遇到的问题…') + '"></textarea></div>' +
      '<div class="form-group"><label>相关页面（选填）</label><input class="input" id="fbUrl" maxlength="500" value="' + esc(cur) + '"></div>' +
      '<div class="form-group"><label>图片（选填，PNG/JPG/WebP/GIF ≤3MB）</label>' +
        '<div class="uploader-mount" id="fbUploadMount"></div>' +
        '<input type="hidden" id="fbImgVal" value="">' +
      '</div>' +
      '<div class="form-actions"><button class="btn btn--primary" id="fbSubmit">' + svgIcon('send') + ' 提交</button>' +
      '<button class="btn btn--ghost" type="button" data-action="close-feedback">取消</button></div>';
    // 标签切换
    feedbackView.querySelectorAll('.fb-kind__btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-kind');
        document.getElementById('fbKindVal').value = k;
        feedbackView.querySelectorAll('.fb-kind__btn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        var c = document.getElementById('fbContent');
        if (c) c.placeholder = k === 'bug' ? '描述 bug：现象、触发步骤、复现方法…' : '说说你的想法、建议或遇到的问题…';
        var intro = feedbackView.querySelector('.fb-intro');
        if (intro) intro.textContent = k === 'bug' ? '抓到虫了？告诉我们，维护公社靠大家。' : '对公社有什么想法、建议或夸奖？都欢迎。';
      });
    });
    // 图片上传：复用可上传组件（点击选择 / 拖拽 / Ctrl+V 粘贴三合一，走 /api/upload）
    var fbImgVal = document.getElementById('fbImgVal');
    var fbUploadMount = document.getElementById('fbUploadMount');
    if (fbUploadMount && fbImgVal && typeof window.Uploader !== 'undefined') {
      window.Uploader.create({
        mount: fbUploadMount,
        token: function () { return token; },
        toast: showToast,
        hidden: fbImgVal
      });
    }
    // 提交
    var fbSubmit = document.getElementById('fbSubmit');
    if (fbSubmit) fbSubmit.addEventListener('click', function () {
      var content = document.getElementById('fbContent').value.trim();
      var kindV = document.getElementById('fbKindVal').value;
      if (!content) { showToast('请填写内容'); return; }
      fbSubmit.disabled = true;
      api('POST', '/feedback', {
        kind: kindV,
        content: content,
        url: document.getElementById('fbUrl').value.trim(),
        image: document.getElementById('fbImgVal').value
      }).then(function (r) {
        if (r.ok) {
          closeFeedback();
          showToast(kindV === 'bug' ? '虫已收到，感谢抓虫！版主认可后 +1 积分。' : '已送达公社信箱，贡献伟大，无需多言。');
        } else { fbSubmit.disabled = false; showToast(r.error || '提交失败'); }
      }).catch(function () { fbSubmit.disabled = false; showToast('提交失败'); });
    });
  }

  // ============================================================
  // Back to Top + Header Scroll
  // ============================================================
  var btt = document.getElementById('backToTop');
  if (btt) {
    btt.addEventListener('click', function() { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    var ticking = false;
    window.addEventListener('scroll', function() {
      if (!ticking) {
        requestAnimationFrame(function() { btt.classList.toggle('btt--show', window.scrollY > 400); ticking = false; });
        ticking = true;
      }
    });
  }
  var headerEl = document.getElementById('header');
  if (headerEl) {
    var hdrST = false;
    window.addEventListener('scroll', function() {
      if (!hdrST) {
        requestAnimationFrame(function() { headerEl.classList.toggle('header--scrolled', window.scrollY > 10); hdrST = false; });
        hdrST = true;
      }
    });
  }

  // ============================================================
  // Global Modal Close (Escape + backdrop click)
  // ============================================================
  function closeAllModals() {
    closeAuth(); closePublish(); closeWechat(); closeDetail(); closeList(); closeDisclaimer(); closeFeedback();
    // 教程发布弹窗在 /tutorials 页（tutorial.js 管理），ESC 一并关掉
    var tutModal = document.getElementById('tutPublishModal');
    if (tutModal) tutModal.classList.remove('modal--open');
  }
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeAllModals(); });
  document.querySelectorAll('.modal').forEach(function(m) {
    m.addEventListener('click', function(e) {
      if (e.target.closest('[data-action="close-auth"]')) closeAuth();
      if (e.target.closest('[data-action="close-publish"]')) closePublish();
      if (e.target.closest('[data-action="close-wechat"]')) closeWechat();
      if (e.target.closest('[data-action="close-modal"]')) closeDetail();
      if (e.target.closest('[data-action="close-list"]')) closeList();
      if (e.target.closest('[data-action="close-disclaimer"]')) closeDisclaimer();
      if (e.target.closest('[data-action="close-feedback"]')) closeFeedback();
    });
  });

  // ============================================================
  // Global Button Bindings
  // ============================================================
  // "发布 Token"：已登录直接打开发布，未登录先弹登录
  var authBtnEl = document.getElementById('authBtn');
  if (authBtnEl) authBtnEl.addEventListener('click', function(e) {
    e.preventDefault();
    if (user) { openPublish(); }
    else { showToast('请先登录'); openAuth('login'); }
  });

  // 独立的"登录"按钮（未登录时显示）
  var loginBtnEl = document.getElementById('headerLoginBtn');
  if (loginBtnEl) loginBtnEl.addEventListener('click', function(e) { e.preventDefault(); openAuth('login'); });

  // 免责声明（footer「完整免责声明」→ 弹窗）
  var disclaimerOpenEl = document.getElementById('disclaimerOpen');
  if (disclaimerOpenEl) disclaimerOpenEl.addEventListener('click', function(e) { e.preventDefault(); openDisclaimer(); });

  // ============================================================
  // Theme Toggle（浅色/深色）
  // ============================================================
  var themeToggleEl = document.getElementById('themeToggle');
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('freeapis-theme', t); } catch (e) {}
    document.querySelectorAll('.icon-sun').forEach(function(el) { el.style.display = t === 'dark' ? 'none' : 'inline-block'; });
    document.querySelectorAll('.icon-moon').forEach(function(el) { el.style.display = t === 'dark' ? 'inline-block' : 'none'; });
  }
  function getTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    return 'light'; // 默认浅色，不跟随系统主题
  }
  if (themeToggleEl) themeToggleEl.addEventListener('click', function() {
    applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
  });
  // 初始化图标（默认浅色，不跟随系统主题变化）
  applyTheme(getTheme());

  var userMenuBtnEl = document.getElementById('userMenuBtn');
  var userDropdownEl = document.getElementById('userDropdown');
  function toggleUserDropdown(force) {
    if (!userDropdownEl) return;
    var shouldOpen = force !== undefined ? force : !userDropdownEl.classList.contains('open');
    userDropdownEl.classList.toggle('open', shouldOpen);
    if (userMenuBtnEl) userMenuBtnEl.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  }
  if (userMenuBtnEl) userMenuBtnEl.addEventListener('click', function(e) {
    e.preventDefault(); e.stopPropagation();
    toggleUserDropdown();
  });
  document.addEventListener('click', function(e) {
    var userMenuEl = document.getElementById('userMenu');
    if (userMenuEl && !userMenuEl.contains(e.target)) toggleUserDropdown(false);
  });
  var logoutBtnEl = document.getElementById('logoutBtn');
  if (logoutBtnEl) logoutBtnEl.addEventListener('click', function(e) {
    e.preventDefault();
    token = null; user = null;
    localStorage.removeItem('token'); localStorage.removeItem('user');
    updateAuthUI(); toggleUserDropdown(false);
    window.dispatchEvent(new CustomEvent('auth-changed'));
    showToast('已退出');
  });

  var wechatBtnEl = document.getElementById('wechatBtn');
  if (wechatBtnEl) wechatBtnEl.addEventListener('click', function(e) { e.preventDefault(); openWechat(); });
  var footerWechatEl = document.getElementById('footerWechat');
  if (footerWechatEl) footerWechatEl.addEventListener('click', function(e) { e.preventDefault(); openWechat(); });
  // 公社信箱（反馈/Bug 上报）
  var footerFeedbackEl = document.getElementById('footerFeedback');
  if (footerFeedbackEl) footerFeedbackEl.addEventListener('click', function(e) { e.preventDefault(); openFeedback(); });

  // Mobile nav toggle
  var navToggle = document.getElementById('navToggle');
  var mainNav = document.getElementById('mainNav');
  if (navToggle && mainNav) {
    navToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      mainNav.classList.toggle('open');
      navToggle.classList.toggle('active');
    });
    document.addEventListener('click', function(e) {
      if (!mainNav.contains(e.target) && !navToggle.contains(e.target)) {
        mainNav.classList.remove('open');
        navToggle.classList.remove('active');
      }
    });
  }

  // ============================================================
  // Global Code Block Copy
  // ============================================================
  document.addEventListener('click', function(e) {
    // Guide page: .code-copy buttons inside .code-block__head
    var guideCopy = e.target.closest('.code-copy');
    if (guideCopy && guideCopy.closest('.code-block__head')) {
      var code = guideCopy.closest('.code-block').querySelector('pre');
      if (code) copyText(code.textContent);
      return;
    }
    // CLI page: .copy-btn inside .code-block
    var cliCopy = e.target.closest('.code-block .copy-btn');
    if (cliCopy) {
      var pre = cliCopy.closest('.code-block').querySelector('pre');
      if (pre) copyText(pre.textContent);
      return;
    }
    // Detail modal: copy-btn with data attributes (token/link)
    var copyBtn = e.target.closest('.copy-btn');
    if (copyBtn && !copyBtn.closest('.code-block')) {
      var val = copyBtn.getAttribute('data-token') || copyBtn.getAttribute('data-copy') || '';
      if (val) copyText(val);
    }
  });

  var publishBtnEl = document.getElementById('publishBtn');
  if (publishBtnEl) publishBtnEl.addEventListener('click', function(e) { e.preventDefault(); openPublish(); });
  var heroPublishBtn = document.getElementById('heroPublishBtn');
  if (heroPublishBtn) heroPublishBtn.addEventListener('click', function(e) { e.preventDefault(); openPublish(); });
  var emptyPublishBtn = document.getElementById('emptyPublishBtn');
  if (emptyPublishBtn) emptyPublishBtn.addEventListener('click', function(e) { e.preventDefault(); openPublish(); });
  var publishBtn2 = document.getElementById('publishBtn2');
  if (publishBtn2) publishBtn2.addEventListener('click', function(e) { e.preventDefault(); openPublish(); });

  // Event delegation for dynamically created publish buttons
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('#publishBtn, #publishBtn2, #emptyPublishBtn');
    if (btn) {
      e.preventDefault();
      openPublish();
    }
  });

  // ============================================================
  // Page Detection
  // ============================================================
  var bodyClass = document.body.classList;
  var isHome = bodyClass.contains('page-home');
  var isGuide = bodyClass.contains('page-guide');
  var isDashboard = bodyClass.contains('page-dashboard');
  var isCli = bodyClass.contains('page-cli');

  updateAuthUI();
  refreshUserProfile();
  // 「管理后台」入口角标 60s 轮询（refreshAdminBadge 内部对非 staff 直接跳过，零开销）
  setInterval(refreshAdminBadge, 60000);

  // ============================================================
  // HOME PAGE LOGIC
  // ============================================================
  if (isHome) {
    var PAGE_LIMIT = 12;
    var loadedItems = [];
    var categories = [];
    var currentCategory = '';
    var searchQ = '';
    var offset = 0;
    var hasMore = true;
    var loading = false;
    var totalCount = 0;
    var searchDebounce = null;

    function init() {
      var tabsEl = document.getElementById('tabs');
      var gridEl = document.getElementById('grid');
      if (tabsEl) tabsEl.addEventListener('click', function(e) {
        var tab = e.target.closest('.tab');
        if (!tab) return;
        currentCategory = tab.getAttribute('data-cat');
        if (currentCategory === '全部') currentCategory = '';
        renderTabs();
        fetchPage(true);
      });
      if (gridEl) gridEl.addEventListener('click', function(e) {
        var shareBtn = e.target.closest('.card [data-share]');
        if (shareBtn) { e.preventDefault(); e.stopPropagation(); doShare(shareBtn); return; }
        var cardTipBtn = e.target.closest('.card [data-tip]');
        if (cardTipBtn) { e.preventDefault(); e.stopPropagation(); tipItem(cardTipBtn.getAttribute('data-tip'), cardTipBtn); return; }
        var card = e.target.closest('.card');
        if (!card) return;
        openDetail(card.getAttribute('data-id'));
      });
      var heroSearchEl = document.getElementById('heroSearch');
      var stickySearchEl = document.getElementById('stickySearch');
      var stickyInputEl = document.getElementById('stickySearchInput');

      // 两个搜索框共用同一逻辑，且值双向同步
      function bindSearchInput(inputEl) {
        if (!inputEl) return;
        inputEl.addEventListener('input', function() {
          var v = this.value;
          var other = this.id === 'heroSearch' ? stickyInputEl : heroSearchEl;
          if (other && other.value !== v) other.value = v;
          clearTimeout(searchDebounce);
          var input = this;
          searchDebounce = setTimeout(function() { searchQ = input.value.trim(); fetchPage(true); }, 300);
        });
      }
      bindSearchInput(heroSearchEl);
      bindSearchInput(stickyInputEl);

      // 支持 ?search= 深链（/tools「免费用」角标、JSON-LD SearchAction 都指向 /?search=<产品>）
      var urlSearch = (new URLSearchParams(location.search).get('search') || '').trim();
      if (urlSearch) {
        searchQ = urlSearch;
        if (heroSearchEl) heroSearchEl.value = urlSearch;
        if (stickyInputEl) stickyInputEl.value = urlSearch;
      }

      // 支持 ?id= 分享深链：分享按钮/二维码海报/OG 图都产出 /?id=<条目id>，落地直接打开详情弹窗
      var urlId = (new URLSearchParams(location.search).get('id') || '').trim();
      if (urlId) openDetail(urlId);

      // 吸附搜索条：banner 滚出视野后滑出（导航栏下方），滚回顶部隐藏
      var heroEl = document.querySelector('.hero');
      if (stickySearchEl && heroEl) {
        var stickyRAF = null;
        function updateSticky() {
          stickyRAF = null;
          var gone = heroEl.getBoundingClientRect().bottom <= 80; // hero 底边滚过头顶即视为已隐藏
          stickySearchEl.classList.toggle('is-visible', gone);
        }
        window.addEventListener('scroll', function() {
          if (stickyRAF) return;
          stickyRAF = requestAnimationFrame(updateSticky);
        }, { passive: true });
        updateSticky();
      }


      loadCategories();
      fetchPage(true);
      loadStats();
      loadSidebar();
      setupInfiniteScroll();
      initCommentWall();
      initAnnouncements();
      syncSponsorStrip();
      initLiveFeed();
    }

    // ============================================================
    // 首页赞助细条（认证广告位，公告栏下方一行式）
    // 只在无搜索/无分类筛选时展示；当日关闭过的不再打扰；渲染后上报一次曝光；
    // 切筛选时同步显隐（fetchPage 成功后调用），列表滚动不重复拉取
    // ============================================================
    var sponsorFetched = false;
    function sponsorDismissKey(id) {
      var d = new Date();
      return 'sponsor_hide_' + id + '_' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }
    function syncSponsorStrip() {
      var bar = document.getElementById('annBar');
      if (!bar) return;
      var el = document.getElementById('sponsorStrip');
      if (currentCategory || searchQ) { if (el) el.remove(); return; } // 有筛选时退场，眼里只能有结果
      if (el || sponsorFetched) return;
      sponsorFetched = true;
      api('GET', '/api/sponsors?slot=home').then(function (res) { return res.json(); }).then(function (d) {
        var list = (d && d.sponsors) || [];
        if (!list.length) return;
        var s = list[0];
        if (!s || !s.id) return;
        try { if (localStorage.getItem(sponsorDismissKey(s.id))) return; } catch (_) {}
        var logoHtml = s.logo
          ? '<span class="sp-strip__logo"><img src="' + esc(s.logo) + '" alt="' + esc(s.name) + '"></span>'
          : '<span class="sp-strip__logo">' + esc(String(s.name || '?').charAt(0)) + '</span>';
        var node = document.createElement('div');
        node.className = 'sp-strip';
        node.id = 'sponsorStrip';
        node.innerHTML =
          '<span class="sp-strip__tag">推广</span>' + logoHtml +
          '<span class="sp-strip__txt"><b>' + esc(s.name) + '</b> · ' + esc(s.slogan || '') +
          (s.verifyScore ? '<span class="sp-strip__score">质检 ' + s.verifyScore + ' 分</span>' : '') + '</span>' +
          '<a class="sp-strip__cta" href="/go/' + esc(s.id) + '">去看看 →</a>' +
          '<button class="sp-strip__x" id="sponsorStripX" title="今天不再显示" aria-label="关闭推广">×</button>';
        bar.parentNode.insertBefore(node, bar.nextSibling);
        var x = document.getElementById('sponsorStripX');
        if (x) x.addEventListener('click', function () {
          try { localStorage.setItem(sponsorDismissKey(s.id), '1'); } catch (_) {}
          node.remove();
        });
        api('POST', '/api/sponsors/' + encodeURIComponent(s.id) + '/view', {}).catch(function () {});
      }).catch(function () { /* 广告拉取失败静默：公益内容不受影响 */ });
    }

    // ============================================================
    // 新 Token 实时推送（SSE → 无筛选时静默插入列表顶部，有筛选时提示条）
    // ============================================================
    function initLiveFeed() {
      var pill = document.getElementById('newItemsPill');
      if (!pill || !('EventSource' in window)) return;
      var countEl = pill.querySelector('.new-items-pill__count');
      var pending = 0;
      var knownIds = {};
      for (var k = 0; k < loadedItems.length; k++) knownIds[loadedItems[k].id] = true;
      var es = new EventSource(API + '/events');
      es.addEventListener('item_created', function(e) {
        var item;
        try { item = JSON.parse(e.data); } catch (_) { return; }
        if (!item || !item.id || knownIds[item.id]) return;
        knownIds[item.id] = true;
        // 无分类筛选/搜索 → 静默插入列表顶部（真正的无感刷新）；有筛选 → 回退提示条
        if (!currentCategory && !searchQ) {
          silentInsertItem(item);
        } else {
          pending++;
          if (countEl) countEl.textContent = pending;
          pill.classList.add('is-visible');
        }
      });
      // EventSource 断线自动重连；无需手动处理
      pill.addEventListener('click', function() {
        if (!pending) return;
        pending = 0;
        pill.classList.remove('is-visible');
        fetchPage(true);
      });
    }

    // 静默把新卡片插入列表顶部（带高亮动画），并同步分页状态避免与无限滚动错位
    function silentInsertItem(item) {
      var grid = document.getElementById('grid');
      if (!grid) return;
      var empty = document.getElementById('empty');
      if (empty) empty.style.display = 'none';
      if (!loadedItems.length) grid.innerHTML = '';
      var wrap = document.createElement('div');
      wrap.innerHTML = buildCard(item);
      var card = wrap.firstChild;
      if (!card) return;
      card.classList.add('card--live');
      if (grid.firstChild) grid.insertBefore(card, grid.firstChild);
      else grid.appendChild(card);
      setTimeout(function() { card.classList.remove('card--live'); }, 2600);
      loadedItems.unshift(item);
      offset++;
      totalCount++;
      var statTotal = document.getElementById('statTotal');
      if (statTotal) statTotal.textContent = totalCount;
    }

    // ============================================================
    // 评论墙（首页底部横向滚动弹幕墙）
    // ============================================================
    function initCommentWall() {
      var marquee = document.getElementById('commentMarquee');
      var track = document.getElementById('commentTrack');
      var openBtn = document.getElementById('commentOpenBtn');
      if (!marquee || !track || !openBtn) return;

      var PALETTE = 6;
      // 相邻气泡异色 + 首尾也异色（无缝循环接缝不撞色）
      function bubbleColor(pos, total) {
        var ci = pos % PALETTE;
        if (pos === total - 1) {
          var prev = (total - 2) % PALETTE;
          var guard = 0;
          while ((ci === prev || ci === 0) && guard < PALETTE) { ci = (ci + 1) % PALETTE; guard++; }
        }
        return ci;
      }
      function bubbleHtml(c, pos, total) {
        // 留言者昵称可点头像进个人主页（匿名/已删号则纯文本）；带小头像
        var nameHtml = c.authorId
          ? '<a class="comment-bubble__name" href="/user/' + esc(c.authorId) + '">' + miniAvatar(c.avatar, c.authorName) + esc(c.authorName) + '</a>'
          : '<span class="comment-bubble__name">' + esc(c.authorName) + '</span>';
        return '<div class="comment-bubble comment-bubble--c' + bubbleColor(pos, total) + '">' + nameHtml + '<span class="comment-bubble__text">' + esc(c.content) + '</span></div>';
      }
      function render(comments) {
        if (!comments || !comments.length) {
          marquee.innerHTML = '<div class="comment-bubble comment-bubble--c0"><span class="comment-bubble__text">还没有留言，来抢沙发～</span></div>';
          marquee.classList.add('is-static'); marquee.classList.remove('is-scrolling');
          return;
        }
        // 先渲染单份量测宽：不足一屏 → 静态居中；溢出 → 偶数份无缝滚动
        var one = comments.map(function(c, i) { return bubbleHtml(c, i, comments.length); }).join('');
        marquee.innerHTML = one;
        marquee.classList.add('is-static'); marquee.classList.remove('is-scrolling');
        var oneW = marquee.scrollWidth || 1;
        var trackW = track.clientWidth || 1200;
        if (oneW > trackW) {
          var reps = Math.max(2, Math.ceil((trackW * 2) / oneW));
          if (reps % 2) reps++;
          marquee.innerHTML = one.repeat(reps);
          marquee.classList.remove('is-static'); marquee.classList.add('is-scrolling');
        }
      }

      fetch(API + '/comments?limit=30').then(function(r) { return r.json(); }).then(function(d) {
        render(d.comments || []);
      }).catch(function() { /* 保留 SSR 内容 */ });

      // 「我也说一句」：登录门槛 + 行内输入
      var composer = document.createElement('div');
      composer.className = 'comment-wall__composer';
      composer.style.display = 'none';
      composer.innerHTML =
        '<input class="comment-wall__input" id="commentInput" maxlength="100" placeholder="说点什么…（最多 100 字）">' +
        '<button class="comment-wall__send" id="commentSendBtn">' + svgIcon('send') + ' 发送</button>';
      track.parentNode.insertBefore(composer, track);

      openBtn.addEventListener('click', function() {
        if (!token) { openAuth('login'); return; }
        composer.style.display = 'flex';
        document.getElementById('commentInput').focus();
      });

      function send() {
        var input = document.getElementById('commentInput');
        var val = input ? input.value.trim() : '';
        if (!val) { showToast('留言不能为空'); return; }
        api('POST', '/comments', { content: val }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); }).then(function(rr) {
          if (!rr.ok) { showToast(rr.d.error || '发送失败'); return; }
          showToast('已上墙！');
          input.value = '';
          fetch(API + '/comments?limit=30').then(function(r) { return r.json(); }).then(function(d) { render(d.comments || []); }).catch(function() {});
        }).catch(function() { showToast('发送失败'); });
      }

      var sendBtn = document.getElementById('commentSendBtn');
      var inputEl = document.getElementById('commentInput');
      if (sendBtn) sendBtn.addEventListener('click', send);
      if (inputEl) inputEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    }

    // ============================================================
    // 公告栏（Banner 下方独立滚动条，管理员官方通知）
    // ============================================================
    function initAnnouncements() {
      var bar = document.getElementById('annBar');
      var marquee = document.getElementById('annMarquee');
      var track = document.getElementById('annTrack');
      var moreBtn = document.getElementById('annMoreBtn');
      if (!bar || !marquee || !track) return;

      function render(list) {
        if (!list || !list.length) { bar.style.display = 'none'; return; }
        bar.style.display = '';
        var one = list.map(function(a) { return '<span class="ann-bubble"><span class="ann-bubble__text">' + esc(a.content) + '</span></span>'; }).join('');
        marquee.innerHTML = one;
        marquee.classList.add('is-static'); marquee.classList.remove('is-scrolling');
        var oneW = marquee.scrollWidth || 1;
        var trackW = track.clientWidth || 1200;
        if (oneW > trackW) {
          var reps = Math.max(2, Math.ceil((trackW * 2) / oneW));
          if (reps % 2) reps++;
          marquee.innerHTML = one.repeat(reps);
          marquee.classList.remove('is-static'); marquee.classList.add('is-scrolling');
        }
      }

      fetch(API + '/announcements?limit=20').then(function(r) { return r.json(); }).then(function(d) {
        render(d.announcements || []);
      }).catch(function() { /* 保留 SSR 内容 */ });

      if (moreBtn) {
        moreBtn.addEventListener('click', function() {
          fetch(API + '/announcements?limit=100').then(function(r) { return r.json(); }).then(function(d) {
            var list = d.announcements || [];
            if (!list.length) { openListModal('全部公告', '<div class="panel__empty">暂无公告</div>'); return; }
            var html = '<div class="list-full">' + list.map(function(a) {
              return '<div class="ann-item"><p class="ann-item__text">' + esc(a.content) + '</p><span class="ann-item__date">' + esc((a.createdAt || '').slice(0, 16).replace('T', ' ')) + '</span></div>';
            }).join('') + '</div>';
            openListModal('全部公告', html);
          }).catch(function() { showToast('加载公告失败'); });
        });
      }
    }

    async function loadSidebar() {
      try {
        var results = await Promise.all([
          fetch(API + '/leaderboard?limit=5').then(function(r) { return r.json(); }),
          fetch(API + '/recent-activity?limit=10').then(function(r) { return r.json(); }),
          fetchStats()
        ]);
        renderLeaderboard(results[0]);
        renderActivity(results[1]);
        var statUsers = document.getElementById('statUsers');
        if (results[2] && results[2].users !== undefined && statUsers) statUsers.textContent = results[2].users;
      } catch (_) {}
    }

    function renderLeaderboard(data) {
      var body = document.getElementById('leaderboardBody');
      if (!body) return;
      if (!data.length) { body.innerHTML = '<div class="panel__empty">还没有贡献者</div>'; return; }
      var medals = ['crown', 'award', 'star'];
      var medalColors = ['#f59e0b', '#94a3b8', '#d97706'];
      function lbRow(entry, i) {
        var rankHtml;
        if (i < 3) {
          rankHtml = '<span class="lb-rank" style="color:' + medalColors[i] + '">' + svgIcon(medals[i]) + '</span>';
        } else {
          rankHtml = '<span class="lb-rank" style="color:var(--text-muted);font-weight:700">#' + (i + 1) + '</span>';
        }
        // 昵称可点头像进个人主页（贡献者的「被看见」入口）
        var nameHtml = entry.userId
          ? '<a class="lb-name" href="/user/' + esc(entry.userId) + '">' + miniAvatar(entry.avatar, displayName(entry)) + esc(displayName(entry)) + '</a>'
          : '<span class="lb-name">' + esc(displayName(entry)) + '</span>';
        return '<div class="lb-item">' + rankHtml + nameHtml + '<span class="lb-count">' + entry.count + '</span></div>';
      }
      var html = '';
      for (var i = 0; i < data.length; i++) {
        html += lbRow(data[i], i);
      }
      html += '<div class="panel__more"><a href="#" class="panel__more-link" data-more="leaderboard">查看完整榜单 ' + svgIcon('chevron-right') + '</a></div>';
      body.innerHTML = html;
      var more = body.querySelector('[data-more="leaderboard"]');
      if (more) more.addEventListener('click', function(e) { e.preventDefault(); openFullLeaderboard(); });
    }

    function renderActivity(data) {
      var body = document.getElementById('activityBody');
      if (!body) return;
      if (!data.length) { body.innerHTML = '<div class="panel__empty">暂无动态</div>'; return; }
      var html = '';
      for (var i = 0; i < data.length; i++) {
        var item = data[i];
        var time = item.created_at ? item.created_at.slice(0, 10) : '';
        if (item.type === 'tip') {
          // 打赏事件：「xx 认可了 yy」——社交事件比纯发布动态更有社区感
          var tipper = item.tipByNickname || item.tipByUsername || '有人';
          html += '<div class="act-item act-item--tip">' + svgIcon('gem') +
            '<a href="#" class="act-name" data-id="' + esc(item.id) + '">' + esc(item.name) + '</a>' +
            '<span class="act-meta">' + miniAvatar(item.tipByAvatar, tipper) + esc(tipper) + ' 认可了 ' + esc(displayName(item)) + ' · ' + time + '</span></div>';
        } else {
          html += '<div class="act-item"><a href="#" class="act-name" data-id="' + esc(item.id) + '">' + esc(item.name) + '</a><span class="act-meta">' + miniAvatar(item.avatar, displayName(item)) + esc(displayName(item)) + ' · ' + time + '</span></div>';
        }
      }
      body.innerHTML = html;
      body.querySelectorAll('.act-name').forEach(function(el) {
        el.addEventListener('click', function(e) {
          e.preventDefault();
          openDetail(this.getAttribute('data-id'));
        });
      });
    }

    // ===== 完整榜单（弹窗） =====
    // （openListModal 与一键分享逻辑已移至 IIFE 顶层，全站可用）

    async function openFullLeaderboard() {
      if (!listModal) return;
      openListModal('贡献榜', '<div class="list-loading"><div class="spinner"></div></div>');
      try {
        var res = await fetch(API + '/leaderboard?limit=100');
        var data = await res.json();
        if (!data.length) { openListModal('贡献榜', '<div class="panel__empty">还没有贡献者</div>'); return; }
        var medals = ['crown', 'award', 'star'];
        var medalColors = ['#f59e0b', '#94a3b8', '#d97706'];
        var html = '';
        for (var i = 0; i < data.length; i++) {
          var rankHtml;
          if (i < 3) {
            rankHtml = '<span class="lb-rank" style="color:' + medalColors[i] + '">' + svgIcon(medals[i]) + '</span>';
          } else {
            rankHtml = '<span class="lb-rank" style="color:var(--text-muted);font-weight:700">#' + (i + 1) + '</span>';
          }
          var nameHtml = data[i].userId
            ? '<a class="lb-name" href="/user/' + esc(data[i].userId) + '">' + miniAvatar(data[i].avatar, displayName(data[i])) + esc(displayName(data[i])) + '</a>'
            : '<span class="lb-name">' + esc(displayName(data[i])) + '</span>';
          html += '<div class="lb-item">' + rankHtml + nameHtml + '<span class="lb-count">' + data[i].count + '</span></div>';
        }
        openListModal('贡献榜', '<div class="list-full">' + html + '</div>');
      } catch (e) {
        openListModal('贡献榜', '<div class="panel__empty">加载失败</div>');
      }
    }

    async function loadCategories() {
      try {
        var res = await fetch(API + '/categories');
        if (!res.ok) return;
        categories = await res.json();
        renderTabs();
      } catch (_) {}
    }

    var pendingReset = false;
    async function fetchPage(reset) {
      if (loading) { if (reset) pendingReset = true; return; }
      if (reset) { offset = 0; hasMore = true; }
      if (!hasMore) return;
      loading = true;
      renderMore();
      try {
        var params = new URLSearchParams();
        params.set('limit', PAGE_LIMIT);
        params.set('offset', offset);
        if (currentCategory) params.set('category', currentCategory);
        if (searchQ) params.set('search', searchQ);
        var res = await api('GET', '/items?' + params.toString());
        if (!res.ok) throw new Error('请求失败');
        var items = await res.json();
        totalCount = parseInt(res.headers.get('X-Total-Count') || '0', 10) || 0;
        var prevLen = loadedItems.length;
        if (reset) loadedItems = items; else loadedItems = loadedItems.concat(items);
        offset += items.length;
        hasMore = offset < totalCount;
        renderGrid(reset ? 0 : prevLen);
        renderMore();
        syncSponsorStrip();
        if (reset && window.scrollY > 100) {
          var host = document.getElementById('gridHost');
          if (host) host.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (e) {
        var grid = document.getElementById('grid');
        if (grid) grid.innerHTML = '<div class="empty"><div class="empty__icon">⚠️</div><p class="empty__text">' + esc(e.message) + '</p></div>';
      } finally {
        loading = false;
        renderMore();
        // 在途期间又来了 reset（搜索词变了/切了分类）：补发一次，避免列表停留旧数据
        if (pendingReset) { pendingReset = false; fetchPage(true); }
      }
    }

    function renderMore() {
      var moreEl = document.getElementById('gridMore');
      var textEl = document.getElementById('gridMoreText');
      if (!moreEl || !textEl) return;
      if (!loadedItems.length) { moreEl.style.display = 'none'; return; }
      moreEl.style.display = '';
      if (loading) { textEl.textContent = '加载中…'; return; }
      if (!hasMore) { textEl.textContent = '已显示全部 ' + totalCount + ' 条'; return; }
      moreEl.style.display = 'none';
    }

    function setupInfiniteScroll() {
      var sentinel = document.getElementById('gridSentinel');
      if (!sentinel || !('IntersectionObserver' in window)) return;
      var io = new IntersectionObserver(function(entries) {
        if (entries[0].isIntersecting && hasMore && !loading) fetchPage(false);
      }, { rootMargin: '300px' });
      io.observe(sentinel);
    }

    // stats 单飞：loadStats 与 loadSidebar 共享同一次请求（此前 /api/stats 每次首屏被拉 2 次）
    var statsPromise = null;
    function fetchStats() {
      if (!statsPromise) {
        statsPromise = fetch(API + '/stats').then(function(r) { return r.ok ? r.json() : null; })
          .catch(function() { return null; });
      }
      return statsPromise;
    }

    async function loadStats() {
      var s = await fetchStats();
      if (!s) return;
      var el;
      if ((el = document.getElementById('statTotal'))) el.textContent = s.total;
      if ((el = document.getElementById('statCats'))) el.textContent = s.categories;
      if ((el = document.getElementById('statProv'))) el.textContent = s.providers;
    }

    function renderTabs() {
      var html = '<span class="tab' + (!currentCategory ? ' tab--active' : '') + '" data-cat="全部">全部</span>';
      for (var j = 0; j < categories.length; j++) {
        var c = categories[j];
        var active = c === currentCategory;
        html += '<span class="tab' + (active ? ' tab--active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</span>';
      }
      var tabsEl = document.getElementById('tabs');
      if (tabsEl) tabsEl.innerHTML = html;
    }

    function renderGrid(start) {
      var grid = document.getElementById('grid');
      var empty = document.getElementById('empty');
      if (!grid) return;
      if (!loadedItems.length) {
        grid.innerHTML = '';
        if (empty) {
          empty.style.display = 'block';
          var txt = empty.querySelector('.empty__text');
          if (txt) txt.textContent = searchQ ? '没有找到与「' + searchQ + '」相关的 Token' : '还没有数据';
          var btn = empty.querySelector('#emptyPublishBtn');
          if (btn) btn.style.display = searchQ ? 'none' : '';
        }
        return;
      }
      if (empty) empty.style.display = 'none';
      if (start === 0) {
        var html = '';
        for (var i = 0; i < loadedItems.length; i++) html += buildCard(loadedItems[i]);
        grid.innerHTML = html;
      } else {
        var appendHtml = '';
        for (var j = start; j < loadedItems.length; j++) appendHtml += buildCard(loadedItems[j]);
        grid.insertAdjacentHTML('beforeend', appendHtml);
      }
    }

    function buildCard(item) {
      var catIcon = categoryIcon(item.category, item.provider);
      var badgeHtml = '';
      if (item.compat && item.compat.length) {
        if (item.compat.indexOf('openai') !== -1) badgeHtml += '<span class="badge badge--openai">OpenAI 兼容</span>';
        if (item.compat.indexOf('anthropic') !== -1) badgeHtml += '<span class="badge badge--anthropic">Anthropic 兼容</span>';
      }
      if (!badgeHtml) {
        badgeHtml = item.tokenType
          ? '<span class="badge ' + badgeClass(item.tokenType) + '">' + esc(item.tokenType) + '</span>'
          : '<span class="badge badge--muted">' + esc(item.category || '其他') + '</span>';
      }
      var verifiedHtml = item.verified ? '<span class="verified-badge" title="已验证">' + svgIcon('check') + '</span>' : '';
      var provider = item.provider || item.category || '';
      var tagsHtml = '';
      if (item.tags && item.tags.length) {
        var shown = item.tags.slice(0, 3);
        for (var t = 0; t < shown.length; t++) tagsHtml += '<span class="card__tag">#' + esc(shown[t]) + '</span>';
        if (item.tags.length > 3) tagsHtml += '<span class="card__tag card__tag--more">+' + (item.tags.length - 3) + '</span>';
      }
      // 卡片直打赏：本人条目显示被认可数（有认可才显示）；已打赏变绿；其余可点（未登录点击引导登录）
      var tipHtml = '';
      var tipCountNum = Number(item.tipCount || 0);
      if (item.createdBy && user && user.id === item.createdBy) {
        if (tipCountNum > 0) tipHtml = '<span class="card__tip card__tip--mine" title="这条 Token 被认可 ' + tipCountNum + ' 次">' + svgIcon('gem') + '<b>' + tipCountNum + '</b></span>';
      } else if (item.createdBy && user && item.tipped) {
        tipHtml = '<button class="card__tip is-done" disabled title="已打赏">' + svgIcon('gem') + (tipCountNum ? '<b>' + tipCountNum + '</b>' : '') + '</button>';
      } else if (item.createdBy) {
        tipHtml = '<button class="card__tip" data-tip="' + esc(item.id) + '" data-count="' + tipCountNum + '" title="打赏 1 积分给发布者" aria-label="打赏">' + svgIcon('gem') + (tipCountNum ? '<b>' + tipCountNum + '</b>' : '') + '</button>';
      }
      var viewCostHtml = '';
      var hasTokenForView = !!(item.tokenLocked || item.token);
      if (hasTokenForView) {
        if (!user) viewCostHtml = '<a href="/points" class="card__cost" title="登录后查看需1积分（已看过免费）" style="text-decoration:none">' + svgIcon('gem') + ' 登录查看</a>';
        else if (user && (user.role==='admin'||user.role==='moderator' || user.id===item.createdBy)) viewCostHtml = '<span class="card__cost card__cost--free">免费查看</span>';
        else viewCostHtml = '<a href="/points" class="card__cost" title="首次查看扣1积分，已看过免费，点此看规则" style="text-decoration:none">' + svgIcon('gem') + ' 1积分 ' + svgIcon('help-circle') + '</a>';
      }
      return '<article class="card" data-id="' + esc(item.id) + '">' +
        '<div class="card__head">' +
          '<div class="card__icon is-svg">' + svgIcon(catIcon) + '</div>' +
          '<div class="card__info">' +
            '<h3 class="card__name"><span class="card__name-text">' + esc(item.name) + '</span>' + verifiedHtml + '</h3>' +
            '<div class="card__provider">' + esc(provider) + '</div>' +
          '</div>' +
        '</div>' +
        '<p class="card__desc">' + esc(item.desc || '点击查看详情') + '</p>' +
        (tagsHtml ? '<div class="card__tags">' + tagsHtml + '</div>' : '') +
        '<div class="card__foot">' + (badgeHtml ? '<div class="card__badges">' + badgeHtml + '</div>' : '') + '<div class="card__foot-actions">' +
          viewCostHtml + tipHtml +
          '<button class="card__share" data-share data-share-url="' + esc(canonicalBase() + '/item/' + item.id) + '" data-share-title="' + esc(item.name) + '" data-share-text="' + esc((item.desc || item.provider || '') + ' — free-tokens Token公益站') + '" title="分享" aria-label="分享">' + svgIcon('share-2') + '</button>' +
          '<span class="card__arrow">查看详情 ' + svgIcon('arrow-right') + '</span>' +
        '</div></div>' +
      '</article>';
    }


    init();
  }

  // ============================================================
  // GUIDE PAGE: FAQ toggle
  // ============================================================
  if (isGuide) {
    document.addEventListener('DOMContentLoaded', function() {
      document.querySelectorAll('.qa-q').forEach(function(el) {
        el.addEventListener('click', function() {
          this.classList.toggle('open');
          var answer = this.nextElementSibling;
          if (answer) answer.classList.toggle('open');
        });
      });
    });
  }

  // ============================================================
  // Expose shared utilities for page-specific scripts (dashboard)
  // ============================================================
  window.TokenApp = {
    esc: esc, badgeClass: badgeClass,
    headers: headers, api: api,
    showToast: showToast, copyText: copyText,
    openAuth: openAuth, closeAuth: closeAuth,
    openPublish: openPublish, closePublish: closePublish,
    openWechat: openWechat, closeWechat: closeWechat,
    updateAuthUI: updateAuthUI, refreshUserProfile: refreshUserProfile,
    getToken: function() { return token; },
    getUser: function() { return user; },
    setAuth: function(t, u) {
      token = t; user = u;
      localStorage.setItem('token', t);
      localStorage.setItem('user', JSON.stringify(u));
      updateAuthUI();
    },
    clearAuth: function() {
      token = null; user = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      updateAuthUI();
      window.dispatchEvent(new CustomEvent('auth-changed'));
    }
  };
})();
