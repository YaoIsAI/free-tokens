// 教程页前端逻辑：/tutorials 列表 + /tutorials/:id 详情 + 发布弹窗（复用 window.TokenApp）
// CSP script-src-attr 'none'：一律 addEventListener，不用内联 onclick
(function () {
  var T = window.TokenApp;
  if (!T) return;
  var grid = document.getElementById('tutGrid');
  var detail = document.getElementById('tutDetail');
  var listPage = !!grid;
  var detailPage = !!detail;
  if (!listPage && !detailPage) return;

  var LIMIT = 12;
  var state = { category: '', offset: 0, total: Infinity };
  var cats = []; // 缓存分类，供发布弹窗 select

  function esc(s) { return T.esc(String(s === null || s === undefined ? '' : s)); }

  function json(res) { return res.json().catch(function () { return null; }); }

  // 本站域名的绝对 uploads 图（如 https://freeapis.top/uploads/x.png）归一化为相对路径，
  // 跟随当前访问域名、同源加载（跨域绝对 URL 会触发 CORP: same-origin 拦截导致封面图裂）。
  function uploadSrc(u) { return String(u || '').replace(/^https?:\/\/(?:freeapis\.top|free-tokens\.org|localhost|127\.0\.0\.1)(?::\d+)?(?=\/uploads\/)/i, ''); }

  // ===== 封面图：有 cover 显示图，无 cover 用分类渐变 + 图标占位 =====
  // 渐变用 CSS 类（.tut-card__cover--g0..g5），避免内联样式；图标直接引用内联的 Lucide sprite
  function iconHtml(name) { return '<svg class="ic" aria-hidden="true"><use href="#lucide-' + name + '"/></svg>'; }
  function coverFor(category) {
    var c = String(category || '').toLowerCase();
    var icon = 'sparkles';
    if (c.indexOf('教程') !== -1 || c.indexOf('科普') !== -1) icon = 'book-open';
    else if (c.indexOf('openai') !== -1 || c.indexOf('gpt') !== -1) icon = 'sparkles';
    else if (c.indexOf('anthropic') !== -1 || c.indexOf('claude') !== -1) icon = 'bot';
    else if (c.indexOf('api') !== -1 || c.indexOf('接入') !== -1) icon = 'zap';
    else if (c.indexOf('经验') !== -1 || c.indexOf('分享') !== -1) icon = 'message-square';
    else if (c.indexOf('deepseek') !== -1 || c.indexOf('gemini') !== -1 || c.indexOf('moonshot') !== -1 || c.indexOf('通义') !== -1 || c.indexOf('kimi') !== -1) icon = 'cpu';
    var s = 0;
    for (var i = 0; i < c.length; i++) s = (s * 31 + c.charCodeAt(i)) >>> 0;
    return { icon: icon, g: s % 6 };
  }
  function coverHtml(t) {
    var cv = coverFor(t.category);
    // 封面区：背景层（真实图 或 分类渐变）+ 左上分类徽章 + 底部浮起标题
    var inner = '<div class="tut-card__cover-icon">' + iconHtml(cv.icon) + '</div>';
    if (t.cover) inner = '<img class="tut-card__cover-img" src="' + esc(uploadSrc(t.cover)) + '" alt="' + esc(t.title) + '" loading="lazy">';
    return '<div class="tut-card__cover' + (t.cover ? '' : ' tut-card__cover--ph') + ' tut-card__cover--g' + cv.g + '">' +
      inner +
      '<span class="tut-card__badge">' + esc(t.category) + '</span>' +
      '<h3 class="tut-card__title">' + esc(t.title) + '</h3>' +
    '</div>';
  }
  // 封面图加载失败 → 移除 img，露出分类渐变占位背景（资源 error 不冒泡，需捕获阶段监听）
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.classList.contains('tut-card__cover-img')) t.remove();
  }, true);

  // ===== 列表页 =====
  function loadCategories() {
    T.api('GET', '/tutorials/categories').then(json).then(function (arr) {
      var box = document.getElementById('tutCats');
      if (!box) return;
      cats = (arr || []).map(function (c) { return c.name; });
      var html = '<button class="tut-chip is-active" data-cat="">全部</button>';
      (arr || []).forEach(function (c) {
        html += '<button class="tut-chip" data-cat="' + esc(c.name) + '">' + esc(c.name) +
          (c.count ? ' <span class="tut-chip__count">' + c.count + '</span>' : '') + '</button>';
      });
      box.innerHTML = html;
    }).catch(function () {});
  }

  function card(t) {
    var tags = (t.tags && t.tags.length) ? '<div class="tut-card__tags">' + t.tags.map(function (x) { return '#' + esc(x); }).join(' ') + '</div>' : '';
    return '<a class="tut-card" href="/tutorials/' + esc(t.id) + '">' +
      coverHtml(t) +
      '<div class="tut-card__body">' +
        (t.summary ? '<p class="tut-card__summary">' + esc(t.summary) + '</p>' : '') +
        tags +
        '<div class="tut-card__foot">' +
          '<span class="tut-card__author" title="' + esc(t.authorName || '匿名') + '">' + iconHtml('user') + '<span>' + esc(t.authorName || '匿名') + '</span></span>' +
          '<span class="tut-card__date">' + esc(String(t.createdAt || '').slice(0, 10)) + '</span>' +
        '</div>' +
      '</div></a>';
  }

  function loadList(reset) {
    if (reset) { state.offset = 0; grid.innerHTML = '<div class="empty"><div class="spinner"></div></div>'; }
    var q = 'limit=' + LIMIT + '&offset=' + state.offset;
    if (state.category) q += '&category=' + encodeURIComponent(state.category);
    T.api('GET', '/tutorials?' + q).then(function (res) {
      state.total = parseInt(res.headers.get('X-Total-Count') || '0', 10);
      return res.json();
    }).then(function (items) {
      if (reset) grid.innerHTML = '';
      if (!items || !items.length) {
        if (state.offset === 0) grid.innerHTML = '<div class="empty"><p>暂无教程，快来发布第一篇 AI 教程 🎓</p></div>';
      } else {
        items.forEach(function (t) { grid.insertAdjacentHTML('beforeend', card(t)); });
      }
      state.offset += (items || []).length;
      var wrap = document.getElementById('tutMoreWrap');
      if (wrap) wrap.style.display = state.offset < state.total ? '' : 'none';
    }).catch(function () {});
  }

  // ===== 详情页 =====
  function loadDetail() {
    // 已审核教程由服务端 SSR 渲染正文，跳过重复 fetch
    if (detail && detail.getAttribute('data-ssr') === '1') return;
    var id = location.pathname.split('/').pop();
    T.api('GET', '/tutorials/' + encodeURIComponent(id)).then(function (res) {
      if (res.status === 404) {
        detail.innerHTML = '<div class="empty"><p>教程不存在或未公开</p></div>';
        return null;
      }
      return res.json();
    }).then(function (t) {
      if (!t || !detail) return;
      document.title = t.title + ' — free-tokens';
      var tags = (t.tags || []).map(function (x) { return '<span class="tag">#' + esc(x) + '</span>'; }).join('');
      var badges = '<span class="tut-badge">' + esc(t.category) + '</span>';
      if (!t.verified) badges += '<span class="tut-badge tut-badge--pending">待审核</span>';
      detail.innerHTML =
        (t.cover ? '<img class="tut-detail__cover" src="' + esc(uploadSrc(t.cover)) + '" alt="' + esc(t.title) + '">' : '') +
        '<h1 class="tut-detail__title">' + esc(t.title) + '</h1>' +
        '<div class="tut-detail__meta">' +
          '<span>' + esc(t.authorName || '匿名') + '</span>' +
          '<span class="dot">·</span>' +
          '<span>' + esc(String(t.createdAt || '').slice(0, 10)) + '</span>' +
          badges +
          (tags ? '<span class="tut-detail__tags">' + tags + '</span>' : '') +
        '</div>' +
        '<div class="tut-detail__content">' + window.TutorialMD.render(t.content) + '</div>';
    }).catch(function () {});
  }

  // ===== 发布弹窗 =====
  function openPublish() {
    if (!T.getUser()) { T.openAuth('login'); return; }
    var m = document.getElementById('tutPublishModal');
    var view = document.getElementById('tutPublishView');
    if (!m || !view) return;
    var fillCats = function () {
      var opts = (cats.length ? cats : ['教程', 'API 接入', 'OpenAI', 'Anthropic', '经验分享', '其他'])
        .map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
      view.innerHTML =
        '<h2 class="modal__title" style="padding-right:36px">发布教程</h2>' +
        '<form id="tutForm">' +
          '<div class="form-group"><label>标题 *</label><input class="input" name="title" maxlength="120" placeholder="如：OpenAI API 从零开始接入"></div>' +
          '<div class="form-group"><label>摘要</label><textarea class="input" name="summary" maxlength="300" rows="2" placeholder="一句话介绍（可选，默认取正文前 120 字）"></textarea></div>' +
          '<div class="form-row"><div class="form-group"><label>分类 *</label><select class="input" name="category">' + opts + '</select></div>' +
          '<div class="form-group"><label>标签</label><input class="input" name="tags" placeholder="逗号分隔，如：OpenAI,教程"></div></div>' +
          '<div class="form-group"><label>封面图（可选）</label>' +
            '<div class="uploader-mount" id="tutCoverMount"></div>' +
            '<input type="hidden" name="cover" id="tutCoverVal" value="">' +
            '<p class="tut-publish__hint">PNG/JPG/WebP/GIF ≤3MB；留空自动用分类渐变封面</p>' +
          '</div>' +
          '<div class="form-group"><label>正文（Markdown）*</label><textarea class="input tut-publish__content" name="content" rows="12" placeholder="支持 # 标题、代码块 ```、表格、列表、链接等 Markdown 语法"></textarea></div>' +
          '<p class="tut-publish__hint">支持 Markdown：标题、代码块、表格、列表、链接。提交后进入待审核，版主审核通过后公开。</p>' +
          '<div class="form-actions"><button class="btn btn--primary" type="submit">' + (T.icon ? T.icon('send') : '') + ' 提交发布</button><button class="btn btn--ghost" type="button" id="tutCancelBtn">取消</button></div>' +
        '</form>';
      var form = document.getElementById('tutForm');
      // 封面上传 / 外链 / 移除：复用可上传组件（点击选择 / 拖拽 / Ctrl+V 粘贴三合一，走 /api/upload）
      var coverVal = document.getElementById('tutCoverVal');
      var coverMount = document.getElementById('tutCoverMount');
      if (coverMount && coverVal && typeof window.Uploader !== 'undefined') {
        window.Uploader.create({
          mount: coverMount,
          token: function () { return T.getToken ? T.getToken() : ''; },
          toast: T.showToast,
          allowUrl: true,
          hidden: coverVal
        });
      }
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        var body = {
          title: String(fd.get('title') || '').trim(),
          summary: String(fd.get('summary') || '').trim(),
          category: String(fd.get('category') || '教程'),
          tags: String(fd.get('tags') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
          cover: String(fd.get('cover') || '').trim(),
          content: String(fd.get('content') || '')
        };
        var btn = form.querySelector('button[type=submit]');
        btn.disabled = true; btn.textContent = '提交中...';
        T.api('POST', '/tutorials', body).then(function (res) {
          return res.json().then(function (d) { return { ok: res.ok, d: d }; });
        }).then(function (r) {
          if (!r.ok) { T.showToast(r.d && r.d.error || '发布失败'); btn.disabled = false; btn.textContent = '提交发布'; return; }
          T.showToast('已提交，等待版主审核');
          closePublish();
          if (listPage) loadList(true);
        }).catch(function () { T.showToast('发布失败'); btn.disabled = false; btn.textContent = '提交发布'; });
      });
      var cancel = document.getElementById('tutCancelBtn');
      if (cancel) cancel.addEventListener('click', closePublish);
    };
    if (cats.length) { fillCats(); m.classList.add('modal--open'); }
    else {
      T.api('GET', '/tutorials/categories').then(json).then(function (arr) {
        cats = (arr || []).map(function (c) { return c.name; });
        fillCats();
        m.classList.add('modal--open');
      }).catch(function () { fillCats(); m.classList.add('modal--open'); });
    }
  }

  function closePublish() {
    var m = document.getElementById('tutPublishModal');
    if (m) m.classList.remove('modal--open');
  }

  // ===== 事件绑定 =====
  document.addEventListener('click', function (e) {
    if (e.target.closest('#tutPublishBtn')) { openPublish(); return; }
    if (e.target.closest('#tutMore')) { loadList(false); return; }
    if (e.target.closest('[data-action="close-tut-publish"]')) { closePublish(); return; }
  });

  var chipsBox = document.getElementById('tutCats');
  if (chipsBox) chipsBox.addEventListener('click', function (e) {
    var chip = e.target.closest('.tut-chip');
    if (!chip) return;
    chipsBox.querySelectorAll('.tut-chip').forEach(function (c) { c.classList.remove('is-active'); });
    chip.classList.add('is-active');
    state.category = chip.getAttribute('data-cat') || '';
    loadList(true);
  });

  // 启动
  if (listPage) { loadCategories(); loadList(true); }
  if (detailPage) loadDetail();
})();
