import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { passwordIssues } from './auth-policy.js';
import {
  publicDemoPerson, samplePersonByName, partnerConfigured, partnerPartiallyConfigured,
  sampleMatches, parseDemoImage, mockCi, ijinfoRequest
} from './identity-service.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 190;
const problem = (res, message, status = 400) => res.status(status).json({ error: message });
const signupCookie = 'rkx_signup';
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };

export function mountSignupRoutes(app, { pool, route, limited }) {
  const tokenFrom = req => {
    const token = (req.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(signupCookie + '='))?.slice(signupCookie.length + 1);
    return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
  };
  const pending = async (req, res, next) => {
    const token = tokenFrom(req);
    if (!token) return problem(res, '회원가입 첫 단계부터 다시 진행해 주세요.', 401);
    const [[record]] = await pool.execute("SELECT * FROM signup_requests WHERE token_hash=? AND status='pending' AND expires_at>NOW()", [hash(token)]);
    if (!record) return problem(res, '가입 절차가 만료되었습니다. 처음부터 다시 진행해 주세요.', 401);
    req.signup = record;
    next();
  };
  const active = (res, record, stage) => {
    if (record.stage !== stage) {
      problem(res, '본인확인 단계를 다시 확인해 주세요.', 409);
      return false;
    }
    return true;
  };

  app.post('/api/auth/register', limited, route(async (req, res) => {
    const name = clean(req.body?.name, 80), email = clean(req.body?.email, 190).toLowerCase();
    const password = req.body?.password;
    if (!name || !validEmail(email) ||
        req.body?.termsConsent !== true || req.body?.privacyConsent !== true || req.body?.outsourcingConsent !== true) {
      return problem(res, '입력값과 필수 동의 항목을 확인해 주세요.');
    }
    const sample = samplePersonByName(name);
    if (!sample) return problem(res, 'IJ-info 샘플에 없는 이름입니다. 가상 인물의 이름을 입력해 주세요.');
    if (sample.mois_status !== '정상') return problem(res, '이 샘플 인물의 증표는 분실 상태라 인증할 수 없습니다.');
    const issues = passwordIssues(password);
    if (issues.length) return problem(res, `비밀번호 조건: ${issues.join(', ')}`);
    const [[existing]] = await pool.execute('SELECT id FROM users WHERE email=?', [email]);
    if (existing) return problem(res, '이미 가입된 이메일입니다.', 409);
    const token = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.execute("UPDATE signup_requests SET status='expired',password_hash='',token_hash=NULL,code_hash=NULL,completed_at=NOW() WHERE email=? AND status='pending'", [email]);
    await pool.execute("INSERT INTO signup_requests (name,email,phone,password_hash,consent_version,token_hash,expires_at) VALUES (?,?,NULL,?, 'draft-1',?,DATE_ADD(NOW(), INTERVAL 20 MINUTE))", [name, email, passwordHash, hash(token)]);
    res.cookie(signupCookie, token, { ...cookieOptions, maxAge: 20 * 60 * 1000 });
    res.status(202).json({ next: 'identity', accountCreated: false });
  }));

  app.get('/api/signup/identity/demo-person', route(pending), (req, res) => {
    res.json({ person: publicDemoPerson(samplePersonByName(req.signup.name)) });
  });
  app.get('/api/signup/identity/status', route(pending), (req, res) => {
    res.json({ identityStatus: 'pending', mode: req.signup.mode, stage: req.signup.stage, expiresAt: req.signup.expires_at });
  });

  app.post('/api/signup/identity/start', route(pending), limited, route(async (req, res) => {
    if (partnerPartiallyConfigured()) return problem(res, 'IJ-info 연동 설정이 일부 빠져 있습니다.', 503);
    if (!partnerConfigured() && process.env.NODE_ENV === 'production') return problem(res, '본인확인 연동을 준비 중입니다.', 503);
    const consents = req.body?.consents;
    if (!consents || !['collect', 'uid', 'carrier_terms', 'biometric'].every(key => consents[key] === true)) {
      return problem(res, '본인확인 필수 동의 항목을 확인해 주세요.');
    }
    const mode = partnerConfigured() ? 'ijinfo' : 'demo';
    const reference = `rkx-signup-${req.signup.id}-${crypto.randomUUID()}`;
    await pool.execute("UPDATE signup_requests SET mode=?,stage='phone',client_user_ref=?,provider_reference=NULL,phone=NULL,code_hash=NULL,code_expires_at=NULL WHERE id=?", [mode, reference, req.signup.id]);
    res.json({ mode, stage: 'phone' });
  }));

  app.post('/api/signup/identity/phone/start', route(pending), limited, route(async (req, res) => {
    const record = req.signup;
    const sample = samplePersonByName(record.name);
    if (!['phone', 'phone_code'].includes(record.stage)) return problem(res, '휴대폰 확인 단계가 아닙니다.', 409);
    if (typeof req.body?.name !== 'string' || typeof req.body?.phone !== 'string' || typeof req.body?.rrn !== 'string' ||
        !sampleMatches({ name: req.body.name, phone: req.body.phone, rrn: req.body.rrn }, sample)) {
      return problem(res, '실습 인물의 성명·주민등록번호·휴대폰번호를 확인해 주세요.');
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = crypto.randomBytes(32).toString('hex');
    await pool.execute("UPDATE signup_requests SET stage='phone_code',phone=?,code_hash=?,code_expires_at=DATE_ADD(NOW(), INTERVAL 3 MINUTE) WHERE id=?", [req.body.phone.replace(/\D/g, ''), `${salt}:${hash(salt + code)}`, record.id]);
    res.json({ stage: 'phone_code', demoCode: code, expiresInSeconds: 180, notice: '실습용 코드입니다. 실제 SMS가 전송되지 않습니다.' });
  }));

  app.post('/api/signup/identity/phone/confirm', route(pending), limited, route(async (req, res) => {
    const record = req.signup;
    if (!active(res, record, 'phone_code')) return;
    const code = String(req.body?.code || '');
    if (!/^\d{6}$/.test(code) || !record.code_hash || !record.phone ||
        new Date(record.code_expires_at).getTime() <= Date.now()) return problem(res, '인증번호가 올바르지 않거나 만료되었습니다.');
    const [salt, expected] = record.code_hash.split(':');
    if (!crypto.timingSafeEqual(Buffer.from(hash(salt + code)), Buffer.from(expected))) return problem(res, '인증번호가 올바르지 않습니다.');
    let providerReference = null;
    if (record.mode === 'ijinfo') {
      try {
        const result = await ijinfoRequest('POST', '/verifications', { client_user_ref: record.client_user_ref, mode: 'DIRECT' });
        providerReference = result.verification_id;
        if (!/^[0-9a-f-]{36}$/i.test(providerReference || '')) return problem(res, 'IJ-info 응답을 확인할 수 없습니다.', 502);
      } catch { return problem(res, 'IJ-info에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', 502); }
    }
    const [updated] = await pool.execute("UPDATE signup_requests SET stage='id_card',code_hash=NULL,code_expires_at=NULL,provider_reference=? WHERE id=? AND stage='phone_code' AND code_hash=?", [providerReference, record.id, record.code_hash]);
    if (!updated.affectedRows) return problem(res, '인증번호가 변경되었습니다. 다시 확인해 주세요.', 409);
    res.json({ stage: 'id_card', mode: record.mode });
  }));

  app.post('/api/signup/identity/id-card', route(pending), limited, route(async (req, res) => {
    const record = req.signup;
    const sample = samplePersonByName(record.name);
    if (!active(res, record, 'id_card')) return;
    if (typeof req.body?.rrn !== 'string' || typeof req.body?.issueDate !== 'string' ||
        !sampleMatches({ rrn: req.body.rrn, issueDate: req.body.issueDate }, sample)) return problem(res, '샘플 인물의 주민등록번호와 발급일자를 확인해 주세요.');
    let image;
    try { image = parseDemoImage(req.body?.image); } catch (error) { return problem(res, error.message); }
    if (record.mode === 'ijinfo') {
      try {
        const result = await ijinfoRequest('POST', `/verifications/${record.provider_reference}/id-card`, {
          name: sample.name, rrn: sample.rrn, issue_date: sample.issue_date,
          ci: mockCi(sample.rrn), filename: `id_card.${image.filename.endsWith('.png') ? 'png' : 'jpg'}`, image: image.base64,
          consents: ['collect', 'uid', 'carrier_terms', 'biometric'].map(type => ({ type, version: 'v1.0' }))
        });
        if (result.status === 'FAILED') {
          await pool.execute("UPDATE signup_requests SET stage='failed',status='rejected',password_hash='',token_hash=NULL,completed_at=NOW() WHERE id=?", [record.id]);
          res.clearCookie(signupCookie, cookieOptions);
          return problem(res, `IJ-info 판정 실패 (${result.reason_code || '확인 필요'})`, 409);
        }
        if (result.passed !== true || result.stage !== 'FACE') return problem(res, 'IJ-info 신분증 판정 응답을 확인할 수 없습니다.', 502);
      } catch (error) { return problem(res, error.status === 400 ? error.message : 'IJ-info 신분증 검증에 연결할 수 없습니다.', error.status === 400 ? 400 : 502); }
    }
    await pool.execute("UPDATE signup_requests SET stage='face' WHERE id=?", [record.id]);
    res.json({ stage: 'face', mode: record.mode });
  }));

  app.post('/api/signup/identity/face', route(pending), limited, route(async (req, res) => {
    const record = req.signup;
    if (!active(res, record, 'face')) return;
    let image;
    try { image = parseDemoImage(req.body?.image); } catch (error) { return problem(res, error.message); }
    if (record.mode === 'ijinfo') {
      try {
        let result;
        try {
          result = await ijinfoRequest('POST', `/verifications/${record.provider_reference}/face`, {
            filename: `selfie.${image.filename.endsWith('.png') ? 'png' : 'jpg'}`, image: image.base64
          });
        } catch (error) {
          if (error.status) throw error;
          // IA-22 can succeed while its response is lost. IA-12 is authoritative.
          result = await ijinfoRequest('GET', `/verifications/${record.provider_reference}`);
          if (result.status === 'PENDING') return problem(res, 'IJ-info 판정을 확인 중입니다. 잠시 후 다시 시도해 주세요.', 503);
        }
        if (result.status !== 'SUCCEEDED') {
          await pool.execute("UPDATE signup_requests SET stage='failed',status='rejected',password_hash='',token_hash=NULL,completed_at=NOW() WHERE id=?", [record.id]);
          res.clearCookie(signupCookie, cookieOptions);
          return problem(res, `IJ-info 판정 실패 (${result.reason_code || '확인 필요'})`, 409);
        }
      } catch (error) { return problem(res, error.status === 400 ? error.message : 'IJ-info 얼굴 검증에 연결할 수 없습니다.', error.status === 400 ? 400 : 502); }
    }
    const connection = await pool.getConnection();
    const sessionToken = crypto.randomBytes(32).toString('hex');
    let userId;
    try {
      await connection.beginTransaction();
      const [[current]] = await connection.execute("SELECT * FROM signup_requests WHERE id=? AND status='pending' AND expires_at>NOW() FOR UPDATE", [record.id]);
      if (!current || current.stage !== 'face' || current.token_hash !== record.token_hash || !current.phone) {
        await connection.rollback();
        return problem(res, '가입 절차가 변경되거나 만료되었습니다. 다시 진행해 주세요.', 409);
      }
      const [[existing]] = await connection.execute('SELECT id FROM users WHERE email=?', [current.email]);
      if (existing) {
        await connection.rollback();
        return problem(res, '이미 가입된 이메일입니다.', 409);
      }
      const customerKey = `RKX${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
      const [insert] = await connection.execute(
        "INSERT INTO users (customer_key,name,email,phone,password_hash,identity_status,consent_version,terms_consented_at,privacy_consented_at,outsourcing_consented_at) VALUES (?,?,?,?,?,'demo_verified',?, ?,?,?)",
        [customerKey, current.name, current.email, current.phone, current.password_hash, current.consent_version,
          current.created_at, current.created_at, current.created_at]
      );
      userId = insert.insertId;
      await connection.execute('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 30 MINUTE))', [hash(sessionToken), userId]);
      await connection.execute("UPDATE signup_requests SET stage='completed',status='verified',password_hash='',token_hash=NULL,code_hash=NULL,completed_at=NOW() WHERE id=?", [current.id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') return problem(res, '이미 가입된 이메일입니다.', 409);
      throw error;
    } finally { connection.release(); }
    res.cookie('rkx_session', sessionToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.clearCookie(signupCookie, cookieOptions);
    const [[user]] = await pool.execute('SELECT id,customer_key,name,email,phone,role,identity_status FROM users WHERE id=?', [userId]);
    res.status(201).json({ stage: 'completed', mode: record.mode, identityStatus: 'demo_verified', demo: true, user });
  }));
}
