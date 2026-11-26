import crypto from 'node:crypto';
import {
  publicDemoPerson, samplePersonByName, samplePersonByNo, demoCardSvg, demoFaceSvg,
  partnerConfigured, partnerPartiallyConfigured, sampleMatches, parseDemoImage,
  inboxUrl, ijinfoRequest, verifyIjinfoSignature
} from './identity-service.js';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const apiError = (res, message, status = 400) => res.status(status).json({ error: message });

export function mountIdentityRoutes(app, { pool, requireUser, role, route, limited }) {
  const customer = [requireUser, role('customer')];
  const load = async userId => {
    const [[row]] = await pool.execute('SELECT *, expires_at<=NOW() AS expired FROM identity_verifications WHERE user_id=?', [userId]);
    return row || null;
  };
  const activeAt = (res, row, stage) => {
    if (!row || row.expired || row.stage !== stage) {
      apiError(res, '본인확인 단계를 다시 확인하거나 새로 시작해 주세요.', 409);
      return false;
    }
    return true;
  };

  app.get('/api/identity/demo-card/:personNo.svg', (req, res) => {
    const person = samplePersonByNo(req.params.personNo);
    if (!person) return res.status(404).end();
    res.type('image/svg+xml').send(demoCardSvg(person));
  });
  app.get('/api/identity/demo-face/:personNo.svg', (req, res) => {
    const person = samplePersonByNo(req.params.personNo);
    if (!person) return res.status(404).end();
    res.type('image/svg+xml').send(demoFaceSvg(person));
  });
  app.get('/api/identity/demo-person', ...customer, (req, res) => {
    const person = samplePersonByName(req.user.name);
    if (!person) return apiError(res, '이 계정에 맞는 실습 인물이 없습니다.', 404);
    res.json({ person: publicDemoPerson(person) });
  });
  app.get('/api/identity/status', ...customer, route(async (req, res) => {
    const row = await load(req.user.id);
    res.json({ identityStatus: req.user.identity_status, mode: row?.mode || null, stage: row && !row.expired ? row.stage : null, expiresAt: row?.expires_at || null });
  }));

  app.post('/api/identity/start', ...customer, limited, route(async (req, res) => {
    const person = samplePersonByName(req.user.name);
    if (!person || person.mois_status !== '정상') return apiError(res, '이 계정에 맞는 실습 인물이 없습니다.', 409);
    if (req.user.identity_status === 'verified') return apiError(res, '이미 본인확인이 완료되었습니다.', 409);
    if (partnerPartiallyConfigured()) return apiError(res, 'IJ-info 연동 설정이 일부 빠져 있습니다. 관리자에게 문의해 주세요.', 503);
    if (!partnerConfigured() && process.env.NODE_ENV === 'production') return apiError(res, '본인확인 연동을 준비 중입니다.', 503);
    const consents = req.body?.consents;
    if (!consents || !['collect', 'uid', 'carrier_terms', 'biometric'].every(key => consents[key] === true)) {
      return apiError(res, '본인확인 필수 동의 항목을 확인해 주세요.');
    }
    const mode = partnerConfigured() ? 'ijinfo' : 'demo';
    const reference = `rkx-${req.user.id}-${crypto.randomUUID()}`;
    // 휴대폰 본인확인부터 IJ-info 를 거치므로 인증 건을 먼저 만든다(IA-01).
    let providerReference = null;
    if (mode === 'ijinfo') {
      try {
        const result = await ijinfoRequest('POST', '/verifications', { client_user_ref: reference, mode: 'DIRECT' });
        providerReference = result.verification_id;
        if (!/^[0-9a-f-]{36}$/i.test(providerReference || '')) return apiError(res, 'IJ-info 응답을 확인할 수 없습니다.', 502);
      } catch { return apiError(res, 'IJ-info에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', 502); }
    }
    await pool.execute(`INSERT INTO identity_verifications
      (user_id,client_user_ref,provider_reference,mode,stage,sample_person_no,expires_at)
      VALUES (?,?,?,?,'phone',?,DATE_ADD(NOW(), INTERVAL 20 MINUTE))
      ON DUPLICATE KEY UPDATE client_user_ref=VALUES(client_user_ref),provider_reference=VALUES(provider_reference),mode=VALUES(mode),stage='phone',sample_person_no=VALUES(sample_person_no),pending_phone=NULL,code_hash=NULL,code_expires_at=NULL,expires_at=VALUES(expires_at)`,
    [req.user.id, reference, providerReference, mode, person.person_no]);
    await pool.execute("UPDATE users SET identity_status='pending' WHERE id=?", [req.user.id]);
    res.json({ mode, stage: 'phone' });
  }));

  app.post('/api/identity/phone/start', ...customer, limited, route(async (req, res) => {
    const row = await load(req.user.id);
    const person = samplePersonByNo(row?.sample_person_no);
    if (!row || row.expired || !['phone', 'phone_code'].includes(row.stage)) return apiError(res, '본인확인 단계를 다시 확인하거나 새로 시작해 주세요.', 409);
    if (typeof req.body?.name !== 'string' || typeof req.body?.phone !== 'string' || typeof req.body?.rrn !== 'string' ||
        !sampleMatches({ name: req.body.name, phone: req.body.phone, rrn: req.body.rrn }, person) ||
        !sampleMatches({ name: req.user.name }, person)) {
      return apiError(res, '실습 인물의 성명·주민등록번호·휴대폰번호를 확인해 주세요.');
    }
    const phone = req.body.phone.replace(/\D/g, '');

    // 인증번호는 IJ-info 가 만들어 이용자 휴대폰으로 보낸다(IA-23).
    // RKX 는 인증번호를 받지 않는다 — 받으면 그 자체가 오라클이다.
    if (row.mode === 'ijinfo') {
      let issued;
      try {
        issued = await ijinfoRequest('POST', `/verifications/${row.provider_reference}/phone/otp`, {
          name: req.body.name, phone_number: phone, resend: req.body.resend === true
        });
      } catch (error) {
        if (error.status === 400 || error.status === 409) return apiError(res, error.message, 400);
        if (error.status === 429) return apiError(res, '잠시 후 다시 요청해 주세요. (60초 제한)', 429);
        return apiError(res, 'IJ-info 휴대폰 본인확인에 연결할 수 없습니다.', 502);
      }
      await pool.execute("UPDATE identity_verifications SET stage='phone_code',pending_phone=? WHERE user_id=?", [phone, req.user.id]);
      return res.json({
        stage: 'phone_code', phoneMask: issued.phone_mask, inboxUrl: inboxUrl(),
        expiresInSeconds: 180, notice: '이용자 휴대폰으로 인증번호를 보냈습니다. 휴대폰 문자 수신함에서 확인해 주세요.'
      });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = crypto.randomBytes(32).toString('hex');
    await pool.execute("UPDATE identity_verifications SET stage='phone_code',pending_phone=?,code_hash=?,code_expires_at=DATE_ADD(NOW(), INTERVAL 3 MINUTE) WHERE user_id=?", [phone, `${salt}:${digest(salt + code)}`, req.user.id]);
    res.json({ stage: 'phone_code', demoCode: code, expiresInSeconds: 180, notice: '연동 설정이 없어 로컬 모의 코드로 진행합니다.' });
  }));

  app.post('/api/identity/phone/confirm', ...customer, limited, route(async (req, res) => {
    const row = await load(req.user.id);
    if (!activeAt(res, row, 'phone_code')) return;
    const code = String(req.body?.code || '');
    if (!/^\d{6}$/.test(code)) return apiError(res, '인증번호 6자리를 입력해 주세요.');

    // IJ-info 가 발급한 인증번호는 IJ-info 가 검증한다(IA-24). 맞으면 통신사에서 CI 를
    // 받아 IJ-info 안에 보관한다 — RKX 로는 넘어오지 않는다.
    if (row.mode === 'ijinfo') {
      try {
        await ijinfoRequest('POST', `/verifications/${row.provider_reference}/phone/confirm`, { code });
      } catch (error) {
        if (error.status === 409 && error.reasonCode) {
          await pool.execute("UPDATE identity_verifications SET stage='failed' WHERE user_id=?", [req.user.id]);
          await pool.execute("UPDATE users SET identity_status='rejected' WHERE id=?", [req.user.id]);
          return apiError(res, `본인확인 실패 (${error.reasonCode})`, 409);
        }
        if (error.status === 400) return apiError(res, error.message, 400);
        return apiError(res, 'IJ-info 휴대폰 본인확인에 연결할 수 없습니다.', 502);
      }
      await pool.execute("UPDATE identity_verifications SET stage='id_card',pending_phone=NULL WHERE user_id=?", [req.user.id]);
      await pool.execute('UPDATE users SET phone=? WHERE id=?', [row.pending_phone, req.user.id]);
      return res.json({ stage: 'id_card', mode: row.mode });
    }

    if (!row.code_hash || new Date(row.code_expires_at).getTime() <= Date.now()) return apiError(res, '인증번호가 올바르지 않거나 만료되었습니다.');
    const [salt, expected] = row.code_hash.split(':');
    if (!crypto.timingSafeEqual(Buffer.from(digest(salt + code)), Buffer.from(expected))) return apiError(res, '인증번호가 올바르지 않습니다.');
    const providerReference = row.provider_reference;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[current]] = await connection.execute('SELECT stage,code_hash,pending_phone FROM identity_verifications WHERE user_id=? FOR UPDATE', [req.user.id]);
      if (!current || current.stage !== 'phone_code' || current.code_hash !== row.code_hash || !current.pending_phone) {
        await connection.rollback();
        return apiError(res, '인증번호가 변경되었습니다. 새 번호로 다시 확인해 주세요.', 409);
      }
      await connection.execute("UPDATE identity_verifications SET stage='id_card',pending_phone=NULL,code_hash=NULL,code_expires_at=NULL,provider_reference=? WHERE user_id=?", [providerReference, req.user.id]);
      await connection.execute('UPDATE users SET phone=? WHERE id=?', [current.pending_phone, req.user.id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
    res.json({ stage: 'id_card', mode: row.mode });
  }));

  app.post('/api/identity/id-card', ...customer, limited, route(async (req, res) => {
    const row = await load(req.user.id);
    const person = samplePersonByNo(row?.sample_person_no);
    if (!activeAt(res, row, 'id_card')) return;
    if (typeof req.body?.rrn !== 'string' || typeof req.body?.issueDate !== 'string' ||
        !sampleMatches({ rrn: req.body.rrn, issueDate: req.body.issueDate }, person)) return apiError(res, '샘플 인물의 주민등록번호와 발급일자를 확인해 주세요.');
    let image;
    try { image = parseDemoImage(req.body?.image); } catch (error) { return apiError(res, error.message); }
    if (row.mode === 'ijinfo') {
      try {
        const result = await ijinfoRequest('POST', `/verifications/${row.provider_reference}/id-card`, {
          name: person.name, rrn: person.rrn, issue_date: person.issue_date,
          filename: `id_card.${image.filename.endsWith('.png') ? 'png' : 'jpg'}`, image: image.base64,
          consents: ['collect', 'uid', 'carrier_terms', 'biometric'].map(type => ({ type, version: 'v1.0' }))
        });
        if (result.status === 'FAILED') {
          await pool.execute("UPDATE identity_verifications SET stage='failed' WHERE user_id=?", [req.user.id]);
          await pool.execute("UPDATE users SET identity_status='rejected' WHERE id=?", [req.user.id]);
          return apiError(res, `IJ-info 판정 실패 (${result.reason_code || '확인 필요'})`, 409);
        }
      } catch (error) { return apiError(res, error.status === 400 ? error.message : 'IJ-info 신분증 검증에 연결할 수 없습니다.', error.status === 400 ? 400 : 502); }
    }
    await pool.execute("UPDATE identity_verifications SET stage='face' WHERE user_id=?", [req.user.id]);
    res.json({ stage: 'face', mode: row.mode });
  }));

  app.post('/api/identity/face', ...customer, limited, route(async (req, res) => {
    const row = await load(req.user.id);
    if (!activeAt(res, row, 'face')) return;
    let image;
    try { image = parseDemoImage(req.body?.image); } catch (error) { return apiError(res, error.message); }
    const status = 'demo_verified';
    if (row.mode === 'ijinfo') {
      try {
        const result = await ijinfoRequest('POST', `/verifications/${row.provider_reference}/face`, { filename: `selfie.${image.filename.endsWith('.png') ? 'png' : 'jpg'}`, image: image.base64 });
        if (result.status !== 'SUCCEEDED') {
          await pool.execute("UPDATE identity_verifications SET stage='failed' WHERE user_id=?", [req.user.id]);
          await pool.execute("UPDATE users SET identity_status='rejected' WHERE id=?", [req.user.id]);
          return apiError(res, `IJ-info 판정 실패 (${result.reason_code || '확인 필요'})`, 409);
        }
      } catch (error) { return apiError(res, error.status === 400 ? error.message : 'IJ-info 얼굴 검증에 연결할 수 없습니다.', error.status === 400 ? 400 : 502); }
    }
    await pool.execute("UPDATE identity_verifications SET stage='completed' WHERE user_id=?", [req.user.id]);
    await pool.execute('UPDATE users SET identity_status=? WHERE id=?', [status, req.user.id]);
    res.json({ stage: 'completed', identityStatus: status, mode: row.mode, demo: true });
  }));

  app.post('/api/identity/ijinfo-callback', route(async (req, res) => {
    if (!verifyIjinfoSignature(req.get('x-timestamp'), req.rawBody || Buffer.alloc(0), req.get('x-signature'))) return res.status(401).end();
    const { verification_id: reference, status } = req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(reference || '') || !['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(status)) return res.status(400).end();
    const [[row]] = await pool.execute('SELECT user_id,stage FROM identity_verifications WHERE provider_reference=?', [reference]);
    if (!row) {
      // DIRECT signup creates the user only after its synchronous IA-22 response.
      // IJ-info sends IA-11 before returning IA-22, so acknowledge the signed
      // notification for a pending signup without creating an account here.
      const [[signup]] = await pool.execute('SELECT id FROM signup_requests WHERE provider_reference=?', [reference]);
      return signup ? res.json({ ok: true }) : res.status(404).end();
    }
    if (row.stage !== 'completed' && row.stage !== 'failed') {
      const completed = status === 'SUCCEEDED';
      await pool.execute('UPDATE identity_verifications SET stage=? WHERE user_id=?', [completed ? 'completed' : 'failed', row.user_id]);
      await pool.execute('UPDATE users SET identity_status=? WHERE id=?', [completed ? 'demo_verified' : 'rejected', row.user_id]);
    }
    res.json({ ok: true });
  }));
}
