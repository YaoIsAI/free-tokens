// 每日签到 — Header 按钮 + 日历弹窗
(function () {
  'use strict';
  var T = window.TokenApp;
  var btn = document.getElementById('checkinBtn');
  var dot = document.getElementById('checkinDot');
  var modal = document.getElementById('checkinModal');
  var view = document.getElementById('checkinView');
  if (!btn || !view) return;
  // 依赖 TokenApp 存在，但即使没有也允许未登录态点击引导登录
  function esc(s) { return T && T.esc ? T.esc(String(s == null ? '' : s)) : String(s).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function icon(name){ return '<svg class="ic" aria-hidden="true" focusable="false"><use href="#lucide-' + name + '"/></svg>'; }
  var stateCache = null;

  function updateBtn(state) {
    stateCache = state;
    var checked = state && state.checkedToday;
    var streak = state ? (state.streak || 0) : 0;
    var txt = btn.querySelector('.checkin-btn__text');
    if (checked) {
      btn.classList.add('checkin-btn--checked');
      if (txt) txt.textContent = streak > 1 ? '已签·' + streak + '天' : '已签到';
      if (dot) dot.style.display = 'none';
      btn.title = '今日已签到，连击 ' + streak + ' 天';
    } else {
      btn.classList.remove('checkin-btn--checked');
      if (txt) txt.textContent = streak > 0 ? '签到·' + streak + '天' : '签到';
      if (dot) dot.style.display = (state && T && T.getToken && T.getToken()) ? '' : 'none';
      // 未登录也显示签到，点开后引导登录
      if (!T || !T.getToken || !T.getToken()) {
        if (dot) dot.style.display = 'none';
        if (txt) txt.textContent = '签到';
      }
      btn.title = checked ? '今日已签到' : '每日签到领积分';
    }
  }

  async function fetchState() {
    if (!T || !T.getToken || !T.getToken()) {
      updateBtn(null);
      return null;
    }
    try {
      var res = await T.api('GET', '/checkin');
      if (!res.ok) { updateBtn(null); return null; }
      var data = await res.json();
      updateBtn(data);
      return data;
    } catch (_) { updateBtn(null); return null; }
  }

  function renderCalendar(state) {
    var today = state.today || new Date().toISOString().slice(0,10);
    var month = state.month || today.slice(0,7);
    var calendarSet = {};
    (state.calendar || []).forEach(function(d){ calendarSet[d] = true; });
    var parts = month.split('-');
    var y = parseInt(parts[0],10), m = parseInt(parts[1],10);
    var firstDay = new Date(y, m-1, 1);
    var lastDay = new Date(y, m, 0).getDate();
    var startWeek = firstDay.getDay(); // 0 Sun
    // 把周一作为第一列： (startWeek+6)%7
    var offset = (startWeek + 6) % 7;
    var totalCells = offset + lastDay;
    var rows = Math.ceil(totalCells / 7);
    var html = '<div class="checkin-hero">';
    html += '<div class="checkin-hero__icon">' + icon(state.checkedToday ? 'check' : 'gift') + '</div>';
    if (state.checkedToday) {
      html += '<div class="checkin-hero__streak">' + esc(state.streak || 1) + ' 天</div>';
      html += '<div class="checkin-hero__label">已连续签到 · 今日已签到</div>';
      var bonus = '';
      if ((state.streak || 0) % 30 === 0) bonus = '30天里程碑额外 +5 积分';
      else if ((state.streak || 0) % 7 === 0) bonus = '7天连击额外 +2 积分';
      if (bonus) html += '<div class="checkin-hero__bonus">' + icon('sparkles') + ' ' + esc(bonus) + '</div>';
    } else {
      html += '<div class="checkin-hero__streak">' + esc(state.streak || 0) + ' 天</div>';
      html += '<div class="checkin-hero__label">已连续签到 · 今日未签到</div>';
      html += '<div class="checkin-hero__bonus" style="background:var(--surface-3);color:var(--text-muted)">签到领 1 积分，连击 7 天额外 +2，30 天额外 +5</div>';
    }
    html += '</div>';

    html += '<div class="checkin-stats"><div class="checkin-stat"><div class="checkin-stat__num">' + esc(state.total || 0) + '</div><div class="checkin-stat__label">累计签到</div></div>';
    html += '<div class="checkin-stat"><div class="checkin-stat__num">' + esc(state.streak || 0) + '</div><div class="checkin-stat__label">连续天数</div></div>';
    html += '<div class="checkin-stat"><div class="checkin-stat__num">' + esc(state.points || 0) + '</div><div class="checkin-stat__label">当前积分</div></div></div>';

    html += '<div class="checkin-calendar"><div class="checkin-calendar__head"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>';
    html += '<div class="checkin-calendar__grid">';
    // 空白占位
    for (var i = 0; i < offset; i++) {
      var d = new Date(y, m-1, 1 - offset + i);
      var ds = d.toISOString().slice(0,10);
      var isChecked = !!calendarSet[ds];
      html += '<div class="checkin-calendar__cell checkin-calendar__cell--other' + (isChecked ? ' checkin-calendar__cell--checked' : '') + '">' + (d.getDate()) + '</div>';
    }
    for (var day = 1; day <= lastDay; day++) {
      var ds2 = y + '-' + String(m).padStart(2,'0') + '-' + String(day).padStart(2,'0');
      var checked = !!calendarSet[ds2];
      var isToday = ds2 === today;
      var cls = 'checkin-calendar__cell' + (checked ? ' checkin-calendar__cell--checked' : '') + (isToday ? ' checkin-calendar__cell--today' : '');
      html += '<div class="' + cls + '">' + day + '</div>';
    }
    var remain = rows * 7 - totalCells;
    for (var j = 1; j <= remain; j++) {
      var d2 = new Date(y, m, j);
      var ds3 = d2.toISOString().slice(0,10);
      var ck = !!calendarSet[ds3];
      html += '<div class="checkin-calendar__cell checkin-calendar__cell--other' + (ck ? ' checkin-calendar__cell--checked' : '') + '">' + j + '</div>';
    }
    html += '</div></div>';

    html += '<div class="checkin-actions">';
    if (state.checkedToday) {
      html += '<button class="btn btn--primary checkin-btn--primary" disabled>' + icon('check') + ' 今日已签到</button>';
      html += '<div class="checkin-tip">明日再来，连续签到可获额外奖励</div>';
    } else {
      html += '<button class="btn btn--primary checkin-btn--primary" id="doCheckinBtn">' + icon('gift') + ' 立即签到 +1 积分</button>';
      html += '<div class="checkin-tip">每日可签到一次，连击 7 天额外 +2，30 天额外 +5</div>';
    }
    html += '</div>';
    return html;
  }

  function openModal(state) {
    if (!state) {
      view.innerHTML = '<div class="checkin-hero"><div class="checkin-hero__icon">' + icon('calendar') + '</div><div class="checkin-hero__streak">签到领积分</div><div class="checkin-hero__label">登录后每日签到可得 1 积分</div></div><div class="checkin-actions"><button class="btn btn--primary checkin-btn--primary" id="checkinLoginBtn">' + icon('log-in') + ' 去登录</button><div class="checkin-tip">注册即可签到，连续签到有额外奖励</div></div>';
      modal.classList.add('modal--open');
      var lb = document.getElementById('checkinLoginBtn');
      if (lb) lb.addEventListener('click', function(){ modal.classList.remove('modal--open'); if (T && T.openAuth) T.openAuth('login'); });
      return;
    }
    view.innerHTML = renderCalendar(state);
    modal.classList.add('modal--open');
    var btn2 = document.getElementById('doCheckinBtn');
    if (btn2) btn2.addEventListener('click', async function(){
      btn2.disabled = true; btn2.textContent = '签到中...';
      try {
        var res = await T.api('POST', '/checkin', {});
        var data = await res.json().catch(function(){ return {}; });
        if (!res.ok) {
          T.showToast(data.error || '签到失败');
          btn2.disabled = false; btn2.innerHTML = icon('gift') + ' 立即签到 +1 积分';
          return;
        }
        var msg = data.already ? '今日已签到' : ('签到成功 +' + (data.points || 1) + ' 积分' + (data.streak > 1 ? '，已连击 ' + data.streak + ' 天' : ''));
        T.showToast(msg);
        // 刷新状态并重渲染
        var ns = await fetchState();
        if (ns) view.innerHTML = renderCalendar(ns);
        // 刷新头部积分显示（触发全局事件，app.js 监听后可刷新）
        window.dispatchEvent(new Event('checkin-done'));
        // 同步更新本地积分缓存显示（如果 app.js 暴露）
        if (T && T.refreshPoints) try { T.refreshPoints(); } catch(_){}
      } catch (e) {
        T.showToast('签到失败，请重试');
        btn2.disabled = false; btn2.innerHTML = icon('gift') + ' 立即签到 +1 积分';
      }
    });
  }

  btn.addEventListener('click', async function(){
    // 未登录直接引导登录
    if (!T || !T.getToken || !T.getToken()) {
      openModal(null);
      return;
    }
    var s = stateCache;
    // 若缓存为空或今日未签，先拉最新
    if (!s || !s.today) s = await fetchState();
    openModal(s || stateCache);
  });

  // 关闭弹窗：复用全局 modal 关闭逻辑 + 专用
  modal.addEventListener('click', function(e){
    if (e.target.closest('[data-action="close-checkin"]') || e.target.classList.contains('modal__backdrop')) {
      modal.classList.remove('modal--open');
    }
  });
  // ESC 关闭
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && modal.classList.contains('modal--open')) modal.classList.remove('modal--open'); });

  // 初始化：加载状态
  fetchState();
  // 登录态变化后刷新
  window.addEventListener('auth-changed', fetchState);
  window.addEventListener('checkin-done', fetchState);
  // 全局暴露供 app.js 调用
  window.Checkin = { refresh: fetchState, open: function(){ btn.click(); } };
})();
