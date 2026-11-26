import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSignupRoutes } from '../signup-routes.js';

test('a name outside the sample registry can reach identity but cannot create an account', async () => {
  const routes = new Map();
  const queries = [];
  const app = {
    post: (path, ...handlers) => routes.set(path, handlers),
    get: (path, ...handlers) => routes.set(path, handlers)
  };
  const pool = {
    async execute(sql) {
      queries.push(sql);
      if (sql.startsWith('SELECT id FROM users')) return [[undefined]];
      if (sql.startsWith('SELECT * FROM signup_requests')) {
        return [[{ id: 1, name: '등록되지 않은 사람', stage: 'phone', mode: 'demo', status: 'pending' }]];
      }
      return [{ affectedRows: 1 }];
    }
  };
  const response = () => ({
    statusCode: 200, body: null, cookies: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    cookie(name, value) { this.cookies[name] = value; return this; }
  });
  mountSignupRoutes(app, { pool, route: handler => handler, limited: () => {} });

  const register = response();
  await routes.get('/api/auth/register')[1]({ body: {
    name: '등록되지 않은 사람', email: 'unknown@example.test', password: 'StrongPass!1',
    termsConsent: true, privacyConsent: true, outsourcingConsent: true
  } }, register);
  assert.equal(register.statusCode, 202);
  assert.equal(register.body.accountCreated, false);
  assert.match(register.cookies.rkx_signup, /^[a-f0-9]{64}$/);

  const phone = response();
  const request = { body: { name: '등록되지 않은 사람', rrn: '1234567890123', phone: '01012345678' }, headers: { cookie: `rkx_signup=${register.cookies.rkx_signup}` }, get(name) { return this.headers[name.toLowerCase()]; } };
  const phoneHandlers = routes.get('/api/signup/identity/phone/start');
  await phoneHandlers[0](request, phone, () => {});
  await phoneHandlers[2](request, phone);
  assert.equal(phone.statusCode, 400);
  assert.match(phone.body.error, /본인확인을 완료할 수 없습니다/);
  assert.equal(queries.some(sql => sql.startsWith('INSERT INTO users')), false);
});
