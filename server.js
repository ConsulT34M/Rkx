import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captchaNeeded, verifyCaptchaToken } from './captcha.js';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const recordingDir = path.join(root, 'uploads', 'recordings');
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'rkx_app', password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'rkx_consulting', waitForConnections: true,
  connectionLimit: 10, charset: 'utf8mb4'
});
const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
const cookieName = 'rkx_session';
const recentAttempts = new Map();
const unknownLoginFailures = new Map();
const marketCache = new Map();
const captchaSiteKey = process.env.RECAPTCHA_SITE_KEY?.trim() || '';
const captchaSecretKey = process.env.RECAPTCHA_SECRET_KEY?.trim() || '';
const captchaConfigured = Boolean(captchaSiteKey && captchaSecretKey);
const route = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 190;
const publicKey = () => `RKX${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
const receiptNumber = () => `RKX-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
function approvedPartnerUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch { return false; }
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' https://www.google.com/recaptcha/; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/; base-uri 'self'; frame-ancestors 'none'");
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '64kb', verify: (req, _res, buffer) => { req.rawBody = buffer; } }));
const callbackPaths = new Set(['/identity/callback', '/partner/status-callback', '/partner/chat-callback']);
app.use('/api', (req, res, next) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && !callbackPaths.has(req.path)) {
    const sentOrigin = req.get('origin');
    if (sentOrigin && sentOrigin !== origin) return res.status(403).json({ error: '요청 출처가 올바르지 않습니다.' });
    if (!sentOrigin && req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: '요청 출처가 올바르지 않습니다.' });
  }
  next();
});
function cookies(req) {
  return Object.fromEntries((req.get('cookie') || '').split(';').map(part => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key]) => key));
}
function setCookie(res, value, maxAge) {
  res.cookie(cookieName, value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge });
}
async function currentUser(req) {
  const token = cookies(req)[cookieName];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [[user]] = await pool.execute("SELECT u.id,u.customer_key,u.name,u.email,u.phone,u.role,u.identity_status FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW() AND (u.role!='customer' OR u.identity_status='verified')", [sha256(token)]);
  return user || null;
}
const requireUser = route(async (req, res, next) => {
  req.user = await currentUser(req);
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  next();
});
const role = expected => (req, res, next) => req.user.role === expected ? next() : res.status(403).json({ error: '접근 권한이 없습니다.' });
function limited(req, res, next) {
  const key = req.ip, now = Date.now();
  const attempts = (recentAttempts.get(key) || []).filter(time => now - time < 15 * 60 * 1000);
  if (attempts.length >= 20) return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });
  attempts.push(now); recentAttempts.set(key, attempts); next();
}
function signed(req, secret) {
  const signature = req.get('x-rkx-signature') || '';
  if (!secret || !/^[a-f0-9]{64}$/.test(signature) || !req.rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
async function logAccess(req, action, targetType, targetId = null) {
  await pool.execute('INSERT INTO access_logs (actor_user_id,action,target_type,target_id,ip_address) VALUES (?,?,?,?,?)', [req.user.id, action, targetType, targetId, req.ip]);
}

// An account is created only by the signed identity callback.
app.post('/api/auth/register', limited, route(async (req, res) => {
  const name = clean(req.body.name, 80), email = clean(req.body.email, 190).toLowerCase();
  const phone = clean(req.body.phone, 30), password = req.body.password;
  if (!name || !validEmail(email) || !/^[0-9+()\-\s]{8,30}$/.test(phone) || typeof password !== 'string' || password.length < 12 || password.length > 128 ||
      req.body.termsConsent !== true || req.body.privacyConsent !== true || req.body.outsourcingConsent !== true) {
    return res.status(400).json({ error: '입력값과 필수 동의 항목을 확인해 주세요. 비밀번호는 12자 이상이어야 합니다.' });
  }
  if (!approvedPartnerUrl(process.env.IJINFO_VERIFY_URL) || !process.env.IJINFO_API_KEY || !process.env.IJINFO_CALLBACK_SECRET) {
    return res.status(503).json({ error: '본인확인 수탁사 연동 설정이 필요합니다. 회원 계정은 생성되지 않았습니다.' });
  }
  const [[existing]] = await pool.execute('SELECT id FROM users WHERE email=?', [email]);
  if (existing) return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
  const [[pending]] = await pool.execute("SELECT id FROM signup_requests WHERE email=? AND status='pending' AND expires_at>NOW() ORDER BY id DESC LIMIT 1", [email]);
  if (pending) return res.status(409).json({ error: '진행 중인 본인확인 요청이 있습니다.' });
  const passwordHash = await bcrypt.hash(password, 12);
  const [insert] = await pool.execute("INSERT INTO signup_requests (name,email,phone,password_hash,consent_version,expires_at) VALUES (?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 1 DAY))", [name, email, phone, passwordHash, 'draft-1']);
  try {
    const response = await fetch(process.env.IJINFO_VERIFY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.IJINFO_API_KEY}` },
      body: JSON.stringify({ requestId: insert.insertId, name, phone, callbackUrl: `${origin}/api/identity/callback` }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('provider');
    const data = await response.json();
    if (typeof data.verificationUrl !== 'string' || !approvedPartnerUrl(data.verificationUrl) || typeof data.reference !== 'string' || !data.reference) throw new Error('provider');
    await pool.execute('UPDATE signup_requests SET provider_reference=? WHERE id=?', [data.reference.slice(0, 190), insert.insertId]);
    res.status(202).json({ verificationUrl: data.verificationUrl, requestId: insert.insertId });
  } catch {
    await pool.execute("DELETE FROM signup_requests WHERE id=? AND status='pending'", [insert.insertId]);
    res.status(502).json({ error: '본인확인 연결에 실패했습니다. 계정은 생성되지 않았습니다.' });
  }
}));
app.post('/api/identity/callback', route(async (req, res) => {
  if (!signed(req, process.env.IJINFO_CALLBACK_SECRET)) return res.status(401).end();
  const { reference, status } = req.body;
  if (typeof reference !== 'string' || !['verified', 'rejected'].includes(status)) return res.status(400).end();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[request]] = await connection.execute('SELECT *,expires_at<=NOW() AS expired FROM signup_requests WHERE provider_reference=? FOR UPDATE', [reference]);
    if (!request) { await connection.rollback(); return res.status(404).end(); }
    if (request.status !== 'pending') { await connection.commit(); return res.json({ ok: true }); }
    if (request.expired) {
      await connection.execute("UPDATE signup_requests SET status='expired',password_hash='',completed_at=NOW() WHERE id=?", [request.id]);
      await connection.commit(); return res.status(410).end();
    }
    if (status === 'verified') {
      const [[existing]] = await connection.execute('SELECT id FROM users WHERE email=?', [request.email]);
      if (existing) { await connection.execute("UPDATE signup_requests SET status='rejected',password_hash='',completed_at=NOW() WHERE id=?", [request.id]); }
      else {
        await connection.execute("INSERT INTO users (customer_key,name,email,phone,password_hash,identity_status) VALUES (?,?,?,?,?,'verified')", [publicKey(), request.name, request.email, request.phone, request.password_hash]);
        await connection.execute("UPDATE signup_requests SET status='verified',password_hash='',completed_at=NOW() WHERE id=?", [request.id]);
      }
    } else await connection.execute("UPDATE signup_requests SET status='rejected',password_hash='',completed_at=NOW() WHERE id=?", [request.id]);
    await connection.commit(); res.json({ ok: true });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));
async function expireSignupRequests() {
  await pool.execute("UPDATE signup_requests SET status='expired',password_hash='' WHERE status='pending' AND expires_at<=NOW()");
}
setInterval(() => expireSignupRequests().catch(error => console.error('signup expiry:', error.message)), 60 * 60 * 1000).unref();
async function login(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.execute('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 7 DAY))', [sha256(token), userId]);
  setCookie(res, token, 7 * 24 * 60 * 60 * 1000);
}
function unknownFailureCount(email) {
  const key = sha256(email), record = unknownLoginFailures.get(key);
  if (!record) return 0;
  if (Date.now() - record.at < 30 * 60 * 1000) return record.count;
  unknownLoginFailures.delete(key);
  return 0;
}
function recordUnknownFailure(email) {
  if (unknownLoginFailures.size > 5000) {
    for (const [key, record] of unknownLoginFailures) {
      if (Date.now() - record.at >= 30 * 60 * 1000) unknownLoginFailures.delete(key);
    }
    if (unknownLoginFailures.size > 5000) unknownLoginFailures.delete(unknownLoginFailures.keys().next().value);
  }
  unknownLoginFailures.set(sha256(email), { count: Math.min(5, unknownFailureCount(email) + 1), at: Date.now() });
  return unknownFailureCount(email);
}
async function captchaGate(req, res, attempts) {
  if (!captchaNeeded(attempts)) return true;
  if (!captchaConfigured) {
    res.status(503).json({ error: 'CAPTCHA 설정이 필요합니다. 관리자에게 문의해 주세요.', captchaRequired: true });
    return false;
  }
  if (!req.body.captchaToken) {
    res.status(403).json({ error: '로봇 확인을 완료해 주세요.', captchaRequired: true });
    return false;
  }
  try {
    const verified = await verifyCaptchaToken({ token: req.body.captchaToken, secret: captchaSecretKey, hostname: new URL(origin).hostname });
    if (verified) return true;
    res.status(403).json({ error: '로봇 확인에 실패했습니다. 다시 시도해 주세요.', captchaRequired: true });
  } catch {
    res.status(502).json({ error: 'CAPTCHA 검증 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', captchaRequired: true });
  }
  return false;
}
app.post('/api/auth/login', limited, route(async (req, res) => {
  const email = clean(req.body.email, 190).toLowerCase(), password = req.body.password;
  if (!validEmail(email) || typeof password !== 'string') return res.status(400).json({ error: '아이디와 비밀번호를 확인해 주세요.' });
  const [[user]] = await pool.execute('SELECT id,password_hash,role,identity_status,failed_login_attempts,locked_until,locked_until>NOW() AS is_locked FROM users WHERE email=?', [email]);
  if (!user) {
    if (!await captchaGate(req, res, unknownFailureCount(email))) return;
    const attempts = recordUnknownFailure(email);
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.', captchaRequired: captchaNeeded(attempts) });
  }
  if (user.role === 'customer' && user.identity_status !== 'verified') return res.status(403).json({ error: '본인확인 완료 후 로그인할 수 있습니다.' });
  if (user.is_locked) return res.status(423).json({ error: '로그인 실패 5회로 계정이 30분 동안 잠겼습니다.' });
  if (user.locked_until) await pool.execute('UPDATE users SET failed_login_attempts=0,locked_until=NULL WHERE id=?', [user.id]);
  if (!await captchaGate(req, res, user.locked_until ? 0 : user.failed_login_attempts)) return;
  if (!await bcrypt.compare(password, user.password_hash)) {
    await pool.execute('UPDATE users SET failed_login_attempts=LEAST(failed_login_attempts+1,5),locked_until=IF(failed_login_attempts+1>=5,DATE_ADD(NOW(),INTERVAL 30 MINUTE),NULL) WHERE id=?', [user.id]);
    const [[updated]] = await pool.execute('SELECT failed_login_attempts,locked_until FROM users WHERE id=?', [user.id]);
    return res.status(updated.locked_until ? 423 : 401).json({ error: updated.locked_until ? '로그인 실패 5회로 계정이 30분 동안 잠겼습니다.' : '아이디 또는 비밀번호가 올바르지 않습니다.', captchaRequired: !updated.locked_until && captchaNeeded(updated.failed_login_attempts) });
  }
  await pool.execute('UPDATE users SET failed_login_attempts=0,locked_until=NULL WHERE id=?', [user.id]);
  await login(res, user.id);
  res.json({ user: await currentUserById(user.id) });
}));
async function currentUserById(id) {
  const [[user]] = await pool.execute('SELECT id,customer_key,name,email,phone,role,identity_status FROM users WHERE id=?', [id]);
  return user;
}
app.get('/api/auth/me', route(async (req, res) => res.json({ user: await currentUser(req) })));
app.post('/api/auth/logout', route(async (req, res) => {
  const token = cookies(req)[cookieName];
  if (token) await pool.execute('DELETE FROM sessions WHERE token_hash=?', [sha256(token)]);
  setCookie(res, '', 0); res.json({ ok: true });
}));

async function forwardToMk(url, body) {
  if (!approvedPartnerUrl(url) || !process.env.MK_WEBHOOK_SECRET) return 'not_configured';
  const payload = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', process.env.MK_WEBHOOK_SECRET).update(payload).digest('hex');
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RKX-Signature': signature }, body: payload, signal: AbortSignal.timeout(8000) });
    return response.ok ? 'sent' : 'failed';
  } catch { return 'failed'; }
}
app.get('/api/public-config', (_req, res) => {
  const phone = process.env.MK_PHONE_NUMBER || '';
  res.json({ partnerPhone: /^[0-9+\-]{8,20}$/.test(phone) ? phone : null, recaptchaSiteKey: captchaConfigured ? captchaSiteKey : null });
});
app.post('/api/tickets', requireUser, role('customer'), route(async (req, res) => {
  const type = req.body.type, subject = clean(req.body.subject, 160), description = clean(req.body.description, 3000);
  const preferredTime = clean(req.body.preferredTime, 100), recordingConsent = type === 'phone' && req.body.recordingConsent === true;
  if (!['consultation', 'reentry', 'phone'].includes(type) || subject.length < 3 || description.length < 10 || (type === 'phone' && !preferredTime)) return res.status(400).json({ error: '상담 내용을 확인해 주세요.' });
  const receipt = receiptNumber();
  const [insert] = await pool.execute('INSERT INTO tickets (receipt_number,user_id,type,subject,description,preferred_time,recording_consent) VALUES (?,?,?,?,?,?,?)', [receipt, req.user.id, type, subject, description, preferredTime || null, recordingConsent]);
  const event = { event: 'ticket.created', receiptNumber: receipt, customerKey: req.user.customer_key, name: req.user.name, type, subject, description };
  if (type === 'phone') { event.phone = req.user.phone; event.preferredTime = preferredTime; event.recordingConsent = recordingConsent; }
  const partnerStatus = await forwardToMk(process.env.MK_WEBHOOK_URL, event);
  await pool.execute('UPDATE tickets SET partner_status=? WHERE id=?', [partnerStatus, insert.insertId]);
  res.status(201).json({ receiptNumber: receipt, partnerStatus });
}));
app.get('/api/tickets', requireUser, role('customer'), route(async (req, res) => {
  const [tickets] = await pool.execute('SELECT receipt_number,type,subject,status,partner_status,assignment_kind,recording_consent,created_at FROM tickets WHERE user_id=? ORDER BY id DESC LIMIT 100', [req.user.id]);
  res.json({ tickets });
}));
app.post('/api/partner/status-callback', route(async (req, res) => {
  if (!signed(req, process.env.MK_WEBHOOK_SECRET)) return res.status(401).end();
  const receipt = clean(req.body.receiptNumber, 32), status = req.body.status, assignment = req.body.assignmentKind;
  if (!receipt || !['received','in_progress','completed'].includes(status) || (assignment != null && !['ai','counselor'].includes(assignment))) return res.status(400).end();
  const [result] = await pool.execute('UPDATE tickets SET status=?,assignment_kind=? WHERE receipt_number=?', [status, assignment || null, receipt]);
  res.status(result.affectedRows ? 200 : 404).json({ ok: !!result.affectedRows });
}));

app.get('/api/chat', requireUser, role('customer'), route(async (req, res) => {
  const [rows] = await pool.execute('SELECT id,sender,body,created_at FROM chat_messages WHERE user_id=? ORDER BY id DESC LIMIT 100', [req.user.id]);
  res.json({ messages: rows.reverse() });
}));
app.post('/api/chat', requireUser, role('customer'), route(async (req, res) => {
  const body = clean(req.body.body, 2000);
  if (!body) return res.status(400).json({ error: '메시지를 입력해 주세요.' });
  const [insert] = await pool.execute("INSERT INTO chat_messages (user_id,sender,body) VALUES (?,'customer',?)", [req.user.id, body]);
  const partnerStatus = await forwardToMk(process.env.MK_CHAT_WEBHOOK_URL, { event: 'chat.message', customerKey: req.user.customer_key, name: req.user.name, messageId: insert.insertId, body });
  await pool.execute('UPDATE chat_messages SET partner_status=? WHERE id=?', [partnerStatus, insert.insertId]);
  res.status(201).json({ partnerStatus });
}));
app.post('/api/partner/chat-callback', route(async (req, res) => {
  if (!signed(req, process.env.MK_WEBHOOK_SECRET)) return res.status(401).end();
  const key = clean(req.body.customerKey, 32), body = clean(req.body.body, 2000);
  if (!key || !body) return res.status(400).end();
  const [[user]] = await pool.execute("SELECT id FROM users WHERE customer_key=? AND role='customer'", [key]);
  if (!user) return res.status(404).end();
  await pool.execute("INSERT INTO chat_messages (user_id,sender,body,partner_status) VALUES (?,'partner',?,'sent')", [user.id, body]);
  res.json({ ok: true });
}));

// This portal simulates the entrusted counselor. Production delivery uses the signed MK callbacks above.
app.get('/api/partner/overview', requireUser, role('partner'), route(async (req, res) => {
  await logAccess(req, 'view', 'partner_tickets');
  const [tickets] = await pool.execute("SELECT t.id,t.receipt_number,t.type,t.subject,t.description,t.preferred_time,t.recording_consent,t.status,t.assignment_kind,t.created_at,u.customer_key,u.name,IF(t.type='phone',u.phone,NULL) phone FROM tickets t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 100");
  const [chats] = await pool.execute('SELECT u.id,u.customer_key,u.name,MAX(m.created_at) last_at FROM chat_messages m JOIN users u ON u.id=m.user_id GROUP BY u.id,u.customer_key,u.name ORDER BY last_at DESC LIMIT 50');
  res.json({ tickets, chats });
}));
app.patch('/api/partner/tickets/:id', requireUser, role('partner'), route(async (req, res) => {
  const status = req.body.status, assignment = req.body.assignmentKind;
  if (!['received','in_progress','completed'].includes(status) || (assignment != null && !['ai','counselor'].includes(assignment))) return res.status(400).json({ error: '상태가 올바르지 않습니다.' });
  const [result] = await pool.execute('UPDATE tickets SET status=?,assignment_kind=? WHERE id=?', [status, assignment || null, req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: '상담을 찾을 수 없습니다.' });
  res.json({ ok: true });
}));
app.get('/api/partner/chat/:userId', requireUser, role('partner'), route(async (req, res) => {
  const [messages] = await pool.execute('SELECT id,sender,body,created_at FROM chat_messages WHERE user_id=? ORDER BY id DESC LIMIT 100', [req.params.userId]);
  await logAccess(req, 'view', 'chat', String(req.params.userId));
  res.json({ messages: messages.reverse() });
}));
app.post('/api/partner/chat/:userId', requireUser, role('partner'), route(async (req, res) => {
  const body = clean(req.body.body, 2000);
  if (!body) return res.status(400).json({ error: '메시지를 입력해 주세요.' });
  const [[user]] = await pool.execute("SELECT id FROM users WHERE id=? AND role='customer'", [req.params.userId]);
  if (!user) return res.status(404).json({ error: '고객을 찾을 수 없습니다.' });
  await pool.execute("INSERT INTO chat_messages (user_id,sender,body,partner_status) VALUES (?,'partner',?,'sent')", [user.id, body]);
  res.status(201).json({ ok: true });
}));

async function purgeExpiredRecordings() {
  const [expired] = await pool.execute('SELECT id,file_name FROM recordings WHERE deleted_at IS NULL AND retention_until<=NOW() LIMIT 100');
  for (const recording of expired) {
    await fs.unlink(path.join(recordingDir, recording.file_name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const [updated] = await pool.execute('UPDATE recordings SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [recording.id]);
    if (updated.affectedRows) await pool.execute("INSERT INTO recording_events (recording_id,actor_user_id,action) VALUES (?,NULL,'deleted')", [recording.id]);
  }
}
const retentionDays = Number(process.env.RECORDING_RETENTION_DAYS || 0);
const rawAudio = express.raw({ type: ['audio/wav','audio/x-wav','audio/webm','audio/mpeg','audio/mp4'], limit: '10mb' });
app.post('/api/partner/recordings/:ticketId', requireUser, role('partner'), rawAudio, route(async (req, res) => {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) return res.status(503).json({ error: '녹취 보관기간 설정이 필요합니다.' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 100 || req.body.length > 10 * 1024 * 1024) return res.status(400).json({ error: '10MB 이하의 오디오 파일을 선택해 주세요.' });
  const [[ticket]] = await pool.execute("SELECT id FROM tickets WHERE id=? AND type='phone' AND recording_consent=TRUE", [req.params.ticketId]);
  if (!ticket) return res.status(403).json({ error: '녹취에 동의한 전화 상담만 등록할 수 있습니다.' });
  const mime = req.get('content-type').split(';')[0];
  const extension = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a' }[mime];
  if (!extension) return res.status(400).json({ error: '지원하지 않는 오디오 형식입니다.' });
  const fileName = `${crypto.randomUUID()}.${extension}`;
  await fs.mkdir(recordingDir, { recursive: true });
  await fs.writeFile(path.join(recordingDir, fileName), req.body, { flag: 'wx', mode: 0o600 });
  try {
    const [insert] = await pool.execute('INSERT INTO recordings (ticket_id,file_name,mime_type,retention_until) VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL ? DAY))', [ticket.id, fileName, mime, retentionDays]);
    await pool.execute("INSERT INTO recording_events (recording_id,actor_user_id,action) VALUES (?,?,'registered')", [insert.insertId, req.user.id]);
    res.status(201).json({ id: insert.insertId });
  } catch (error) { await fs.unlink(path.join(recordingDir, fileName)).catch(() => {}); throw error; }
}));
app.get('/api/partner/recordings/:ticketId', requireUser, role('partner'), route(async (req, res) => {
  await purgeExpiredRecordings();
  const [recordings] = await pool.execute('SELECT id,retention_until,deleted_at,created_at FROM recordings WHERE ticket_id=? ORDER BY id DESC', [req.params.ticketId]);
  const ids = recordings.map(row => row.id);
  const events = ids.length ? (await pool.query(`SELECT recording_id,action,occurred_at FROM recording_events WHERE recording_id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC`, ids))[0] : [];
  await logAccess(req, 'view', 'recording_list', String(req.params.ticketId));
  res.json({ recordings, events });
}));
app.get('/api/partner/recordings/:id/audio', requireUser, role('partner'), route(async (req, res) => {
  await purgeExpiredRecordings();
  const [[recording]] = await pool.execute('SELECT id,file_name,mime_type FROM recordings WHERE id=? AND deleted_at IS NULL AND retention_until>NOW()', [req.params.id]);
  if (!recording) return res.status(404).json({ error: '재생 가능한 녹취가 없습니다.' });
  await pool.execute("INSERT INTO recording_events (recording_id,actor_user_id,action) VALUES (?,?,'played')", [recording.id, req.user.id]);
  await logAccess(req, 'play', 'recording', String(recording.id));
  res.type(recording.mime_type); res.sendFile(path.join(recordingDir, recording.file_name));
}));
setInterval(() => purgeExpiredRecordings().catch(error => console.error('recording retention:', error.message)), 60 * 60 * 1000).unref();

function maskName(value) { return value.length <= 1 ? '*' : `${value[0]}${'*'.repeat(Math.min(value.length - 1, 3))}`; }
function maskEmail(value) { const [local, domain] = value.split('@'); return `${local.slice(0, 2)}***@${domain}`; }
function maskPhone(value) { return value.replace(/\d(?=\d{4})/g, '*'); }
app.get('/api/admin/overview', requireUser, role('admin'), route(async (req, res) => {
  await expireSignupRequests();
  const [[users]] = await pool.execute("SELECT COUNT(*) total FROM users WHERE role='customer'");
  const [[tickets]] = await pool.execute("SELECT COUNT(*) total,SUM(status='received') received FROM tickets");
  const [members] = await pool.execute("SELECT id,customer_key,name,email,phone,identity_status,created_at FROM users WHERE role='customer' ORDER BY id DESC LIMIT 100");
  const [signups] = await pool.execute('SELECT id,name,email,status,created_at,completed_at FROM signup_requests ORDER BY id DESC LIMIT 100');
  const [recent] = await pool.execute('SELECT t.receipt_number,t.type,t.status,t.partner_status,t.assignment_kind,t.created_at,u.customer_key FROM tickets t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 100');
  await logAccess(req, 'view', 'admin_overview');
  const [accessLogs] = await pool.execute('SELECT action,target_type,target_id,created_at FROM access_logs WHERE actor_user_id=? ORDER BY id DESC LIMIT 10', [req.user.id]);
  res.json({ users, tickets, members: members.map(u => ({ ...u, name: maskName(u.name), email: maskEmail(u.email), phone: maskPhone(u.phone) })), signups: signups.map(s => ({ ...s, name: maskName(s.name), email: maskEmail(s.email) })), recent, accessLogs });
}));
app.get('/api/admin/export', requireUser, role('admin'), route(async (req, res) => {
  const [rows] = await pool.execute("SELECT customer_key,name,email,phone,identity_status,created_at FROM users WHERE role='customer' ORDER BY id DESC LIMIT 1000");
  await logAccess(req, 'download', 'masked_members');
  const csvCell = value => `"${String(value ?? '').replace(/^[=+\-@]/, "'$&").replaceAll('"', '""')}"`;
  const csv = ['고객키,이름(마스킹),이메일(마스킹),연락처(마스킹),본인확인,가입일', ...rows.map(row => [row.customer_key,maskName(row.name),maskEmail(row.email),maskPhone(row.phone),row.identity_status,row.created_at].map(csvCell).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rkx-masked-members.csv"');
  res.send(`\uFEFF${csv}`);
}));

const preferredMarkets = ['KRW-BTC','KRW-ETH','KRW-XRP','KRW-SOL','KRW-USDT','KRW-DOGE','KRW-ADA','KRW-SUI','KRW-AVAX','KRW-LINK','KRW-TRX','KRW-SHIB','KRW-DOT','KRW-BCH','KRW-ETC'];
async function bithumb(pathname) {
  const response = await fetch(`https://api.bithumb.com${pathname}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`Bithumb HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Bithumb response format');
  return data;
}
async function cachedMarket(key, ttl, load) {
  const cached = marketCache.get(key);
  if (cached && Date.now() - cached.at < ttl) return cached.data;
  const data = await load();
  marketCache.set(key, { at: Date.now(), data });
  return data;
}
async function catalog() {
  return cachedMarket('catalog', 5 * 60 * 1000, () => bithumb('/v1/market/all?isDetails=false'));
}
async function validMarket(value) {
  const market = clean(value, 20) || 'KRW-BTC';
  if (!/^KRW-[A-Z0-9]{2,12}$/.test(market)) return null;
  const markets = await catalog();
  return markets.some(item => item.market === market) ? market : null;
}
function tickerRecord(ticker, labels) {
  return {
    market: ticker.market, name: labels.get(ticker.market) || ticker.market.slice(4),
    price: ticker.trade_price, changeRate: ticker.signed_change_rate,
    changePrice: ticker.signed_change_price, high: ticker.high_price, low: ticker.low_price,
    opening: ticker.opening_price, volume24h: ticker.acc_trade_price_24h,
    amount24h: ticker.acc_trade_volume_24h, timestamp: ticker.timestamp
  };
}
app.get('/api/market', route(async (_req, res) => {
  const data = await cachedMarket('ticker', 15000, async () => {
    const markets = await catalog();
    const labels = new Map(markets.map(item => [item.market, item.korean_name]));
    const codes = preferredMarkets.filter(code => labels.has(code));
    if (!codes.includes('KRW-BTC')) throw new Error('BTC market unavailable');
    const tickers = await bithumb(`/v1/ticker?markets=${codes.join(',')}`);
    return { source: 'Bithumb', at: new Date().toISOString(), tickers: tickers.map(item => tickerRecord(item, labels)).sort((a,b) => b.volume24h - a.volume24h) };
  });
  res.json(data);
}));
app.get('/api/market/detail', route(async (req, res) => {
  const market = await validMarket(req.query.market);
  if (!market) return res.status(400).json({ error: '지원하지 않는 원화 마켓입니다.' });
  const data = await cachedMarket(`detail:${market}`, 6000, async () => {
    const [ticker, orderbook, trades] = await Promise.all([
      bithumb(`/v1/ticker?markets=${market}`),
      bithumb(`/v1/orderbook?markets=${market}`),
      bithumb(`/v1/trades/ticks?market=${market}&count=25`)
    ]);
    const labels = new Map((await catalog()).map(item => [item.market, item.korean_name]));
    return {
      source: 'Bithumb', at: new Date().toISOString(), ticker: tickerRecord(ticker[0], labels),
      orderbook: { asks: orderbook[0].orderbook_units.map(unit => ({ price: unit.ask_price, size: unit.ask_size })).reverse(), bids: orderbook[0].orderbook_units.map(unit => ({ price: unit.bid_price, size: unit.bid_size })) },
      trades: trades.map(item => ({ price: item.trade_price, volume: item.trade_volume, side: item.ask_bid, timestamp: item.timestamp }))
    };
  });
  res.json(data);
}));
app.get('/api/market/chart', route(async (req, res) => {
  const market = await validMarket(req.query.market);
  if (!market) return res.status(400).json({ error: '지원하지 않는 원화 마켓입니다.' });
  const interval = clean(req.query.interval, 3) || '1d';
  const endpoints = { '1m':'/v1/candles/minutes/1', '30m':'/v1/candles/minutes/30', '1h':'/v1/candles/minutes/60', '4h':'/v1/candles/minutes/240', '1d':'/v1/candles/days', '1w':'/v1/candles/weeks', '1M':'/v1/candles/months' };
  if (!endpoints[interval]) return res.status(400).json({ error: '차트 봉 간격이 올바르지 않습니다.' });
  const data = await cachedMarket(`chart:${market}:${interval}`, interval === '1m' ? 10000 : 30000, async () => {
    const candles = await bithumb(`${endpoints[interval]}?market=${market}&count=100`);
    return { source: 'Bithumb', market, interval, at: new Date().toISOString(), candles: candles.reverse().map(item => ({
      time: item.candle_date_time_kst, open: item.opening_price, high: item.high_price,
      low: item.low_price, close: item.trade_price, volume: item.candle_acc_trade_volume,
      tradeValue: item.candle_acc_trade_price
    })) };
  });
  res.json(data);
}));
app.get('/api/health', route(async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); }));
app.use(express.static(path.join(root, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.type === 'entity.too.large' ? 413 : 500).json({ error: error.type === 'entity.too.large' ? '파일 크기가 제한을 초과했습니다.' : '서버 오류가 발생했습니다.' });
});
app.listen(Number(process.env.PORT || 3000), () => console.log(`RKX running at ${origin}`));
