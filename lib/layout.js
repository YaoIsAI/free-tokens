// Layout factory — zero-dependency server-side HTML components.
// All pages share this layout. Change once, updates everywhere.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// verify-relay.js / checkin.js 独立内容哈希：可复用组件，改动需单独带动缓存失效。
// 不能复用 app.js 的 jsHash 作为其版本号——那样只改组件时 URL 版本不变，
let VERIFY_RELAY_HASH = '';
let CHECKIN_HASH = '';
try {
  VERIFY_RELAY_HASH = crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname, '..', 'public', 'verify-relay.js'))).digest('hex').slice(0, 8);
} catch (_) {}
try {
  CHECKIN_HASH = crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname, '..', 'public', 'checkin.js'))).digest('hex').slice(0, 8);
} catch (_) {}

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Inline the Lucide sprite once into every page so icon <use> references
// resolve against the SAME document. This avoids a class of production bugs
// where external /icons.svg references fail to load (CDN/proxy cache, CSP,
// cross-document <use> quirks) and icons render as blank squares.
//
// Perf: the full sprite (103 symbols, ~56KB) is trimmed at runtime to ONLY the
// symbols the app actually uses (69, ~37KB) — the sprite is inlined into every
// SSR page, so trimming cuts ~19KB per page (~5KB brotli). Keep this list in
// sync with icon() usage: tests/api.test.js "图标白名单完整" 扫描全库断言
// 代码用到的每个图标都在这份白名单里，新增图标未登记会直接测挂。
var ICON_ALLOWLIST = [
  'alert-triangle','arrow-left','arrow-right','arrow-up','award','bell','book-open','bot','box','brain','bug',
  'calendar','check','chevron-down','chevron-right','clock','cloud','code','compass','copy','cpu','crown','download','external-link',
  'file-text','gem','gift','globe','help-circle','eye','image','inbox','info','key','key-round','layers','layout-grid',
  'link','lock','log-in','log-out','mail','message-circle','message-square','moon','package','pause','pencil','play','plus',
  'refresh-cw','rocket','rotate-ccw','search','send','server','settings','share-2','shield','shield-check','sparkles',
  'star','sun','terminal','trash-2','trophy','undo-2','upload','user','user-plus','users','video','x','zap'
];

var SPRITE_SVG = '';
try {
  SPRITE_SVG = fs.readFileSync(path.join(__dirname, '..', 'public', 'icons.svg'), 'utf8');
} catch (e) { /* sprite optional */ }

// 从全量 sprite 里挑出白名单内的符号，组装为最小内联 sprite
function trimmedSprite() {
  if (!SPRITE_SVG) return '';
  return SPRITE_SVG.replace(/<symbol\s+id="lucide-([^"]+)"[\s\S]*?<\/symbol>/g, function (m, name) {
    return ICON_ALLOWLIST.indexOf(name) === -1 ? '' : m;
  });
}

function inlineSprite() {
  if (!SPRITE_SVG) return '';
  // Hide the sprite container WITHOUT display:none (a few browsers skip
  // rendering symbols inside display:none subtrees). width/height 0 +
  // absolute positioning is the bulletproof pattern.
  return trimmedSprite().replace(
    /style="display:none"/,
    'style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false"'
  );
}

// Lucide icon — references the inlined sprite in the same document.
function icon(name, extraClass) {
  return '<svg class="ic' + (extraClass ? ' ' + extraClass : '') + '" aria-hidden="true" focusable="false"><use href="#lucide-' + name + '"/></svg>';
}

function buildNav(active) {
  var items = [
    { href: '/', label: '首页', id: 'home', icon: 'compass' },
    { href: '/tools', label: 'AI 工具', id: 'tools', icon: 'link' },
    { href: '/verify', label: '掺水检测', id: 'verify', icon: 'shield-check' },
    { href: '/skills', label: 'Skill 广场', id: 'skills', icon: 'box' },
    { href: '/tutorials', label: '教程', id: 'guide', icon: 'book-open' },
    { href: '/cli', label: 'CLI', id: 'cli', icon: 'terminal' }
  ];
  return items.map(function(n) {
    var cls = n.id === active ? 'nav__link nav__link--active' : 'nav__link';
    return '<a href="' + n.href + '" class="' + cls + '">' + icon(n.icon) + '<span>' + n.label + '</span></a>';
  }).join('\n        ');
}

