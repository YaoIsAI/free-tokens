// AI 辅助判定（判官 LLM）：用平台自有有效 token 对掺水检测的文本信号做语义判断。
// - 候选池 = items 表 verified + OpenAI 兼容的公开 token（社区发布免费 key）
// - 自动路由：逐候选探测健康（端点可达 + 选定模型对话返回文本），401/403/429/超时熔断 + 冷却，
//   可用判官缓存复用，全部失败或超并发立即返回 null（优雅降级到纯规则判定）
// - 安全：判官 token 仅存本模块内存；enhance() 只接收非敏感文本信号（模型名/身份/回答），
//   绝不接收也不外发任何用户 token 明文；AI 结论 JSON 由 verifyModelBattery 单向修正 warn→pass，
//   红线判定（跨家族替换/身份冲突）仍由规则兜底。
// 依赖注入：init({getDb, fetchWithTimeout, isBlockedHost, probeUrls, chatCandidates, chatText})，
// 便于测试时替换为 mock。

'use strict';

let deps = null;
let env = {};

// 候选池：key=item.id，value={id,name,url,token,models,health}
const candidatePool = new Map();
let poolLoadedAt = 0;
let judgeProbe = null;      // {ts, judge|null}  当前可用的判官缓存
let judgeProbeInFlight = null;
let activeProbes = 0;
let dedicatedHealth = { state: 'ok', fail: 0, until: 0 };

function enabled() { return env.AI_JUDGE_ENABLED !== '0' && env.DISABLE_AI_JUDGE !== '1'; }
function hasDedicated() {
  if (env.AI_JUDGE_BASE_URL && env.AI_JUDGE_TOKEN && env.AI_JUDGE_MODEL) return true;
  try {
    const db = deps && deps.getDb ? deps.getDb() : null;
    if (!db) return false;
    const row = db.prepare('SELECT base_url, token, model FROM ai_judge_config WHERE id = ?').get('default');
    return !!(row && row.base_url && row.token && row.model);
  } catch (_) { return false; }
}
function getDedicatedConfig() {
  // 优先 DB（管理员一键设置），回退 env（.env 兜底）
  try {
    const db = deps && deps.getDb ? deps.getDb() : null;
    if (db) {
      const row = db.prepare('SELECT base_url, token, model FROM ai_judge_config WHERE id = ?').get('default');
      if (row && row.base_url && row.token && row.model) {
        return { base: String(row.base_url).trim().replace(/\/+$/, ''), token: String(row.token).trim(), model: String(row.model).trim() };
      }
    }
  } catch (_) {}
  if (env.AI_JUDGE_BASE_URL && env.AI_JUDGE_TOKEN && env.AI_JUDGE_MODEL) {
    return { base: String(env.AI_JUDGE_BASE_URL).trim().replace(/\/+$/, ''), token: String(env.AI_JUDGE_TOKEN).trim(), model: String(env.AI_JUDGE_MODEL).trim() };
  }
  return null;
}

async function getActiveJudge(excludeBase) {
  if (!enabled() || !deps) return null;
  // 排除与当前检测目标同一端点的候选（防把被测端点/自身当判官，自引用污染）。
  // 注意按「归一化完整 base URL」比对，而非仅 hostname：测试环境多 mock 同挂 127.0.0.1，
  // 仅比 host 会误伤全部本地候选。
  const now = Date.now();
  if (judgeProbe && (now - judgeProbe.ts) < env.POOL_TTL_MS && judgeProbe.exclude !== normBase(excludeBase)) {
    return judgeProbe.judge;
  }
  if (judgeProbeInFlight) return judgeProbeInFlight; // 复用进行中的探测
  judgeProbeInFlight = ensureJudge(normBase(excludeBase)).finally(() => { judgeProbeInFlight = null; });
  return judgeProbeInFlight;
}

function normBase(url) { const s = String(url || '').trim().replace(/\/+$/, '').toLowerCase(); try { return new URL(s).origin + new URL(s).pathname.replace(/\/+$/, ''); } catch (_) { return s; } }

