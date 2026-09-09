// 中转站掺水检测 · 可复用组件（window.VerifyRelay，仿 upload.js 的 Uploader.create 模式）
// 用法：VerifyRelay.create(mountEl, { initialUrl, initialToken })
//   mountEl        — 挂载容器（组件会渲染自己的交互区：Base URL + API Key + 检测按钮 + 结果 + 模型列表 + 详情）
//   initialUrl     — 预填 Base URL（可留空手填）
//   initialToken   — 预填 API Key（可留空手填）
// 流程：/api/verify 自动识别兼容模式+模型 → 每模型 /api/verify/model 掺水检测（评分+逐项 checks）
// 依赖：window.TokenApp（app.js 注入，api/esc/getToken/openAuth/showToast）
// 说明：本组件供 /verify 独立工具页使用（完整手填 + 逐个检测）。Token 详情弹窗的逐模型
//       掺水检测不走本组件，而是复用现有模型列表行（app.js 的 verifyModelRow，调 /api/verify/model）。
(function () {
  'use strict';
  function ic(name) {
    return '<svg class="ic" aria-hidden="true" focusable="false"><use href="#lucide-' + name + '"/></svg>';
  }
  function esc(s) { var TA = window.TokenApp; return TA ? TA.esc(s) : String(s == null ? '' : s); }

  // 单项检查行：✓ 通过 / ⚠ 警告 / ✗ 失败
  function checkRow(c) {
    var dot = c.status === 'pass' ? '<span class="verify-check__dot verify-check__dot--pass">' + ic('check') + '</span>'
      : c.status === 'warn' ? '<span class="verify-check__dot verify-check__dot--warn">' + ic('alert-triangle') + '</span>'
      : '<span class="verify-check__dot verify-check__dot--fail">' + ic('x') + '</span>';
    return '<div class="verify-check">' + dot +
      '<span class="verify-check__label">' + esc(c.label) + '</span>' +
      '<span class="verify-check__detail" title="' + esc(c.detail || '') + '">' + esc(c.detail || '') + '</span></div>';
  }
  function endpointChecksHtml(checks) {
    return '<div class="verify-checks">' + (checks || []).map(checkRow).join('') + '</div>';
  }
  function badgesHtml(compat, type) {
    var badges = (compat || []).map(function (c) {
      return c === 'openai' ? '<span class="badge badge--openai">OpenAI 兼容</span>'
        : c === 'anthropic' ? '<span class="badge badge--anthropic">Anthropic 兼容</span>'
        : '<span class="badge badge--other">' + esc(c) + '</span>';
    }).join('');
    return '<div class="verify-okhead">' + badges + (type ? '<span class="badge badge--other">' + esc(type) + '</span>' : '') + '</div>';
  }
  function verdictCls(score) { return score >= 80 ? 'ok' : (score >= 60 ? 'warn' : 'bad'); }
  function verdictText(score) { return score >= 80 ? '基本可信' : (score >= 60 ? '存在疑点' : '疑似掺水'); }
  function numCls(score) { return score >= 80 ? 'verify-score__num--pass' : (score >= 60 ? 'verify-score__num--warn' : 'verify-score__num--fail'); }
  // AI 辅助判定段落（可折叠）：available=true 展示结论与升级维度；false 标注降级原因
  function aiSectionHtml(ai) {
    if (!ai) return '';
    var badge = ai.available
      ? '<span class="verify-ai__badge verify-ai__badge--on">' + ic('sparkles') + ' AI 已参与判定</span>'
      : '<span class="verify-ai__badge verify-ai__badge--off">' + ic('info') + ' AI 暂不可用，已用规则判定</span>';
    var body = ai.available
      ? (esc(ai.conclusion || '未生成结论') + (ai.upgraded && ai.upgraded.length ? ' <span class="verify-ai__up">（AI 修正：' + esc(ai.upgraded.join('、')) + '）</span>' : ''))
      : esc('本报告由内置规则判定，AI 辅助暂时不可用。');
    return '<div class="verify-ai">' +
      '<button type="button" class="verify-ai__head" aria-expanded="false">' + ic('sparkles') + ' AI 辅助判定' + ic('chevron-down') + '</button>' +
      '<div class="verify-ai__body is-collapsed">' + badge + '<p class="verify-ai__text">' + body + '</p></div>' +
    '</div>';
  }
  // 失败报告卡：错误原因 + 已跑出的逐项 checks（404/连接失败等也有 reachable 一项，不让失败变黑盒）
  function modelErrorHtml(d) {
    var err = esc((d && d.error) || '检测失败');
    var checks = (d && d.checks && d.checks.length) ? endpointChecksHtml(d.checks) : '';
    return '<div class="verify-detail__err">' + err + '</div>' + checks;
  }
  // 报告内「AI 辅助判定」段的折叠头切换（模块级，供 /verify 页与 Token 详情弹窗共用；
  // 详情弹窗的报告卡是 app.js 直接 innerHTML 渲染的，不走 create() 内流程，必须手动调它绑定）
  function bindAiToggle(reportEl) {
    if (!reportEl) return;
    var head = reportEl.querySelector('.verify-ai__head');
    if (head && !head.getAttribute('data-bound')) {
      head.setAttribute('data-bound', '1');
      head.addEventListener('click', function () {
        var body = reportEl.querySelector('.verify-ai__body');
        var hidden = body && body.classList.toggle('is-collapsed');
        head.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      });
    }
  }
  function modelDetailHtml(d) {
    if (!d || !d.ok) return modelErrorHtml(d);
    return '<div class="verify-score">' +
      '<span class="verify-score__num ' + numCls(d.score) + '">' + d.score + '</span>' +
      '<span class="verify-score__verdict verify-score__verdict--' + verdictCls(d.score) + '">' + esc(d.verdict || verdictText(d.score)) + '</span>' +
      '<span class="verify-score__meta">' + esc(d.model) + ' · ' + (d.latencyMs || 0) + 'ms</span>' +
    '</div>' + endpointChecksHtml(d.checks) + aiSectionHtml(d.ai);
  }

  function create(mount, opts) {
    if (!mount || !window.TokenApp) return null;
    opts = opts || {};
    var TA = window.TokenApp;

    // 渲染组件 DOM（/verify 页表单模式）
    mount.innerHTML =
      '<form class="verify-form" novalidate>' +
        '<div class="verify-field">' +
          '<label>Base URL</label>' +
          '<input class="input verify-url" type="url" placeholder="https://api.example.com/v1" autocomplete="off" required aria-label="中转站 Base URL">' +
        '</div>' +
        '<div class="verify-field">' +
          '<label>API Key</label>' +
          '<div class="verify-key">' +
            '<input class="input verify-token" type="password" placeholder="sk-…" autocomplete="off" spellcheck="false" required aria-label="API Key">' +
            '<button type="button" class="btn btn--ghost btn--sm verify-key__toggle" aria-label="显示/隐藏 API Key">' + ic('eye') + '</button>' +
          '</div>' +
        '</div>' +
        '<button type="submit" class="btn btn--primary btn--lg verify-submit">' + ic('shield-check') + ' 检测端点</button>' +
      '</form>' +
      '<div class="test-result verify-result" aria-live="polite"></div>' +
      '<div class="modal__tags model-list verify-model-list"></div>';

    var form = mount.querySelector('.verify-form');
    var urlEl = mount.querySelector('.verify-url');
    var tokenEl = mount.querySelector('.verify-token');
    var toggleBtn = mount.querySelector('.verify-key__toggle');
    var submitBtn = mount.querySelector('.verify-submit');
    var resultEl = mount.querySelector('.verify-result');
    var modelListEl = mount.querySelector('.verify-model-list');
    if (!form || !urlEl || !tokenEl || !resultEl || !modelListEl) return null;

    if (opts.initialUrl) urlEl.value = opts.initialUrl;
    if (opts.initialToken) tokenEl.value = opts.initialToken;

    function setStatus(cls, html) { resultEl.innerHTML = html; resultEl.className = 'test-result ' + cls; }

    if (toggleBtn) toggleBtn.addEventListener('click', function () {
      var show = tokenEl.type === 'password';
      tokenEl.type = show ? 'text' : 'password';
      toggleBtn.setAttribute('aria-label', show ? '隐藏 API Key' : '显示 API Key');
    });

    function renderEndpoint(d) {
      setStatus('ok', badgesHtml(d.compat, d.type) + endpointChecksHtml(d.checks));
      var models = d.models || [];
      if (models.length) {
        modelListEl.innerHTML = '<span class="model-list-label">已识别 ' + models.length + ' 个模型 · 逐个点击做掺水检测</span>' +
          '<div class="model-rows">' + models.map(function (m) {
            var mn = m && (m.id || m.name) ? (m.id || m.name) : String(m);
            return '<div class="model-row">' +
              '<code class="model-row__name" title="' + esc(mn) + '">' + esc(mn) + '</code>' +
              '<button type="button" class="btn btn--sm btn--ghost model-row__test" data-verify-model="' + esc(mn) + '">' + ic('shield-check') + ' 掺水检测</button>' +
              '<span class="model-row__result" aria-live="polite"></span>' +
              '<div class="model-row__report is-collapsed" data-model-report="' + esc(mn) + '"></div></div>';
          }).join('') + '</div>';
      } else {
        modelListEl.innerHTML = '<span class="model-list-label">该端点未列出模型列表（如 Anthropic 类）——直接输入模型名检测</span>' +
          '<div class="verify-manual"><input class="input verify-manual-input" placeholder="输入模型名，如 claude-sonnet-4-20250514">' +
          '<button type="button" class="btn btn--sm verify-manual-btn">' + ic('shield-check') + ' 检测</button></div>';
        var manualBtn = mount.querySelector('.verify-manual-btn');
        var manualInput = mount.querySelector('.verify-manual-input');
        if (manualBtn && manualInput) manualBtn.addEventListener('click', function () {
          if (manualInput.value.trim()) {
            var row = manualBtn.closest('.model-row');
            var rep = row ? row.querySelector('.model-row__report') : null;
            runModelCheck(manualInput.value.trim(), manualBtn, manualBtn.parentElement.querySelector('.model-row__result'), rep);
          }
        });
      }
    }

    function renderModelDetail(d, reportEl) {
      if (!reportEl) return;
      // 失败时也渲染 checks（含具体原因，如「模型 xxx 无可用渠道/超时」），不让失败变成黑盒
      if (!d.ok) {
        if (d.checks && d.checks.length) {
          reportEl.innerHTML = '<div class="verify-detail__err">' + esc(d.error || '检测失败') + '</div>' + endpointChecksHtml(d.checks);
        } else {
          reportEl.innerHTML = '<div class="verify-detail__err">' + esc(d.error || '检测失败') + '</div>';
        }
        reportEl.classList.remove('is-collapsed');
        reportEl.setAttribute('data-done', '1');
        var rowF = reportEl.closest('.model-row');
        if (rowF) rowF.classList.add('is-report-open');
        return;
      }
      reportEl.innerHTML = modelDetailHtml(d);
      reportEl.setAttribute('data-done', '1');
      reportEl.classList.remove('is-collapsed');
      var row = reportEl.closest('.model-row');
      if (row) row.classList.add('is-report-open');
      bindAiToggle(reportEl);
    }

    function runModelCheck(model, btn, resultSpan, reportEl) {
      if (!TA.getToken()) { TA.openAuth('login'); TA.showToast('请先登录后使用'); return; }
      if (reportEl && reportEl.getAttribute('data-done') === '1') {
        var wasHidden = reportEl.classList.toggle('is-collapsed');
        var row0 = reportEl.closest('.model-row');
        if (row0) row0.classList.toggle('is-report-open', !wasHidden);
        return;
      }
      if (btn) btn.disabled = true;
      if (resultSpan) resultSpan.innerHTML = '<span class="testing"><span class="spinner spinner--sm"></span> 检测中…</span>';
      if (reportEl) { reportEl.innerHTML = '<div class="verify-stream"><div class="verify-stream__item"><span class="spinner spinner--sm"></span><span class="verify-stream__label">正在连接模型…</span><span class="verify-stream__status verify-stream__status--running">检测中</span></div></div>'; reportEl.classList.remove('is-collapsed'); var r0=reportEl.closest('.model-row'); if(r0) r0.classList.add('is-report-open'); }
      // 优先流式：逐条推送 checks，秒级有反馈
      (async function tryStream(){
        try {
          var streamRes = await fetch('/api/verify/model/stream', {
            method: 'POST',
            headers: (function(){ var h={'Content-Type':'application/json'}; var t=TA.getToken(); if(t) h['Authorization']='Bearer '+t; return h; })(),
            body: JSON.stringify({ baseUrl: urlEl.value.trim(), token: tokenEl.value.trim(), model: model })
          });
          if (streamRes.status === 401) { TA.openAuth('login'); TA.showToast('登录已过期，请重新登录'); if (resultSpan) resultSpan.innerHTML = '<span class="bad">✗ 未登录 (401)</span>'; if (btn) btn.disabled = false; if (reportEl) reportEl.innerHTML=''; return true; }
          if (streamRes.ok && streamRes.body && window.ReadableStream) {
            var reader = streamRes.body.getReader();
            var decoder = new TextDecoder();
            var buf = '';
            var streamChecks = [];
            var finalResult = null;
            var streamEl = reportEl ? reportEl.querySelector('.verify-stream') : null;
            if (!streamEl && reportEl) {
              reportEl.innerHTML = '<div class="verify-stream"></div>';
              streamEl = reportEl.querySelector('.verify-stream');
            }
            function addStreamCheck(c){
              streamChecks.push(c);
              if (!streamEl) return;
              var st = c.status === 'pass' ? 'pass' : (c.status === 'fail' ? 'fail' : 'warn');
              var icon = st === 'pass' ? '✓' : (st === 'fail' ? '✗' : '⚠');
              var html = '<div class="verify-stream__item"><span class="verify-stream__status verify-stream__status--' + st + '">' + icon + ' ' + esc(c.label) + '</span><span class="verify-stream__label">' + esc(c.detail||'') + '</span></div>';
              var d2=document.createElement('div'); d2.innerHTML=html; streamEl.appendChild(d2.firstChild);
              if (resultSpan) resultSpan.innerHTML = '<span class="testing"><span class="spinner spinner--sm"></span> 检测中 ' + streamChecks.length + '/~7…</span>';
            }
            while (true) {
              var rr = await reader.read();
              if (rr.done) break;
              buf += decoder.decode(rr.value, { stream: true });
              var parts = buf.split('\n\n'); buf = parts.pop();
              for (var pi=0; pi<parts.length; pi++) {
                var block=parts[pi]; if(!block.trim()||block.indexOf('data:')===-1) continue;
                var lines=block.split('\n'), ev='message', dataStr='';
                for(var li=0;li<lines.length;li++){ var l=lines[li]; if(l.indexOf('event:')===0) ev=l.slice(6).trim(); else if(l.indexOf('data:')===0) dataStr=l.slice(5).trim(); }
                if(!dataStr) continue;
                try{
                  var data=JSON.parse(dataStr);
                  if(ev==='check'&&data&&data.key) addStreamCheck(data);
                  else if(ev==='done'&&data){ finalResult=data; try{await reader.cancel();}catch(_){} break; }
                  else if(ev==='error'){ finalResult=data; try{await reader.cancel();}catch(_){} break; }
                }catch(_){}
              }
              if(finalResult) break;
            }
            if(finalResult){
              renderModelDetail(finalResult, reportEl);
              if(resultSpan){
                if(finalResult.ok){ var c2=verdictCls(finalResult.score); resultSpan.innerHTML='<span class="'+c2+'">'+(finalResult.score>=80?'✓ 基本可信':(finalResult.score>=60?'⚠ 存在疑点':'✗ 疑似掺水'))+' ('+finalResult.score+')</span>'; }
                else if(finalResult.kind==='ratelimit') resultSpan.innerHTML='<span class="warn">⚠ 限流中 (429)</span>';
                else if(finalResult.kind==='vision_skip') resultSpan.innerHTML='<span class="warn">Vision 已跳过</span>';
                else { var eMsg=String((finalResult&&finalResult.error)||'检测失败'); resultSpan.innerHTML='<span class="bad" title="'+esc(eMsg)+'">✗ '+esc(eMsg.slice(0,40))+'</span>'; }
              }
              if(btn) btn.disabled=false;
              return true; // 流式成功，已处理
            }
          }
        } catch(e){ /* 流式失败，回退轮询 */ }
        return false;
      })().then(function(streamOk){
        if(streamOk) return;
        // 回退：传统轮询
        var attempt = 0;
        function poll() {
          if (attempt > 45) {
            if (resultSpan) resultSpan.innerHTML = '<span class="bad">✗ 检测超时</span>';
            if (btn) btn.disabled = false;
            return;
          }
          TA.api('POST', '/verify/model', { baseUrl: urlEl.value.trim(), token: tokenEl.value.trim(), model: model })
            .then(function (res) {
              if (res.status === 401) { TA.openAuth('login'); TA.showToast('登录已过期，请重新登录'); if (resultSpan) resultSpan.innerHTML = '<span class="bad">✗ 未登录 (401)</span>'; if (btn) btn.disabled = false; return; }
              return res.json().then(function (d) {
                if (d && d.inProgress) { attempt++; setTimeout(poll, 1000); return; }
                renderModelDetail(d, reportEl);
                if (resultSpan) {
                  if (d && d.ok) {
                    var c = verdictCls(d.score);
                    resultSpan.innerHTML = '<span class="' + c + '">' + (d.score >= 80 ? '✓ 基本可信' : (d.score >= 60 ? '⚠ 存在疑点' : '✗ 疑似掺水')) + ' (' + d.score + ')</span>';
                  } else if (d && d.kind === 'ratelimit') {
                    resultSpan.innerHTML = '<span class="warn">⚠ 限流中 (429)</span>';
                  } else if (d && d.kind === 'vision_skip') {
                    resultSpan.innerHTML = '<span class="warn">Vision 已跳过</span>';
                  } else {
                    var eMsg = String((d && d.error) || '检测失败');
                    resultSpan.innerHTML = '<span class="bad" title="' + esc(eMsg) + '">✗ ' + esc(eMsg.slice(0, 40)) + '</span>';
                  }
                }
                if (btn) btn.disabled = false;
              });
            })
            .catch(function () {
              if (resultSpan) resultSpan.innerHTML = '<span class="bad">✗ 请求失败</span>';
              if (TA.showToast) TA.showToast('检测请求失败，请重试');
              if (btn) btn.disabled = false;
            });
        }
        poll();
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var url = urlEl.value.trim();
      var tok = tokenEl.value.trim();
      if (!/^https?:\/\/.+/i.test(url)) { setStatus('bad', esc('Base URL 需以 http(s):// 开头')); return; }
      if (!tok) { setStatus('bad', esc('请填写 API Key')); return; }
      if (!TA.getToken()) { TA.openAuth('login'); TA.showToast('请先登录后使用'); return; }
      modelListEl.innerHTML = '';
      submitBtn.disabled = true;
      setStatus('testing', '<span class="spinner" style="display:inline-block;width:14px;height:14px;vertical-align:-2px;margin-right:6px"></span>检测端点中…（自动识别兼容模式与模型）');
      TA.api('POST', '/verify', { baseUrl: url, token: tok })
        .then(function (res) {
          if (res.status === 401) { TA.openAuth('login'); TA.showToast('登录已过期，请重新登录'); return; }
          return res.json().then(function (d) {
            if (d.ok) { renderEndpoint(d); }
            else { setStatus('bad', esc(d.error || '检测失败')); }
          });
        })
        .catch(function () { setStatus('bad', esc('检测请求失败，请稍后重试')); })
        .finally(function () { submitBtn.disabled = false; });
    });

    modelListEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-verify-model]');
      if (!btn) return;
      var row = btn.closest('.model-row');
      var rep = row ? row.querySelector('.model-row__report') : null;
      runModelCheck(btn.getAttribute('data-verify-model'), btn, btn.parentElement.querySelector('.model-row__result'), rep);
    });

    return {
      mount: mount,
      getValue: function () { return { url: urlEl.value.trim(), token: tokenEl.value.trim() }; },
      setValue: function (v) { if (v && v.url != null) urlEl.value = v.url; if (v && v.token != null) tokenEl.value = v.token; },
      destroy: function () { mount.innerHTML = ''; }
    };
  }

  window.VerifyRelay = { create: create, reportHtml: modelDetailHtml, errorHtml: modelErrorHtml, bindAiToggle: bindAiToggle };
  if (typeof module !== 'undefined' && module.exports) module.exports = { VerifyRelay: window.VerifyRelay };
})();
