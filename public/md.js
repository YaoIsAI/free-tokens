// 轻量 Markdown 渲染器（教程正文用）。先整体转义再渲染，杜绝 XSS。
// 挂到 window.TutorialMD.render(src, opts) → HTML；只支持本站需要的子集：
// 标题 / 段落 / 围栏代码块 / 行内代码 / 图片（![alt](src)）/ 链接 / 加粗斜体 / 列表 / 引用 / 表格 / 分隔线。
// 图片与链接走协议白名单（https: 或本站 /uploads/），其余协议保持字面防注入。
// opts.wechat=true 时 B 站视频降级为跳转卡片（微信内置浏览器无法内嵌播放）。
(function () {
  var NUL = '\x00'; // 占位符分隔符

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 图片标签（协议已在本段前面校验过才调用；src/alt 来自已整体转义的文本，属性安全）
  // src 若是本站域名的绝对 uploads 图（如 https://freeapis.top/uploads/x.png），归一化为相对
  // 路径 → 跟随当前访问域名、同源加载（跨域会触发 CORP: same-origin 拦截导致图片裂）。
  function uploadSrc(src) {
    return String(src).replace(/^https?:\/\/(?:freeapis\.top|free-tokens\.org|localhost|127\.0\.0\.1)(?::\d+)?(?=\/uploads\/)/i, '');
  }
  function imgTag(src, alt) {
    return '<img class="md-img" src="' + uploadSrc(src) + '" alt="' + alt + '" loading="lazy" referrerpolicy="no-referrer">';
  }

  // 行内渲染：先摘行内代码 → 图片/链接（协议白名单）→ 加粗 → 斜体 → 回填代码
  function inline(s) {
    var code = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      code.push('<code>' + c + '</code>');
      return NUL + 'i' + (code.length - 1) + NUL;
    });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, ia, is, lt, lu) {
      if (ia !== undefined) {
        if (/^(https?:|\/uploads\/)/i.test(is)) return imgTag(is, ia);
        return '![' + ia + '](' + is + ')'; // 协议不在白名单（javascript:/data: 等）→ 保持字面，防注入
      }
      if (/^(https?:|mailto:|#|\/[^/])/i.test(lu)) {
        return '<a href="' + lu + '" target="_blank" rel="noopener noreferrer">' + lt + '</a>';
      }
      return '[' + lt + '](' + lu + ')';
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    return s.replace(new RegExp(NUL + 'i(\\d+)' + NUL, 'g'), function (_, n) { return code[+n] || ''; });
  }

  function render(src, opts) {
    if (typeof src !== 'string') return '';
    opts = opts || {};
    // 微信内置浏览器（XWeb/WKWebView）不支持 bilibili 内嵌播放器，浏览器端自动降级为跳转卡片
    if (!opts.wechat && typeof navigator !== 'undefined' && navigator.userAgent && /MicroMessenger|Weixin/i.test(navigator.userAgent)) {
      opts.wechat = true;
    }
    // 归一化换行、剔除 NUL，随后整体转义（原始 HTML 惰化）
    src = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(NUL).join('');
    var lines = esc(src).split('\n');
    var codeStore = [];
    var out = [];
    var list = null; // { type:'ul'|'ol', items:[] }
    var para = [];
    var i = 0;

    function closePara() {
      if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
    }
    function closeList() {
      if (list) { out.push('<' + list.type + '>' + list.items.join('') + '</' + list.type + '>'); list = null; }
    }
    function flush() { closePara(); closeList(); }

    while (i < lines.length) {
      var line = lines[i];

      // 围栏代码块
      var fm = /^```([\w-]*)\s*$/.exec(line);
      if (fm) {
        flush();
        var buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        var ph = NUL + 'c' + codeStore.length + NUL;
        codeStore.push('<pre><code' + (fm[1] ? ' class="code-' + fm[1] + '"' : '') + '>' + buf.join('\n') + '</code></pre>');
        out.push(ph);
        continue;
      }

      // 表格（当前行含 |，且下一行是 |---| 分隔）
      if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1) {
        flush();
        var head = line.split('|').slice(1, -1).map(function (c) { return inline(c.trim()); });
        i += 2;
        var body = [];
        while (i < lines.length && lines[i].trim() && /^\|/.test(lines[i])) {
          body.push('<tr>' + lines[i].split('|').slice(1, -1).map(function (c) { return '<td>' + inline(c.trim()) + '</td>'; }).join('') + '</tr>');
          i++;
        }
        out.push('<table><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + body.join('') + '</tbody></table>');
        continue;
      }

      if (!line.trim()) { flush(); i++; continue; }

      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        flush();
        var lv = h[1].length;
        out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
        i++;
        continue;
      }

      if (/^&gt;\s?/.test(line)) {
        flush();
        var q = [];
        while (i < lines.length && /^&gt;\s?/.test(lines[i])) { q.push(lines[i].replace(/^&gt;\s?/, '')); i++; }
        out.push('<blockquote><p>' + inline(q.join('\n')) + '</p></blockquote>');
        continue;
      }

      if (/^(\s*([-*_])\s*){3,}$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }

      // 独立成行的图片 → 块级展示（居中 + 圆角，alt 作图注）；协议不允许则保持字面
      var im = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
      if (im) {
        flush();
        if (/^(https?:|\/uploads\/)/i.test(im[2])) {
          out.push('<figure class="md-figure">' + imgTag(im[2], im[1]) + (im[1] ? '<figcaption>' + im[1] + '</figcaption>' : '') + '</figure>');
        } else {
          out.push('<p>' + line + '</p>');
        }
        i++;
        continue;
      }

      var um = /^[-*+]\s+(.*)$/.exec(line);
      if (um) {
        closePara();
        if (!list || list.type !== 'ul') { closeList(); list = { type: 'ul', items: [] }; }
        list.items.push('<li>' + inline(um[1]) + '</li>');
        i++;
        continue;
      }

      var om = /^\d+[.)]\s+(.*)$/.exec(line);
      if (om) {
        closePara();
        if (!list || list.type !== 'ol') { closeList(); list = { type: 'ol', items: [] }; }
        list.items.push('<li>' + inline(om[1]) + '</li>');
        i++;
        continue;
      }

      // B 站视频：独立成行的裸链接 → 在线播放器；微信内置浏览器不支持内嵌，降级为「在哔哩哔哩打开」跳转卡片
      var vm = /^\s*(https?:\/\/(?:www\.|m\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]+)\/?(\?[^\s]*)?)\s*$/i.exec(line);
      if (vm) {
        flush();
        if (opts.wechat) {
          out.push('<div class="md-video md-video--link"><a class="md-video__jump" href="' + vm[1] + '" target="_blank" rel="noopener noreferrer"><span class="md-video__btn"><span class="md-video__play"></span></span><span class="md-video__hint">在哔哩哔哩打开观看</span></a></div>');
        } else {
          out.push('<div class="md-video"><iframe src="https://player.bilibili.com/player.html?bvid=' + vm[2] + '&high_quality=1&danmaku=1" scrolling="no" frameborder="no" allowfullscreen="true" loading="lazy" title="哔哩哔哩视频"></iframe></div>');
        }
        i++;
        continue;
      }

      para.push(line);
      i++;
    }
    flush();

    var html = out.join('\n');
    html = html.replace(new RegExp(NUL + 'c(\\d+)' + NUL, 'g'), function (_, n) { return codeStore[+n] || ''; });
    return html;
  }

  var api = { render: render, esc: esc };
  if (typeof window !== 'undefined') window.TutorialMD = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