async function ensureJudge(excludeBase) {
  try {
    // 优先专用判官（管理员一键设置或 .env，不走池子）；专用已配置则不回退池子，避免“专用不可用却悄悄用池子”误导
    const dedicated = getDedicatedConfig();
    const hasDed = !!dedicated;
    if (dedicated) {
      const now = Date.now();
      const dedExcluded = normBase(dedicated.base) === excludeBase;
      if (!dedExcluded) {
        if (dedicatedHealth.state === 'dead' && now < dedicatedHealth.until) {
          // 专用冷却中：直接判不可用，不回退
          judgeProbe = { ts: Date.now(), exclude: excludeBase, judge: null };
          return null;
        }
        const dc = { id: '__dedicated__', name: 'dedicated-judge', url: dedicated.base, token: dedicated.token, models: [dedicated.model], health: dedicatedHealth };
        const judge = await probeCandidate(dc);
        if (judge) {
          dedicatedHealth = { state: 'ok', fail: 0, until: 0 };
          if (activeProbes < env.MAX_CONCURRENCY) {
            judgeProbe = { ts: Date.now(), exclude: excludeBase, judge };
            return judge;
          }
        } else {
          dedicatedHealth = dc.health;
          // 专用已配置且已尝试探活失败：显式不可用，不回退池子
          judgeProbe = { ts: Date.now(), exclude: excludeBase, judge: null };
          return null;
        }
      }
      // 专用被自引用排除（同端点）：回退池子
    }
    await loadPoolRefreshed();
    const now = Date.now();
    for (const c of candidatePool.values()) {
      if (c.health.state === 'dead' && now < c.health.until) continue; // 冷却中
      if (normBase(c.url) === excludeBase) continue; // 同端点 → 自引用，跳过
      const judge = await probeCandidate(c);
      if (judge) {
        if (activeProbes >= env.MAX_CONCURRENCY) break;
        judgeProbe = { ts: Date.now(), exclude: excludeBase, judge };
        return judge;
      }
    }
    judgeProbe = { ts: Date.now(), exclude: excludeBase, judge: null };
    return null;
  } catch (_) {
    judgeProbe = { ts: Date.now(), exclude: excludeBase, judge: null };
    return null;
  }
}

async function loadPoolRefreshed() {
  const now = Date.now();
  if (poolLoadedAt && (now - poolLoadedAt) < env.CAND_INTERVAL_MS) return;
  const db = deps.getDb();
  let rows = [];
  try {
    rows = db.prepare(
      "SELECT id, name, url, token, models FROM items WHERE verified = 1 AND trashed = 0 AND token != '' AND compat LIKE '%openai%' ORDER BY created_at DESC LIMIT 20"
    ).all();
  } catch (_) { return; }
  const seen = new Set();
  for (const r of rows) {
    seen.add(r.id);
    let models = [];
    try { models = JSON.parse(r.models || '[]'); } catch (_) {}
    if (!candidatePool.has(r.id)) {
      candidatePool.set(r.id, { id: r.id, name: r.name, url: r.url, token: r.token, models, health: { state: 'ok', fail: 0, until: 0 } });
    } else {
      candidatePool.get(r.id).models = models;
      candidatePool.get(r.id).url = r.url;
      candidatePool.get(r.id).token = r.token;
    }
  }
  if (!seen.size) { poolLoadedAt = now; return; }
  for (const id of Array.from(candidatePool.keys())) {
    if (!seen.has(id)) candidatePool.delete(id);
  }
  poolLoadedAt = now;
}

// 探测单个候选：端点可达 + 选定判官模型对话返回真实文本 → 该候选健康可用
async function probeCandidate(c) {
  const base = String(c.url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) { mark(c, 'dead', 600000); return null; }
  let hostname;
  try { hostname = new URL(base).hostname; } catch (_) { mark(c, 'dead', 600000); return null; }
  const guard = await deps.isBlockedHost(hostname);
  if (guard.blocked) { mark(c, 'dead', 600000); return null; }

  const model = pickModel(c.models);
  if (!model) { mark(c, 'dead', 120000); return null; } // 无可用模型，短冷却

  const headers = { 'Authorization': 'Bearer ' + c.token, 'Content-Type': 'application/json' };
  const probePayload = {
    model,
    messages: [{ role: 'user', content: buildPrompt({ model: 'probe', echo: 'probe-llm', identity: '', knowledge: [], excludeHost: null }) }],
    max_tokens: 800
  };
  for (const u of deps.chatCandidates(base, false)) {
    try {
      // 健康校验必须是「能完成判官协议」才算可用：发一次 AI_VERDICT 请求且能解析出 verdict，
      // 过滤掉只能回普通文本、不能做结构化判定的候选（避免拿到一个"回显OK但判不了"的端点当判官）
      const resp = await deps.fetchWithTimeout(u, {
        method: 'POST', headers, body: JSON.stringify(probePayload),
        timeout: env.TIMEOUT_MS, redirect: 'manual', pinnedIp: guard.ip
      });
      if (resp.status === 404) continue; // 空路径，试下一候选
      if (resp.status === 401 || resp.status === 403) { mark(c, 'dead', 600000); return null; }
      if (resp.status === 429) { mark(c, 'warm', 60000); return null; } // 限流：短冷却后再试
      if (!resp.ok) { c.health = fail(c); continue; }
      let body = null; try { body = await resp.json(); } catch (_) {}
      const text = deps.chatText(body, false);
      if (parseVerdict(text)) {
        c.health = { state: 'ok', fail: 0, until: 0 };
        return { id: c.id, name: c.name, base, token: c.token, model, chatUrl: u };
      }
      c.health = fail(c); // 回文本但无法结构化判定 → 不算判官
    } catch (_) { c.health = fail(c); }
  }
  return null;
}

