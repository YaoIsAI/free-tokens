// 广告商自助（/cooperate 页"我的广告"区）：申请 / 改料 / 下线可自助完成；
// 上线（active）需版主在后台确认收款后开通，费用走线下渠道。
(function () {
  'use strict';
  var T = window.TokenApp;
  var zone = document.getElementById('sponsorZone');
  if (!T || !zone || !T.api) return;

  function esc(s) { return T.esc(String(s === null || s === undefined ? '' : s)); }
  function icon(name) {
    return '<svg class="ic" aria-hidden="true" focusable="false"><use href="#lucide-' + name + '"/></svg>';
  }

  var STATUS_LABEL = {
    pending: '待认证', qualified: '已认证待付款', active: '投放中',
    rejected: '已拒绝', offline: '已下线', expired: '已到期'
  };
  function nextStep(s) {
    if (s.status === 'pending') return '站长正在审核，通过后会主动联系你。';
    if (s.status === 'qualified') return '已认证通过！请加微信备注「广告合作+ ' + (s.name || '') + '」完成付款，付款后管理员会尽快安排上线。';
    if (s.status === 'active') return '已上线投放中' + (s.endsAt ? '，将于 ' + String(s.endsAt).slice(0, 10) + ' 到期' : '') + '。修改品牌/链接/口号/logo 会重新进入审核流程。';
    if (s.status === 'rejected') return '审核未通过：' + (s.rejectReason || '暂无具体原因') + '。修改后可重新提交，无需再次申请。';
    if (s.status === 'offline') return '已下线。如需恢复投放，请联系管理员重新上线。';
    if (s.status === 'expired') return '已到期。如需续期，请联系管理员协商续费。';
    return '';
  }

  function render(list) {
    var html = '<div class="dash__section"><div class="dash__section-head">' +
      '<span class="dash__section-title">' + icon('gem') + ' 我的广告</span>' +
      '<button class="btn btn--sm btn--primary" id="sponsorApplyBtn">' + icon('plus') + ' 申请成为广告商</button></div>';
    if (!list.length) {
      html += '<div class="dash-empty"><p class="dash-empty__text">还没有提交过广告，点右上「申请成为广告商」即可开始。认证通过后联系管理员完成付款，即可正式上线。</p></div>';
    } else {
      html += '<table class="dash-table"><thead><tr><th>品牌</th><th>状态</th><th>数据</th><th>到期</th><th>操作</th></tr></thead><tbody>';
      for (var i = 0; i < list.length; i++) {
        (function (s) {
          html += '<tr><td><b>' + esc(s.name) + '</b><div class="item-provider">' + esc(s.slogan || '') + '</div>' +
            '<div class="item-provider">' + esc(nextStep(s)) + '</div></td>';
          html += '<td><span class="item-status ' + (s.status === 'active' ? 'item-status--verified' : 'item-status--pending') + '">' +
            esc(STATUS_LABEL[s.status] || s.status) + (s.paid ? '' : ' · 未付款') + '</span></td>';
          html += '<td class="item-date">' + (s.views || 0) + ' 展 / ' + (s.clicks || 0) + ' 点</td>';
          html += '<td class="item-date">' + esc((s.endsAt || '').slice(0, 10) || '-') + '</td>';
          html += '<td><div class="item-actions">';
          html += '<button class="btn-icon" title="编辑物料" data-sp-edit="' + esc(s.id) + '">' + icon('pencil') + '</button>';
          if (s.status === 'active' || s.status === 'qualified') {
            html += '<button class="btn-icon" title="下线" data-sp-offline="' + esc(s.id) + '">' + icon('pause') + '</button>';
          }
          html += '</div></td></tr>';
        })(list[i]);
      }
      html += '</tbody></table>';
    }
    html += '</div>';
    zone.innerHTML = html;
    var applyBtn = document.getElementById('sponsorApplyBtn');
    if (applyBtn) applyBtn.addEventListener('click', function () { openForm(null); });
    zone.querySelectorAll('[data-sp-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-sp-edit');
        var found = null;
        for (var i = 0; i < list.length; i++) if (list[i].id === id) found = list[i];
        if (found) openForm(found);
      });
    });
    zone.querySelectorAll('[data-sp-offline]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('下线这条广告？重新上线需联系管理员。')) return;
        var r = await T.api('PUT', '/my/sponsors/' + b.getAttribute('data-sp-offline') + '/offline', {});
        var d = await r.json().catch(function () { return {}; });
        if (!r.ok) { T.showToast(d.error || '操作失败'); return; }
        T.showToast('已下线');
        load();
      });
    });
  }

  async function load() {
    try {
      var res = await T.api('GET', '/my/sponsors');
      if (res.status === 401) {
        zone.innerHTML = '<div class="dash__section"><div class="dash-empty"><p class="dash-empty__text">登录后即可申请广告位，也可在这里管理已提交的内容。</p>' +
          '<button class="btn btn--primary" id="sponsorLoginBtn">登录</button></div></div>';
        document.getElementById('sponsorLoginBtn').addEventListener('click', function () { T.openAuth('login'); });
        return;
      }
      if (!res.ok) {
        var ed = await res.json().catch(function(){ return {}; });
        throw new Error(ed.error || ('HTTP ' + res.status));
      }
      var d = await res.json();
      render((d && d.sponsors) || []);
    } catch (e) {
      console.error('[sponsor] load failed', e && e.message);
      zone.innerHTML = '<div class="dash-empty"><p class="dash-empty__text">加载失败，请刷新重试</p><p class="fb-intro" style="color:var(--text-muted);font-size:12px">' + esc(String(e && e.message || e).slice(0,120)) + '</p></div>';
    }
  }

  function openForm(s) {
    var ov = document.createElement('div');
    ov.className = 'modal modal--open';
    ov.innerHTML = '<div class="modal__backdrop" data-close></div><div class="modal__panel" style="max-width:560px">' +
      '<button class="modal__x" data-close aria-label="关闭">' + icon('x') + '</button>' +
      '<h2 class="modal__title">' + (s ? '编辑广告物料' : '申请成为广告商') + '</h2>' +
      '<p class="fb-intro">提交后站长会进行审核，认证通过后联系你完成付款，确认收款后即可上线。' +
      (s && s.status === 'active' ? '<b>提示：已上线广告修改品牌/链接/口号/logo 会重新进入审核，上线前请确认内容无误。</b>' : '') + '</p>' +
      '<div class="form-group"><label>品牌名 *（≤30字）</label><input class="input" id="spName" maxlength="30" value="' + esc(s ? s.name : '') + '"></div>' +
      '<div class="form-group"><label>官网链接 *（http(s)://）</label><input class="input" id="spUrl" maxlength="200" value="' + esc(s ? s.url : '') + '"></div>' +
      '<div class="form-group"><label>一句话（≤60字，展示在首页细条）</label><input class="input" id="spSlogan" maxlength="60" value="' + esc(s ? s.slogan : '') + '"></div>' +
      '<div class="form-group"><label>Logo（选填，站内上传或外链）</label><div class="uploader-mount" id="spLogoMount"></div>' +
      '<input type="hidden" id="spLogoVal" value="' + esc(s ? s.logo : '') + '"></div>' +
      '<div class="form-actions"><button class="btn btn--primary" id="spSubmit">' + icon('send') + (s ? ' 保存' : ' 提交申请') + '</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) ov.remove(); });
    var logoVal = ov.querySelector('#spLogoVal');
    var mount = ov.querySelector('#spLogoMount');
    if (mount && window.Uploader && window.Uploader.create) {
      try {
        var up = window.Uploader.create({ mount: mount, token: function () { return T.getToken ? T.getToken() : ''; }, toast: function (m) { T.showToast(m); }, hidden: logoVal, allowUrl: true });
        if (up && s && s.logo) up.setValue(s.logo);
      } catch (_) {}
    }
    if (s && s.logo && logoVal && !logoVal.value) logoVal.value = s.logo;
    ov.querySelector('#spSubmit').addEventListener('click', async function () {
      var body = {
        name: ov.querySelector('#spName').value.trim(),
        url: ov.querySelector('#spUrl').value.trim(),
        slogan: ov.querySelector('#spSlogan').value.trim(),
        logo: logoVal ? logoVal.value.trim() : ''
      };
      if (!body.name) { T.showToast('请填写品牌名'); return; }
      if (!body.url) { T.showToast('请填写官网链接'); return; }
      try {
        var res = s
          ? await T.api('PUT', '/my/sponsors/' + s.id, body)
          : await T.api('POST', '/sponsors', body);
        var d = await res.json().catch(function () { return {}; });
        if (!res.ok) { T.showToast(d.error || '提交失败'); return; }
        T.showToast(s ? '已保存' : '申请已提交，待站长审核');
        ov.remove();
        load();
      } catch (e) { T.showToast('提交失败'); }
    });
  }

  if (T.getToken && T.getToken()) load();
  else {
    zone.innerHTML = '<div class="dash__section"><div class="dash-empty"><p class="dash-empty__text">登录后即可申请广告位，也可在这里管理已提交的内容。</p>' +
      '<button class="btn btn--primary" id="sponsorLoginBtn">登录</button></div></div>';
    document.getElementById('sponsorLoginBtn').addEventListener('click', function () { T.openAuth('login'); });
  }
  window.addEventListener('auth-changed', load);
})();
