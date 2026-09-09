// 动态 OG 分享卡片生成器（1200×630 PNG）。
// 优先用 @napi-rs/canvas（预编译原生模块）渲染带标题的品牌卡片；
// 若该模块不可用，回退到纯 JS 渐变图（无文字，仅品牌底色），保证服务永不因此崩溃。

const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const QRCode = require('qrcode');

const W = 1200, H = 630;
const PW = 600, PH = 800; // 通用二维码海报（紧凑 3:4）
const PW_ITEM = 1080, PH_ITEM = 1440; // Token 传播卡（3:4 高清，小红书/微信最佳，1080 宽铺满竖屏）
const FONT_PATH = path.join(__dirname, '..', 'public', 'fonts', 'NotoSansCJKsc-Regular.otf');
const FONT_NAME = 'NotoSansCJKsc';

// 尝试加载 @napi-rs/canvas（有预编译二进制，加载失败不影响站点）
let canvas = null;
try { canvas = require('@napi-rs/canvas'); } catch (_) { canvas = null; }
let fontReady = false;
if (canvas) {
  try {
    canvas.GlobalFonts.registerFromPath(FONT_PATH, FONT_NAME);
    fontReady = true;
  } catch (_) { fontReady = false; }
}

// ---------- 纯 JS 回退：品牌渐变（复用 scripts/gen-og-image.js 算法） ----------
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function fallbackGradient() {
  const c1 = [91, 110, 247], c2 = [155, 92, 246];
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const rowStart = y * (1 + W * 3);
    raw[rowStart] = 0;
    const t = y / (H - 1);
    const r = c1[0] + (c2[0] - c1[0]) * t;
    const g = c1[1] + (c2[1] - c1[1]) * t;
    const b = c1[2] + (c2[2] - c1[2]) * t;
    for (let x = 0; x < W; x++) {
      const nx = x / W, ny = y / H;
      const d1 = Math.hypot(nx - 0.25, ny - 0.32) / 0.45;
      const d2 = Math.hypot(nx - 0.82, ny - 0.72) / 0.5;
      const a1 = Math.max(0, 1 - d1) * 0.10;
      const a2 = Math.max(0, 1 - d2) * 0.16;
      const off = rowStart + 1 + x * 3;
      raw[off] = Math.min(255, Math.round(r + a1 * 255 + a2 * 255));
      raw[off + 1] = Math.min(255, Math.round(g + a1 * 255 + a2 * 220));
      raw[off + 2] = Math.min(255, Math.round(b + a1 * 255 + a2 * 255));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- @napi-rs/canvas 品牌卡片 ----------
function wrapLines(ctx, text, maxWidth, maxLines) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chars = Array.from(clean);
  const lines = [];
  let cur = '';
  for (const ch of chars) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
      if (lines.length === maxLines - 1) break;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) lines.length = maxLines;
  // 最后一行超宽时截断加省略号
  if (lines.length && ctx.measureText(lines[lines.length - 1]).width > maxWidth) {
    let t = lines[lines.length - 1];
    while (t.length && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    lines[lines.length - 1] = t + '…';
  }
  return lines;
}

function renderCardCanvas(title, sub, kind) {
  const { createCanvas } = canvas;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');

  // 背景渐变
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#5b6ef7');
  g.addColorStop(0.55, '#7c5cf6');
  g.addColorStop(1, '#9b5cf6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 柔光光斑（与首页 hero 同风格的极光感）
  const blobs = [
    { x: 0.16, y: 0.2, r: 420, col: 'rgba(255,255,255,0.16)' },
    { x: 0.88, y: 0.75, r: 460, col: 'rgba(255,255,255,0.14)' },
    { x: 0.72, y: 0.08, r: 300, col: 'rgba(255,255,255,0.10)' }
  ];
  for (const b of blobs) {
    const rad = ctx.createRadialGradient(W * b.x, H * b.y, 0, W * b.x, H * b.y, b.r);
    rad.addColorStop(0, b.col);
    rad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, W, H);
  }

  const white = 'rgba(255,255,255,0.97)';
  const muted = 'rgba(255,255,255,0.78)';

  // 顶部品牌行：logo 点 + 名称
  ctx.font = '600 30px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = white;
  const brand = 'free-tokens · Token公益站';
  ctx.fillText(brand, 60, 72);

  // 顶部右侧类型徽章
  if (kind) {
    ctx.font = '600 26px ' + FONT_NAME + ', sans-serif';
    const bw = ctx.measureText(kind).width + 56;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.arc(W - 60 - bw, 54, 27, 0, Math.PI * 2);
    ctx.arc(W - 60, 54, 27, 0, Math.PI * 2);
    ctx.rect(W - 60 - bw, 27, bw, 54);
    ctx.fill();
    ctx.fillStyle = white;
    ctx.fillText(kind, W - 60 - bw / 2 - ctx.measureText(kind).width / 2, 66);
  }

  // 主体标题：居左，最多两行，换行
  ctx.font = '700 66px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = white;
  const titleLines = wrapLines(ctx, title, 1040, 2);
  let ty = 220;
  for (const line of titleLines) {
    ctx.fillText(line, 60, ty);
    ty += 84;
  }

  // 副标题（描述/分类）
  if (sub) {
    ctx.font = '400 30px ' + FONT_NAME + ', sans-serif';
    ctx.fillStyle = muted;
    const subLines = wrapLines(ctx, sub, 1000, 2);
    let sy = Math.min(ty + 10, 430);
    for (const line of subLines.slice(0, 1)) {
      ctx.fillText(line, 60, sy);
      sy += 44;
    }
  }

  // 底部：一条渐变强调线 + tagline
  const accent = ctx.createLinearGradient(60, 0, W - 60, 0);
  accent.addColorStop(0, 'rgba(255,255,255,0.9)');
  accent.addColorStop(1, 'rgba(255,255,255,0.1)');
  ctx.fillStyle = accent;
  ctx.fillRect(60, H - 86, W - 120, 3);
  ctx.font = '500 24px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = muted;
  ctx.fillText('免费大模型 Token 聚合导航 · 人人可发布 · 永久免费', 60, H - 40);

  return c.toBuffer('image/jpeg', { quality: 0.85 });
}

// ---------- 二维码分享海报（720×1040：品牌渐变 + 内容标题 + 二维码） ----------
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderPosterCanvas(url, title, kind) {
  const { createCanvas } = canvas;
  const c = createCanvas(PW, PH);
  const ctx = c.getContext('2d');

  // 低饱和流光背景（与首页 banner hero aurora 同款浅色）
  const g = ctx.createLinearGradient(0, 0, PW, PH);
  g.addColorStop(0, '#eef2ff');   // 淡靛蓝
  g.addColorStop(0.45, '#f5f0ff'); // 淡紫
  g.addColorStop(0.8, '#ecf7ff');  // 淡天蓝
  g.addColorStop(1, '#fdf6ec');    // 淡杏
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PW, PH);

  // 柔光光斑（低饱和，取自 hero aurora 四色）
  const blobs = [
    { x: 0.18, y: 0.22, r: 300, col: 'rgba(147,160,252,0.20)' },
    { x: 0.85, y: 0.2, r: 320, col: 'rgba(196,181,253,0.18)' },
    { x: 0.6, y: 0.9, r: 340, col: 'rgba(125,211,252,0.16)' },
    { x: 0.22, y: 0.95, r: 280, col: 'rgba(253,186,116,0.13)' }
  ];
  for (const b of blobs) {
    const rad = ctx.createRadialGradient(PW * b.x, PH * b.y, 0, PW * b.x, PH * b.y, b.r);
    rad.addColorStop(0, b.col);
    rad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, PW, PH);
  }

  const ink = '#3f4cc0';   // 深靛蓝（主文字）
  const muted = '#64748b'; // 灰蓝（次要文字）
  const cx = PW / 2;

  // 品牌行：logo 圆点 + 名称（整体居中）
  ctx.font = '600 28px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = ink;
  const brand = 'free-tokens · Token公益站';
  const bw = ctx.measureText(brand).width;
  const gs = cx - (bw + 26) / 2; // 6px 圆点 + 20px 间距 + 文本
  ctx.beginPath();
  ctx.arc(gs + 8, 44, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillText(brand, gs + 22, 56);

  // 口号（柔和品牌渐变文字）
  const sloganGrad = ctx.createLinearGradient(0, 0, PW, 0);
  sloganGrad.addColorStop(0, '#4a5de0');
  sloganGrad.addColorStop(1, '#8b6cf0');
  ctx.font = '700 64px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = sloganGrad;
  const slogan = 'Token 就是力量！';
  ctx.fillText(slogan, cx - ctx.measureText(slogan).width / 2, 164);

  // 副标语
  ctx.font = '400 24px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = muted;
  const sub = '免费大模型 Token 聚合导航 · 永久免费';
  ctx.fillText(sub, cx - ctx.measureText(sub).width / 2, 220);

  // 内容标题胶囊（无标题时显示站点标语）
  let pill = String(title || '').replace(/\s+/g, ' ').trim();
  if (!pill) pill = '人人可发布 · 永久免费';
  const chars = Array.from(pill);
  if (chars.length > 16) pill = chars.slice(0, 16).join('') + '…';
  ctx.font = '500 26px ' + FONT_NAME + ', sans-serif';
  const tw = ctx.measureText(pill).width;
  const ph2 = 52, pw2 = tw + 60;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  roundRectPath(ctx, cx - pw2 / 2, 256, pw2, ph2, ph2 / 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(63,76,192,0.16)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, cx - pw2 / 2, 256, pw2, ph2, ph2 / 2);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.fillText(pill, cx - tw / 2, 256 + 35);

  // 白色圆角二维码块（带极浅描边）
  const blockSize = 244;
  const bx = (PW - blockSize) / 2;
  const by = 366;
  ctx.fillStyle = '#ffffff';
  roundRectPath(ctx, bx, by, blockSize, blockSize, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,163,184,0.30)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, bx, by, blockSize, blockSize, 24);
  ctx.stroke();

  // 二维码（qrcode 生成模块矩阵，手动填充成像素）
  try {
    const qr = QRCode.create(url || 'https://free-tokens.org', { errorCorrectionLevel: 'M', margin: 2 });
    const size = qr.modules.size;
    const marginCells = 2;
    const cell = blockSize / (size + marginCells * 2);
    const ox = bx + marginCells * cell;
    const oy = by + marginCells * cell;
    const data = qr.modules.data;
    ctx.fillStyle = '#334155';
    for (let r = 0; r < size; r++) {
      for (let cc = 0; cc < size; cc++) {
        if (data[r * size + cc] & 1) ctx.fillRect(ox + cc * cell, oy + r * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
  } catch (_) {}

  // 说明 + 网址
  ctx.font = '500 24px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = ink;
  const caption = '微信扫码 · 立即打开';
  ctx.fillText(caption, cx - ctx.measureText(caption).width / 2, 654);

  // 底部醒目展示网站域名
  ctx.font = '600 26px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = ink;
  let domain = 'free-tokens.org';
  try { domain = new URL(url || 'https://free-tokens.org').host; } catch (_) {}
  ctx.fillText(domain, cx - ctx.measureText(domain).width / 2, 700);

  // 底部强调线（低饱和靛蓝渐变）
  const accent = ctx.createLinearGradient(cx - 170, 0, cx + 170, 0);
  accent.addColorStop(0, 'rgba(63,76,192,0.50)');
  accent.addColorStop(1, 'rgba(139,108,240,0.06)');
  ctx.fillStyle = accent;
  ctx.fillRect(cx - 170, PH - 32, 340, 3);

  return c.toBuffer('image/jpeg', { quality: 0.85 });
}

// ---------- Token 传播卡（小红书/微信最佳 3:4 高清 1080×1440，简单粗暴大字报） ----------
function renderItemPosterCanvas(item, url) {
  const W2 = PW_ITEM, H2 = PH_ITEM;
  const { createCanvas } = canvas;
  const c = createCanvas(W2, H2);
  const ctx = c.getContext('2d');

  // 高级纸感背景：低饱和流光 + 细腻噪点感
  const g = ctx.createLinearGradient(0, 0, W2, H2);
  g.addColorStop(0, '#eef2ff');
  g.addColorStop(0.38, '#f5f0ff');
  g.addColorStop(0.72, '#ecf7ff');
  g.addColorStop(1, '#fdf6ec');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W2, H2);
  const blobs = [
    { x: 0.18, y: 0.20, r: 540, col: 'rgba(147,160,252,0.18)' },
    { x: 0.88, y: 0.18, r: 560, col: 'rgba(196,181,253,0.16)' },
    { x: 0.62, y: 0.92, r: 600, col: 'rgba(125,211,252,0.14)' },
    { x: 0.20, y: 0.88, r: 480, col: 'rgba(253,186,116,0.10)' }
  ];
  for (const b of blobs) {
    const rad = ctx.createRadialGradient(W2 * b.x, H2 * b.y, 0, W2 * b.x, H2 * b.y, b.r);
    rad.addColorStop(0, b.col);
    rad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, W2, H2);
  }

  const itemName = String((item && item.name) || '免费 Token').trim() || '免费 Token';
  const provider = String((item && item.provider) || '').trim();
  const category = String((item && item.category) || 'Token').trim();
  let models = [];
  try {
    const raw = item && item.models;
    if (Array.isArray(raw)) models = raw.map(String).filter(Boolean);
    else if (typeof raw === 'string') models = JSON.parse(raw || '[]');
  } catch (_) { models = []; }
  models = models.filter(Boolean);
  let compat = [];
  try {
    const raw = item && item.compat;
    if (Array.isArray(raw)) compat = raw.map(String);
    else if (typeof raw === 'string') compat = JSON.parse(raw || '[]');
  } catch (_) { compat = []; }

  const ink = '#0f172a';
  const faint = '#64748b';
  const inkMid = '#334155';
  const cx = W2 / 2;

  // 顶部品牌条（居中，留呼吸感）
  ctx.font = '600 26px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = '#3f4cc0';
  const brand = 'free-tokens · Token公益站';
  ctx.fillText(brand, cx - ctx.measureText(brand).width / 2, 72);
  // 品牌下细线
  ctx.fillStyle = 'rgba(99,102,241,0.18)';
  ctx.fillRect(cx - 140, 88, 280, 2);

  // ---- 预计算：卡片高度自适应内容（解决单模型时白卡大面积留白的“怪”感） ----
  const innerX_tmp = 96; // 48+48
  const innerW_tmp = W2 - 192; // 984-96
  // 标题行数
  // 临时设字体以量宽度
  let _titleLines;
  {
    const _c = createCanvas(10, 10).getContext('2d');
    _c.font = '800 52px ' + FONT_NAME + ', sans-serif';
    _titleLines = wrapLines(_c, String((item && item.name) || '免费 Token'), innerW_tmp, 2);
  }
  const titleRows = Math.max(1, _titleLines.length);
  const descRawTmp = String((item && item.desc) || '').replace(/\s+/g, ' ').trim();
  let descRows = 0;
  if (descRawTmp) {
    const _c2 = createCanvas(10, 10).getContext('2d');
    _c2.font = '500 22px ' + FONT_NAME + ', sans-serif';
    const dl = wrapLines(_c2, descRawTmp, innerW_tmp, 1);
    if (dl[0]) descRows = 1;
  }
  // 芯片行数预估
  let chipRows = 0;
  if (models.length) {
    const chipGap = 16, chipPadX = 22;
    const MAX_SHOW = Math.min(models.length, 8);
    const displayTmp = models.slice(0, MAX_SHOW);
    if (models.length > MAX_SHOW) displayTmp.push('+' + (models.length - MAX_SHOW));
    const _c3 = createCanvas(10, 10).getContext('2d');
    _c3.font = '700 22px ' + FONT_NAME + ', sans-serif';
    let cxT = 0, rowT = 0;
    let maxRowsT = 2; // 单模型/少模型时最多2行足够，视觉更紧凑
    if (models.length > 4) maxRowsT = 3;
    for (let i = 0; i < displayTmp.length; i++) {
      let nm = String(displayTmp[i]);
      if (nm.length > 20) nm = nm.slice(0, 20) + '…';
      let tw = _c3.measureText(nm).width;
      let cw = tw + chipPadX * 2;
      if (cw > innerW_tmp) cw = innerW_tmp;
      if (cxT + cw > innerW_tmp) {
        rowT++;
        if (rowT >= maxRowsT) { chipRows = maxRowsT; break; }
        cxT = 0;
        cxT = cw + chipGap;
      } else cxT += cw + chipGap;
    }
    if (chipRows === 0) chipRows = Math.min(maxRowsT, rowT + 1);
    if (models.length === 1) chipRows = 1;
  } else chipRows = 0;

  const baseH = 36 + 42 + 24; // 顶部 pill 到标题起始
  const titleH = titleRows * 68;
  const descH = descRows ? 38 : 0;
  const divH = 1.8 + 42 + 28; // 分割线+label到芯片起点
  const chipsH = models.length ? (chipRows * 52 + (chipRows - 1) * 16) : 40;
  const cardPadBottom = 54;
  let cardH = baseH + titleH + descH + divH + chipsH + cardPadBottom;
  // 限制高度区间：少模型卡更紧凑，多模型卡也不过高
  cardH = Math.max(360, Math.min(720, cardH));
  const cardX = 48, cardW = W2 - 96, cardY = 118;
  // 阴影
  ctx.fillStyle = 'rgba(15,23,42,0.08)';
  roundRectPath(ctx, cardX + 6, cardY + 10, cardW, cardH, 36);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 36);
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,163,184,0.18)';
  ctx.lineWidth = 1.4;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 36);
  ctx.stroke();

  const innerX = cardX + 48;
  const innerW = cardW - 96;

  // 顶部细渐变装饰线（卡内顶部）
  const topLine = ctx.createLinearGradient(innerX, 0, innerX + innerW, 0);
  topLine.addColorStop(0, 'rgba(79,70,229,0)');
  topLine.addColorStop(0.2, 'rgba(79,70,229,0.22)');
  topLine.addColorStop(0.8, 'rgba(124,92,246,0.16)');
  topLine.addColorStop(1, 'rgba(79,70,229,0)');
  ctx.fillStyle = topLine;
  ctx.fillRect(innerX, cardY + 12, innerW, 1.2);

  // 分类 + 右侧兼容/提供方（顶部一行，清晰标签）
  const catText = category || 'Token';
  ctx.font = '700 22px ' + FONT_NAME + ', sans-serif';
  const catPadX = 18;
  const catW = ctx.measureText(catText).width + catPadX * 2;
  const catH = 42;
  const catY = cardY + 36;
  ctx.fillStyle = '#eef2ff';
  roundRectPath(ctx, innerX, catY, catW, catH, catH / 2);
  ctx.fill();
  ctx.fillStyle = '#4f46e5';
  ctx.fillText(catText, innerX + catPadX, catY + 29);

  // 右上：提供方 · 兼容（小字，不抢标题）
  let compatLabel = '';
  if (compat.includes('openai') && compat.includes('anthropic')) compatLabel = '双兼容';
  else if (compat.includes('anthropic')) compatLabel = 'Anthropic';
  else if (compat.includes('openai')) compatLabel = 'OpenAI';
  const metaRight = [provider, compatLabel].filter(Boolean).join(' · ') || '免费';
  ctx.font = '600 20px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = '#94a3b8';
  const metaW = ctx.measureText(metaRight).width;
  ctx.fillText(metaRight, cardX + cardW - 48 - metaW, catY + 29);

  // 标题 — 加大加粗，传播核心（最多2行，52px）
  ctx.font = '800 52px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = ink;
  const titleLines = wrapLines(ctx, itemName, innerW, 2);
  let ty = cardY + 148;
  for (let i = 0; i < titleLines.length; i++) {
    ctx.fillText(titleLines[i], innerX, ty);
    ty += 68;
  }

  // 副描述（若有 desc，弱化展示一行，保传播清爽）
  const descRaw = String((item && item.desc) || '').replace(/\s+/g, ' ').trim();
  if (descRaw) {
    ctx.font = '500 22px ' + FONT_NAME + ', sans-serif';
    ctx.fillStyle = inkMid;
    const dLines = wrapLines(ctx, descRaw, innerW, 1);
    if (dLines[0]) {
      ctx.fillText(dLines[0], innerX, ty + 6);
      ty += 38;
    }
  }

  // 分割线（呼吸感）
  const divY = ty + 18;
  ctx.fillStyle = 'rgba(148,163,184,0.16)';
  ctx.fillRect(innerX, divY, innerW, 1.8);

  // 模型区 — 直接粗暴：大芯片，微信压缩后依然清晰
  let modelY = divY + 42;
  ctx.font = '700 20px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = faint;
  const modelCount = models.length;
  const label = modelCount ? ('可用模型  ' + modelCount + ' 个') : '可用模型';
  ctx.fillText(label, innerX, modelY);
  // 免费领取（右侧强 CTA 小徽章，靛蓝→紫渐变感用纯色近似）
  ctx.font = '800 18px ' + FONT_NAME + ', sans-serif';
  const freeTag = '免费领取  →';
  const ftPadX = 20;
  const ftW = ctx.measureText(freeTag).width + ftPadX * 2;
  const ftH = 36;
  const ftX = cardX + cardW - 48 - ftW;
  const ftY = modelY - 26;
  ctx.fillStyle = '#4f46e5';
  roundRectPath(ctx, ftX, ftY, ftW, ftH, ftH / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(freeTag, ftX + ftPadX, ftY + 24);

  if (modelCount) {
    const chipGap = 16;
    const chipH = 52;
    const chipPadX = 22;
    let cx2 = innerX;
    let cy = modelY + 28;
    const maxRows = models.length === 1 ? 1 : (models.length > 4 ? 3 : 2);
    let row = 0;
    const MAX_SHOW = 8;
    const display = [];
    for (let i = 0; i < Math.min(models.length, MAX_SHOW); i++) display.push(models[i]);
    const overflow = models.length - display.length;
    if (overflow > 0) display.push('+' + overflow);
    ctx.font = '700 22px ' + FONT_NAME + ', sans-serif';
    for (let i = 0; i < display.length; i++) {
      let name = String(display[i]);
      if (name.length > 20) name = name.slice(0, 20) + '…';
      let tw = ctx.measureText(name).width;
      let cw = tw + chipPadX * 2;
      if (cw > innerW) cw = innerW;
      while (cw > innerW - 4 && name.length > 4) { name = name.slice(0, -2) + '…'; tw = ctx.measureText(name).width; cw = tw + chipPadX * 2; }
      if (cx2 + cw > innerX + innerW) {
        row++;
        if (row >= maxRows) {
          if (!name.startsWith('+')) {
            const remain = models.length - i;
            const over = '+' + remain;
            const ow = ctx.measureText(over).width + chipPadX * 2;
            ctx.fillStyle = '#0f172a';
            roundRectPath(ctx, cx2, cy, ow, chipH, chipH / 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(over, cx2 + chipPadX, cy + 34);
          }
          break;
        }
        cx2 = innerX;
        cy += chipH + chipGap;
      }
      const isOver = name.startsWith('+');
      if (isOver) {
        ctx.fillStyle = '#0f172a';
        roundRectPath(ctx, cx2, cy, cw, chipH, chipH / 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(name, cx2 + chipPadX, cy + 34);
      } else {
        // 单模型时芯片适当加宽居左更稳重，不显得孤零
        if (models.length === 1) {
          ctx.fillStyle = '#f1f5f9';
          // 单芯片做稍大内边距
          const singleW = Math.min(innerW, cw + 16);
          roundRectPath(ctx, cx2, cy, singleW, chipH, chipH / 2);
          ctx.fill();
          ctx.strokeStyle = '#e2e8f0';
          ctx.lineWidth = 1.2;
          roundRectPath(ctx, cx2, cy, singleW, chipH, chipH / 2);
          ctx.stroke();
          ctx.fillStyle = ink;
          ctx.fillText(name, cx2 + chipPadX + 8, cy + 34);
          cx2 += singleW + chipGap;
        } else {
          ctx.fillStyle = '#f1f5f9';
          roundRectPath(ctx, cx2, cy, cw, chipH, chipH / 2);
          ctx.fill();
          ctx.strokeStyle = '#e2e8f0';
          ctx.lineWidth = 1.2;
          roundRectPath(ctx, cx2, cy, cw, chipH, chipH / 2);
          ctx.stroke();
          ctx.fillStyle = ink;
          ctx.fillText(name, cx2 + chipPadX, cy + 34);
          cx2 += cw + chipGap;
        }
      }
      if (models.length === 1) break;
    }
    // 卡底提示条（已验证 · 直接可用，传播信任感）— 贴卡底，不留大面积空白
    ctx.font = '600 18px ' + FONT_NAME + ', sans-serif';
    ctx.fillStyle = '#10b981';
    const okText = '✓ 已验证 · 可直接调用';
    ctx.fillText(okText, innerX, cardY + cardH - 28);
    ctx.fillStyle = faint;
    ctx.font = '500 18px ' + FONT_NAME + ', sans-serif';
    const subOk = '  ·  无需绑卡  ·  限时免费';
    ctx.fillText(subOk, innerX + ctx.measureText(okText).width, cardY + cardH - 28);
  } else {
    ctx.font = '600 20px ' + FONT_NAME + ', sans-serif';
    ctx.fillStyle = inkMid;
    ctx.fillText('详情页查看完整模型与调用示例', innerX, modelY + 40);
    // 无模型时也保留底条
    ctx.font = '600 18px ' + FONT_NAME + ', sans-serif';
    ctx.fillStyle = '#10b981';
    ctx.fillText('✓ 已验证', innerX, cardY + cardH - 28);
  }

  // 二维码区 — 传播焦点（大码 + 强边框 + 阴影），自适应居中于剩余空间
  const qrSize = 380;
  const qx = (W2 - qrSize) / 2;
  const captionH = 48 + 34 + 56 + 36; // cap1+cap2+domain+foot
  const remainBelow = H2 - (cardY + cardH) - qrSize - captionH;
  const gapTop = Math.max(32, Math.min(96, Math.floor(remainBelow / 2)));
  const qy = cardY + cardH + gapTop;
  // 外阴影
  ctx.fillStyle = 'rgba(15,23,42,0.10)';
  roundRectPath(ctx, qx + 8, qy + 10, qrSize, qrSize, 28);
  ctx.fill();
  // 白底
  ctx.fillStyle = '#ffffff';
  roundRectPath(ctx, qx, qy, qrSize, qrSize, 28);
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,163,184,0.22)';
  ctx.lineWidth = 1.6;
  roundRectPath(ctx, qx, qy, qrSize, qrSize, 28);
  ctx.stroke();
  // 内描边装饰（细线）
  ctx.strokeStyle = 'rgba(99,102,241,0.10)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, qx + 10, qy + 10, qrSize - 20, qrSize - 20, 18);
  ctx.stroke();
  try {
    const qr = QRCode.create(url || 'https://free-tokens.org', { errorCorrectionLevel: 'M', margin: 1 });
    const size = qr.modules.size;
    const marginCells = 2;
    const cell = qrSize / (size + marginCells * 2);
    const ox = qx + marginCells * cell;
    const oy = qy + marginCells * cell;
    const data = qr.modules.data;
    ctx.fillStyle = '#0f172a';
    for (let r = 0; r < size; r++) for (let cc = 0; cc < size; cc++) if (data[r * size + cc] & 1) ctx.fillRect(ox + cc * cell, oy + r * cell, Math.ceil(cell), Math.ceil(cell));
  } catch (_) {}

  // 扫码 CTA（大字，传播最关键一句）
  ctx.font = '800 28px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = ink;
  const cap1 = '长按 / 扫码  立即领取';
  ctx.fillText(cap1, cx - ctx.measureText(cap1).width / 2, qy + qrSize + 48);
  ctx.font = '500 20px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = faint;
  const cap2 = '微信 · 浏览器均可打开  ·  无需下载';
  ctx.fillText(cap2, cx - ctx.measureText(cap2).width / 2, qy + qrSize + 82);

  // 域名 — 加粗紫色，传播记忆点
  let domain = 'free-tokens.org';
  try { domain = new URL(url || 'https://free-tokens.org').host; } catch (_) {}
  let pathPart = '';
  try { const u = new URL(url || 'https://free-tokens.org'); if (u.pathname && u.pathname !== '/' && u.pathname.length < 28) pathPart = u.pathname; } catch (_) {}
  const domLine = pathPart ? (domain + pathPart) : domain;
  ctx.font = '800 30px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = '#4f46e5';
  let dText = domLine;
  while (dText.length > 2 && ctx.measureText(dText).width > W2 - 120) dText = dText.slice(0, -2) + '…';
  ctx.fillText(dText, cx - ctx.measureText(dText).width / 2, qy + qrSize + 138);

  // 底部口号（不抢视觉但强化品牌）
  ctx.font = '600 18px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = 'rgba(100,116,139,0.88)';
  const foot = 'Token 就是力量  ·  人人可发布  ·  永久免费';
  ctx.fillText(foot, cx - ctx.measureText(foot).width / 2, H2 - 36);
  // 底部细线装饰
  ctx.fillStyle = 'rgba(99,102,241,0.14)';
  ctx.fillRect(cx - 180, H2 - 18, 360, 2);

  return c.toBuffer('image/jpeg', { quality: 0.88 });
}

function renderItemOgCanvas(item) {
  const { createCanvas } = canvas;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#5b6ef7');
  g.addColorStop(0.55, '#7c5cf6');
  g.addColorStop(1, '#9b5cf6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const blobs = [
    { x: 0.16, y: 0.2, r: 420, col: 'rgba(255,255,255,0.16)' },
    { x: 0.88, y: 0.75, r: 460, col: 'rgba(255,255,255,0.14)' },
    { x: 0.72, y: 0.08, r: 300, col: 'rgba(255,255,255,0.10)' }
  ];
  for (const b of blobs) {
    const rad = ctx.createRadialGradient(W * b.x, H * b.y, 0, W * b.x, H * b.y, b.r);
    rad.addColorStop(0, b.col);
    rad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, W, H);
  }
  const white = 'rgba(255,255,255,0.97)';
  const muted = 'rgba(255,255,255,0.78)';
  // 品牌
  ctx.font = '600 30px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = white;
  ctx.fillText('free-tokens · Token公益站', 60, 72);
  // 分类徽章
  const cat = String((item && item.category) || 'Token');
  ctx.font = '600 22px ' + FONT_NAME + ', sans-serif';
  const bw = ctx.measureText(cat).width + 36;
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  roundRectPath(ctx, W - 60 - bw, 32, bw, 40, 20);
  ctx.fill();
  ctx.fillStyle = white;
  ctx.fillText(cat, W - 60 - bw + 18, 60);
  // 标题
  const title = String((item && item.name) || '免费 Token');
  ctx.font = '700 58px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = white;
  const lines = wrapLines(ctx, title, 1080, 2);
  let ty = 200;
  for (const line of lines) { ctx.fillText(line, 60, ty); ty += 74; }
  // 提供方/副标题
  let models = [];
  try {
    const raw = item && item.models;
    if (Array.isArray(raw)) models = raw;
    else if (typeof raw === 'string') models = JSON.parse(raw || '[]');
  } catch (_) {}
  const provider = String((item && item.provider) || '').trim();
  const sub = (provider ? provider + ' · ' : '') + (models.length ? (models.length + ' 个可用模型') : '免费大模型 Token');
  if (sub) {
    ctx.font = '400 28px ' + FONT_NAME + ', sans-serif';
    ctx.fillStyle = muted;
    ctx.fillText(sub.slice(0, 80), 60, ty + 12);
    ty += 44;
  }
  // 模型芯片（OG 横向，最多5个）
  if (models.length) {
    const gap = 12;
    let cx2 = 60;
    const chipH = 36;
    ctx.font = '600 20px ' + FONT_NAME + ', sans-serif';
    const show = models.slice(0, 5);
    const overflow = models.length - show.length;
    if (overflow > 0) show.push('+' + overflow);
    for (let i = 0; i < show.length; i++) {
      let name = String(show[i]);
      if (name.length > 16) name = name.slice(0, 16) + '…';
      const tw = ctx.measureText(name).width;
      const cw = tw + 28;
      if (cx2 + cw > W - 60) break;
      ctx.fillStyle = i === show.length - 1 && String(show[i]).startsWith('+') ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.18)';
      roundRectPath(ctx, cx2, ty + 10, cw, chipH, chipH / 2);
      ctx.fill();
      ctx.fillStyle = white;
      ctx.fillText(name, cx2 + 14, ty + 34);
      cx2 += cw + gap;
    }
  }
  // 底部线
  const accent = ctx.createLinearGradient(60, 0, W - 60, 0);
  accent.addColorStop(0, 'rgba(255,255,255,0.9)');
  accent.addColorStop(1, 'rgba(255,255,255,0.1)');
  ctx.fillStyle = accent;
  ctx.fillRect(60, H - 86, W - 120, 3);
  ctx.font = '500 24px ' + FONT_NAME + ', sans-serif';
  ctx.fillStyle = muted;
  ctx.fillText('免费大模型 Token 聚合导航 · 人人可发布 · 永久免费', 60, H - 40);
  return c.toBuffer('image/jpeg', { quality: 0.85 });
}