function pickModel(models) {
  const arr = Array.isArray(models) ? models.map(String).filter(Boolean) : [];
  // 管理员指定优先级：命中 stored models 直接用它；未列出也尝试第一个（公认好模型）
  if (env.MODEL_PRIORITY.length) {
    for (const p of env.MODEL_PRIORITY) {
      if (arr.some(m => m.toLowerCase() === p.toLowerCase())) return p;
    }
    return env.MODEL_PRIORITY[0];
  }
  const nonReasoning = arr.filter(m => !/reasoner|r1[-_]|thinking|o1|o3|o4/i.test(m));
  return nonReasoning[0] || arr[0] || null;
}

function mark(c, state, ms) { c.health = { state, fail: state === 'ok' ? 0 : Math.max(c.health.fail || 0, 1), until: Date.now() + ms }; }
function fail(c) {
  const f = (c.health.fail || 0) + 1;
  if (f >= 3) return { state: 'dead', fail: f, until: Date.now() + 300000 }; // 连续 3 次失败冷却 5min
  return { state: 'warm', fail: f, until: 0 };
}

// 组装判官 prompt：只含非敏感文本信号，绝无 token
function buildPrompt(signals) {
  const k = (signals.knowledge || []).map(i => '- 题目「' + i.q + '」，期望「' + i.expect + '」，模型回答「' + i.answer + '」').join('\n');
  return [
    '你是模型身份与回答质量的独立评审。对一次大模型调用的信号做判断，只输出一个 JSON 对象，不要输出任何其他文字、注释或 Markdown 代码块：',
    '{',
    '  "echoSame": <bool>,        // 请求模型名与响应回显模型名是否指向同一模型；容忍前缀/后缀/大小写/小版本差异（如 "x/gpt-4o" 与 "gpt-4o"、"deepseek-chat-v1" 与 "deepseek-chat" 视为同一）',
    '  "identityConflict": <bool>, // 模型的自述身份是否与实际请求模型跨家族冲突（委婉拒绝回答、同家族或未明确回答不算冲突）',
    '  "knowledgeCorrect": <bool>, // 知识题回答是否实质正确（容忍"北京市"对"北京"等表述差异，明显答错才算错误）',
    '  "conclusion": "<一句话中文结论，说明是否疑似掺水及依据>"',
    '}',
    '信号：',
    '- 请求模型: ' + signals.model,
    '- 响应回显模型: ' + (signals.echo || '(未回显)'),
    '- 模型自述身份: ' + (signals.identity || '(未回答)'),
    '- 知识题:' + (k || '(无)'),
    'AI_VERDICT'
  ].join('\n');
}

// 解析判官 JSON：优先整段 JSON.parse，失败则正则抓字段保底
function parseVerdict(raw) {
  const txt = String(raw || '').trim();
  let obj = null;
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) { try { obj = JSON.parse(m[0]); } catch (_) {} }
  if (!obj) {
    obj = {};
    const bool = (pat, key) => { const mm = txt.match(pat); if (mm) obj[key] = /true/i.test(mm[1]); };
    bool(/"echoSame"\s*:\s*(true|false)/i, 'echoSame');
    bool(/"identityConflict"\s*:\s*(true|false)/i, 'identityConflict');
    bool(/"knowledgeCorrect"\s*:\s*(true|false)/i, 'knowledgeCorrect');
    const cm = txt.match(/"conclusion"\s*:\s*"([^"]*)"|"conclusion"\s*:\s*\'([^\']*)\'/i);
    if (cm) obj.conclusion = (cm[1] || cm[2] || '').trim();
  }
  if (obj && (obj.echoSame !== undefined || obj.identityConflict !== undefined || obj.knowledgeCorrect !== undefined)) {
    return obj;
  }
  return null;
}

