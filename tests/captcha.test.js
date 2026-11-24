import test from 'node:test';
import assert from 'node:assert/strict';
import { captchaNeeded, verifyCaptchaToken } from '../captcha.js';

test('CAPTCHA starts after the second failed login', () => {
  assert.equal(captchaNeeded(0), false);
  assert.equal(captchaNeeded(1), false);
  assert.equal(captchaNeeded(2), true);
  assert.equal(captchaNeeded(5), true);
});

test('Google token verification uses POST and checks the site hostname', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://www.google.com/recaptcha/api/siteverify');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('secret'), 'server-secret');
    assert.equal(options.body.get('response'), 'browser-token');
    return { ok: true, json: async () => ({ success: true, hostname: 'localhost' }) };
  };
  assert.equal(await verifyCaptchaToken({ token: 'browser-token', secret: 'server-secret', hostname: 'localhost', fetchImpl }), true);
  assert.equal(await verifyCaptchaToken({ token: 'browser-token', secret: 'server-secret', hostname: 'example.com', fetchImpl }), false);
});

test('missing, rejected, and provider-failed CAPTCHA tokens never pass', async () => {
  const rejected = async () => ({ ok: true, json: async () => ({ success: false, hostname: 'localhost' }) });
  const unavailable = async () => ({ ok: false });
  assert.equal(await verifyCaptchaToken({ token: '', secret: 'server-secret', hostname: 'localhost', fetchImpl: rejected }), false);
  assert.equal(await verifyCaptchaToken({ token: 'browser-token', secret: 'server-secret', hostname: 'localhost', fetchImpl: rejected }), false);
  await assert.rejects(verifyCaptchaToken({ token: 'browser-token', secret: 'server-secret', hostname: 'localhost', fetchImpl: unavailable }));
});
