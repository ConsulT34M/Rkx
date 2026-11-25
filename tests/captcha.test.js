import test from 'node:test';
import assert from 'node:assert/strict';
import { captchaNeeded, createCaptcha, verifyCaptchaAnswer } from '../captcha.js';

const id = '94acb21a-adae-4842-9f6d-abb8790d6f5c';
const baseUrl = 'https://captcha.example/api/v1.0';

test('CAPTCHA starts after the second failed login', () => {
  assert.equal(captchaNeeded(0), false);
  assert.equal(captchaNeeded(1), false);
  assert.equal(captchaNeeded(2), true);
  assert.equal(captchaNeeded(5), true);
});

test('CERN API challenge contains only a valid image and ID', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, `${baseUrl}/captcha`);
    assert.equal(options.headers.Accept, 'application/json');
    return { ok: true, json: async () => ({ id, img: 'data:image/jpeg;base64,/9j/4AA=' }) };
  };
  assert.deepEqual(await createCaptcha({ baseUrl, fetchImpl }), { id, img: 'data:image/jpeg;base64,/9j/4AA=' });
  await assert.rejects(createCaptcha({ baseUrl, fetchImpl: async () => ({ ok: true, json: async () => ({ id, img: 'javascript:alert(1)' }) }) }));
});

test('CERN API checks answers server-side and rejects expired or invalid challenges', async () => {
  const valid = async (url, options) => {
    assert.equal(url, `${baseUrl}/captcha`);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { id, answer: 'Ab12' });
    return { status: 200, ok: true, json: async () => ({ message: 'Valid' }) };
  };
  assert.equal(await verifyCaptchaAnswer({ baseUrl, id, answer: 'Ab12', fetchImpl: valid }), true);
  assert.equal(await verifyCaptchaAnswer({ baseUrl, id, answer: 'wrong', fetchImpl: async () => ({ status: 400 }) }), false);
  assert.equal(await verifyCaptchaAnswer({ baseUrl, id, answer: 'expired', fetchImpl: async () => ({ status: 404 }) }), false);
  assert.equal(await verifyCaptchaAnswer({ baseUrl, id: 'bad-id', answer: 'Ab12', fetchImpl: valid }), false);
  await assert.rejects(verifyCaptchaAnswer({ baseUrl, id, answer: 'Ab12', fetchImpl: async () => ({ status: 503, ok: false }) }));
});