// 核心：对信号做 AI 增强判断。返回 {available, verdict?, reason?}
async function enhance(signals) {
  if (!enabled() || !deps) return { available: false, reason: 'disabled' };
  const excludeBase = signals.excludeBase || null;
  const judge = await getActiveJudge(excludeBase);
  if (!judge) return { available: false, reason: 'judge-unavailable' };
  if (activeProbes >= env.MAX_CONCURRENCY) return { available: false, reason: 'busy' };
  activeProbes++;
  try {
    const payload = { model: judge.model, messages: [{ role: 'user', content: buildPrompt(signals) }], max_tokens: 800 };
    const resp = await deps.fetchWithTimeout(judge.chatUrl, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + judge.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), timeout: env.TIMEOUT_MS, redirect: 'manual'
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) return { available: false, reason: 'judge-auth' };
      if (resp.status === 429) return { available: false, reason: 'judge-ratelimit' };
      return { available: false, reason: 'judge-http-' + resp.status };
    }
    let body = null; try { body = await resp.json(); } catch (_) {}
    const text = deps.chatText(body, false);
    const verdict = parseVerdict(text);
    return verdict ? { available: true, verdict } : { available: false, reason: 'parse-fail' };
  } catch (_) {
    return { available: false, reason: 'judge-error' };
  } finally {
    activeProbes--;
  }
}

function init(depsIn, envIn) {
  deps = depsIn;
  env = Object.assign({}, {
    AI_JUDGE_ENABLED: '1',
    POOL_TTL_MS: 10 * 60 * 1000,       // 可用判官缓存/重探
    CAND_INTERVAL_MS: 60 * 1000,       // 候选池重查
    TIMEOUT_MS: 12000,
    MAX_CONCURRENCY: 2,
    MODEL_PRIORITY: [],
    AI_JUDGE_BASE_URL: '',
    AI_JUDGE_TOKEN: '',
    AI_JUDGE_MODEL: ''
  }, envIn || {});
  env.MODEL_PRIORITY = String(env.MODEL_PRIORITY || '').split(',').map(s => s.trim()).filter(Boolean);
  env.AI_JUDGE_BASE_URL = String(env.AI_JUDGE_BASE_URL || '').trim().replace(/\/+$/, '');
  env.AI_JUDGE_TOKEN = String(env.AI_JUDGE_TOKEN || '').trim();
  env.AI_JUDGE_MODEL = String(env.AI_JUDGE_MODEL || '').trim();
  // 池定期刷新（unref 不阻塞进程退出）
  if (typeof setInterval === 'function') {
    const t = setInterval(() => { if (enabled()) loadPoolRefreshed().catch(() => {}); }, env.CAND_INTERVAL_MS);
    if (t && typeof t.unref === 'function') t.unref();
  }
  return module.exports;
}

function getStatus() {
  const list = [];
  for (const c of candidatePool.values()) list.push({ id: c.id, name: c.name, health: c.health });
  const d = getDedicatedConfig();
  return {
    enabled: enabled(),
    poolSize: list.length,
    candidates: list.slice(0, 5),
    judgeProbe: judgeProbe ? { ageMs: judgeProbe.ts ? Date.now() - judgeProbe.ts : null, ok: !!judgeProbe.judge, id: judgeProbe.judge ? judgeProbe.judge.id : null } : null,
    dedicated: d ? { base: d.base, model: d.model, health: dedicatedHealth } : null
  };
}
function setDedicatedConfig(base, token, model, updatedBy) {
  const db = deps && deps.getDb ? deps.getDb() : null;
  if (!db) throw new Error('DB 未就绪');
  const now = new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO ai_judge_config (id, base_url, token, model, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('default', String(base).trim(), String(token).trim(), String(model).trim(), updatedBy || null, now);
  dedicatedHealth = { state: 'ok', fail: 0, until: 0 };
  judgeProbe = null;
  judgeProbeInFlight = null;
}
function clearDedicatedConfig() {
  try {
    const db = deps && deps.getDb ? deps.getDb() : null;
    if (db) db.prepare('DELETE FROM ai_judge_config WHERE id = ?').run('default');
  } catch (_) {}
  dedicatedHealth = { state: 'ok', fail: 0, until: 0 };
  judgeProbe = null;
  judgeProbeInFlight = null;
}

module.exports = { init, getActiveJudge, enhance, getStatus, setDedicatedConfig, clearDedicatedConfig, _reset: () => { candidatePool.clear(); poolLoadedAt = 0; judgeProbe = null; judgeProbeInFlight = null; activeProbes = 0; dedicatedHealth = { state: 'ok', fail: 0, until: 0 }; } };