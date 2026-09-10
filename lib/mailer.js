// 邮件服务封装（基于 nodemailer）
// - 配置存表 email_settings：host/port/secure/user/pass(from_addr)
// - pass 用 AES-256-GCM 加密存盘（env: EMAIL_CONFIG_KEY，缺省即不加密）
// - sendCode/sendResetLink 统一封装 → 发后异步写 email_logs（不存验证码/token 明文）
// - 管理员测试发送：POST /api/admin/email/test

'use strict';

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const getDb = require('./db');

const ALGO = 'aes-256-gcm';

function getKey() {
  const k = process.env.EMAIL_CONFIG_KEY;
  if (k && k.length >= 16) return crypto.createHash('sha256').update(k).digest();
  return null;
}

function encryptSecret(plain) {
  const key = getKey();
  if (!key) return { cipher: '', iv: '', tag: '' };
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { cipher: enc.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64') };
}

function decryptSecret(cipher, iv, tag) {
  const key = getKey();
  if (!key || !cipher || !iv || !tag) return '';
  try {
    const c = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'base64'));
    c.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([c.update(Buffer.from(cipher, 'base64')), c.final()]).toString('utf8');
  } catch (_) { return ''; }
}

function readConfig() {
  const db = getDb();
  const row = db.prepare('SELECT host, port, secure, user, pass_cipher, pass_iv, pass_tag, from_addr, enabled FROM email_settings WHERE id = ?').get('default') || {};
  const pass = decryptSecret(row.pass_cipher, row.pass_iv, row.pass_tag);
  return {
    enabled: !!row.enabled,
    host: row.host || '',
    port: row.port || 465,
    secure: row.secure !== 0,
    user: row.user || '',
    pass,
    fromAddr: row.from_addr || ''
  };
}

function saveConfig({ host, port, secure, user, pass, fromAddr, updatedBy }) {
  const db = getDb();
  const enc = pass ? encryptSecret(pass) : { cipher: '', iv: '', tag: '' };
  db.prepare(`UPDATE email_settings SET
    host=?, port=?, secure=?, user=?, pass_cipher=?, pass_iv=?, pass_tag=?, from_addr=?, updated_by=?, updated_at=datetime('now')
    WHERE id='default'`).run(
    String(host || '').slice(0, 200),
    parseInt(port, 10) || 465,
    secure ? 1 : 0,
    String(user || '').slice(0, 200),
    enc.cipher,
    enc.iv,
    enc.tag,
    String(fromAddr || '').slice(0, 200),
    String(updatedBy || '').slice(0, 32)
  );
}

function maskConfig() {
  const c = readConfig();
  const masked = { ...c, pass: '' };
  if (c.pass) masked.passSet = true;
  return masked;
}

let cachedTransporter = null;
let cachedConfigKey = '';

function getTransporter() {
  const c = readConfig();
  if (!c.enabled || !c.host || !c.user || !c.pass) return null;
  const key = `${c.host}|${c.port}|${c.user}|${c.secure ? 1 : 0}`;
  if (cachedTransporter && key === cachedConfigKey) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: !!c.secure,
    auth: { user: c.user, pass: c.pass }
  });
  cachedConfigKey = key;
  return cachedTransporter;
}

function resetTransporter() { cachedTransporter = null; cachedConfigKey = ''; }

function logSend(userId, email, purpose, subject, ok, err) {
  try {
    const db = getDb();
    db.prepare('INSERT INTO email_logs (user_id, email, purpose, subject, ok, err) VALUES (?, ?, ?, ?, ?, ?)').run(
      String(userId || '').slice(0, 32),
      String(email || '').slice(0, 200),
      String(purpose || '').slice(0, 32),
      String(subject || '').slice(0, 200),
      ok ? 1 : 0,
      String(err || '').slice(0, 500)
    );
  } catch (_) {}
}

async function sendMail({ to, subject, html, text, userId, purpose }) {
  const t = getTransporter();
  const c = readConfig();
  if (!t || !c.fromAddr) {
    logSend(userId, to, purpose, subject, 0, 'service-disabled-or-missing-from');
    return { ok: false, error: '邮件服务未启用或未配置发件人' };
  }
  try {
    await t.sendMail({
      from: c.fromAddr,
      to,
      subject,
      text: text || subject,
      html: html || `<p>${text || subject}</p>`
    });
    logSend(userId, to, purpose, subject, 1, '');
    return { ok: true };
  } catch (e) {
    logSend(userId, to, purpose, subject, 0, e.message || String(e));
    return { ok: false, error: e.message || '邮件发送失败' };
  }
}

function makeCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashValue(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }

module.exports = { readConfig, saveConfig, maskConfig, getTransporter, resetTransporter, sendMail, logSend, makeCode, makeToken, hashValue, encryptSecret, decryptSecret };