// 纯 JS 回退：低饱和流光背景 + 白色二维码块 + 二维码像素（无文字）
function posterFallback(url) {
  const stops = [[0, [238, 242, 255]], [0.45, [245, 240, 255]], [0.8, [236, 247, 255]], [1, [253, 246, 236]]];
  const blobs = [
    { x: 0.18, y: 0.22, r: 0.5, col: [147, 160, 252], a: 0.20 },
    { x: 0.85, y: 0.2, r: 0.53, col: [196, 181, 253], a: 0.18 },
    { x: 0.6, y: 0.9, r: 0.57, col: [125, 211, 252], a: 0.16 },
    { x: 0.22, y: 0.95, r: 0.47, col: [253, 186, 116], a: 0.13 }
  ];
  function gradAt(t) {
    for (let i = 0; i < stops.length - 1; i++) {
      if (t <= stops[i + 1][0]) {
        const t0 = stops[i][0], c0 = stops[i][1], t1 = stops[i + 1][0], c1 = stops[i + 1][1];
        const f = (t - t0) / (t1 - t0);
        return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
      }
    }
    return stops[stops.length - 1][1];
  }
  const raw = Buffer.alloc(PH * (1 + PW * 3));
  for (let y = 0; y < PH; y++) {
    const rowStart = y * (1 + PW * 3);
    raw[rowStart] = 0;
    const ny = y / (PH - 1);
    for (let x = 0; x < PW; x++) {
      const nx = x / PW;
      const base = gradAt(ny);
      let r = base[0], gg = base[1], b = base[2];
      for (const bl of blobs) {
        const d = Math.hypot(nx - bl.x, ny - bl.y) / bl.r;
        const a = Math.max(0, 1 - d) * bl.a;
        r += (bl.col[0] - r) * a;
        gg += (bl.col[1] - gg) * a;
        b += (bl.col[2] - b) * a;
      }
      const off = rowStart + 1 + x * 3;
      raw[off] = Math.min(255, Math.round(r));
      raw[off + 1] = Math.min(255, Math.round(gg));
      raw[off + 2] = Math.min(255, Math.round(b));
    }
  }
  const blockSize = 244;
  const bx = (PW - blockSize) / 2, by = 366;
  function setPx(x, y, rgb) {
    if (x < 0 || y < 0 || x >= PW || y >= PH) return;
    const off = y * (1 + PW * 3) + 1 + x * 3;
    raw[off] = rgb[0]; raw[off + 1] = rgb[1]; raw[off + 2] = rgb[2];
  }
  for (let y = by; y < by + blockSize; y++) for (let x = bx; x < bx + blockSize; x++) setPx(x, y, [255, 255, 255]);
  try {
    const qr = QRCode.create(url || 'https://free-tokens.org', { errorCorrectionLevel: 'M', margin: 2 });
    const size = qr.modules.size;
    const marginCells = 2;
    const cell = blockSize / (size + marginCells * 2);
    const ox = bx + marginCells * cell;
    const oy = by + marginCells * cell;
    const data = qr.modules.data;
    const ceil = Math.ceil(cell);
    for (let r = 0; r < size; r++) {
      for (let cc = 0; cc < size; cc++) {
        if (data[r * size + cc] & 1) {
          for (let dy = 0; dy < ceil; dy++) for (let dx = 0; dx < ceil; dx++) setPx(Math.floor(ox + cc * cell + dx), Math.floor(oy + r * cell + dy), [51, 65, 85]);
        }
      }
    }
  } catch (_) {}
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(PW, 0); ihdr.writeUInt32BE(PH, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- 对外接口（带内存缓存） ----------
const cache = new Map();
const CACHE_MAX = 500;

function render(title, sub, kind) {
  if (!canvas || !fontReady) return fallbackGradient();
  try {
    return renderCardCanvas(title || '', sub || '', kind || '');
  } catch (_) {
    return fallbackGradient();
  }
}

function ogCard(type, id, title, sub, kind) {
  const key = type + ':' + id + ':' + crypto.createHash('sha1').update((title || '') + '|' + (sub || '')).digest('hex').slice(0, 12);
  const hit = cache.get(key);
  if (hit) return hit;
  const buf = render(title, sub, kind);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, buf);
  return buf;
}

// 二维码分享海报：url 为二维码内容（页面绝对地址），title/kind 用于海报标题胶囊
function poster(url, title, kind) {
  const key = 'poster:' + crypto.createHash('sha1').update((url || '') + '|' + (title || '') + '|' + (kind || '')).digest('hex').slice(0, 12);
  const hit = cache.get(key);
  if (hit) return hit;
  let buf;
  if (!canvas || !fontReady) buf = posterFallback(url);
  else {
    try { buf = renderPosterCanvas(url || '', title || '', kind || ''); }
    catch (_) { buf = posterFallback(url); }
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, buf);
  return buf;
}

// Token 专属海报（白卡 + 模型芯片，简单粗暴）
function posterForItem(item, url) {
  // 缓存 key 含模型指纹，模型变更自动失效
  let modelHash = '';
  try {
    let m = item && item.models;
    if (typeof m === 'string') m = JSON.parse(m || '[]');
    if (Array.isArray(m)) modelHash = m.slice(0, 8).join('|');
  } catch (_) {}
  const key = 'poster:item:' + crypto.createHash('sha1').update((url || '') + '|' + String((item && item.name) || '') + '|' + String((item && item.category) || '') + '|' + modelHash).digest('hex').slice(0, 16);
  const hit = cache.get(key);
  if (hit) return hit;
  let buf;
  if (!canvas || !fontReady) buf = posterFallback(url);
  else {
    try { buf = renderItemPosterCanvas(item || {}, url || ''); }
    catch (_) { buf = posterFallback(url); }
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, buf);
  return buf;
}

function ogForItem(item) {
  let mHash = '';
  try {
    let m = item && item.models;
    if (typeof m === 'string') m = JSON.parse(m || '[]');
    if (Array.isArray(m)) mHash = m.slice(0, 6).join('|');
  } catch (_) {}
  const key = 'og:item:' + String(item && item.id || 'unknown') + ':' + crypto.createHash('sha1').update(String((item && item.name) || '') + '|' + mHash).digest('hex').slice(0, 12);
  const hit = cache.get(key);
  if (hit) return hit;
  let buf;
  if (!canvas || !fontReady) buf = fallbackGradient();
  else {
    try { buf = renderItemOgCanvas(item || {}); }
    catch (_) { buf = fallbackGradient(); }
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, buf);
  return buf;
}

module.exports = { ogCard, poster, posterForItem, ogForItem, render, renderCardCanvas, renderPosterCanvas, renderItemPosterCanvas, renderItemOgCanvas, W, H };
