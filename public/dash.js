(function() {
    'use strict';
    var T = window.TokenApp;
    if (!T) return;
    function ic(name) {
      return '<svg class="ic" aria-hidden="true" focusable="false"><use href="#lucide-' + name + '"/></svg>';
    }
    var dashRoot = document.getElementById('dashRoot');
    var editModal = document.getElementById('editModal');
    var editView = document.getElementById('editView');
    var cachedItems = [];
    var cachedTuts = []; // 我的教程缓存，供编辑弹窗
    var currentTab = 'mine';
    var pointsMonth = ''; // 积分日历当前月份（空=当月）
    var inviteFilter = 'unused'; // 邀请码列表筛选（unused/used）
    var userMonth = ''; // 用户注册日历当前月份（空=当月）
    var editingAnnId = null; // 公告编辑中的 id（null=新增模式）
    // 审核/反馈 tab 筛选状态：必须在 initDash()（下方较早的调用）之前初始化，
    // 否则 var 提升让首次同步执行到 await 前读到 undefined（请求 ?status=undefined = 后端按「全部」返回）
    var auditStatus = 'pending'; // 条目审核：pending/verified/all/trash
    var tutStatus = 'pending';   // 教程审核：pending/verified/all
    var skillStatus = 'pending'; // Skill审核：pending/online/rejected/all
    var fbStatus = 'all';        // 反馈：all/open/done
    var sponsorStatus = 'all';   // 广告：all/pending/qualified/active/rejected/offline/expired

    // ===== 积分卡片（月度日历 + 明细弹窗）助手 =====
    function pad2(n) { return n < 10 ? '0' + n : '' + n; }
    function pointsMonthLabel(month) {
      if (!month) return '';
      var p = month.split('-');
      return p[0] + '年' + parseInt(p[1], 10) + '月';
    }
    function shiftMonth(month, delta) {
      var d = (month && /^\d{4}-\d{2}$/.test(month)) ? new Date(parseInt(month.slice(0, 4), 10), parseInt(month.slice(5, 7), 10) - 1, 1) : new Date();
      d.setMonth(d.getMonth() + delta);
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
    }
    function localDateKey(createdAt) {
      var dt = new Date(String(createdAt).replace(' ', 'T') + 'Z');
      if (isNaN(dt)) return String(createdAt).slice(0, 10);
      return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
    }
    // 东八区时间格式化（后台统一按北京时间显示，站长均 UTC+8）：输入 ISO/『YYYY-MM-DD HH:MM:SS』，输出『MM-DD HH:MM』
    function bjTime(createdAt) {
      var dt = new Date(String(createdAt).replace(' ', 'T') + 'Z');
      if (isNaN(dt)) return String(createdAt).slice(5, 16).replace('T', ' ');
      var b = new Date(dt.getTime() + 8 * 3600e3);
      return pad2(b.getUTCMonth() + 1) + '-' + pad2(b.getUTCDate()) + ' ' + pad2(b.getUTCHours()) + ':' + pad2(b.getUTCMinutes());
    }
    function pointsReasonLabel(reason) {
      if (reason === 'item_verify') return '发布 Token 奖励';
      if (reason === 'tutorial_verify') return '教程审核奖励';
      if (reason === 'skill_verify') return 'Skill 审核奖励';
      if (reason === 'skill_first_sale') return 'Skill 首单奖励';
      if (reason === 'skill_review') return 'Skill 测评奖励';
      if (reason === 'feedback_verify') return '反馈认可奖励';
      if (reason === 'invite') return '邀请奖励';
      if (reason === 'pull') return '拉取消耗';
      if (reason === 'view') return '查看 Token';
      if (reason === 'tip') return '打赏支出';
      if (reason === 'tip_received') return '被打赏';
      if (reason === 'skill_buy') return '购买 Skill';
      if (reason === 'skill_sell') return 'Skill 售出';
      if (reason === 'checkin') return '每日签到';
      return reason || '其他';
    }
    function pointsCalHtml(month, daily) {
      if (!month) return '<div class="dash-empty"><div class="dash-empty__text">暂无积分记录</div></div>';
      var y = parseInt(month.slice(0, 4), 10), m = parseInt(month.slice(5, 7), 10);
      var offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 周一开头
      var daysInMonth = new Date(y, m, 0).getDate();
      var map = {};
      (daily || []).forEach(function(d) { map[d.date] = d.delta; });
      var now = new Date();
      var today = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
      var h = '<div class="points-cal__head">';
      ['一', '二', '三', '四', '五', '六', '日'].forEach(function(w) { h += '<span class="points-cal__week">' + w + '</span>'; });
      h += '</div><div class="points-cal__grid">';
      for (var i = 0; i < offset; i++) h += '<span class="points-cal__cell is-blank"></span>';
      for (var d = 1; d <= daysInMonth; d++) {
        var key = month + '-' + pad2(d);
        var delta = map[key];
        var cls = 'points-cal__cell';
        if (key === today) cls += ' is-today';
        if (delta !== undefined) cls += delta > 0 ? ' has-plus' : ' has-minus';
        h += '<span class="' + cls + '" data-date="' + key + '"><span class="points-cal__day">' + d + '</span>' +
          (delta !== undefined ? '<span class="points-cal__delta">' + (delta > 0 ? '+' : '') + delta + '</span>' : '') + '</span>';
      }
      h += '</div>';
      return h;
    }
    function pointsRowHtml(log) {
      if (!log || !log.length) return '<div class="points-modal__empty">暂无记录</div>';
      var rows = '';
      for (var i = 0; i < log.length; i++) {
        var l = log[i];
        var plus = (l.delta || 0) > 0;
        var t = String(l.created_at || '').replace('T', ' ').slice(0, 19);
        rows += '<div class="points-modal__row"><span class="points-modal__label">' + T.esc(pointsReasonLabel(l.reason)) + '</span><span class="points-modal__time">' + T.esc(t) + '</span><span class="points-modal__delta ' + (plus ? 'is-plus' : 'is-minus') + '">' + (plus ? '+' : '') + l.delta + '</span></div>';
      }
      return rows;
    }
    function openPointsModal(title, log) {
      var ov = document.createElement('div');
      ov.className = 'points-modal';
      ov.innerHTML = '<div class="points-modal__mask" data-close></div><div class="points-modal__box"><div class="points-modal__head"><span class="points-modal__title">' + T.esc(title) + '</span><button class="points-modal__close" data-close>' + ic('x') + '</button></div><div class="points-modal__body">' + pointsRowHtml(log) + '</div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', function(e) { if (e.target.closest('[data-close]')) ov.remove(); });
    }
    function openPointsAll() {
      T.api('GET', '/points?all=1').then(function(r) { return r.json(); }).then(function(d) {
        openPointsModal('全部积分明细（共 ' + (d.log ? d.log.length : 0) + ' 条）', d.log || []);
      }).catch(function() { T.showToast('加载失败'); });
    }
    function openPointsDate(date) {
      T.api('GET', '/points?all=1').then(function(r) { return r.json(); }).then(function(d) {
        var list = (d.log || []).filter(function(l) { return localDateKey(l.created_at) === date; });
        openPointsModal(date + ' 积分明细（' + list.length + ' 条）', list);
      }).catch(function() { T.showToast('加载失败'); });
    }

    // ===== 用户注册日历（按天聚合注册数，复用 points-cal 样式） =====
    function userCalHtml(month, users) {
      if (!month) return '';
      var y = parseInt(month.slice(0, 4), 10), m = parseInt(month.slice(5, 7), 10);
      var offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 周一开头
      var daysInMonth = new Date(y, m, 0).getDate();
      var map = {};
      for (var i = 0; i < users.length; i++) {
        var k = localDateKey(users[i].created_at);
        if (k.slice(0, 7) === month) map[k] = (map[k] || 0) + 1;
      }
      var now = new Date();
      var today = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
      var h = '<div class="points-cal__head">';
      ['一', '二', '三', '四', '五', '六', '日'].forEach(function(w) { h += '<span class="points-cal__week">' + w + '</span>'; });
      h += '</div><div class="points-cal__grid">';
      for (var i2 = 0; i2 < offset; i2++) h += '<span class="points-cal__cell is-blank"></span>';
      for (var d = 1; d <= daysInMonth; d++) {
        var key = month + '-' + pad2(d);
        var cnt = map[key];
        var cls = 'points-cal__cell';
        if (key === today) cls += ' is-today';
        if (cnt) cls += ' has-plus';
        h += '<span class="' + cls + '" data-userdate="' + key + '"><span class="points-cal__day">' + d + '</span>' +
          (cnt ? '<span class="points-cal__delta">+' + cnt + '</span>' : '') + '</span>';
      }
      h += '</div>';
      return h;
    }
    function openUsersDate(date, users) {
      var list = [];
      for (var i = 0; i < users.length; i++) {
        if (localDateKey(users[i].created_at) === date) list.push(users[i]);
      }
      var rows = list.length
        ? list.map(function(u) {
            return '<div class="points-modal__row"><span class="points-modal__label">' + T.esc(u.username) + '</span><span class="points-modal__time">' + T.esc(String(u.created_at || '').replace('T', ' ').slice(0, 16)) + '</span></div>';
          }).join('')
        : '<div class="points-modal__empty">该日无注册</div>';
      var ov = document.createElement('div');
      ov.className = 'points-modal';
      ov.innerHTML = '<div class="points-modal__mask" data-close></div><div class="points-modal__box"><div class="points-modal__head"><span class="points-modal__title">' + T.esc(date) + ' 注册用户（' + list.length + '）</span><button class="points-modal__close" data-close>' + ic('x') + '</button></div><div class="points-modal__body">' + rows + '</div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', function(e) { if (e.target.closest('[data-close]')) ov.remove(); });
    }

    function closeEdit() { editModal.classList.remove('modal--open'); }

    // 与 CLI 对齐：编辑时若 Token 已填，链接字段语义 = API Base URL（厂商端点），否则 = 官网链接
    function syncEditUrlLabel() {
      var t = document.getElementById('eToken');
      var hasToken = !!(t && t.value.trim());
      var note = document.getElementById('eTokenNote');
      if (note) note.style.display = hasToken ? '' : 'none';
    }

    function openEdit(id) {
      var item = null;
      for (var i = 0; i < cachedItems.length; i++) { if (cachedItems[i].id === id) { item = cachedItems[i]; break; } }
      if (!item) return;
      var tagsStr = (item.tags || []).join(', ');
      editView.innerHTML = '<h2 class="modal__title" style="padding-right:0;margin-bottom:20px">编辑 Token</h2>' +
        '<div class="form-group"><label>名称 *</label><input class="input" id="eName" value="' + T.esc(item.name) + '"></div>' +
        '<div class="form-group"><label>描述</label><textarea class="input" id="eDesc" rows="2">' + T.esc(item.desc || '') + '</textarea></div>' +
        '<div class="form-row"><div class="form-group"><label>厂商</label><input class="input" id="eProvider" value="' + T.esc(item.provider || '') + '"></div>' +
        '<div class="form-group"><label>分类</label><select class="input" id="eCategory">' +
        '<option' + (item.category === '对话模型' ? ' selected' : '') + '>对话模型</option>' +
        '<option' + (item.category === '图像生成' ? ' selected' : '') + '>图像生成</option>' +
        '<option' + (item.category === '视频工具' ? ' selected' : '') + '>视频工具</option>' +
        '<option' + (item.category === '编程工具' ? ' selected' : '') + '>编程工具</option>' +
        '<option' + (item.category === '聚合平台' ? ' selected' : '') + '>聚合平台</option>' +
        '<option' + (item.category === '其他' ? ' selected' : '') + '>其他</option>' +
        '</select></div></div>' +
        '<div class="form-group"><label>base_url（地址） *</label><input class="input" id="eUrl" value="' + T.esc(item.url) + '"></div>' +
        '<div class="form-group"><label>API_KEY（Token 值）</label><input class="input" id="eToken" value="' + T.esc(item.token || '') + '"></div>' +
        '<div class="form-note" id="eTokenNote" style="display:none">填了 Token 后，上面的 base_url 需填 <b>API Base URL</b>（如 <code>https://x-api.cfd/v1</code>）。保存时会先做有效性测试并自动检测兼容模式，测试不通过将拒绝保存。</div>' +
        '<div class="form-row"><div class="form-group"><label>Token 类型</label><select class="input" id="eTokenType">' +
        '<option value="">不标注</option>' +
        '<option' + (item.tokenType === 'OpenAI' ? ' selected' : '') + '>OpenAI</option>' +
        '<option' + (item.tokenType === 'OpenAI兼容' ? ' selected' : '') + '>OpenAI兼容</option>' +
        '<option' + (item.tokenType === 'Anthropic' ? ' selected' : '') + '>Anthropic</option>' +
        '<option' + (item.tokenType === 'Gemini' ? ' selected' : '') + '>Gemini</option>' +
        '</select></div>' +
        '<div class="form-group"><label>标签</label><input class="input" id="eTags" value="' + T.esc(tagsStr) + '"></div></div>' +
        '<div class="form-actions"><button class="btn btn--full" id="submitEdit" data-id="' + T.esc(item.id) + '">保存修改</button>' +
        '<button class="btn btn--full btn--ghost" data-action="close-edit">取消</button></div>';
      editModal.classList.add('modal--open');
      var eTokenInput = document.getElementById('eToken');
      if (eTokenInput) eTokenInput.addEventListener('input', syncEditUrlLabel);
      syncEditUrlLabel();
      document.getElementById('submitEdit')?.addEventListener('click', async function() {
        var name = document.getElementById('eName').value.trim();
        var url = document.getElementById('eUrl').value.trim();
        if (!name || !url) { T.showToast('名称和链接必填'); return; }
        try { new URL(url); } catch (_) { T.showToast('链接格式无效'); return; }
        var body = {
          name: name, desc: document.getElementById('eDesc').value.trim(),
          provider: document.getElementById('eProvider').value.trim(),
          category: document.getElementById('eCategory').value, url: url,
          token: document.getElementById('eToken').value.trim(),
          tokenType: document.getElementById('eTokenType').value,
          tags: document.getElementById('eTags').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
        };
        try {
          var res = await T.api('PUT', '/my/items/' + item.id, body);
          if (!res.ok) { var d = await res.json(); T.showToast(d.error || '保存失败'); return; }
          T.showToast('已保存'); closeEdit(); loadDashboard();
        } catch (e) { T.showToast('保存失败'); }
      });
    }

    // ===== 我的教程：编辑弹窗（含封面上传/外链/移除，PUT /my/tutorials/:id） =====
    function openTutEdit(tut) {
      var cats = ['教程', 'API 接入', 'OpenAI', 'Anthropic', 'Gemini', 'DeepSeek', 'Moonshot', '通义千问', '大模型科普', '经验分享', '其他'];
      var catOpts = cats.map(function(c) { return '<option' + (tut.category === c ? ' selected' : '') + '>' + T.esc(c) + '</option>'; }).join('');
      var cover = tut.cover || '';
      editView.innerHTML =
        '<h2 class="modal__title" style="padding-right:0;margin-bottom:20px">编辑教程</h2>' +
        '<div class="form-group"><label>标题 *</label><input class="input" id="teTitle" maxlength="120" value="' + T.esc(tut.title) + '"></div>' +
        '<div class="form-group"><label>摘要</label><textarea class="input" id="teSummary" maxlength="300" rows="2">' + T.esc(tut.summary || '') + '</textarea></div>' +
        '<div class="form-row"><div class="form-group"><label>分类 *</label><select class="input" id="teCategory">' + catOpts + '</select></div>' +
        '<div class="form-group"><label>标签</label><input class="input" id="teTags" value="' + T.esc((tut.tags || []).join(', ')) + '"></div></div>' +
        '<div class="form-group"><label>封面图（可选）</label>' +
          '<div class="uploader-mount" id="teCoverMount"></div>' +
          '<input type="hidden" id="teCoverVal" value="' + T.esc(cover) + '">' +
          '<p class="tut-publish__hint">PNG/JPG/WebP/GIF ≤3MB；留空自动用分类渐变封面</p>' +
        '</div>' +
        '<div class="form-group"><label>正文（Markdown）*</label><textarea class="input tut-publish__content" id="teContent" rows="12">' + T.esc(tut.content || '') + '</textarea></div>' +
        '<div class="form-actions"><button class="btn btn--primary" id="submitTutEdit">' + ic('send') + ' 保存修改</button>' +
        '<button class="btn btn--ghost" data-action="close-edit">取消</button></div>';
      editModal.classList.add('modal--open');
      // 封面上传 / 外链 / 移除：复用可上传组件（点击选择 / 拖拽 / Ctrl+V 粘贴三合一，走 /api/upload）
      var coverVal = document.getElementById('teCoverVal');
      var coverMount = document.getElementById('teCoverMount');
      if (coverMount && coverVal && typeof window.Uploader !== 'undefined') {
        window.Uploader.create({
          mount: coverMount,
          token: function () { return T.getToken ? T.getToken() : ''; },
          toast: T.showToast,
          allowUrl: true,
          initial: cover,
          hidden: coverVal
        });
      }
      document.getElementById('submitTutEdit').addEventListener('click', async function() {
        var title = document.getElementById('teTitle').value.trim();
        var content = document.getElementById('teContent').value;
        if (!title || !content.trim()) { T.showToast('标题和正文必填'); return; }
        var body = {
          title: title,
          summary: document.getElementById('teSummary').value.trim(),
          category: document.getElementById('teCategory').value,
          tags: document.getElementById('teTags').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
          cover: coverVal.value,
          content: content
        };
        try {
          var res = await T.api('PUT', '/my/tutorials/' + tut.id, body);
          if (!res.ok) { var d = await res.json(); T.showToast(d.error || '保存失败'); return; }
          T.showToast('已保存'); closeEdit(); loadDashboard();
        } catch (e) { T.showToast('保存失败'); }
      });
    }

    // Dashboard-specific: handle editModal close click
    if (editModal) editModal.addEventListener('click', function(e) {
      if (e.target.closest('[data-action="close-edit"]')) closeEdit();
    });
    // Dashboard-specific: ESC closes editModal (app.js handles other modals)
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && editModal.classList.contains('modal--open')) closeEdit();
    });

    function initDash() {
      var user = T.getUser();
      var token = T.getToken();
      var isStaff = user && (user.role === 'admin' || user.role === 'moderator');
      currentTab = location.hash === '#admin' ? 'audit' : 'mine';
      if (!user || !token) {
        dashRoot.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">请先登录后查看</p><button class="btn btn--primary" id="dashLoginBtn">登录</button></div>';
        document.getElementById('dashLoginBtn')?.addEventListener('click', function() { T.openAuth('login'); });
      } else if (isStaff) {
        renderLayout();
      } else {
        loadDashboard(dashRoot);
      }
    }
    initDash();
    window.addEventListener('auth-changed', initDash);

    var tabsInited = false;
    function buildTabsHtml() {
      var isAdmin = (T.getUser() && T.getUser().role) === 'admin';
      var isStaff = isAdmin || (T.getUser() && T.getUser().role) === 'moderator';
      var h = '';
      h += '<button class="dash__tab' + (currentTab === 'mine' ? ' is-active' : '') + '" data-tab="mine">' + ic('layout-grid') + '我的发布</button>';
      if (isAdmin) h += '<button class="dash__tab' + (currentTab === 'users' ? ' is-active' : '') + '" data-tab="users">' + ic('users') + '用户管理</button>';
      h += '<button class="dash__tab' + (currentTab === 'audit' ? ' is-active' : '') + '" data-tab="audit">' + ic('shield') + '条目审核<span class="dash__badge" data-badge="audit" style="display:none"></span></button>';
      if (isStaff) h += '<button class="dash__tab' + (currentTab === 'tutorials' ? ' is-active' : '') + '" data-tab="tutorials">' + ic('book-open') + '教程审核<span class="dash__badge" data-badge="tutorials" style="display:none"></span></button>';
      if (isStaff) h += '<button class="dash__tab' + (currentTab === 'skills' ? ' is-active' : '') + '" data-tab="skills">' + ic('box') + 'Skill审核<span class="dash__badge" data-badge="skills" style="display:none"></span></button>';
      if (isAdmin) h += '<button class="dash__tab' + (currentTab === 'invites' ? ' is-active' : '') + '" data-tab="invites">' + ic('key') + '邀请码</button>';
      if (isAdmin) h += '<button class="dash__tab' + (currentTab === 'announcements' ? ' is-active' : '') + '" data-tab="announcements">' + ic('bell') + '公告</button>';
      if (isStaff) h += '<button class="dash__tab' + (currentTab === 'sponsors' ? ' is-active' : '') + '" data-tab="sponsors">' + ic('gem') + '广告<span class="dash__badge" data-badge="sponsors" style="display:none"></span></button>';
      if (isStaff) h += '<button class="dash__tab' + (currentTab === 'feedback' ? ' is-active' : '') + '" data-tab="feedback">' + ic('inbox') + '反馈<span class="dash__badge" data-badge="feedback" style="display:none"></span></button>';
      if (isStaff) h += '<button class="dash__tab' + (currentTab === 'visits' ? ' is-active' : '') + '" data-tab="visits">' + ic('globe') + '访客</button>';
      if (isStaff) h += '<button class="dash__tab' + (currentTab === 'server' ? ' is-active' : '') + '" data-tab="server">' + ic('server') + '服务器</button>';
      if (isStaff) h += '<button class="dash__tab' + (currentTab === 'email' ? ' is-active' : '') + '" data-tab="email">' + ic('mail') + '邮箱<span class="dash__badge" data-badge="email" style="display:none"></span></button>';
      if (isAdmin) h += '<button class="dash__tab' + (currentTab === 'ai-judge' ? ' is-active' : '') + '" data-tab="ai-judge">' + ic('bot') + 'AI 判官</button>';
      return h;
    }
    function renderLayout() {
      var isAdmin = (T.getUser() && T.getUser().role) === 'admin';
      var isStaff = isAdmin || (T.getUser() && T.getUser().role) === 'moderator';
      var existingTabs = document.getElementById('dashTabs');
      var existingWrap = document.getElementById('dashTabsWrap');
      var savedScroll = existingTabs ? existingTabs.scrollLeft : 0;
      var needsRebuild = !existingTabs || !existingWrap || !tabsInited;
      // 首次或角色变化时全量重建，否则仅更新 active 与内容，避免整卡刷新与滚动跳动
      if (needsRebuild) {
        var html = '<div class="dash__tabs-wrap" id="dashTabsWrap">';
        html += '<button class="dash__tabs-arrow dash__tabs-arrow--left" aria-label="向左滚动">' + ic('arrow-left') + '</button>';
        html += '<div class="dash__tabs" id="dashTabs">' + buildTabsHtml() + '</div>';
        html += '<button class="dash__tabs-arrow dash__tabs-arrow--right" aria-label="向右滚动">' + ic('arrow-right') + '</button>';
        html += '</div><div class="dash__view" id="dashView"></div>';
        dashRoot.innerHTML = html;
        tabsInited = true;
        var viewEl0 = document.getElementById('dashView');
        var tabsEl0 = document.getElementById('dashTabs');
        var wrapEl0 = document.getElementById('dashTabsWrap');
        function updateArrows0() {
          if (!tabsEl0 || !wrapEl0) return;
          var max = tabsEl0.scrollWidth - tabsEl0.clientWidth;
          wrapEl0.classList.toggle('has-left', tabsEl0.scrollLeft > 2);
          wrapEl0.classList.toggle('has-right', tabsEl0.scrollLeft < max - 2);
        }
        if (tabsEl0 && wrapEl0) {
          tabsEl0.addEventListener('scroll', updateArrows0);
          window.addEventListener('resize', updateArrows0);
          var leftBtn0 = wrapEl0.querySelector('.dash__tabs-arrow--left');
          var rightBtn0 = wrapEl0.querySelector('.dash__tabs-arrow--right');
          if (leftBtn0) leftBtn0.addEventListener('click', function(){ tabsEl0.scrollBy({left:-220,behavior:'smooth'}); });
          if (rightBtn0) rightBtn0.addEventListener('click', function(){ tabsEl0.scrollBy({left:220,behavior:'smooth'}); });
          var isDown0=false, startX0=0, scrollL0=0;
          tabsEl0.addEventListener('mousedown', function(e){ isDown0=true; startX0=e.pageX - tabsEl0.offsetLeft; scrollL0=tabsEl0.scrollLeft; tabsEl0.style.cursor='grabbing'; });
          tabsEl0.addEventListener('mouseleave', function(){ isDown0=false; tabsEl0.style.cursor=''; });
          tabsEl0.addEventListener('mouseup', function(){ isDown0=false; tabsEl0.style.cursor=''; });
          tabsEl0.addEventListener('mousemove', function(e){ if(!isDown0) return; e.preventDefault(); var x=e.pageX - tabsEl0.offsetLeft; tabsEl0.scrollLeft = scrollL0 - (x - startX0); });
          tabsEl0.addEventListener('click', function(e) {
            var tab = e.target.closest('.dash__tab');
            if (!tab) return;
            var next = tab.getAttribute('data-tab');
            if (next === currentTab) return;
            currentTab = next;
            renderLayout();
          });
          var active0 = tabsEl0.querySelector('.dash__tab.is-active');
          if (active0) active0.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});
          setTimeout(updateArrows0, 80);
          setTimeout(updateArrows0, 300);
        }
      } else {
        // 增量更新：不重建 tabs，仅切换 active，保留横滑位置
        var tabsEl1 = document.getElementById('dashTabs');
        if (tabsEl1) {
          tabsEl1.innerHTML = buildTabsHtml();
          tabsEl1.scrollLeft = savedScroll;
          var active1 = tabsEl1.querySelector('.dash__tab.is-active');
          if (active1) active1.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});
          // 触发羽化更新
          var wrap1 = document.getElementById('dashTabsWrap');
          if (wrap1) {
            var max1 = tabsEl1.scrollWidth - tabsEl1.clientWidth;
            wrap1.classList.toggle('has-left', tabsEl1.scrollLeft > 2);
            wrap1.classList.toggle('has-right', tabsEl1.scrollLeft < max1 - 2);
          }
        }
      }
      // 离开服务器页自动停轮询，节省请求
      if (typeof serverTimer !== 'undefined' && serverTimer && currentTab !== 'server') { clearInterval(serverTimer); serverTimer = null; }
      var viewEl = document.getElementById('dashView');
      if (currentTab === 'users') loadUsers(viewEl);
      else if (currentTab === 'audit') loadAudit(viewEl);
      else if (currentTab === 'tutorials') loadTutorials(viewEl);
      else if (currentTab === 'skills') loadSkills(viewEl);
      else if (currentTab === 'invites') loadInvites(viewEl);
      else if (currentTab === 'announcements') loadAnnouncements(viewEl);
      else if (currentTab === 'sponsors') loadSponsors(viewEl);
      else if (currentTab === 'feedback') loadFeedback(viewEl);
      else if (currentTab === 'visits') loadVisits(viewEl);
      else if (currentTab === 'server') loadServer(viewEl);
      else if (currentTab === 'email') loadEmail(viewEl);
      else if (currentTab === 'ai-judge') loadAiJudge(viewEl);
      else loadDashboard(viewEl);
      refreshBadges();
    }

    // 后台 tab 角标：拉取待审核计数并填充（条目审核 / 教程审核 / 反馈待处理）
    function setBadge(key, n) {
      var el = document.querySelector('[data-badge="' + key + '"]');
      if (!el) return;
      n = Number(n) || 0;
      el.textContent = n > 99 ? '99+' : n;
      el.style.display = n > 0 ? '' : 'none';
    }
    function refreshBadges() {
      try {
        T.api('GET', '/admin/review-counts').then(async function (res) {
          if (!res.ok) return;
          var d = await res.json();
          setBadge('audit', d.pendingItems);
          setBadge('tutorials', d.pendingTutorials);
          setBadge('skills', d.pendingSkills);
          setBadge('feedback', d.openFeedback);
          setBadge('sponsors', d.pendingSponsors);
        }).catch(function () {});
      } catch (_) {}
    }

    async function loadDashboard(target) {
      var u = T.getUser();
      var t = T.getToken();
      if (!u || !t) return;
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var [items, stats, tutorials, me, pts] = await Promise.all([
          T.api('GET', '/my/items').then(function(r) { return r.json(); }),
          T.api('GET', '/my/stats').then(function(r) { return r.json(); }),
          T.api('GET', '/my/tutorials').then(function(r) { return r.json().catch(function() { return []; }); }),
          T.api('GET', '/auth/me').then(function(r) { return r.json().catch(function() { return null; }); }),
          T.api('GET', '/points' + (pointsMonth ? '?month=' + pointsMonth : '')).then(function(r) { return r.json().catch(function() { return null; }); })
        ]);
        cachedItems = items;
        var profile = (me && me.user) ? me.user : u;
        var joined = stats.joinedAt ? new Date(stats.joinedAt).toLocaleDateString('zh-CN') : '未知';
        var firstLetter = ((profile.nickname || u.username || '?')).charAt(0).toUpperCase();
        var displayName = profile.nickname || u.username;
        var contactLine = (profile.email || profile.phone)
          ? [profile.email ? '邮箱 ' + profile.email : '', profile.phone ? '手机 ' + profile.phone : ''].filter(Boolean).join(' · ')
          : '未设置邮箱/手机号';
        var html = '';
        html += '<div class="dash__head">';
        html += '<div class="dash__avatar">' + (profile.avatar ? '<img src="' + T.esc(profile.avatar) + '" alt="我的头像">' : T.esc(firstLetter)) + '</div>';
        html += '<div class="dash__info"><div class="dash__name">' + T.esc(displayName) + '</div>';
        html += '<div class="dash__meta">@' + T.esc(u.username) + ' · 加入于 ' + T.esc(joined) + '</div>';
        html += '<div class="dash__meta">' + T.esc(contactLine) + '</div>';
        var pointsLine = pts ? '积分 ' + pts.points + ' · 今日免费拉取 ' + pts.pullCountToday + '/' + pts.freePullsPerDay : '';
        if (pointsLine) html += '<div class="dash__meta">' + T.esc(pointsLine) + '</div>';
        html += '</div>';
        html += '<div class="dash__actions">';
        html += '<button class="btn btn--ghost btn--sm" id="editNicknameBtn">' + ic('settings') + ' 编辑资料</button>';
        html += '<a href="/" class="btn btn--ghost">' + ic('arrow-left') + ' 返回首页</a></div></div>';
        html += '<div class="dash__profile-edit" id="nicknameEditBox" style="display:none">';
        // 头像编辑行：头像本身即上传触发器（点击 / 拖拽 / Ctrl+V 三合一，与站内 Uploader 同模式）
        html += '<div class="form-group avatar-edit">';
        html += '<label>头像</label>';
        html += '<div class="avatar-edit__row">';
        html += '<div class="avatar-edit__preview" id="avatarPreview" role="button" tabindex="0" aria-label="更换头像：点击选择图片，或直接拖拽 / Ctrl+V 粘贴">' + (profile.avatar ? '<img src="' + T.esc(profile.avatar) + '" alt="头像预览">' : T.esc(firstLetter)) + '<span class="avatar-edit__mask">' + ic('image') + '更换</span></div>';
        html += '<input type="file" id="avatarFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>';
        html += '<div class="avatar-edit__btns">';
        html += (profile.avatar ? '<button type="button" class="btn btn--ghost btn--sm" id="avatarRemoveBtn">' + ic('trash-2') + ' 移除头像</button>' : '');
        html += '</div>';
        html += '<div class="avatar-edit__hint">点击头像 / 拖拽图片 / Ctrl+V 粘贴即换，PNG/JPG/WebP/GIF ≤3MB</div>';
        html += '</div></div>';
        html += '<div class="form-group"><label>昵称</label><input class="input" id="nicknameInput" maxlength="30" placeholder="留空则显示账号，昵称全站唯一" value="' + T.esc(profile.nickname || '') + '"><div class="nickname-hint" id="nicknameHint"></div></div>';
        html += '<div class="form-group"><label>邮箱 ' + (profile.email_verified_at ? '<span style="color:var(--green);font-size:11px">✓ 已验证</span>' : '<span style="color:var(--text-muted);font-size:11px">未验证</span>') + '</label><div style="display:flex;gap:6px"><input class="input" id="profileEmail" type="email" placeholder="用于找回密码，选填" value="' + T.esc(profile.email || '') + '" style="flex:1"><button class="btn btn--ghost btn--sm" id="sendEmailCodeBtn" style="white-space:nowrap">' + ic('mail') + ' 发验证码</button></div><div style="display:flex;gap:6px;margin-top:6px"><input class="input" id="emailCodeInput" placeholder="6 位验证码" maxlength="6" style="flex:1"><button class="btn btn--primary btn--sm" id="verifyEmailBtn">' + ic('check') + ' 验证</button></div></div>';
        html += '<div class="form-group"><label>手机号</label><input class="input" id="profilePhone" placeholder="用于找回密码，选填" value="' + T.esc(profile.phone || '') + '"></div>';
        html += '<div class="dash__profile-edit-actions">';
        html += '<button class="btn btn--primary btn--sm" id="nicknameSave">保存</button>';
        html += '<button class="btn btn--ghost btn--sm" id="nicknameCancel">取消</button></div></div>';
        html += '<div class="dash__stats">';
        html += '<div class="dash-stat"><div class="dash-stat__num">' + stats.total + '</div><div class="dash-stat__label">发布总数</div></div>';
        html += '<div class="dash-stat"><div class="dash-stat__num">' + stats.verified + '</div><div class="dash-stat__label">已验证</div></div>';
        html += '<div class="dash-stat"><div class="dash-stat__num">' + Math.max(0, stats.total - stats.verified) + '</div><div class="dash-stat__label">待验证</div></div></div>';
        if (pts) {
          var cal = pointsCalHtml(pts.month, pts.daily || []);
          var monthTotal = 0;
          (pts.daily || []).forEach(function(d) { monthTotal += d.delta; });
          html += '<div class="dash__section points-card">';
          html += '<div class="dash__section-head">';
          html += '<span class="dash__section-title">' + ic('award') + ' 积分</span>';
          html += '<div class="points-card__nav">';
          html += '<button class="btn-icon" title="上个月" id="pointsPrev">' + ic('arrow-left') + '</button>';
          html += '<span class="points-card__month" id="pointsMonthLabel">' + T.esc(pointsMonthLabel(pts.month)) + '</span>';
          html += '<button class="btn-icon" title="下个月" id="pointsNext">' + ic('chevron-right') + '</button>';
          html += '</div></div>';
          html += '<div class="points-card__summary">';
          html += '<div class="points-card__stat"><span class="points-card__label">当前积分</span><b class="points-card__num">' + pts.points + '</b></div>';
          html += '<div class="points-card__stat"><span class="points-card__label">今日免费拉取</span><b class="points-card__num">' + pts.pullCountToday + '/' + pts.freePullsPerDay + '</b></div>';
          html += '<div class="points-card__stat"><span class="points-card__label">本月净增减</span><b class="points-card__num' + (monthTotal > 0 ? ' is-plus' : monthTotal < 0 ? ' is-minus' : '') + '">' + (monthTotal > 0 ? '+' : '') + monthTotal + '</b></div>';
          html += '</div>';
          html += '<div class="points-cal" id="pointsCal">' + cal + '</div>';
          html += '<div class="points-card__foot" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn--ghost btn--sm" id="pointsAllBtn">' + ic('clock') + ' 查看全部明细</button><a href="/points" class="btn btn--ghost btn--sm">' + ic('help-circle') + ' 完整规则</a></div>';
          html += '<div class="points-card__how">';
          html += '<div class="points-card__how-title">' + ic('award') + ' 积分 = 贡献的账本（不是钱，不可买卖） <a href="/points" style="font-size:12px;font-weight:600;margin-left:8px">' + ic('help-circle') + ' 完整规则</a></div>';
          html += '<ul class="points-card__how-list">';
          html += '<li>发布含 Token 的条目（发布即上线）+1</li>';
          html += '<li>AI 教程 / Skill 审核通过 +1（Skill 首单再 +1）</li>';
          html += '<li>抓到 bug / 高质量反馈，版主认可 +1</li>';
          html += '<li>邀请好友注册并首发 Token，邀请人 +1</li>';
          html += '<li>购买后测评 Skill +1（每 Skill 一次）</li>';
          html += '</ul>';
          html += '<div class="points-card__how-essence">Token 免费给大家用，贡献靠大家搭把手——Token 共产主义，人人共建。</div>';
          html += '</div>';
          html += '</div>';
        }
        html += '<div class="dash__section">';
        html += '<div class="dash__section-head"><span class="dash__section-title">我的发布</span>';
        html += '<button class="btn btn--sm btn--primary" id="publishBtn">' + ic('plus') + ' 发布新 Token</button></div>';
        if (items.length === 0) {
          html += '<div class="dash-empty"><div class="dash-empty__icon">' + ic('inbox') + '</div><p class="dash-empty__text">还没有发布任何 Token</p><button class="btn btn--primary" id="publishBtn2">去发布</button></div>';
        } else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr>';
          html += '<th>名称</th><th>分类</th><th>厂商</th><th>发布时间</th><th>状态</th><th>操作</th>';
          html += '</tr></thead><tbody>';
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var date = it.createdAt ? it.createdAt.slice(0, 10) : '';
            var statusCls = it.verified ? 'item-status--verified' : 'item-status--pending';
            var statusText = it.verified ? '已验证' : '待验证';
            html += '<tr>';
            html += '<td><span class="item-name" data-id="' + T.esc(it.id) + '">' + T.esc(it.name) + '</span>';
            html += '<div class="item-provider">' + T.esc(String(it.desc || '').slice(0, 50)) + '</div></td>';
            html += '<td>' + T.esc(it.category || '-') + '</td>';
            html += '<td>' + T.esc(it.provider || '-') + '</td>';
            html += '<td class="item-date">' + T.esc(date) + '</td>';
            html += '<td><span class="item-status ' + statusCls + '">' + statusText + '</span></td>';
            html += '<td><div class="item-actions">';
            html += '<button class="btn-icon" title="复制 Token" data-copy="' + T.esc(it.token || '') + '">' + ic('copy') + '</button>';
            html += '<button class="btn-icon" title="编辑" data-edit="' + T.esc(it.id) + '">' + ic('pencil') + '</button>';
            html += '<button class="btn-icon btn-icon--danger" title="删除" data-del="' + T.esc(it.id) + '">' + ic('trash-2') + '</button>';
            html += '</div></td></tr>';
          }
          html += '</tbody></table></div>';
        }
        html += '</div>';
        // 我的教程
        html += '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('book-open') + ' 我的教程</span>';
        html += '<a class="btn btn--sm btn--ghost" href="/tutorials">' + ic('plus') + ' 去发布教程</a></div>';
        if (!tutorials.length) {
          html += '<div class="dash-empty"><div class="dash-empty__text">还没有发布任何教程，点「去发布教程」或使用 CLI <code>tutorial add</code></div></div>';
        } else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>标题</th><th>分类</th><th>发布时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
          cachedTuts = tutorials;
          for (var ti = 0; ti < tutorials.length; ti++) {
            var tut = tutorials[ti];
            var tdate = tut.createdAt ? tut.createdAt.slice(0, 10) : '';
            var tCls = tut.verified ? 'item-status--verified' : (tut.rejectReason ? 'item-status--rejected' : 'item-status--pending');
            var tText = tut.verified ? '已通过' : (tut.rejectReason ? '已拒绝' : '待审核');
            html += '<tr>';
            html += '<td><a class="item-name" href="/tutorials/' + T.esc(tut.id) + '" target="_blank">' + T.esc(tut.title) + '</a>';
            if (tut.rejectReason) html += '<div class="item-provider item-provider--reject">拒绝理由：' + T.esc(tut.rejectReason) + '</div>';
            html += '</td>';
            html += '<td>' + T.esc(tut.category || '-') + '</td>';
            html += '<td class="item-date">' + T.esc(tdate) + '</td>';
            html += '<td><span class="item-status ' + tCls + '">' + tText + '</span></td>';
            html += '<td><div class="item-actions">';
            html += '<button class="btn-icon" title="编辑" data-tutedit="' + T.esc(tut.id) + '">' + ic('pencil') + '</button>';
            html += '<button class="btn-icon btn-icon--danger" title="删除" data-tutdel="' + T.esc(tut.id) + '">' + ic('trash-2') + '</button>';
            html += '</div></td></tr>';
          }
          html += '</tbody></table></div>';
        }
        html += '</div>';
        target.innerHTML = html;
        target.onclick = async function(e) {
          var pointsPrev = e.target.closest('#pointsPrev');
          var pointsNext = e.target.closest('#pointsNext');
          var pointsAll = e.target.closest('#pointsAllBtn');
          var calCell = e.target.closest('.points-cal__cell[data-date]');
          if (pointsPrev || pointsNext) {
            pointsMonth = shiftMonth(pointsMonth || '', pointsPrev ? -1 : 1);
            loadDashboard(target);
            return;
          }
          if (pointsAll) { openPointsAll(); return; }
          if (calCell) { openPointsDate(calCell.getAttribute('data-date')); return; }
          var copyBtn = e.target.closest('[data-copy]');
          var tutdelBtn = e.target.closest('[data-tutdel]');
          var tuteditBtn = e.target.closest('[data-tutedit]');
          if (tuteditBtn) {
            var teid = tuteditBtn.getAttribute('data-tutedit');
            var teTut = null;
            for (var ti2 = 0; ti2 < cachedTuts.length; ti2++) { if (cachedTuts[ti2].id === teid) { teTut = cachedTuts[ti2]; break; } }
            if (teTut) openTutEdit(teTut);
            return;
          }
          if (tutdelBtn) {
            var tid = tutdelBtn.getAttribute('data-tutdel');
            if (!confirm('确定删除此教程？')) return;
            try {
              var tres = await T.api('DELETE', '/my/tutorials/' + tid);
              if (!tres.ok) { var td = await tres.json(); T.showToast(td.error || '删除失败'); return; }
              T.showToast('已删除'); loadDashboard(target);
            } catch (e2) { T.showToast('删除失败'); }
            return;
          }
          if (copyBtn) { T.copyText(copyBtn.getAttribute('data-copy')); return; }
          var editBtn = e.target.closest('[data-edit]');
          if (editBtn) { openEdit(editBtn.getAttribute('data-edit')); return; }
          var delBtn = e.target.closest('[data-del]');
          if (delBtn) {
            var id = delBtn.getAttribute('data-del');
            if (!confirm('确定删除此条目？')) return;
            try {
              var res = await T.api('DELETE', '/my/items/' + id);
              if (!res.ok) { var d = await res.json(); T.showToast(d.error || '删除失败'); return; }
              T.showToast('已删除'); loadDashboard(target);
            } catch (e) { T.showToast('删除失败'); }
            return;
          }
          var nameEl = e.target.closest('.item-name');
          if (nameEl) { window.open('/?id=' + nameEl.getAttribute('data-id'), '_blank'); return; }
        };
        // 改昵称
        var editNickBtn = document.getElementById('editNicknameBtn');
        if (editNickBtn) editNickBtn.addEventListener('click', function() {
          document.getElementById('nicknameEditBox').style.display = 'flex';
          editNickBtn.style.display = 'none';
          var inp = document.getElementById('nicknameInput');
          if (inp) { inp.focus(); inp.select(); }
        });
        // 头像：选择文件即上传（POST /api/auth/avatar 原始二进制），成功后三处同步（预览/头部/localStorage）
        var avatarFile = document.getElementById('avatarFile');
        var avatarPreview = document.getElementById('avatarPreview');
        var avatarUploading = false;
        function applyAvatar(url) {
          if (avatarPreview) avatarPreview.innerHTML = (url ? '<img src="' + T.esc(url) + '" alt="头像预览">' : T.esc(firstLetter)) + '<span class="avatar-edit__mask">' + ic('image') + '更换</span>';
          var headAvatar = document.querySelector('.dash__avatar');
          if (headAvatar) headAvatar.innerHTML = url ? '<img src="' + T.esc(url) + '" alt="我的头像">' : T.esc(firstLetter);
          // 上传后补出「移除头像」按钮（初始无头像时未渲染）
          var btns = document.querySelector('.avatar-edit__btns');
          if (btns && url && !document.getElementById('avatarRemoveBtn')) {
            var rb = document.createElement('button');
            rb.type = 'button'; rb.className = 'btn btn--ghost btn--sm'; rb.id = 'avatarRemoveBtn';
            rb.innerHTML = ic('trash-2') + ' 移除头像';
            btns.appendChild(rb);
            rb.addEventListener('click', removeAvatar);
          }
          // 同步登录态（localStorage + 头部菜单头像），setAuth 内部会 updateAuthUI
          try { T.setAuth(T.getToken(), Object.assign({}, T.getUser(), { avatar: url || '' })); } catch (_) {}
        }
        async function removeAvatar() {
          if (!confirm('确定移除头像？将恢复为默认字母头像')) return;
          try {
            var res = await T.api('DELETE', '/auth/avatar');
            if (!res.ok) { var d = await res.json(); T.showToast(d.error || '移除失败'); return; }
            var rb = document.getElementById('avatarRemoveBtn');
            if (rb) rb.remove();
            applyAvatar('');
            T.showToast('已移除头像');
          } catch (e) { T.showToast('移除失败'); }
        }
        async function uploadAvatar(f) {
          if (!f || avatarUploading) return;
          if (f.size > 3 * 1024 * 1024) { T.showToast('图片超过 3MB'); return; }
          if (!/^image\/(png|jpe?g|webp|gif)$/i.test(f.type)) { T.showToast('仅支持 PNG/JPG/WebP/GIF'); return; }
          avatarUploading = true;
          if (avatarPreview) avatarPreview.classList.add('is-uploading');
          try {
            var res = await fetch('/api/auth/avatar', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + T.getToken(), 'Content-Type': f.type },
              body: f
            });
            var d = await res.json();
            if (!res.ok) { T.showToast(d.error || '上传失败'); return; }
            applyAvatar(d.url);
            T.showToast('头像已更新');
          } catch (e) { T.showToast('上传失败'); }
          avatarUploading = false;
          if (avatarPreview) avatarPreview.classList.remove('is-uploading');
        }
        // 头像即上传触发器：点击选择 / 拖拽图片 / Ctrl+V 粘贴（三合一，与站内 Uploader 同模式）
        if (avatarPreview && avatarFile) {
          avatarPreview.addEventListener('click', function() { if (!avatarUploading) avatarFile.click(); });
          avatarPreview.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!avatarUploading) avatarFile.click(); } });
          avatarFile.addEventListener('change', function() {
            var f = this.files && this.files[0];
            this.value = '';
            uploadAvatar(f);
          });
          var avatarDragDepth = 0;
          avatarPreview.addEventListener('dragenter', function(e) { e.preventDefault(); if (avatarUploading) return; avatarDragDepth++; avatarPreview.classList.add('is-drag'); });
          avatarPreview.addEventListener('dragover', function(e) { e.preventDefault(); });
          avatarPreview.addEventListener('dragleave', function() { avatarDragDepth--; if (avatarDragDepth <= 0) { avatarDragDepth = 0; avatarPreview.classList.remove('is-drag'); } });
          avatarPreview.addEventListener('drop', function(e) {
            e.preventDefault();
            avatarDragDepth = 0;
            avatarPreview.classList.remove('is-drag');
            var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            uploadAvatar(f);
          });
          // 粘贴：编辑资料打开（头像可见）且剪贴板含图片时处理，不干扰文本粘贴
          function avatarPaste(e) {
            if (!avatarPreview.offsetParent) return;
            var items = (e.clipboardData && e.clipboardData.items) || [];
            for (var i = 0; i < items.length; i++) {
              if (items[i].kind === 'file') { uploadAvatar(items[i].getAsFile()); return; }
            }
          }
          document.addEventListener('paste', avatarPaste);
        }
        var avatarRemoveBtn = document.getElementById('avatarRemoveBtn');
        if (avatarRemoveBtn) avatarRemoveBtn.addEventListener('click', removeAvatar);
        var nickSave = document.getElementById('nicknameSave');
        var nickInput = document.getElementById('nicknameInput');
        var nickHint = document.getElementById('nicknameHint');
        var nickTaken = false;
        // 昵称实时可用性检测（防抖 300ms）
        if (nickInput && nickHint) {
          var nickTimer = null;
          nickInput.addEventListener('input', function() {
            var v = this.value.trim();
            if (nickTimer) clearTimeout(nickTimer);
            if (!v) { nickHint.textContent = ''; nickHint.className = 'nickname-hint'; nickTaken = false; return; }
            nickTimer = setTimeout(function() {
              T.api('GET', '/auth/nickname-check?nickname=' + encodeURIComponent(v), null).then(function(r) { return r.json(); }).then(function(d) {
                if (d.available) { nickHint.textContent = '✓ 昵称可用'; nickHint.className = 'nickname-hint nickname-hint--ok'; nickTaken = false; }
                else { nickHint.textContent = '该昵称已被使用，换一个吧'; nickHint.className = 'nickname-hint nickname-hint--err'; nickTaken = true; }
              }).catch(function() {});
            }, 300);
          });
        }
        if (nickSave) nickSave.addEventListener('click', async function() {
          var nickname = (document.getElementById('nicknameInput').value || '').trim();
          var email = (document.getElementById('profileEmail').value || '').trim();
          var phone = (document.getElementById('profilePhone').value || '').trim();
          if (nickTaken) { T.showToast('该昵称已被使用，请换一个'); return; }
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { T.showToast('邮箱格式无效'); return; }
          if (phone && !/^\+?[0-9]{5,20}$/.test(phone)) { T.showToast('手机号格式无效'); return; }
          try {
            var res = await T.api('PUT', '/auth/profile', { nickname: nickname, email: email, phone: phone });
            var d = await res.json();
            if (!res.ok) { T.showToast(d.error || '保存失败'); return; }
            T.setAuth(T.getToken(), d.user);
            T.showToast('资料已更新');
            loadDashboard(target);
          } catch (e) { T.showToast('保存失败'); }
        });
        var sendCodeBtn = document.getElementById('sendEmailCodeBtn');
        if (sendCodeBtn) sendCodeBtn.addEventListener('click', async function(){
          var email = (document.getElementById('profileEmail').value || '').trim();
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { T.showToast('请先填写有效邮箱'); return; }
          this.disabled = true; this.textContent = '发送中...';
          try {
            var r = await T.api('POST', '/auth/email/send-bind', { email: email });
            var d = await r.json();
            T.showToast(r.ok ? '验证码已发送，请查收' : (d.error || '发送失败'));
          } catch(e){ T.showToast('发送失败'); }
          this.disabled = false; this.innerHTML = ic('mail') + ' 发验证码';
        });
        var verifyBtn = document.getElementById('verifyEmailBtn');
        if (verifyBtn) verifyBtn.addEventListener('click', async function(){
          var email = (document.getElementById('profileEmail').value || '').trim();
          var code = (document.getElementById('emailCodeInput').value || '').trim();
          if (!email || !code) { T.showToast('请填写邮箱与验证码'); return; }
          try {
            var r = await T.api('POST', '/auth/email/verify-bind', { email: email, code: code });
            var d = await r.json();
            if (!r.ok) { T.showToast(d.error || '验证失败'); return; }
            T.showToast('邮箱验证成功');
            loadDashboard(target);
          } catch(e){ T.showToast('验证失败'); }
        });
        var nickCancel = document.getElementById('nicknameCancel');
        if (nickCancel) nickCancel.addEventListener('click', function() { loadDashboard(target); });
      } catch (e) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e.message) + '</p></div>';
      }
    }

    // === 用户管理（admin only） ===
    async function loadUsers(target) {
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var me = T.getUser();
        var res = await T.api('GET', '/admin/users');
        if (!res.ok) { var d = await res.json(); target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">' + T.esc(d.error || '无权限') + '</p></div>'; return; }
        var users = await res.json();
        var curMonth = userMonth || (new Date().getFullYear() + '-' + pad2(new Date().getMonth() + 1));
        var monthNew = 0;
        for (var umi = 0; umi < users.length; umi++) { if (localDateKey(users[umi].created_at).slice(0, 7) === curMonth) monthNew++; }
        var html = '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('users') + ' 用户管理（' + users.length + '）</span></div>';
        // 注册日历
        html += '<div class="dash__section points-card">';
        html += '<div class="dash__section-head">';
        html += '<span class="dash__section-title">' + ic('calendar') + ' 注册日历</span>';
        html += '<div class="points-card__nav">';
        html += '<button class="btn-icon" title="上个月" id="userCalPrev">' + ic('arrow-left') + '</button>';
        html += '<span class="points-card__month">' + T.esc(pointsMonthLabel(curMonth)) + '</span>';
        html += '<button class="btn-icon" title="下个月" id="userCalNext">' + ic('chevron-right') + '</button>';
        html += '</div></div>';
        html += '<div class="points-card__summary">';
        html += '<div class="points-card__stat"><span class="points-card__label">本月注册</span><b class="points-card__num">' + monthNew + ' 人</b></div>';
        html += '<div class="points-card__stat"><span class="points-card__label">累计用户</span><b class="points-card__num">' + users.length + ' 人</b></div>';
        html += '</div>';
        html += '<div class="points-cal" id="userCal">' + userCalHtml(curMonth, users) + '</div>';
        html += '</div>';
        if (!users.length) html += '<div class="dash-empty"><p class="dash-empty__text">暂无用户</p></div>';
        else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>用户</th><th>角色</th><th>加入时间</th><th>操作</th></tr></thead><tbody>';
          for (var i = 0; i < users.length; i++) {
            var u2 = users[i];
            var joined2 = u2.created_at ? u2.created_at.slice(0, 10) : '';
            var roleLabel = u2.role === 'admin' ? ic('crown') + ' 管理员' : (u2.role === 'moderator' ? ic('shield') + ' 版主' : ic('user') + ' 用户');
            var canDelete = (me && u2.id !== me.id) ? '' : ' disabled';
            html += '<tr>';
            html += '<td><span class="item-name">' + T.esc(u2.username) + '</span>';
            html += '<div class="item-provider">' + T.esc(u2.email || '') + '</div></td>';
            html += '<td><select class="input input--sm" data-role="' + T.esc(u2.id) + '">' +
              '<option value="user"' + (u2.role === 'user' ? ' selected' : '') + '>用户</option>' +
              '<option value="moderator"' + (u2.role === 'moderator' ? ' selected' : '') + '>版主</option>' +
              '<option value="admin"' + (u2.role === 'admin' ? ' selected' : '') + '>管理员</option>' +
              '</select></td>';
            html += '<td class="item-date">' + T.esc(joined2) + '</td>';
            html += '<td><div class="item-actions">';
            html += '<button class="btn-icon" title="重置密码" data-resetpass="' + T.esc(u2.id) + '">' + ic('key-round') + '</button>';
            html += '<button class="btn-icon btn-icon--danger" title="删除用户" data-deluser="' + T.esc(u2.id) + '"' + canDelete + '>' + ic('trash-2') + '</button>';
            html += '</div></td></tr>';
          }
          html += '</tbody></table></div>';
        }
        html += '</div>';
        target.innerHTML = html;
        // 用 onchange 赋值（同 onclick 模式）：loadUsers 重渲染复用同一元素，addEventListener 会累积重复监听
        target.onchange = async function(e) {
          var sel = e.target.closest('[data-role]');
          if (!sel) return;
          var role = sel.value;
          var id = sel.getAttribute('data-role');
          try {
            var r = await T.api('PUT', '/admin/users/' + id + '/role', { role: role });
            if (!r.ok) { var d = await r.json(); T.showToast(d.error || '修改失败'); loadUsers(target); return; }
            T.showToast('角色已更新'); loadUsers(target);
          } catch (err) { T.showToast('修改失败'); }
        };
        target.onclick = async function(e) {
          var calPrev = e.target.closest('#userCalPrev');
          var calNext = e.target.closest('#userCalNext');
          if (calPrev || calNext) {
            userMonth = shiftMonth(userMonth || '', calPrev ? -1 : 1);
            loadUsers(target);
            return;
          }
          var calCell = e.target.closest('.points-cal__cell[data-userdate]');
          if (calCell) { openUsersDate(calCell.getAttribute('data-userdate'), users); return; }
          var rpBtn = e.target.closest('[data-resetpass]');
          if (rpBtn && !rpBtn.disabled) {
            var rid = rpBtn.getAttribute('data-resetpass');
            var newPass = prompt('输入该用户的新密码（至少8位，需同时包含字母和数字）：');
            if (!newPass) return;
            if (newPass.length < 8 || !/[A-Za-z]/.test(newPass) || !/\d/.test(newPass)) { T.showToast('密码需至少8位且包含字母和数字'); return; }
            if (!confirm('确定将密码重置为 ' + newPass + ' ？重置后该用户需用新密码登录。')) return;
            try {
              var rr = await T.api('POST', '/admin/users/' + rid + '/reset-password', { password: newPass });
              if (!rr.ok) { var rd = await rr.json(); T.showToast(rd.error || '重置失败'); return; }
              T.showToast('密码已重置');
            } catch (err) { T.showToast('重置失败'); }
            return;
          }
          var delBtn = e.target.closest('[data-deluser]');
          if (!delBtn || delBtn.disabled) return;
          var id = delBtn.getAttribute('data-deluser');
          if (!confirm('确定删除该用户及其所有发布？')) return;
          try {
            var r = await T.api('DELETE', '/admin/users/' + id);
            if (!r.ok) { var d = await r.json(); T.showToast(d.error || '删除失败'); return; }
            T.showToast('已删除'); loadUsers(target);
          } catch (err) { T.showToast('删除失败'); }
        };
      } catch (e) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e.message) + '</p></div>';
      }
    }

    // === 条目审核（moderator+） ===
    async function loadAudit(target) {
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var q = auditStatus === 'all' ? '' : '?status=' + auditStatus;
        var res = await T.api('GET', '/admin/items' + q);
        if (!res.ok) { var d = await res.json(); target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">' + T.esc(d.error || '无权限') + '</p></div>'; return; }
        var items = await res.json();
        var html = '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('shield') + ' 条目审核</span></div>';
        html += '<div class="dash__filters">' +
          '<button class="dash__tab' + (auditStatus === 'pending' ? ' is-active' : '') + '" data-filter="pending">' + ic('clock') + '待审核</button>' +
          '<button class="dash__tab' + (auditStatus === 'verified' ? ' is-active' : '') + '" data-filter="verified">' + ic('check') + '已通过</button>' +
          '<button class="dash__tab' + (auditStatus === 'all' ? ' is-active' : '') + '" data-filter="all">' + ic('layers') + '全部</button>' +
          '<button class="dash__tab' + (auditStatus === 'trash' ? ' is-active' : '') + '" data-filter="trash">' + ic('trash-2') + '垃圾桶</button>' +
          '<button class="btn btn--sm btn--primary" id="autoVerifyBtn">' + ic('shield-check') + ' 一键审核（有可用模型即通过）</button>' +
          '<button class="btn btn--sm btn--danger" id="checkItemsBtn">' + ic('zap') + ' 巡检：下线无可用模型</button>' +
          (auditStatus === 'pending' ? '<button class="btn btn--sm btn--danger" id="trashPendingBtn">' + ic('trash-2') + ' 一键清理待审</button>' : '') +
          '</div>';
        if (!items.length) html += '<div class="dash-empty"><div class="dash-empty__icon">' + ic('inbox') + '</div><p class="dash-empty__text">没有条目</p></div>';
        else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>名称</th><th>分类</th><th>作者</th><th>发布时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var date = it.createdAt ? it.createdAt.slice(0, 10) : '';
            var statusCls = it.trashed ? 'item-status--pending' : (it.verified ? 'item-status--verified' : 'item-status--pending');
            var statusText = it.trashed ? '垃圾桶' : (it.verified ? '已验证' : '待验证');
            html += '<tr>';
            html += '<td><span class="item-name">' + T.esc(it.name) + '</span>';
            html += '<div class="item-provider">' + T.esc((it.desc || '').slice(0, 50)) + '</div></td>';
            html += '<td>' + T.esc(it.category || '-') + '</td>';
            html += '<td>' + T.esc(it.authorName || '匿名') + '</td>';
            html += '<td class="item-date">' + T.esc(date) + '</td>';
            html += '<td><span class="item-status ' + statusCls + '">' + statusText + '</span></td>';
            html += '<td><div class="item-actions">';
            if (it.trashed) {
              html += '<button class="btn-icon" title="撤回" data-restore="' + T.esc(it.id) + '">' + ic('refresh-cw') + '</button>';
              html += '<button class="btn-icon btn-icon--danger" title="彻底删除" data-purge="' + T.esc(it.id) + '">' + ic('x') + '</button>';
            } else {
              html += '<button class="btn-icon" title="复制链接" data-copylink="' + T.esc(it.url || '') + '">' + ic('link') + '</button>';
              html += it.verified
                ? '<button class="btn-icon" title="下线" data-unverify="' + T.esc(it.id) + '">' + ic('undo-2') + '</button>'
                : '<button class="btn-icon" title="通过验证" data-verify="' + T.esc(it.id) + '">' + ic('check') + '</button>';
              html += '<button class="btn-icon btn-icon--danger" title="移入垃圾桶" data-trash="' + T.esc(it.id) + '">' + ic('trash-2') + '</button>';
            }
            html += '</div></td></tr>';
          }
          html += '</tbody></table></div>';
        }
        html += '</div>';
        target.innerHTML = html;
        target.onclick = async function(e) {
          var avBtn = e.target.closest('#autoVerifyBtn');
          if (avBtn) {
            // 批量上线操作：二次确认（通过即公开推送，限流条目会暂缓）
            if (!confirm('对全部待审核含 Token 条目逐个真实问答检测，有可用模型的自动上线（当前待审 ' + items.length + ' 条）？限流中的条目会暂缓，需稍后重试。')) return;
            avBtn.disabled = true; avBtn.textContent = '验证中...';
            try {
              var ar = await T.api('POST', '/admin/items/auto-verify', {});
              if (!ar.ok) { var ad = await ar.json(); T.showToast(ad.error || '验证失败'); loadAudit(target); return; }
              var adata = await ar.json();
              T.showToast('检测 ' + adata.checked + ' 个待审核，自动通过 ' + (adata.approved || []).length + ' 个'
                + ((adata.limited || []).length ? '，限流暂缓 ' + adata.limited.length + ' 个（稍后重试）' : '')
                + ((adata.rejected || []).length ? '，未通过 ' + adata.rejected.length + ' 个' : ''));
              loadAudit(target);
            } catch (err) { T.showToast('验证失败'); loadAudit(target); }
            return;
          }
          var checkBtn = e.target.closest('#checkItemsBtn');
          if (checkBtn) {
            // 批量下线操作：二次确认（明确失效才下线，可在待审核找回；429 限流不下架）
            if (!confirm('对全部已上线条目逐个真实问答巡检，明确失效的自动下线（429 限流不下架，下线的可在待审核找回）？')) return;
            checkBtn.disabled = true; checkBtn.textContent = '检测中...';
            try {
              var cr = await T.api('POST', '/admin/items/check', {});
              if (!cr.ok) { var cd = await cr.json(); T.showToast(cd.error || '检测失败'); loadAudit(target); return; }
              var cdata = await cr.json();
              T.showToast('检测 ' + cdata.checked + ' 个，下线 ' + cdata.offline.length + ' 个失效 Token');
              loadAudit(target);
            } catch (err) { T.showToast('检测失败'); loadAudit(target); }
            return;
          }
          var trashPendingBtn = e.target.closest('#trashPendingBtn');
          if (trashPendingBtn) {
            if (!confirm('将 ' + items.length + ' 条待审核条目全部移入垃圾桶？可在垃圾桶中撤回或彻底删除。')) return;
            trashPendingBtn.disabled = true; trashPendingBtn.textContent = '清理中...';
            try {
              var tr = await T.api('POST', '/admin/items/trash-pending', {});
              if (!tr.ok) { var td = await tr.json(); T.showToast(td.error || '清理失败'); loadAudit(target); return; }
              var tdata = await tr.json();
              T.showToast('已移入垃圾桶 ' + tdata.moved + ' 条'); loadAudit(target);
            } catch (err) { T.showToast('清理失败'); loadAudit(target); }
            return;
          }
          var trashBtn = e.target.closest('[data-trash]');
          if (trashBtn) {
            if (!confirm('移入垃圾桶？可在垃圾桶中撤回。')) return;
            var tid = trashBtn.getAttribute('data-trash');
            try {
              var tr2 = await T.api('PUT', '/admin/items/' + tid + '/trash', {});
              if (!tr2.ok) { var td2 = await tr2.json(); T.showToast(td2.error || '操作失败'); return; }
              T.showToast('已移入垃圾桶'); loadAudit(target);
            } catch (err) { T.showToast('操作失败'); }
            return;
          }
          var restoreBtn = e.target.closest('[data-restore]');
          if (restoreBtn) {
            var rid = restoreBtn.getAttribute('data-restore');
            try {
              var rr = await T.api('PUT', '/admin/items/' + rid + '/restore', {});
              if (!rr.ok) { var rd = await rr.json(); T.showToast(rd.error || '操作失败'); return; }
              T.showToast('已撤回'); loadAudit(target);
            } catch (err) { T.showToast('操作失败'); }
            return;
          }
          var purgeBtn = e.target.closest('[data-purge]');
          if (purgeBtn) {
            if (!confirm('彻底删除该条目？此操作不可恢复！')) return;
            var pid = purgeBtn.getAttribute('data-purge');
            try {
              var pr = await T.api('DELETE', '/admin/items/' + pid, {});
              if (!pr.ok) { var pd = await pr.json(); T.showToast(pd.error || '操作失败'); return; }
              T.showToast('已彻底删除'); loadAudit(target);
            } catch (err) { T.showToast('操作失败'); }
            return;
          }
          var filt = e.target.closest('[data-filter]');
          if (filt) { auditStatus = filt.getAttribute('data-filter'); loadAudit(target); return; }
          var copylink = e.target.closest('[data-copylink]');
          if (copylink) { T.copyText(copylink.getAttribute('data-copylink')); return; }
          var verifyBtn = e.target.closest('[data-verify]');
          var unverifyBtn = e.target.closest('[data-unverify]');
          var id = verifyBtn ? verifyBtn.getAttribute('data-verify') : (unverifyBtn ? unverifyBtn.getAttribute('data-unverify') : null);
          if (id) {
            var verified = !!verifyBtn;
            try {
              var r = await T.api('PUT', '/admin/items/' + id + '/verify', { verified: verified });
              if (!r.ok) { var d = await r.json(); T.showToast(d.error || '操作失败'); return; }
              T.showToast(verified ? '已通过验证' : '已下线'); loadAudit(target);
            } catch (err) { T.showToast('操作失败'); }
            return;
          }
        };
        refreshBadges();
      } catch (e) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e.message) + '</p></div>';
      }
    }

    // === 教程审核（moderator+） ===
    async function loadTutorials(target) {
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var q = tutStatus === 'all' ? '' : '?status=' + tutStatus;
        var res = await T.api('GET', '/admin/tutorials' + q);
        if (!res.ok) { var d = await res.json(); target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">' + T.esc(d.error || '无权限') + '</p></div>'; return; }
        var items = await res.json();
        var html = '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('book-open') + ' 教程审核</span></div>';
        html += '<div class="dash__filters">' +
          '<button class="dash__tab' + (tutStatus === 'pending' ? ' is-active' : '') + '" data-filter="pending">' + ic('clock') + '待审核</button>' +
          '<button class="dash__tab' + (tutStatus === 'verified' ? ' is-active' : '') + '" data-filter="verified">' + ic('check') + '已通过</button>' +
          '<button class="dash__tab' + (tutStatus === 'all' ? ' is-active' : '') + '" data-filter="all">' + ic('layers') + '全部</button>' +
          '</div>';
        html += '<div class="dash__hint">审核标准：与 AI 相关、信息准确、无广告推广、无重复、内容完整。打开正文阅读后再决定通过 / 下线。</div>';
        if (!items.length) html += '<div class="dash-empty"><div class="dash-empty__icon">' + ic('inbox') + '</div><p class="dash-empty__text">没有教程</p></div>';
        else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>标题</th><th>分类</th><th>作者</th><th>发布时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var date = it.createdAt ? it.createdAt.slice(0, 10) : '';
            var statusCls = it.verified ? 'item-status--verified' : (it.rejectReason ? 'item-status--rejected' : 'item-status--pending');
            var statusText = it.verified ? '已通过' : (it.rejectReason ? '已拒绝' : '待审核');
            html += '<tr>';
            html += '<td><a class="item-name" href="/tutorials/' + T.esc(it.id) + '" target="_blank">' + T.esc(it.title) + '</a>';
            html += '<div class="item-provider">' + T.esc((it.summary || '').slice(0, 60)) + '</div>';
            if (it.rejectReason) html += '<div class="item-provider item-provider--reject">拒绝理由：' + T.esc(it.rejectReason) + '</div>';
            html += '</td>';
            html += '<td>' + T.esc(it.category || '-') + '</td>';
            html += '<td>' + T.esc(it.authorName || '匿名') + '</td>';
            html += '<td class="item-date">' + T.esc(date) + '</td>';
            html += '<td><span class="item-status ' + statusCls + '">' + statusText + '</span></td>';
            html += '<td><div class="item-actions">';
            html += '<a class="btn-icon" title="查看" href="/tutorials/' + T.esc(it.id) + '" target="_blank">' + ic('external-link') + '</a>';
            if (it.verified) {
              html += '<button class="btn-icon" title="下线" data-unverify="' + T.esc(it.id) + '">' + ic('undo-2') + '</button>';
            } else {
              html += '<button class="btn-icon" title="通过验证" data-verify="' + T.esc(it.id) + '">' + ic('check') + '</button>';
              html += '<button class="btn-icon btn-icon--danger" title="拒绝并填写理由" data-reject="' + T.esc(it.id) + '">' + ic('x') + '</button>';
            }
            html += '</div></td></tr>';
          }
          html += '</tbody></table></div>';
        }
        html += '</div>';
        target.innerHTML = html;
        target.onclick = async function(e) {
          var filt = e.target.closest('[data-filter]');
          if (filt) { tutStatus = filt.getAttribute('data-filter'); loadTutorials(target); return; }
          var rejectBtn = e.target.closest('[data-reject]');
          if (rejectBtn) {
            var rid = rejectBtn.getAttribute('data-reject');
            var reason = prompt('填写拒绝理由（将展示给发布者，便于其修改后重新提交）：');
            if (reason === null) return;
            reason = reason.trim();
            if (!reason) { T.showToast('拒绝理由不能为空'); return; }
            try {
              var rr = await T.api('PUT', '/admin/tutorials/' + rid + '/reject', { reason: reason });
              if (!rr.ok) { var rd = await rr.json(); T.showToast(rd.error || '操作失败'); return; }
              T.showToast('已拒绝'); loadTutorials(target);
            } catch (err) { T.showToast('操作失败'); }
            return;
          }
          var verifyBtn = e.target.closest('[data-verify]');
          var unverifyBtn = e.target.closest('[data-unverify]');
          var id = verifyBtn ? verifyBtn.getAttribute('data-verify') : (unverifyBtn ? unverifyBtn.getAttribute('data-unverify') : null);
          if (id) {
            var verified = !!verifyBtn;
            try {
              var r = await T.api('PUT', '/admin/tutorials/' + id + '/verify', { verified: verified });
              if (!r.ok) { var d = await r.json(); T.showToast(d.error || '操作失败'); return; }
              T.showToast(verified ? '已通过审核' : '已下线'); loadTutorials(target);
            } catch (err) { T.showToast('操作失败'); }
            return;
          }
        };
        refreshBadges();
      } catch (e) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e.message) + '</p></div>';
      }
    }

    // ===== Skill 审核（版主+） =====
    async function loadSkills(target) {
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var q = skillStatus === 'all' ? '' : '?status=' + skillStatus;
        var res = await T.api('GET', '/admin/skills' + q);
        if (!res.ok) { var d = await res.json(); target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">' + T.esc(d.error || '无权限') + '</p></div>'; return; }
        var items = await res.json();
        var html = '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('box') + ' Skill 审核</span></div>';
        html += '<div class="dash__filters skill-filters">' +
          '<button class="dash__tab' + (skillStatus === 'pending' ? ' is-active' : '') + '" data-filter="pending">' + ic('clock') + '待审核</button>' +
          '<button class="dash__tab' + (skillStatus === 'online' ? ' is-active' : '') + '" data-filter="online">' + ic('check') + '已上线</button>' +
          '<button class="dash__tab' + (skillStatus === 'rejected' ? ' is-active' : '') + '" data-filter="rejected">' + ic('x') + '已拒绝</button>' +
          '<button class="dash__tab' + (skillStatus === 'all' ? ' is-active' : '') + '" data-filter="all">' + ic('layers') + '全部</button>' +
          '</div>';
        html += '<div class="dash__hint">审核标准：内容完整、无恶意代码、与 AI Agent 相关、无重复发布。</div>';
        if (!items.length) html += '<div class="dash-empty"><div class="dash-empty__icon">' + ic('inbox') + '</div><p class="dash-empty__text">没有 Skill</p></div>';
        else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>标题</th><th>分类</th><th>作者</th><th>价格</th><th>发布时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var date = it.createdAt ? it.createdAt.slice(0, 10) : '';
            var statusCls = it.status === 'online' ? 'item-status--verified' : (it.status === 'rejected' ? 'item-status--rejected' : 'item-status--pending');
            var statusText = it.status === 'online' ? '已上线' : (it.status === 'rejected' ? '已拒绝' : '待审核');
            html += '<tr>';
            html += '<td><a class="item-name" href="/skills/' + T.esc(it.slug || it.id) + '" target="_blank">' + T.esc(it.title) + '</a>';
            html += '<div class="item-provider">' + T.esc((it.summary || '').slice(0, 60)) + '</div>';
            html += '</td>';
            html += '<td>' + T.esc(it.category || '-') + '</td>';
            html += '<td>' + T.esc(it.authorName || '匿名') + '</td>';
            html += '<td>' + (it.price > 0 ? it.price + ' 积分' : '免费') + '</td>';
            html += '<td class="item-date">' + T.esc(date) + '</td>';
            html += '<td><span class="item-status ' + statusCls + '">' + statusText + '</span></td>';
            html += '<td><div class="item-actions">';
            html += '<a class="btn-icon" title="查看" href="/skills/' + T.esc(it.slug || it.id) + '" target="_blank">' + ic('external-link') + '</a>';
            if (it.status === 'online') {
              html += '<button class="btn-icon" title="下线" data-offline="' + T.esc(it.id) + '">' + ic('undo-2') + '</button>';
            } else if (it.status === 'pending') {
              html += '<button class="btn-icon" title="通过" data-skillverify="' + T.esc(it.id) + '">' + ic('check') + '</button>';
              html += '<button class="btn-icon btn-icon--danger" title="拒绝" data-skillreject="' + T.esc(it.id) + '">' + ic('x') + '</button>';
            }
            html += '</div></td></tr>';
          }
          html += '</tbody></table></div>';
        }
        html += '</div>';
        target.innerHTML = html;
        target.onclick = async function(e) {
          var filt = e.target.closest('[data-filter]');
          if (filt) { skillStatus = filt.getAttribute('data-filter'); loadSkills(target); return; }
          var verifyBtn = e.target.closest('[data-skillverify]');
          if (verifyBtn) {
            var vid = verifyBtn.getAttribute('data-skillverify');
            try {
              var r = await T.api('PUT', '/admin/skills/' + vid + '/verify');
              if (!r.ok) { var d = await r.json(); T.showToast(d.error || '操作失败'); return; }
              T.showToast('已通过审核'); loadSkills(target);
            } catch (err) { T.showToast('操作失败'); }
            return;
          }
          var rejectBtn = e.target.closest('[data-skillreject]');
          if (rejectBtn) {
            var rid = rejectBtn.getAttribute('data-skillreject');
            var reason = prompt('填写拒绝理由（将展示给发布者）：');
            if (reason === null) return;
            reason = reason.trim();
            if (!reason) { T.showToast('拒绝理由不能为空'); return; }
            try {
              var rr = await T.api('PUT', '/admin/skills/' + rid + '/reject', { reason: reason });
              if (!rr.ok) { var rd = await rr.json(); T.showToast(rd.error || '操作失败'); return; }
              T.showToast('已拒绝'); loadSkills(target);
            } catch (err) { T.showToast('操作失败'); }
            return;
          }
          var offlineBtn = e.target.closest('[data-offline]');
          if (offlineBtn) {
            var oid = offlineBtn.getAttribute('data-offline');
            if (!confirm('确定要下线这个 Skill 吗？')) return;
            try {
              var or = await T.api('PUT', '/admin/skills/' + oid + '/offline');
              if (!or.ok) { var od = await or.json(); T.showToast(od.error || '操作失败'); return; }
              T.showToast('已下线'); loadSkills(target);
            } catch (err) { T.showToast('操作失败'); }
            return;
          }
        };
        refreshBadges();
      } catch (e) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e.message) + '</p></div>';
      }
    }

    async function loadInvites(target) {
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var res = await T.api('GET', '/admin/invites');
        if (!res.ok) { var d = await res.json(); target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">' + T.esc(d.error || '无权限') + '</p></div>'; return; }
        var codes = await res.json();
        var usedCount = 0, unusedCount = 0;
        for (var ci = 0; ci < codes.length; ci++) { if (codes[ci].used_by) usedCount++; else unusedCount++; }
        var filtered = codes.filter(function(c) { return inviteFilter === 'used' ? !!c.used_by : !c.used_by; });
        var html = '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('key') + ' 邀请码管理</span></div>';
        html += '<div class="invite-gen">' +
          '<label class="invite-tip" for="inviteCount">数量</label>' +
          '<input class="input input--sm" id="inviteCount" type="number" min="1" max="50" value="5">' +
          '<button class="btn btn--primary btn--sm" id="genInviteBtn">' + ic('plus') + ' 生成邀请码</button>' +
          '<span class="invite-tip">入群后发给新用户，每个码只能用一次</span></div>';
        html += '<div class="dash__filters">' +
          '<button class="dash__tab' + (inviteFilter === 'unused' ? ' is-active' : '') + '" data-invfilter="unused">' + ic('key') + ' 未使用（' + unusedCount + '）</button>' +
          '<button class="dash__tab' + (inviteFilter === 'used' ? ' is-active' : '') + '" data-invfilter="used">' + ic('check') + ' 已使用（' + usedCount + '）</button>' +
          '</div>';
        if (!filtered.length) {
          html += '<div class="dash-empty"><div class="dash-empty__icon">' + ic('key') + '</div><p class="dash-empty__text">' + (inviteFilter === 'unused' ? '没有未使用的邀请码，点上方生成' : '还没有已使用的邀请码') + '</p></div>';
        } else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>邀请码</th><th>生成时间</th><th>状态</th></tr></thead><tbody>';
          for (var i = 0; i < filtered.length; i++) {
            var c = filtered[i];
            var cls = c.used_by ? 'item-status--verified' : 'item-status--pending';
            var used = c.used_by ? '已使用' : '未使用';
            html += '<tr>';
            html += '<td><button class="btn-icon" title="复制" data-copycode="' + T.esc(c.code) + '">' + ic('copy') + '</button> <code class="invite-code">' + T.esc(c.code) + '</code></td>';
            html += '<td class="item-date">' + T.esc((c.created_at || '').slice(0, 10)) + '</td>';
            html += '<td><span class="item-status ' + cls + '">' + used + '</span>' + (c.used_at ? ' <span class="item-date">' + T.esc(String(c.used_at).slice(0, 10)) + '</span>' : '') + '</td>';
            html += '</tr>';
          }
          html += '</tbody></table></div>';
        }
        html += '</div>';
        target.innerHTML = html;
        target.onclick = async function(e) {
          var invfilt = e.target.closest('[data-invfilter]');
          if (invfilt) { inviteFilter = invfilt.getAttribute('data-invfilter'); loadInvites(target); return; }
          var copy = e.target.closest('[data-copycode]');
          if (copy) { T.copyText(copy.getAttribute('data-copycode')); return; }
          var gen = e.target.closest('#genInviteBtn');
          if (gen) {
            var count = parseInt(document.getElementById('inviteCount')?.value, 10) || 1;
            try {
              var r = await T.api('POST', '/admin/invites', { count: count });
              if (!r.ok) { var d = await r.json(); T.showToast(d.error || '生成失败'); return; }
              var gd = await r.json();
              T.showToast('已生成 ' + gd.created.length + ' 个邀请码');
              loadInvites(target);
            } catch (err) { T.showToast('生成失败'); }
            return;
          }
        };
      } catch (e) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e.message) + '</p></div>';
      }
    }

    // ===== 公告管理（管理员）：发布/下线/编辑/删除 =====
    async function loadAnnouncements(target) {
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var res = await T.api('GET', '/admin/announcements');
        if (!res.ok) { var ed = await res.json(); target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">' + T.esc(ed.error || '无权限') + '</p></div>'; return; }
        var list = (await res.json()).announcements || [];
        var html = '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('bell') + ' 公告管理</span></div>';
        html += '<div class="ann-editor">' +
          '<textarea class="ann-editor__input" id="annInput" maxlength="500" placeholder="输入公告内容（最多 500 字），发布后立即在首页公告栏滚动显示…"></textarea>' +
          '<div class="ann-editor__row"><span class="invite-tip" id="annInputHint">' + (editingAnnId ? '正在编辑公告 #' + editingAnnId : '新增公告') + '</span>' +
          '<button class="btn btn--primary btn--sm" id="annSaveBtn">' + ic('send') + ' ' + (editingAnnId ? '保存修改' : '发布公告') + '</button>' +
          (editingAnnId ? '<button class="btn btn--sm" id="annCancelEdit">' + ic('x') + ' 取消编辑</button>' : '') +
          '</div></div>';
        if (!list.length) {
          html += '<div class="dash-empty"><div class="dash-empty__icon">' + ic('bell') + '</div><p class="dash-empty__text">还没有公告，先发布一条吧</p></div>';
        } else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>内容</th><th>作者</th><th>时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
          for (var i = 0; i < list.length; i++) {
            var a = list[i];
            var statusCls = a.active ? 'item-status--verified' : 'item-status--pending';
            html += '<tr>';
            html += '<td class="ann-cell">' + T.esc(a.content) + '</td>';
            html += '<td class="item-date">' + T.esc(a.authorName || '匿名') + '</td>';
            html += '<td class="item-date">' + T.esc((a.createdAt || '').slice(0, 16).replace('T', ' ')) + '</td>';
            html += '<td><span class="item-status ' + statusCls + '">' + (a.active ? '显示中' : '已下线') + '</span></td>';
            html += '<td class="dash-actions">' +
              '<button class="btn-icon" title="编辑" data-annedit="' + T.esc(a.id) + '">' + ic('pencil') + '</button>' +
              '<button class="btn-icon" title="' + (a.active ? '下线' : '上线') + '" data-anntoggle="' + T.esc(a.id) + '">' + (a.active ? ic('pause') : ic('play')) + '</button>' +
              '<button class="btn-icon btn-icon--danger" title="删除" data-anndel="' + T.esc(a.id) + '">' + ic('x') + '</button>' +
              '</td>';
            html += '</tr>';
          }
          html += '</tbody></table></div>';
        }
        html += '</div>';
        target.innerHTML = html;

        var input = document.getElementById('annInput');
        if (editingAnnId) {
          var editing = null;
          for (var j = 0; j < list.length; j++) { if (list[j].id === editingAnnId) { editing = list[j]; break; } }
          if (editing && input) input.value = editing.content;
        }

        target.onclick = async function(e) {
          var save = e.target.closest('#annSaveBtn');
          if (save) {
            var val = (document.getElementById('annInput')?.value || '').trim();
            if (!val) { T.showToast('公告内容不能为空'); return; }
            if (val.length > 500) { T.showToast('公告最多 500 字'); return; }
            try {
              var r = editingAnnId
                ? await T.api('PUT', '/admin/announcements/' + editingAnnId, { content: val })
                : await T.api('POST', '/admin/announcements', { content: val });
              if (!r.ok) { var de = await r.json(); T.showToast(de.error || '保存失败'); return; }
              T.showToast(editingAnnId ? '公告已更新' : '公告已发布');
              editingAnnId = null;
              loadAnnouncements(target);
            } catch (err) { T.showToast('保存失败'); }
            return;
          }
          var cancel = e.target.closest('#annCancelEdit');
          if (cancel) { editingAnnId = null; loadAnnouncements(target); return; }
          var edit = e.target.closest('[data-annedit]');
          if (edit) { editingAnnId = edit.getAttribute('data-annedit'); loadAnnouncements(target); return; }
          var toggle = e.target.closest('[data-anntoggle]');
          if (toggle) {
            var tid = toggle.getAttribute('data-anntoggle');
            try {
              var cur = null;
              for (var k = 0; k < list.length; k++) { if (list[k].id === tid) { cur = list[k]; break; } }
              var tr = await T.api('PUT', '/admin/announcements/' + tid, { active: cur ? !cur.active : false });
              if (!tr.ok) { var te = await tr.json(); T.showToast(te.error || '操作失败'); return; }
              loadAnnouncements(target);
            } catch (err) { T.showToast('操作失败'); }
            return;
          }
          var del = e.target.closest('[data-anndel]');
          if (del) {
            if (!confirm('确定删除这条公告？删除后不可恢复。')) return;
            try {
              var dr = await T.api('DELETE', '/admin/announcements/' + del.getAttribute('data-anndel'));
              if (!dr.ok) { var dde = await dr.json(); T.showToast(dde.error || '删除失败'); return; }
              T.showToast('已删除');
              loadAnnouncements(target);
            } catch (err) { T.showToast('删除失败'); }
            return;
          }
        };
      } catch (e) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e.message) + '</p></div>';
      }
    }

    // ===== 认证广告（版主+）：认证 / 确认收款上线 / 下线 / 续费 / 删除 =====
    // 广告上线总控：广告商仅可提交物料与自助下线，上线需在此人工确认。
    var SPONSOR_LABEL = { pending: '待认证', qualified: '待付款', active: '投放中', rejected: '已拒绝', offline: '已下线', expired: '已到期' };
    async function loadSponsors(target) {
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var res = await T.api('GET', '/admin/sponsors' + (sponsorStatus === 'all' ? '' : '?status=' + sponsorStatus));
        if (!res.ok) { var ed = await res.json(); target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">' + T.esc(ed.error || '无权限') + '</p></div>'; return; }
        var list = (await res.json()).sponsors || [];
        var html = '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('gem') + ' 认证广告</span></div>';
        html += '<div class="dash__filters">' +
          ['all', 'pending', 'qualified', 'active', 'rejected', 'offline', 'expired'].map(function (st) {
            var label = st === 'all' ? '全部' : (SPONSOR_LABEL[st] || st);
            return '<button class="dash__tab' + (sponsorStatus === st ? ' is-active' : '') + '" data-spf="' + st + '">' + label + '</button>';
          }).join('') + '</div>';
        html += '<p class="invite-tip">确认收款后即可上线，同一位置同时只展示 1 条广告，新上线会替换旧的；修改资料会重新进入审核，到期后自动下线。</p>';
        if (!list.length) {
          html += '<div class="dash-empty"><div class="dash-empty__icon">' + ic('gem') + '</div><p class="dash-empty__text">暂无广告。广告商通过「商务合作」页提交申请后，会出现在这里等待审核。</p></div>';
        } else {
          html += '<div class="sponsor-grid">';
          for (var i = 0; i < list.length; i++) {
            (function (s) {
              var stCls = s.status === 'active' ? 'item-status--verified' : (s.status === 'rejected' ? 'item-status--rejected' : 'item-status--pending');
              html += '<div class="sponsor-card">';
              html += '<div class="sponsor-card__head"><div class="sponsor-card__brand"><div class="sponsor-card__name">' + T.esc(s.name) + '</div>';
              if (s.slogan) html += '<div class="sponsor-card__slogan">' + T.esc(s.slogan) + '</div>';
              html += '<div class="sponsor-card__url"><a href="' + T.esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + T.esc(s.url) + '</a>' + (s.verifyScore ? ' · 质检 ' + s.verifyScore + ' 分' : '') + '</div>';
              if (s.status === 'rejected' && s.rejectReason) html += '<div class="sponsor-card__slogan" style="color:var(--red)">拒绝：' + T.esc(s.rejectReason) + '</div>';
              html += '</div><span class="item-status ' + stCls + '">' + T.esc(SPONSOR_LABEL[s.status] || s.status) + '</span></div>';
              html += '<div class="sponsor-card__meta"><span>' + (s.paid ? '已付款' : '未付款') + (s.expiredNow ? ' · 已到期' : '') + '</span><span>·</span><span>' + T.esc(s.slot || 'home') + '</span></div>';
              html += '<div class="sponsor-card__stats"><div class="sponsor-card__stat"><span>费用</span><b>' + (s.price || 0) + ' 元</b></div><div class="sponsor-card__stat"><span>到期</span><b>' + T.esc((s.endsAt || '').slice(0, 10) || '—') + '</b></div><div class="sponsor-card__stat"><span>数据</span><b>' + (s.views || 0) + ' / ' + (s.clicks || 0) + '</b></div></div>';
              html += '<div class="sponsor-card__actions">';
              if (s.status === 'pending' || s.status === 'rejected') html += '<button class="btn-icon" title="认证通过（待付款）" data-sp-approve="' + T.esc(s.id) + '">' + ic('shield-check') + '</button>';
              if (s.status !== 'rejected') html += '<button class="btn-icon" title="拒绝并附理由" data-sp-reject="' + T.esc(s.id) + '">' + ic('x') + '</button>';
              if (s.status === 'qualified' || s.status === 'offline' || s.status === 'expired') html += '<button class="btn-icon" title="确认收款并上线" data-sp-activate="' + T.esc(s.id) + '">' + ic('rocket') + '</button>';
              if (s.status === 'active') { html += '<button class="btn-icon" title="下线" data-sp-offline="' + T.esc(s.id) + '">' + ic('pause') + '</button>'; html += '<button class="btn-icon" title="续费" data-sp-renew="' + T.esc(s.id) + '">' + ic('refresh-cw') + '</button>'; }
              html += '<button class="btn-icon btn-icon--danger" title="彻底删除" data-sp-del="' + T.esc(s.id) + '">' + ic('trash-2') + '</button>';
              html += '</div></div>';
            })(list[i]);
          }
          html += '</div>';
        }
        html += '</div>';
        target.innerHTML = html;
        target.onclick = async function (e) {
          var f = e.target.closest('[data-spf]');
          if (f) { sponsorStatus = f.getAttribute('data-spf'); loadSponsors(target); return; }
          async function call(method, url, body, okMsg) {
            try {
              var r = await T.api(method, url, body || {});
              var d = await r.json().catch(function () { return {}; });
              if (!r.ok) { T.showToast(d.error || '操作失败'); return; }
              if (okMsg) T.showToast(okMsg);
              loadSponsors(target);
            } catch (err) { T.showToast('操作失败'); }
          }
          var ap = e.target.closest('[data-sp-approve]');
          if (ap) {
            var scoreRaw = prompt('认证通过。质检分（0-100，可空）:', '');
            var score = scoreRaw === null ? undefined : parseInt(scoreRaw, 10);
            var body = (scoreRaw !== null && scoreRaw !== '' && Number.isInteger(score)) ? { verifyScore: score } : {};
            await call('PUT', '/admin/sponsors/' + ap.getAttribute('data-sp-approve') + '/approve', body, '已认证，待广告商付款');
            return;
          }
          var rj = e.target.closest('[data-sp-reject]');
          if (rj) {
            var reason = prompt('拒绝理由（广告商可见，≤200字）:', '');
            if (reason === null) return;
            if (!reason.trim()) { T.showToast('请填写拒绝理由'); return; }
            await call('PUT', '/admin/sponsors/' + rj.getAttribute('data-sp-reject') + '/reject', { reason: reason.trim() });
            return;
          }
          var ac = e.target.closest('[data-sp-activate]');
          if (ac) {
            var daysRaw = prompt('确认已收到款项。上线天数（默认 30）:', '30');
            if (daysRaw === null) return;
            var priceRaw = prompt('包月金额（元，默认 0 表示待定）:', '0');
            if (priceRaw === null) return;
            await call('PUT', '/admin/sponsors/' + ac.getAttribute('data-sp-activate') + '/activate',
              { days: parseInt(daysRaw, 10) || 30, price: parseInt(priceRaw, 10) || 0 }, '已上线');
            return;
          }
          var of = e.target.closest('[data-sp-offline]');
          if (of) { if (!confirm('下线这条广告？')) return; await call('PUT', '/admin/sponsors/' + of.getAttribute('data-sp-offline') + '/offline', {}, '已下线'); return; }
          var rn = e.target.closest('[data-sp-renew]');
          if (rn) {
            var dRaw = prompt('续费天数（默认 30）:', '30');
            if (dRaw === null) return;
            await call('PUT', '/admin/sponsors/' + rn.getAttribute('data-sp-renew') + '/renew', { days: parseInt(dRaw, 10) || 30 }, '已续费');
            return;
          }
          var del = e.target.closest('[data-sp-del]');
          if (del) { if (!confirm('彻底删除这条广告（含数据，不可恢复）？')) return; await call('DELETE', '/admin/sponsors/' + del.getAttribute('data-sp-del'), {}, '已删除'); return; }
        };
      } catch (e2) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e2.message) + '</p></div>';
      }
    }

    // 反馈 / Bug（公社信箱）：单入口双标签，后台仅版主+可见；内容/url/图片全部 T.esc
    async function loadFeedback(target) {
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var res = await T.api('GET', '/admin/feedback' + (fbStatus !== 'all' ? '?status=' + fbStatus : ''));
        if (!res.ok) { var ed = await res.json(); target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">' + T.esc(ed.error || '无权限') + '</p></div>'; return; }
        var list = (await res.json()).feedback || [];
        var html = '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('inbox') + ' 公社信箱</span></div>';
        html += '<div class="dash__filters">' +
          '<button class="dash__tab' + (fbStatus === 'all' ? ' is-active' : '') + '" data-fbs="all">' + ic('layers') + '全部</button>' +
          '<button class="dash__tab' + (fbStatus === 'open' ? ' is-active' : '') + '" data-fbs="open">' + ic('clock') + '待处理</button>' +
          '<button class="dash__tab' + (fbStatus === 'done' ? ' is-active' : '') + '" data-fbs="done">' + ic('check') + '已处理</button>' +
          '</div>';
        if (!list.length) {
          html += '<div class="dash-empty"><div class="dash-empty__icon">' + ic('inbox') + '</div><p class="dash-empty__text">信箱还是空的</p></div>';
        } else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>类型</th><th>内容</th><th>作者</th><th>时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
          for (var i = 0; i < list.length; i++) {
            var f = list[i];
            var statusCls = f.status === 'done' ? 'item-status--verified' : 'item-status--pending';
            html += '<tr>';
            html += '<td><span class="fb-badge' + (f.kind === 'bug' ? ' fb-badge--bug' : '') + '">' + (f.kind === 'bug' ? '🐞 抓虫' : '💬 反馈') + '</span></td>';
            html += '<td class="ann-cell"><div class="ann-cell__content">' + T.esc(f.content) +
              (f.url ? ' <span class="fb-meta" title="' + T.esc(f.url) + '">' + ic('external-link') + '页面</span>' : '') +
              (f.image ? ' <a class="fb-meta" href="' + T.esc(f.image) + '" target="_blank" rel="noopener noreferrer">' + ic('image') + '看图</a>' : '') +
              '</div></td>';
            html += '<td class="item-date">' + T.esc(f.authorName || '匿名') + '</td>';
            html += '<td class="item-date">' + T.esc((f.createdAt || '').slice(0, 16).replace('T', ' ')) + '</td>';
            html += '<td><span class="item-status ' + statusCls + '">' + (f.status === 'done' ? '已处理' : '待处理') + '</span></td>';
            html += '<td class="dash-actions">' +
              '<button class="btn-icon" title="' + (f.status === 'done' ? '重新打开' : '标记完成') + '" data-fbdone="' + T.esc(f.id) + '">' + (f.status === 'done' ? ic('rotate-ccw') : ic('check')) + '</button>' +
              (f.pointsAwarded
                ? '<span class="fb-awarded" title="已通过，作者 +1 积分">' + ic('award') + '</span>'
                : '<button class="btn-icon btn-icon--gold" title="高质量反馈，通过并给作者 +1 积分" data-fbverify="' + T.esc(f.id) + '">' + ic('award') + '</button>') +
              '<button class="btn-icon btn-icon--danger" title="删除" data-fbdel="' + T.esc(f.id) + '">' + ic('x') + '</button>' +
              '</td>';
            html += '</tr>';
          }
          html += '</tbody></table></div>';
        }
        html += '</div>';
        target.innerHTML = html;
        target.onclick = async function (e) {
          var filter = e.target.closest('[data-fbs]');
          if (filter) { fbStatus = filter.getAttribute('data-fbs'); loadFeedback(target); return; }
          var done = e.target.closest('[data-fbdone]');
          if (done) {
            var fid = done.getAttribute('data-fbdone');
            var cur = null;
            for (var k = 0; k < list.length; k++) { if (list[k].id === fid) { cur = list[k]; break; } }
            try {
              var dr = await T.api('PUT', '/admin/feedback/' + fid, { status: cur && cur.status === 'done' ? 'open' : 'done' });
              if (!dr.ok) { var de = await dr.json(); T.showToast(de.error || '操作失败'); return; }
              loadFeedback(target);
            } catch (err) { T.showToast('操作失败'); }
            return;
          }
          var del = e.target.closest('[data-fbdel]');
          if (del) {
            if (!confirm('确定删除这条反馈？不可恢复。')) return;
            try {
              var dr2 = await T.api('DELETE', '/admin/feedback/' + del.getAttribute('data-fbdel'));
              if (!dr2.ok) { var dde = await dr2.json(); T.showToast(dde.error || '删除失败'); return; }
              T.showToast('已删除');
              loadFeedback(target);
            } catch (err) { T.showToast('删除失败'); }
            return;
          }
          var verify = e.target.closest('[data-fbverify]');
          if (verify) {
            if (!confirm('确认为高质量反馈？将给作者 +1 积分（同一反馈仅发一次）。')) return;
            try {
              var vr = await T.api('POST', '/admin/feedback/' + verify.getAttribute('data-fbverify') + '/verify');
              var vj = vr.ok ? await vr.json() : null;
              if (!vr.ok || !vj) { var ve = vr.ok ? null : await vr.json(); T.showToast((ve && ve.error) || '操作失败'); return; }
              T.showToast(vj.awarded ? '已通过，作者 +1 积分' : '该反馈已奖励过积分');
              loadFeedback(target);
            } catch (err) { T.showToast('操作失败'); }
            return;
          }
        };
      } catch (e) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e.message) + '</p></div>';
      }
    }

    // ===== 访客统计（版主+）：概览卡片 + 国家分布 + 7 日趋势 + 最近访问 + 热门页面 =====
    // 数据源 lib/analytics.js（beacon 采集，浏览器上报时区/语言，服务端补 IP/UA；保留 30 天）
    async function loadVisits(target) {
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var res = await T.api('GET', '/admin/visits?limit=50');
        if (!res.ok) { var ed = await res.json(); target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">' + T.esc(ed.error || '无权限') + '</p></div>'; return; }
        var d = await res.json();
        var s = d.stats || {};
        var visits = d.visits || [];
        var html = '';

        // 概览数字卡片
        var cards = [
          { label: '今日 PV', val: s.todayPv },
          { label: '今日 UV', val: s.todayUv },
          { label: '24h PV', val: s.h24Pv },
          { label: '近 7 日 PV', val: s.weekPv }
        ];
        html += '<div class="mon-cards">' + cards.map(function (c) {
          return '<div class="mon-card"><div class="mon-card__val">' + c.val + '</div><div class="mon-card__label">' + c.label + '</div></div>';
        }).join('') + '</div>';

        // 国家/地区分布（近 30 天，纯 CSS 柱条）
        var byCountry = s.byCountry || [];
        var maxCountry = 1;
        byCountry.forEach(function (r) { if (r.c > maxCountry) maxCountry = r.c; });
        html += '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('globe') + ' 国家/地区分布（近 30 天）</span></div>';
        if (!byCountry.length) {
          html += '<div class="dash-empty"><p class="dash-empty__text">暂无数据——访客页面加载后由浏览器上报，JS 禁用/爬虫不计入</p></div>';
        } else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><tbody>';
          byCountry.forEach(function (r) {
            html += '<tr><td style="width:150px;white-space:nowrap">' + T.esc(r.country) + '</td>' +
              '<td><div class="mon-bar"><i style="width:' + Math.round(r.c / maxCountry * 100) + '%"></i></div></td>' +
              '<td class="item-date" style="width:70px">' + r.c + '</td></tr>';
          });
          html += '</tbody></table></div>';
        }
        html += '</div>';

        // 近 7 日 PV 趋势（纯 CSS 柱状图）
        var byDay = s.byDay || [];
        var maxDay = 1;
        byDay.forEach(function (r) { if (r.c > maxDay) maxDay = r.c; });
        html += '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('calendar') + ' 近 7 日 PV 趋势</span></div>';
        if (!byDay.length) {
          html += '<div class="dash-empty"><p class="dash-empty__text">暂无数据</p></div>';
        } else {
          html += '<div class="mon-bars">' + byDay.map(function (r) {
            var h = Math.max(2, Math.round(r.c / maxDay * 100));
            return '<div class="mon-bar-col" title="' + T.esc(r.day) + ' · ' + r.c + ' PV"><i style="height:' + h + '%"></i><span>' + T.esc(r.day.slice(5)) + '</span></div>';
          }).join('') + '</div>';
        }
        html += '</div>';

        // 最近访问明细
        html += '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('users') + ' 最近访问（保留 30 天）</span>' +
          '<button class="btn btn--ghost btn--sm" id="visitsRefreshBtn">' + ic('refresh-cw') + ' 刷新</button></div>';
        if (!visits.length) {
          html += '<div class="dash-empty"><p class="dash-empty__text">暂无访问记录</p></div>';
        } else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>时间</th><th>IP</th><th>国家/地区</th><th>页面</th><th>来源</th><th>UA</th></tr></thead><tbody>';
          visits.forEach(function (v) {
            // trust proxy=1 后 req.ip 已是客户端 IP；X-Forwarded-For 链尾兜底展示
            var ipTxt = v.ip ? String(v.ip).split(',').pop().trim() : '—';
            html += '<tr><td class="item-date">' + T.esc(bjTime(v.created_at)) + '</td>' +
              '<td><code class="mon-ip">' + T.esc(ipTxt) + '</code></td>' +
              '<td>' + T.esc(v.country || '未知') + '</td>' +
              '<td class="mon-path" title="' + T.esc(v.path || '') + '">' + T.esc(v.path || '—') + '</td>' +
              '<td class="mon-path" title="' + T.esc(v.ref || '') + '">' + T.esc(v.ref || '直接访问') + '</td>' +
              '<td class="mon-ua" title="' + T.esc(v.ua || '') + '">' + T.esc(v.ua || '—') + '</td></tr>';
          });
          html += '</tbody></table></div>';
        }
        html += '</div>';

        // 来源 TOP（近 30 天）：SEO 看 google/baidu/bing，GEO 看 chatgpt.com/claude.ai/perplexity.ai 等 AI 引用
        var byRef = s.byRef || [];
        var maxRef = 1;
        byRef.forEach(function (r) { if (r.c > maxRef) maxRef = r.c; });
        html += '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('link') + ' 来源 TOP（近 30 天）</span></div>';
        if (!byRef.length) {
          html += '<div class="dash-empty"><p class="dash-empty__text">暂无数据</p></div>';
        } else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><tbody>';
          byRef.forEach(function (r) {
            html += '<tr><td class="mon-path" style="max-width:300px" title="' + T.esc(r.ref) + '">' + T.esc(r.ref) + '</td>' +
              '<td><div class="mon-bar"><i style="width:' + Math.round(r.c / maxRef * 100) + '%"></i></div></td>' +
              '<td class="item-date" style="width:70px">' + r.c + '</td></tr>';
          });
          html += '</tbody></table></div>';
        }
        html += '</div>';

        // 热门页面 TOP（近 30 天）
        var byPath = s.byPath || [];
        var maxPath = 1;
        byPath.forEach(function (r) { if (r.c > maxPath) maxPath = r.c; });
        html += '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('link') + ' 热门页面（近 30 天）</span></div>';
        if (!byPath.length) {
          html += '<div class="dash-empty"><p class="dash-empty__text">暂无数据</p></div>';
        } else {
          html += '<div class="dash-table-wrap"><table class="dash-table"><tbody>';
          byPath.forEach(function (r) {
            html += '<tr><td class="mon-path" style="max-width:300px" title="' + T.esc(r.path) + '">' + T.esc(r.path) + '</td>' +
              '<td><div class="mon-bar"><i style="width:' + Math.round(r.c / maxPath * 100) + '%"></i></div></td>' +
              '<td class="item-date" style="width:70px">' + r.c + '</td></tr>';
          });
          html += '</tbody></table></div>';
        }
        html += '</div>';

        target.innerHTML = html;
        var rf = document.getElementById('visitsRefreshBtn');
        if (rf) rf.onclick = function () { loadVisits(target); };
      } catch (e) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e.message) + '</p></div>';
      }
    }

    // ===== 服务器资源监控（版主+）：数字卡片 + CPU/内存 柱状曲线，极速 3s 轮询 =====
    var serverTimer = null;
    var serverLive = true;
    // 数据源 lib/analytics.js（每 5s 采样 CPU/内存/磁盘/RSS，120 点 ≈ 10 分钟窗口）
    async function loadServer(target) {
      if (serverTimer) { clearInterval(serverTimer); serverTimer = null; }
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var res = await T.api('GET', '/admin/server-stats');
        if (!res.ok) { var ed = await res.json(); target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">' + T.esc(ed.error || '无权限') + '</p></div>'; return; }
        var d = await res.json();
        var latest = d.latest || {};
        var series = d.series || [];
        function fmtBytes(b) {
          b = Number(b) || 0;
          if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
          if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
          return (b / 1024).toFixed(0) + ' KB';
        }
        function pct(used, total) { return total ? Math.round(used / total * 1000) / 10 : 0; }
        var html = '';

        // 顶部实时状态条
        html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">';
        html += '<span class="live-dot' + (serverLive ? ' is-live' : '') + '" id="liveDot"></span><span style="font-size:13px;font-weight:700;color:' + (serverLive ? 'var(--green)' : 'var(--text-muted)') + '" id="liveText">' + (serverLive ? '实时' : '已暂停') + '</span>';
        html += '<span class="mon-note" id="liveNote" style="margin:0">每 5s 采样 · 3s 自动刷新</span>';
        html += '<button class="btn btn--ghost btn--sm" id="liveToggle" style="margin-left:auto">' + (serverLive ? ic('pause') + ' 暂停' : ic('play') + ' 继续') + '</button>';
        html += '</div>';

        // 数字卡片（带 id 供极速更新）
        var cards = [
          { id: 'cpu', label: 'CPU 使用率', val: (latest.cpu != null ? latest.cpu : '—') + '%' },
          { id: 'mem', label: '内存', val: fmtBytes(latest.mem_used) + ' / ' + fmtBytes(latest.mem_total), sub: '占用 ' + pct(latest.mem_used, latest.mem_total) + '%' },
          { id: 'disk', label: '磁盘 /', val: fmtBytes(latest.disk_used) + ' / ' + fmtBytes(latest.disk_total), sub: '占用 ' + pct(latest.disk_used, latest.disk_total) + '%' },
          { id: 'rss', label: 'Node 进程 RSS', val: fmtBytes(latest.rss) }
        ];
        html += '<div class="mon-cards" id="monCards">' + cards.map(function (c) {
          return '<div class="mon-card"><div class="mon-card__val" data-k="' + c.id + '">' + c.val + '</div><div class="mon-card__label">' + c.label + '</div>' +
            (c.sub ? '<div class="mon-card__sub" data-sk="' + c.id + '">' + c.sub + '</div>' : '') + '</div>';
        }).join('') + '</div>';

        // 柱状曲线（5s/次，120 点 ≈ 10 分钟，平滑过渡）
        function chartBars(title, iconName, getVal, chartId) {
          var max = 1;
          series.forEach(function (r) { var v = getVal(r); if (v > max) max = v; });
          var html2 = '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic(iconName) + ' ' + title + '（每 5s 采样，最近 ' + series.length + ' 点）</span></div>';
          if (!series.length) {
            html2 += '<div class="dash-empty"><p class="dash-empty__text">暂无采样——服务重启后 5 秒内开始采集</p></div>';
          } else {
            html2 += '<div class="mon-bars mon-bars--chart" id="' + chartId + '">' + series.map(function (r) {
              var v = Math.round(getVal(r) * 10) / 10;
              var h = Math.max(2, Math.round(v / max * 100));
              return '<div class="mon-bar-col" title="' + v + '"><i style="height:' + h + '%"></i></div>';
            }).join('') + '</div>';
          }
          return html2 + '</div>';
        }
        html += chartBars('CPU 使用率', 'server', function (r) { return r.cpu || 0; }, 'cpuChart');
        html += chartBars('内存占用率', 'layers', function (r) { return r.mem_total ? r.mem_used / r.mem_total * 100 : 0; }, 'memChart');

        var lastTs = latest.created_at ? new Date(latest.created_at).toLocaleTimeString('zh-CN') : '—';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:0 2px;flex-wrap:wrap">' +
          '<p class="mon-note" id="lastTs" style="margin:0">最近一次采样：' + T.esc(lastTs) + '</p>' +
          '<button class="btn btn--ghost btn--sm" id="serverRefreshBtn">' + ic('refresh-cw') + ' 立即刷新</button></div>';

        target.innerHTML = html;
        var sr = document.getElementById('serverRefreshBtn');
        if (sr) sr.onclick = function () { loadServer(target); };
        var lt = document.getElementById('liveToggle');
        if (lt) lt.onclick = function(){ serverLive = !serverLive; lt.innerHTML = (serverLive ? ic('pause') + ' 暂停' : ic('play') + ' 继续'); document.getElementById('liveDot').className = 'live-dot' + (serverLive ? ' is-live' : ''); document.getElementById('liveText').textContent = serverLive ? '实时' : '已暂停'; document.getElementById('liveText').style.color = serverLive ? 'var(--green)' : 'var(--text-muted)'; if (serverLive) startPoll(); else if (serverTimer){ clearInterval(serverTimer); serverTimer=null; } };
        function startPoll(){
          if (serverTimer) clearInterval(serverTimer);
          if (!serverLive) return;
          serverTimer = setInterval(async function(){
            if (document.hidden || !document.getElementById('monCards') || currentTab !== 'server') return;
            try {
              var r = await T.api('GET', '/admin/server-stats');
              if (!r.ok) return;
              var nd = await r.json();
              var nl = nd.latest || {}; var ns = nd.series || [];
              // 极速更新数字卡片（不闪烁，平滑）
              var cpuEl = document.querySelector('[data-k="cpu"]'); if (cpuEl) cpuEl.textContent = (nl.cpu != null ? nl.cpu : '—') + '%';
              var memEl = document.querySelector('[data-k="mem"]'); if (memEl) memEl.textContent = fmtBytes(nl.mem_used) + ' / ' + fmtBytes(nl.mem_total);
              var memSub = document.querySelector('[data-sk="mem"]'); if (memSub) memSub.textContent = '占用 ' + pct(nl.mem_used, nl.mem_total) + '%';
              var diskEl = document.querySelector('[data-k="disk"]'); if (diskEl) diskEl.textContent = fmtBytes(nl.disk_used) + ' / ' + fmtBytes(nl.disk_total);
              var diskSub = document.querySelector('[data-sk="disk"]'); if (diskSub) diskSub.textContent = '占用 ' + pct(nl.disk_used, nl.disk_total) + '%';
              var rssEl = document.querySelector('[data-k="rss"]'); if (rssEl) rssEl.textContent = fmtBytes(nl.rss);
              var tsEl = document.getElementById('lastTs'); if (tsEl && nl.created_at) tsEl.textContent = '最近一次采样：' + new Date(nl.created_at).toLocaleTimeString('zh-CN');
              // 平滑重绘柱状（120 点，高度过渡 0.4s）
              function updateChart(id, getVal){
                var el = document.getElementById(id); if (!el || !ns.length) return;
                var max = 1; ns.forEach(function(rr){ var v=getVal(rr); if(v>max) max=v; });
                var cols = el.querySelectorAll('.mon-bar-col i');
                // 若点数变化则全量重建，否则仅改高度（极速）
                if (cols.length !== ns.length) {
                  el.innerHTML = ns.map(function(rr){ var v=Math.round(getVal(rr)*10)/10; var h=Math.max(2,Math.round(v/max*100)); return '<div class="mon-bar-col" title="'+v+'"><i style="height:'+h+'%"></i></div>'; }).join('');
                } else {
                  for (var i=0;i<ns.length;i++){ var v2=Math.round(getVal(ns[i])*10)/10; var h2=Math.max(2,Math.round(v2/max*100)); cols[i].style.height = h2 + '%'; cols[i].parentElement.title = v2; }
                }
              }
              updateChart('cpuChart', function(rr){ return rr.cpu || 0; });
              updateChart('memChart', function(rr){ return rr.mem_total ? rr.mem_used/rr.mem_total*100 : 0; });
            } catch(e){}
          }, 3000);
        }
        startPoll();
        // 切走 tab 自动暂停，节省请求
        var _origRender = renderLayout;
        // 清理由外层 currentTab 变化触发的下一轮 renderLayout 已在 loadServer 外处理，此处仅页面隐藏暂停
        document.addEventListener('visibilitychange', function(){ if(document.hidden && serverTimer){ clearInterval(serverTimer); serverTimer=null; } else if(!document.hidden && serverLive && currentTab==='server' && !serverTimer){ startPoll(); } });
      } catch (e) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e.message) + '</p></div>';
      }
    }
    async function loadAiJudge(target) {
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var res = await T.api('GET', '/admin/ai-judge');
        if (!res.ok) { var ed = await res.json(); target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">' + T.esc(ed.error || '无权限') + '</p></div>'; return; }
        var data = await res.json();
        var cur = data.current;
        var status = data.status || {};
        var cands = data.candidates || [];
        var html = '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('bot') + ' AI 判官设置</span><button class="btn btn--ghost btn--sm" id="aiJudgeRefresh">' + ic('refresh-cw') + ' 刷新</button></div>';
        html += '<p class="invite-tip" style="margin:0 22px 16px">判官是掺水检测的“裁判”——用平台上一个可信 Token 对“回显/身份/知识”做语义复核，只升不降。优先专用判官，其次池子自动选。</p>';
        // 当前专用 — 单卡扁平化，不再嵌套 dash__section
        html += '<div class="ai-judge-card" style="margin:0 22px 18px">';
        html += '<div class="ai-judge-card__head">' + ic('sparkles') + ' 当前专用判官</div>';
        if (cur && cur.baseUrl) {
          var health = status.dedicated ? status.dedicated.health : null;
          var hText = health ? (health.state === 'ok' ? '健康' : (health.state === 'dead' ? '冷却中' : '可用')) : '未知';
          var hCls = health && health.state === 'ok' ? 'is-ok' : (health && health.state === 'dead' ? 'is-bad' : '');
          html += '<div class="ai-judge-current"><div class="ai-judge-kv"><span>Base URL</span><b>' + T.esc(cur.baseUrl) + '</b></div>'
            + '<div class="ai-judge-kv"><span>模型</span><b>' + T.esc(cur.model) + '</b></div>'
            + '<div class="ai-judge-kv"><span>Token</span><b>' + T.esc(cur.tokenMasked || '') + '</b></div>'
            + '<div class="ai-judge-kv"><span>状态</span><b class="' + hCls + '">' + T.esc(hText) + '</b>' + (status.judgeProbe ? '<span class="ai-judge-probe">' + (status.judgeProbe.ok ? '· 探活可用' : '· 暂无可用') + '</span>' : '') + '</div>'
            + (cur.updatedAt ? '<div class="ai-judge-time">更新于 ' + T.esc(cur.updatedAt.slice(0,19).replace('T',' ')) + '</div>' : '')
            + '</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">'
            + '<button class="btn btn--ghost btn--sm" id="aiJudgeClear">' + ic('x') + ' 清除专用（回池子）</button>'
            + '<button class="btn btn--primary btn--sm" id="aiJudgeTest">' + ic('play') + ' 测试判官</button>'
            + '</div>';
        } else {
          html += '<div class="dash-empty" style="margin:0"><p class="dash-empty__text">未设置专用判官，当前走池子自动选（' + (status.poolSize || 0) + ' 候选）' + (status.judgeProbe && status.judgeProbe.ok ? ' · 已有可用判官' : ' · 暂无可用判官') + '</p></div>';
          html += '<div style="margin-top:12px"><button class="btn btn--primary btn--sm" id="aiJudgeTest2">' + ic('play') + ' 测试当前池子</button></div>';
        }
        html += '</div>';
        // 手动设置 — 紧凑表单，移动端单列
        html += '<div class="ai-judge-card" style="margin:0 22px 18px">';
        html += '<div class="ai-judge-card__head">' + ic('settings') + ' 手动设置</div>';
        html += '<div class="ai-judge-form">'
          + '<label class="ai-judge-label">Base URL<input class="input" id="aiJudgeBase" placeholder="https://apihub.agnes-ai.com/v1" value="' + T.esc(cur ? cur.baseUrl : '') + '"></label>'
          + '<label class="ai-judge-label">模型<input class="input" id="aiJudgeModel" placeholder="agnes-2.5-flash" value="' + T.esc(cur ? cur.model : '') + '"></label>'
          + '<label class="ai-judge-label">API Key<input class="input" id="aiJudgeToken" placeholder="留空则不改（显示为 ****）" type="password"></label>'
          + '<button class="btn btn--primary" id="aiJudgeSave" style="width:100%;justify-content:center">' + ic('check') + ' 保存专用判官</button>'
          + '<p class="ai-judge-hint">Token 仅存服务端，不回显明文；保存后立即生效，无需重启。</p>'
          + '</div></div>';
        // 候选一键 — 响应式卡片网格
        html += '<div class="ai-judge-card" style="margin:0 22px 4px">';
        html += '<div class="ai-judge-card__head">' + ic('gem') + ' 一键选用平台可用 Token<span class="ai-judge-count">' + cands.length + '</span></div>';
        if (!cands.length) {
          html += '<div class="dash-empty"><p class="dash-empty__text">暂无已上线 openai 兼容的可用 Token，请先发布/审核一条</p></div>';
        } else {
          html += '<div class="ai-judge-grid">';
          cands.forEach(function(c){
            var models = (c.models||[]).slice(0,6);
            var opts = models.map(function(m){ return '<option value="' + T.esc(m) + '">' + T.esc(m) + '</option>'; }).join('');
            html += '<div class="ai-judge-pick">'
              + '<div class="ai-judge-pick__name">' + T.esc(c.name) + '</div>'
              + '<div class="ai-judge-pick__meta">' + T.esc(c.provider||'') + ' · ' + T.esc(c.tokenMasked||'') + '</div>'
              + '<div class="ai-judge-pick__url">' + T.esc(c.url) + '</div>'
              + '<div class="ai-judge-pick__row">'
              + '<select class="input input--sm" data-ai-model-for="' + T.esc(c.id) + '">' + opts + '</select>'
              + '<button class="btn btn--primary btn--sm" data-ai-pick="' + T.esc(c.id) + '">' + ic('bot') + ' 设为判官</button>'
              + '</div></div>';
          });
          html += '</div>';
        }
        html += '</div>';
        html += '</div>';
        target.innerHTML = html;
        // 绑定
        var rf = document.getElementById('aiJudgeRefresh');
        if (rf) rf.onclick = function(){ loadAiJudge(target); };
        var clr = document.getElementById('aiJudgeClear');
        if (clr) clr.onclick = async function(){
          if (!confirm('清除专用判官？之后将回退到池子自动选。')) return;
          var r = await T.api('DELETE', '/admin/ai-judge');
          var d = await r.json().catch(function(){return {};});
          if (!r.ok) { T.showToast(d.error||'清除失败'); return; }
          T.showToast('已清除专用判官');
          loadAiJudge(target);
        };
        var tst = document.getElementById('aiJudgeTest') || document.getElementById('aiJudgeTest2');
        if (tst) tst.onclick = async function(){
          tst.disabled=true; tst.textContent='测试中...';
          try{
            var r = await T.api('POST', '/admin/ai-judge/test', {});
            var d = await r.json();
            if (r.ok && d.ai) T.showToast('判官可用：' + (d.ai.available ? '是' : '否') + ' - ' + (d.ai.reason||d.ai.verdict&&(d.ai.verdict.conclusion||'')||''));
            else T.showToast(d.error||'测试完成');
          }catch(e){ T.showToast('测试失败'); }
          tst.disabled=false; tst.textContent='测试判官';
        };
        var sv = document.getElementById('aiJudgeSave');
        if (sv) sv.onclick = async function(){
          var base = document.getElementById('aiJudgeBase').value.trim();
          var model = document.getElementById('aiJudgeModel').value.trim();
          var token = document.getElementById('aiJudgeToken').value.trim();
          if (!base || !model) { T.showToast('请填写 Base URL 与模型'); return; }
          if (!token) {
            // 留空保留原 Token：从当前配置取
            try {
              var curRes = await T.api('GET', '/admin/ai-judge');
              var curData = await curRes.json();
              if (curData && curData.current && curData.current.tokenMasked && curData.current.tokenMasked !== 'env-****') {
                // 无法从脱敏恢复明文，提示需重输；但若是 env 兜底则允许留空由后端复用 env
                T.showToast('Token 为空：请输入完整 Key（脱敏不可恢复）');
                return;
              }
            } catch(_){}
            // 允许留空：后端若检测到 token 为空且已有专用配置，会保留原 token（需后端支持）
          }
          sv.disabled=true;
          try{
            var r2 = await T.api('POST', '/admin/ai-judge', { baseUrl: base, token: token, model: model });
            var d2 = await r2.json();
            if (!r2.ok) { T.showToast(d2.error||'保存失败'); } else { T.showToast('已设为专用判官：' + model); loadAiJudge(target); }
          }catch(e){ T.showToast('保存失败'); }
          sv.disabled=false;
        };
        target.querySelectorAll('[data-ai-pick]').forEach(function(btn){
          btn.addEventListener('click', async function(){
            var id = btn.getAttribute('data-ai-pick');
            var sel = target.querySelector('[data-ai-model-for="' + CSS.escape(id) + '"]');
            var model = sel ? sel.value : '';
            if (!model) { T.showToast('请选择模型'); return; }
            btn.disabled=true;
            try{
              var r3 = await T.api('POST', '/admin/ai-judge', { itemId: id, model: model });
              var d3 = await r3.json();
              if (!r3.ok) T.showToast(d3.error||'设置失败');
              else { T.showToast('已设为判官：' + model); loadAiJudge(target); }
            }catch(e){ T.showToast('设置失败'); }
            btn.disabled=false;
          });
        });
      } catch (e) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e.message) + '</p></div>';
      }
    }
    async function loadEmail(target) {
      target.innerHTML = '<div class="dash-empty"><div class="spinner" style="margin:0 auto 16px"></div><p class="dash-empty__text">加载中...</p></div>';
      try {
        var res = await T.api('GET', '/admin/email/settings');
        if (!res.ok) { var ed = await res.json(); target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('lock') + '</div><p class="dash-empty__text">' + T.esc(ed.error || '无权限') + '</p></div>'; return; }
        var cfg = await res.json();
        var logsRes = await T.api('GET', '/admin/email/logs');
        var logs = logsRes.ok ? (await logsRes.json()).logs || [] : [];
        var html = '<div class="dash__section"><div class="dash__section-head"><span class="dash__section-title">' + ic('mail') + ' 邮箱服务</span><span class="item-status ' + (cfg.enabled ? 'item-status--verified' : 'item-status--pending') + '">' + (cfg.enabled ? '已启用' : '未启用') + '</span></div>';
        html += '<div class="guide-card" style="padding:16px;display:flex;flex-direction:column;gap:12px">';
        html += '<p class="invite-tip">用于邮箱绑定验证码与密码重置链接；启用后前台“邮箱验证/忘记密码”自动可用，停用则静默关闭。</p>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
        html += '<label class="ai-judge-label">SMTP Host<input class="input" id="emHost" placeholder="如 smtp.resend.com" value="' + T.esc(cfg.host || '') + '"></label>';
        html += '<label class="ai-judge-label">端口<input class="input" id="emPort" type="number" placeholder="465" value="' + T.esc(String(cfg.port || 465)) + '"></label>';
        html += '<label class="ai-judge-label">发件人<input class="input" id="emFrom" placeholder="noreply@free-tokens.org" value="' + T.esc(cfg.fromAddr || '') + '"></label>';
        html += '<label class="ai-judge-label">账号<input class="input" id="emUser" placeholder="SMTP 用户名" value="' + T.esc(cfg.user || '') + '"></label>';
        html += '<label class="ai-judge-label">密码<input class="input" id="emPass" type="password" placeholder="' + (cfg.passSet ? '已设置（留空不改）' : 'SMTP 密码 / API Key') + '"></label>';
        html += '<label class="ai-judge-label" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="emSecure" ' + (cfg.secure !== false ? 'checked' : '') + '> SSL/TLS</label>';
        html += '<label class="ai-judge-label" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="emEnabled" ' + (cfg.enabled ? 'checked' : '') + '> 启用邮件服务</label>';
        html += '</div>';
        html += '<button class="btn btn--primary" id="emSave" style="width:100%;justify-content:center">' + ic('check') + ' 保存并启用/更新</button>';
        if (cfg.last_test_at) html += '<p style="font-size:11px;color:var(--text-muted);margin:0">上次测试：' + T.esc(cfg.last_test_at.slice(0,19).replace('T',' ')) + ' · ' + T.esc(cfg.last_test_msg || '') + '</p>';
        html += '</div></div>';
        // 测试发送
        html += '<div class="ai-judge-card" style="margin:0 0 18px"><div class="ai-judge-card__head">' + ic('send') + ' 测试发送</div>';
        html += '<div style="display:flex;gap:8px"><input class="input" id="emTestTo" placeholder="收件人邮箱" style="flex:1"><button class="btn btn--primary btn--sm" id="emTestBtn">' + ic('send') + ' 发送测试</button></div></div>';
        // 流水
        html += '<div class="ai-judge-card" style="margin:0 0 18px"><div class="ai-judge-card__head">' + ic('clock') + ' 最近发送流水（100 条）</div>';
        if (!logs.length) html += '<div class="dash-empty"><p class="dash-empty__text">暂无记录</p></div>';
        else {
          html += '<div style="overflow:auto"><table style="width:100%;min-width:560px;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--surface-3)"><th style="padding:6px 8px">时间</th><th style="padding:6px 8px">收件人</th><th style="padding:6px 8px">主题</th><th style="padding:6px 8px">结果</th></tr></thead><tbody>';
          logs.forEach(function(l){
            html += '<tr><td style="padding:6px 8px;white-space:nowrap">' + T.esc((l.created_at||'').slice(5,16).replace('T',' ')) + '</td><td style="padding:6px 8px">' + T.esc(l.email) + '</td><td style="padding:6px 8px">' + T.esc(l.subject) + '</td><td style="padding:6px 8px">' + (l.ok ? '<span style="color:var(--green)">成功</span>' : '<span style="color:var(--red)" title="' + T.esc(l.err||'') + '">失败</span>') + '</td></tr>';
          });
          html += '</tbody></table></div>';
        }
        html += '</div>';
        html += '</div>';
        target.innerHTML = html;
        document.getElementById('emSave').onclick = async function(){
          var b = {
            host: document.getElementById('emHost').value.trim(),
            port: parseInt(document.getElementById('emPort').value,10) || 465,
            secure: document.getElementById('emSecure').checked,
            user: document.getElementById('emUser').value.trim(),
            pass: document.getElementById('emPass').value,
            fromAddr: document.getElementById('emFrom').value.trim(),
            enabled: document.getElementById('emEnabled').checked
          };
          if (!b.host || !b.user || !b.fromAddr) { T.showToast('host/user/from 必填'); return; }
          var r = await T.api('PUT', '/admin/email/settings', b);
          var d = await r.json();
          if (!r.ok) { T.showToast(d.error||'保存失败'); return; }
          T.showToast('已保存'); loadEmail(target);
        };
        document.getElementById('emTestBtn').onclick = async function(){
          var to = document.getElementById('emTestTo').value.trim();
          if (!to) { T.showToast('请填写收件人'); return; }
          var btn = document.getElementById('emTestBtn'); btn.disabled=true; btn.textContent='发送中...';
          try {
            var r = await T.api('POST', '/admin/email/test', { to });
            var d = await r.json();
            T.showToast(r.ok ? '已发送，请查收' : (d.error||'失败'));
            if (r.ok) loadEmail(target);
          } catch(e){ T.showToast('发送失败'); }
          btn.disabled=false; btn.innerHTML = ic('send') + ' 发送测试';
        };
      } catch (e) {
        target.innerHTML = '<div class="dash-empty"><div class="dash-empty__icon">' + ic('alert-triangle') + '</div><p class="dash-empty__text">' + T.esc(e.message) + '</p></div>';
      }
    }

    T.updateAuthUI();
  })();
