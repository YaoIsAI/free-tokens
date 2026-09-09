// 可复用图片上传组件（点击选择 / 拖拽 / Ctrl+V 粘贴三合一）。
// 所有走 /api/upload 的上传点（反馈图片、教程封面…）都用它，消除重复逻辑。
// 挂到 window.Uploader.create(opts) → { getValue(), setValue(v) }。
// 服务端契约不变：Bearer 认证 + 单张 ≤3MB + 每用户每日 ≤20 张 + 后端 magic number 校验。
(function () {
  var MAX = 3 * 1024 * 1024;
  var TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  var EXT_OK = /^\/uploads\/[a-f0-9]{16}\.(png|jpg|webp|gif)$/i;
  var DEFAULT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/></svg>';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function create(opts) {
    opts = opts || {};
    var mount = opts.mount;
    if (!mount) return null;
    var getToken = opts.token || function () { return ''; };
    var toast = opts.toast || function () {};
    var allowUrl = !!opts.allowUrl;
    var hidden = opts.hidden || null;
    var onValue = opts.onValue || function () {};

    mount.innerHTML =
      '<div class="uploader">' +
        '<div class="uploader__zone" tabindex="0" role="button">' +
          '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>' +
          '<span class="uploader__icon">' + (opts.icon || DEFAULT_ICON) + '</span>' +
          '<span class="uploader__hint">点击选择 / 拖拽图片 / Ctrl+V 粘贴</span>' +
        '</div>' +
        (allowUrl ? '<input class="input uploader__url" type="text" placeholder="或粘贴图片链接 https://…" maxlength="500">' : '') +
        '<div class="uploader__bar"><button type="button" class="uploader__clear" style="display:none">移除</button></div>' +
        '<div class="uploader__preview"></div>' +
      '</div>';

    var zone = mount.querySelector('.uploader__zone');
    var fileInput = mount.querySelector('input[type=file]');
    var urlInput = mount.querySelector('.uploader__url');
    var preview = mount.querySelector('.uploader__preview');
    var clearBtn = mount.querySelector('.uploader__clear');
    var state = { value: '', uploading: false };

    function render() {
      var v = state.value;
      preview.innerHTML = v ? '<img src="' + esc(v) + '" alt="图片预览">' : '';
      if (clearBtn) clearBtn.style.display = v ? '' : 'none';
      if (hidden) hidden.value = v;
      onValue(v);
    }
    function setValue(v) {
      state.value = v || '';
      if (urlInput) urlInput.value = (/^https?:/i.test(state.value) ? state.value : '');
      render();
    }

    function upload(f) {
      if (!f || state.uploading) return;
      if (f.size > MAX) { toast('图片超过 3MB'); return; }
      if (TYPES.indexOf(f.type) === -1) { toast('仅支持 PNG/JPG/WebP/GIF'); return; }
      state.uploading = true;
      zone.classList.add('is-uploading');
      fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + (typeof getToken === 'function' ? getToken() : getToken),
          'Content-Type': f.type
        },
        body: f
      }).then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, d: d }; });
      }).then(function (r) {
        state.uploading = false;
        zone.classList.remove('is-uploading');
        if (!r.ok) { toast((r.d && r.d.error) || '上传失败'); return; }
        if (urlInput) urlInput.value = '';
        state.value = r.d.url;
        render();
        toast('上传成功');
      }).catch(function () {
        state.uploading = false;
        zone.classList.remove('is-uploading');
        toast('上传失败');
      });
    }

    // 点击选择
    zone.addEventListener('click', function () { if (!state.uploading) fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      upload(f);
    });
    // 拖拽上传
    var dragDepth = 0;
    zone.addEventListener('dragenter', function (e) { e.preventDefault(); if (state.uploading) return; dragDepth++; zone.classList.add('is-drag'); });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); });
    zone.addEventListener('dragleave', function () { dragDepth--; if (dragDepth <= 0) { dragDepth = 0; zone.classList.remove('is-drag'); } });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      zone.classList.remove('is-drag');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      upload(f);
    });
    // Ctrl+V 粘贴：仅本组件可见（弹窗打开）且剪贴板含图片文件时处理，不干扰文本粘贴
    function handlePaste(e) {
      if (!zone.offsetParent) return;
      var items = (e.clipboardData && e.clipboardData.items) || [];
      var f = null;
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') { f = items[i].getAsFile(); break; }
      }
      if (f && /^image\//i.test(f.type)) upload(f);
    }
    document.addEventListener('paste', handlePaste);
    // 弹窗开着时拖偏到上传区外：拦下 document 级 drop，防浏览器直接打开本地文件替换页面
    function blockDocDrop(e) {
      if (!zone.offsetParent) return; // 组件不可见（弹窗关着）不拦，保持默认行为
      e.preventDefault();
    }
    document.addEventListener('dragover', blockDocDrop);
    document.addEventListener('drop', blockDocDrop);

    // 外链 URL 输入：与上传值互斥（填 URL 清上传、上传清 URL）
    if (urlInput) {
      urlInput.addEventListener('input', function () {
        var v = String(urlInput.value).trim();
        state.value = (/^https?:\/\/\S+$/i.test(v)) ? v : '';
        render();
      });
      urlInput.addEventListener('paste', function (e) { e.stopPropagation(); }); // 避免粘贴进 URL 框时触发整图上传
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        state.value = '';
        if (fileInput) fileInput.value = '';
        if (urlInput) urlInput.value = '';
        render();
      });
    }

    // 初始值：/uploads/ 直接预览；https 填 URL 输入框；空则干净
    setValue(opts.initial || '');
    return { getValue: function () { return state.value; }, setValue: setValue };
  }

  var api = { create: create };
  if (typeof window !== 'undefined') window.Uploader = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
