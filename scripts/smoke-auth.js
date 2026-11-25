import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
const email = `rkx-smoke-${randomUUID()}@example.invalid`;
const adminEmail = `rkx-admin-smoke-${randomUUID()}@example.invalid`;
const password = 'SmokeTest!A8';
const db = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'rkx_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'rkx_consulting'
});
let cookie = '';

async function request(path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';', 1)[0];
  return { status: response.status, body: await response.json() };
}

try {
  const invalid = await request('/api/auth/register', {
    name: '테스트 회원', email, phone: '01000000000', password: 'short',
    termsConsent: true, privacyConsent: true, outsourcingConsent: true
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /비밀번호 조건/);

  const registration = await request('/api/auth/register', {
    name: '테스트 회원', email, phone: '01000000000', password,
    termsConsent: true, privacyConsent: true, outsourcingConsent: true
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.user.email, email);
  assert.equal(registration.body.user.identity_status, 'not_started');
  assert.ok(cookie.startsWith('rkx_session='));

  const [[stored]] = await db.execute('SELECT password_hash,consent_version,terms_consented_at,privacy_consented_at,outsourcing_consented_at FROM users WHERE email=?', [email]);
  assert.notEqual(stored.password_hash, password);
  assert.equal(stored.consent_version, 'draft-1');
  assert.ok(stored.terms_consented_at && stored.privacy_consented_at && stored.outsourcing_consented_at);

  assert.equal((await request('/api/auth/me')).body.user.email, email);
  const ticketRequest = {
    requestId: randomUUID(), type: 'consultation', category: 'market',
    subject: '가상 시세 문의', description: '가상 계정으로 접수 흐름을 확인하는 테스트 문의입니다.',
    recordingConsent: false
  };
  const firstTicket = await request('/api/tickets', ticketRequest);
  const repeatedTicket = await request('/api/tickets', ticketRequest);
  assert.equal(firstTicket.status, 201);
  assert.equal(repeatedTicket.status, 200);
  assert.equal(firstTicket.body.receiptNumber, repeatedTicket.body.receiptNumber);
  const [[ticketCount]] = await db.execute('SELECT COUNT(*) AS total FROM tickets WHERE client_request_id=?', [ticketRequest.requestId]);
  assert.equal(ticketCount.total, 1);
  assert.equal((await request(`/api/admin/search?kind=member&key=${registration.body.user.customer_key}`)).status, 403);
  assert.equal((await request('/api/auth/register', {
    name: '테스트 회원', email, phone: '01000000000', password,
    termsConsent: true, privacyConsent: true, outsourcingConsent: true
  })).status, 409);

  assert.equal((await request('/api/auth/logout', {})).status, 200);
  assert.equal((await request('/api/auth/me')).body.user, null);
  assert.equal((await request('/api/auth/login', { email, password })).status, 200);
  const token = cookie.split('=', 2)[1];
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await db.execute('UPDATE sessions SET expires_at=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE token_hash=?', [tokenHash]);
  assert.equal((await request('/api/auth/me')).body.user, null);
  assert.equal((await request('/api/auth/logout', {})).status, 200);

  assert.equal((await request('/api/auth/login', { email, password })).status, 200);
  assert.equal((await request('/api/auth/logout', {})).status, 200);

  const wrong1 = await request('/api/auth/login', { email, password: 'Incorrect!A8' });
  const wrong2 = await request('/api/auth/login', { email, password: 'Incorrect!A8' });
  assert.equal(wrong1.status, 401);
  assert.equal(wrong1.body.captchaRequired, false);
  assert.equal(wrong2.status, 401);
  assert.equal(wrong2.body.captchaRequired, true);
  const challenge = await request('/api/captcha');
  assert.equal(challenge.status, 200);
  assert.match(challenge.body.img, /^data:image\/jpeg;base64,/);
  const wrongCaptcha = await request('/api/auth/login', {
    email, password, captchaId: challenge.body.id, captchaAnswer: '0000000000000000'
  });
  assert.equal(wrongCaptcha.status, 403);
  assert.equal(wrongCaptcha.body.captchaRequired, true);
  const [[failureState]] = await db.execute('SELECT failed_login_attempts FROM users WHERE email=?', [email]);
  assert.equal(failureState.failed_login_attempts, 2);
  const [legacyLockColumn] = await db.query("SHOW COLUMNS FROM users LIKE 'locked_until'");
  if (legacyLockColumn.length) {
    await db.execute('UPDATE users SET locked_until=DATE_ADD(NOW(), INTERVAL 30 MINUTE) WHERE email=?', [email]);
    const legacyLockedRetry = await request('/api/auth/login', { email, password });
    assert.equal(legacyLockedRetry.status, 403);
    assert.equal(legacyLockedRetry.body.captchaRequired, true);
  }
  await db.execute("INSERT INTO users (name,email,phone,password_hash,role,identity_status) VALUES (?,?,?,?, 'admin','verified')", ['테스트 관리자', adminEmail, '01000000000', await bcrypt.hash(password, 12)]);
  assert.equal((await request('/api/auth/login', { email: adminEmail, password })).status, 200);
  const memberSearch = await request(`/api/admin/search?kind=member&key=${registration.body.user.customer_key}`);
  assert.equal(memberSearch.status, 200);
  assert.equal(memberSearch.body.record.customer_key, registration.body.user.customer_key);
  assert.notEqual(memberSearch.body.record.email, email);
  const ticketSearch = await request(`/api/admin/search?kind=ticket&key=${firstTicket.body.receiptNumber}`);
  assert.equal(ticketSearch.status, 200);
  assert.equal(ticketSearch.body.record.receipt_number, firstTicket.body.receiptNumber);
  assert.equal((await request('/api/admin/search?kind=signup&key=1')).status, 200);
  const [[access]] = await db.execute("SELECT COUNT(*) AS total FROM access_logs a JOIN users u ON u.id=a.actor_user_id WHERE u.email=? AND a.action='search' AND a.target_type LIKE 'admin_%'", [adminEmail]);
  assert.equal(access.total, 3);
  console.log('RKX smoke test passed: registration, consent, consultation idempotency, session expiry, login, logout, CERN CAPTCHA, no account lock, admin permissions and search.');
} finally {
  await db.execute('DELETE FROM users WHERE email=?', [email]);
  await db.execute('DELETE FROM users WHERE email=?', [adminEmail]);
  await db.end();
}