function head(opts) {
  var title = esc(opts.title || 'free-tokens');
  var fullTitle = title === 'free-tokens' ? 'free-tokens — Token公益站 · 免费大模型Token导航' : title + ' — free-tokens';
  var rawDesc = opts.desc || 'free-tokens · Token公益站，免费大模型Token聚合导航与 AI 教程，OpenAI/Anthropic/Gemini/DeepSeek等公益领取';
  var desc = esc(rawDesc);
  var keywords = esc(opts.keywords || '免费大模型Token,免费API Key,免费大模型key,大模型API导航,Token公益站,OpenAI免费key,DeepSeek免费key,Claude免费key,Gemini免费key,AI教程');
  var extraStyles = opts.style ? '\n  <style>\n' + opts.style + '\n  </style>' : '';

  // ===== SEO / GEO：canonical · robots · OG · Twitter · JSON-LD =====
  var url = opts.url || '';
  var origin = url.replace(/(https?:\/\/[^/]+).*/, '$1');
  if (origin === url) origin = ''; // 非绝对 URL 时不推导
  var ogTitle = esc(opts.ogTitle || opts.title || 'free-tokens');
  var ogType = esc(opts.ogType || 'website');
  var image = esc(opts.image || (origin ? origin + '/og-image.png' : ''));
  var robots = opts.noindex ? 'noindex,nofollow' : 'index,follow';
  var seo = '';
  if (url) seo += '\n  <link rel="canonical" href="' + esc(url) + '">';
  if (url) seo += '\n  <link rel="alternate" hreflang="zh-Hans" href="' + esc(url) + '">';
  if (url) seo += '\n  <link rel="alternate" hreflang="x-default" href="' + esc(url) + '">';
  seo += '\n  <meta name="robots" content="' + robots + '">';
  seo += '\n  <meta property="og:site_name" content="free-tokens · Token公益站">';
  seo += '\n  <meta property="og:locale" content="zh_CN">';
  if (url) seo += '\n  <meta property="og:url" content="' + esc(url) + '">';
  seo += '\n  <meta property="og:type" content="' + ogType + '">';
  seo += '\n  <meta property="og:title" content="' + ogTitle + '">';
  seo += '\n  <meta property="og:description" content="' + desc + '">';
  if (image) seo += '\n  <meta property="og:image" content="' + image + '">';
  if (image) seo += '\n  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">';
  seo += '\n  <meta name="twitter:card" content="summary_large_image">';
  seo += '\n  <meta name="twitter:site" content="@freetokens">';
  seo += '\n  <meta name="twitter:creator" content="@freetokens">';
  seo += '\n  <meta name="twitter:title" content="' + ogTitle + '">';
  seo += '\n  <meta name="twitter:description" content="' + desc + '">';
  if (image) seo += '\n  <meta name="twitter:image" content="' + image + '">';

  var ld = [{
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': 'free-tokens · Token公益站',
    'alternateName': '免费大模型Token导航',
    'url': origin || 'https://free-tokens.org',
    'description': rawDesc,
    'publisher': {
      '@type': 'Organization',
      'name': 'free-tokens · Token公益站',
      'url': origin || 'https://free-tokens.org',
      'logo': (origin || 'https://free-tokens.org') + '/og-image.png'
    },
    'potentialAction': {
      '@type': 'SearchAction',
      'target': (origin || 'https://free-tokens.org') + '/?search={search_term_string}',
      'query-input': 'required name=search_term_string'
    }
  }];
  if (Array.isArray(opts.jsonLd)) ld = ld.concat(opts.jsonLd);
  // JSON.stringify 不转义 <，必须把 < 编成 < 防止 </script> 逃逸出 ld+json 块（存储型 XSS）
  var ldHtml = ld.map(function (o) { return '\n  <script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>'; }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
  <script nonce="${opts.nonce || ''}">
  (function() {
    try {
      var t = localStorage.getItem('freeapis-theme');
      if (t === 'dark' || t === 'light') {
        document.documentElement.setAttribute('data-theme', t);
      }
      // 未手动选择过 → 保持默认浅色（不跟随系统主题）
    } catch (e) {}
  })();
  </script>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fullTitle}</title>
  <meta name="description" content="${desc}">
  <meta name="keywords" content="${keywords}">${seo}
  <meta name="referrer" content="no-referrer">
  <meta name="theme-color" content="#5b6ef7">
  <meta name="baidu-site-verification" content="codeva-vhLqoP5gZt">
  <link rel="preload" href="/styles.css?v=${opts.cssHash || ''}" as="style">
  <link rel="stylesheet" href="/styles.css?v=${opts.cssHash || ''}">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect width='24' height='24' rx='5' fill='%235b6ef7' stroke='none'/><path d='M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z'/><path d='M20 2v4'/><path d='M22 4h-4'/><circle cx='4' cy='20' r='2'/></svg>">${extraStyles}${ldHtml}
</head>`;
}

function headerInner(opts) {
  return `
    <div class="header__inner">
      <a href="/" class="logo">
        <span class="logo__mark">${icon('sparkles')}</span>
        <span class="logo__text">free-<span class="logo__accent">tokens</span></span>
      </a>
      <button class="nav-toggle" id="navToggle" aria-label="菜单">
        <span></span><span></span><span></span>
      </button>
      <nav class="nav" id="mainNav" style="margin-left:auto">
        ${buildNav(opts.activeNav)}
        <button class="nav__link nav__link--icon checkin-btn" id="checkinBtn" title="每日签到" aria-label="每日签到"><span class="checkin-btn__icon">${icon('calendar')}</span><span class="checkin-btn__text">签到</span><span class="checkin-btn__dot" id="checkinDot" style="display:none"></span></button>
        <a href="#" class="nav__link nav__link--icon" id="wechatBtn" title="加微信群">${icon('message-circle')}</a>
        <button class="nav__link nav__link--icon" id="themeToggle" title="切换主题" aria-label="切换主题">
          <span class="icon-sun">${icon('sun')}</span><span class="icon-moon">${icon('moon')}</span>
        </button>
        <button class="btn btn--sm btn--primary nav-login" id="headerLoginBtn">${icon('log-in')}登录</button>
        <a href="#" class="btn btn--sm btn--primary nav-publish" id="authBtn" style="display:none">${icon('plus')}发布 Token</a>
        <div class="user-menu" id="userMenu" style="display:none">
          <button class="user-menu__btn" id="userMenuBtn" aria-haspopup="true" aria-expanded="false">
            <span class="user-menu__avatar" id="userMenuAvatar">${icon('user')}</span>
            <span class="user-menu__name" id="userMenuName">user</span>
            <span class="user-menu__caret">${icon('chevron-down')}</span>
          </button>
          <div class="user-menu__dropdown" id="userDropdown">
            <a href="/dashboard" class="user-menu__item"><span class="user-menu__item-icon">${icon('layout-grid')}</span>我的发布</a>
            <a href="/dashboard#admin" class="user-menu__item user-menu__item--admin" id="adminMenuLink" style="display:none"><span class="user-menu__item-icon">${icon('shield')}</span>管理后台<span class="nav-badge" id="adminMenuBadge" style="display:none"></span></a>
            <div class="user-menu__divider"></div>
            <button class="user-menu__item user-menu__item--danger" id="logoutBtn"><span class="user-menu__item-icon">${icon('log-out')}</span>退出登录</button>
          </div>
        </div>
      </nav>
    </div>`;
}

function header(opts) {
  return `\n  <header class="header" id="header">` + headerInner(opts) + `\n  </header>`;
}

function footer() {
  return `
  <footer class="footer">
    <div class="footer__inner">
      <a href="/" class="footer__brand">
        <span class="logo__mark">${icon('sparkles')}</span>
        <span class="logo__text">free-<span class="logo__accent">tokens</span></span>
      </a>
      <div class="footer__links">
        <a href="/">${icon('compass')}首页</a>
        <a href="/tools">${icon('link')}AI 工具</a>
        <a href="/verify">${icon('shield-check')}掺水检测</a>
        <a href="/tutorials">${icon('book-open')}教程</a>
        <a href="/points">${icon('award')}积分规则</a>
        <a href="/guide">${icon('file-text')}官方指南</a>
        <a href="/cli">${icon('terminal')}CLI</a>
        <a href="#" id="footerWechat">${icon('message-circle')}加群</a>
        <a href="#" id="footerFeedback">${icon('mail')}公社信箱</a>
        <a href="/cooperate">${icon('gem')}商务合作</a>
      </div>
      <p class="footer__copy">© 2026 free-tokens · Token公益站 · 人人可发布 · 永久免费 · 所有 AI 相关教程公益共享</p>
    </div>
    <div class="footer__disclaimer">
      <span class="footer__disclaimer-mark" aria-hidden="true">${icon('info')}</span>
      <p class="footer__disclaimer-text">本站为免费大模型 Token 信息聚合平台，条目由社区用户自行发布，平台不提供、不担保任何 API 服务，请自行甄别并自担风险。</p>
      <button class="footer__disclaimer-link" id="disclaimerOpen" type="button">${icon('file-text')} 完整免责声明</button>
    </div>
  </footer>`;
}

// Shared modals — all pages get the same set so app.js works everywhere
function modals() {
  return `
  <div class="modal" id="modal" data-modal="detail">
    <div class="modal__backdrop" data-action="close-modal"></div>
    <div class="modal__panel" id="modalContent"></div>
  </div>
  <div class="modal" id="authModal" data-modal="auth">
    <div class="modal__backdrop" data-action="close-auth"></div>
    <div class="modal__panel" style="max-width:420px" id="authModalContent">
      <button class="modal__x" data-action="close-auth" aria-label="关闭">${icon('x')}</button>
      <div id="authView"></div>
    </div>
  </div>
  <div class="modal" id="publishModal" data-modal="publish">
    <div class="modal__backdrop" data-action="close-publish"></div>
    <div class="modal__panel" style="max-width:580px" id="publishModalContent">
      <button class="modal__x" data-action="close-publish" aria-label="关闭">${icon('x')}</button>
      <div id="publishView"></div>
    </div>
  </div>
  <div class="modal" id="wechatModal" data-modal="wechat">
    <div class="modal__backdrop" data-action="close-wechat"></div>
    <div class="modal__panel" style="max-width:400px">
      <div class="modal__body" style="text-align:center">
        <button class="modal__x" data-action="close-wechat" aria-label="关闭">${icon('x')}</button>
        <h2 class="modal__title" style="padding-right:0">加微信群 · 获取邀请码</h2>
        <div class="wechat-steps" style="text-align:left;margin:12px 0 20px">
          <div class="wechat-step"><span class="wechat-step__num">1</span> 扫码添加微信好友</div>
          <div class="wechat-step"><span class="wechat-step__num">2</span> 发送暗号 <code style="background:var(--surface-3);padding:2px 8px;border-radius:var(--r-sm);color:var(--brand);font-weight:600">free-tokens</code>，拉你进群</div>
          <div class="wechat-step"><span class="wechat-step__num">3</span> 向群主/管理员索取邀请码（群公告也会同步）</div>
          <div class="wechat-step"><span class="wechat-step__num">4</span> 回到注册页，粘贴邀请码完成注册</div>
        </div>
        <div class="qr" id="wechatQrContainer"><div class="spinner"></div></div>
        <p style="margin-top:12px;font-size:13px;color:var(--text-muted)">请备注 <code style="background:var(--surface-3);padding:2px 8px;border-radius:var(--r-sm);color:var(--brand);font-weight:600">free-tokens，Token公益站</code></p>
      </div>
    </div>
  </div>
  <div class="modal" id="editModal">
    <div class="modal__backdrop" data-action="close-edit"></div>
    <div class="modal__panel" style="max-width:580px">
      <button class="modal__x" data-action="close-edit" aria-label="关闭">${icon('x')}</button>
      <div id="editView"></div>
    </div>
  </div>
  <div class="modal" id="listModal" data-modal="list">
    <div class="modal__backdrop" data-action="close-list"></div>
    <div class="modal__panel" style="max-width:560px">
      <button class="modal__x" data-action="close-list" aria-label="关闭">${icon('x')}</button>
      <div id="listModalBody" class="modal__body"></div>
    </div>
  </div>
  <div class="modal" id="tutPublishModal" data-modal="tut-publish">
    <div class="modal__backdrop" data-action="close-tut-publish"></div>
    <div class="modal__panel" style="max-width:680px">
      <button class="modal__x" data-action="close-tut-publish" aria-label="关闭">${icon('x')}</button>
      <div id="tutPublishView"></div>
    </div>
  </div>
  <div class="modal" id="disclaimerModal" data-modal="disclaimer">
    <div class="modal__backdrop" data-action="close-disclaimer"></div>
    <div class="modal__panel modal__panel--tall" style="max-width:680px">
      <button class="modal__x" data-action="close-disclaimer" aria-label="关闭">${icon('x')}</button>
      <h2 class="modal__title" style="padding-right:0">完整免责声明</h2>
      <p class="disclaimer-body__intro">更新日期：2026-08-14　·　继续使用本站即视为已阅读并同意本声明全部条款</p>
      <div class="disclaimer-body">
        <h3>一、平台性质</h3>
        <p>free-tokens（Token公益站，下称"本站"）是一个免费的 AI 大模型 Token 信息聚合与导航平台。本站本身不提供任何模型服务、API 网关、算力或数据存储，也不与任何模型厂商存在代理、转售或授权关系。</p>
        <h3>二、内容来源与真实性</h3>
        <p>本站展示的条目（含 Token、Base URL、可用模型、描述、教程等）均由社区用户自愿发布。本站已对发布内容进行技术性校验（如端点连通性、Token 去重与格式探测），但<strong>不保证任何内容的真实性、准确性、有效性、稳定性或持续可用性</strong>。免费 Token 可能随时失效、被限流或被厂商收回，发布者也可能随时删除或修改条目，请以实际使用为准。</p>
        <h3>三、使用风险与责任</h3>
        <p>您使用本站获取的 Token、Base URL 及其他信息，属于自行判断、自担风险的行为。因使用或依赖上述信息产生的任何直接或间接损失（包括但不限于业务中断、数据丢失、资费损失、账号封禁、法律纠纷等），本站及本站运营者概不负责。发布者对其所发布内容引发的后果由其本人承担。</p>
        <h3>四、第三方服务与链接</h3>
        <p>本站条目中的链接、Base URL 及第三方服务均由第三方独立运营。您与其交互（包括但不限于注册、付费、数据传输、调用 API）时，应遵守该第三方的服务条款与隐私政策。本站对第三方服务的内容、质量、安全性及由此产生的任何损失不承担责任。</p>
        <h3>五、合规使用与禁止用途</h3>
        <p>您须遵守所在国家/地区的法律法规，以及各模型厂商的服务条款与使用政策。禁止将本站内容用于任何非法、侵权、危害他人或违反公序良俗的用途（包括但不限于生成攻击性内容、批量滥用、绕过模型厂商限制、侵犯他人知识产权或隐私等）。因违规使用产生的全部责任由您自行承担。</p>
        <h3>六、知识产权与侵权处理</h3>
        <p>本站页面设计、文案及平台功能的知识产权归本站运营者所有；用户发布内容的知识产权归发布者本人。如您认为本站内容侵犯了您的合法权益（如商标、版权、商业秘密等），请提供权属证明联系我们，我们核实后将依法及时处理。</p>
        <h3>七、数据与安全</h3>
        <p>Token 属于敏感凭据，请妥善保管您发布的 Token，切勿向不可信方透露。本站不对用户因 Token 泄露、滥用或被第三方获取造成的损失负责。本站不收集、不出售用户个人数据。</p>
        <h3>八、服务变更与中断</h3>
        <p>本站为公益项目，可能随时调整服务、下线部分内容或停止运营且无需事先通知。因不可抗力、网络故障、第三方服务中断、维护升级等原因导致的访问中断或数据丢失，本站不承担责任。</p>
        <h3>九、法律适用与争议解决</h3>
        <p>本声明适用中华人民共和国法律。因本声明或使用本站产生的争议，双方应友好协商解决；协商不成的，提交本站运营者所在地有管辖权的人民法院解决。</p>
        <h3>十、联系与反馈</h3>
        <p>如您对本声明、内容或平台有任何疑问、建议或投诉，可通过本站「加微信群」或站内反馈渠道与我们联系。</p>
      </div>
    </div>
  </div>
  <div class="modal" id="feedbackModal" data-modal="feedback">
    <div class="modal__backdrop" data-action="close-feedback"></div>
    <div class="modal__panel" style="max-width:520px">
      <button class="modal__x" data-action="close-feedback" aria-label="关闭">${icon('x')}</button>
      <div id="feedbackView"></div>
    </div>
  </div>
  <div class="modal" id="checkinModal" data-modal="checkin">
    <div class="modal__backdrop" data-action="close-checkin"></div>
    <div class="modal__panel" style="max-width:420px">
      <button class="modal__x" data-action="close-checkin" aria-label="关闭">${icon('x')}</button>
      <div id="checkinView"></div>
    </div>
  </div>
  <button class="btt" id="backToTop" aria-label="回到顶部">${icon('arrow-up')}</button>`;
}

function scripts(opts) {
  // defer: external scripts execute after HTML parsing (non-blocking render) but
  // before DOMContentLoaded, in document order — app.js/upload.js rely on the DOM
  var parts = ['<script defer src="/upload.js?v=' + (opts.jsHash || '') + '"></script>', '<script defer src="/app.js?v=' + (opts.jsHash || '') + '"></script>', '<script defer src="/track.js?v=' + (opts.jsHash || '') + '"></script>', '<script defer src="/verify-relay.js?v=' + (opts.verifyRelayHash || VERIFY_RELAY_HASH || '') + '"></script>', '<script defer src="/checkin.js?v=' + (CHECKIN_HASH || opts.jsHash || '') + '"></script>'];
  if (opts.scriptSrc) {
    var srcs = Array.isArray(opts.scriptSrc) ? opts.scriptSrc : [opts.scriptSrc];
    srcs.forEach(function (s) { parts.push('<script defer src="' + s + '"></script>'); });
  }
  if (opts.script) {
    parts.push('<script nonce="' + (opts.nonce || '') + '">\n' + opts.script + '\n</script>');
  }
  return parts.join('\n  ');
}

// Homepage layout with search header + all modals
function homePage(opts) {
  return head(opts) + '\n<body class="page-home">\n' +
    inlineSprite() + '\n' +
    header(opts) + '\n' +
    (opts.content || '') + '\n' +
    footer() + '\n' +
    modals() + '\n' +
    '  ' + scripts(opts) + '\n</body>\n</html>';
}

// Generic page layout with simple header + all modals
function page(opts) {
  return head(opts) + '\n<body class="page-' + esc(opts.activeNav || 'page') + '">\n' +
    inlineSprite() + '\n' +
    header(opts) + '\n' +
    (opts.content || '') + '\n' +
    footer() + '\n' +
    modals() + '\n' +
    '  ' + scripts(opts) + '\n</body>\n</html>';
}

module.exports = { head, header, footer, modals, homePage, page, icon, esc, inlineSprite, ICON_ALLOWLIST };
