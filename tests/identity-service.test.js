import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  demoPerson, demoPeople, samplePersonByName, sampleMatches, demoCardSvg,
  parseDemoImage, partnerConfigured, partnerPartiallyConfigured,
  mockCi, ijinfoRequest, verifyIjinfoSignature
} from '../identity-service.js';

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=';

test('IJ-info sample people include Park Yujin and keep each identity separate', () => {
  assert.equal(demoPerson.person_no, 1);
  assert.equal(demoPeople.length, 10);
  const park = samplePersonByName('박유진');
  assert.equal(park.person_no, 10);
  assert.equal(sampleMatches({ name: park.name, phone: park.phone_number, rrn: park.rrn, issueDate: park.issue_date }, park), true);
  assert.equal(sampleMatches({ name: demoPerson.name, phone: park.phone_number }, park), false);
  assert.match(demoCardSvg(park), /박유진/);
  assert.match(demoCardSvg(park), /IJ-info 샘플 인물 10/);
  assert.equal(sampleMatches({ name: demoPerson.name, phone: demoPerson.phone_number, rrn: demoPerson.rrn, issueDate: demoPerson.issue_date }), true);
  assert.equal(sampleMatches({ name: '다른 사람', phone: demoPerson.phone_number }), false);
  assert.equal(sampleMatches({ rrn: '0000000000000' }), false);
  assert.equal(sampleMatches({ name: '이혜진' }, samplePersonByName('이혜진')), false);
});

test('demo upload accepts PNG and rejects content-type spoofing', () => {
  assert.equal(parseDemoImage(tinyPng).filename, 'sample.png');
  assert.throws(() => parseDemoImage(tinyPng.replace('image/png', 'image/jpeg')));
  assert.throws(() => parseDemoImage('data:image/png;base64,AAAA'));
});

test('IJ-info DIRECT request signs exact body and mock CI uses sample number', async () => {
  assert.equal(
    crypto.createHmac('sha256', 'test-secret').update('1700000000').update('{"client_user_ref":"u-1"}').digest('hex'),
    '8d15772196338b56f028ea824940d5cfa11c3716ec0d7cf57675a81d63d071a8'
  );
  assert.equal(
    crypto.createHmac('sha256', 'test-secret').update('1700000000').digest('hex'),
    '1b74eaf87da46877ba651ac812b24a3bf01990e9ed0101b88268f60f965729e2'
  );
  const key = crypto.randomBytes(32);
  const env = { NODE_ENV: 'development', IJINFO_BASE_URL: 'http://127.0.0.1:8000', IJINFO_API_KEY: 'test-key', IJINFO_HMAC_SECRET: 'test-secret', IJINFO_DEMO_CI_KEY_B64: key.toString('base64') };
  assert.equal(partnerConfigured(env), true);
  assert.equal(partnerPartiallyConfigured({ IJINFO_BASE_URL: env.IJINFO_BASE_URL }), true);
  assert.equal(mockCi(demoPerson.rrn, env).length, 88);
  const result = await ijinfoRequest('POST', '/verifications', { mode: 'DIRECT', client_user_ref: 'rkx-test' }, { env, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8000/api/v1/verifications');
    const { 'X-Timestamp': time, 'X-Signature': signature } = options.headers;
    const expected = crypto.createHmac('sha256', env.IJINFO_HMAC_SECRET).update(time + options.body).digest('hex');
    assert.equal(signature, expected);
    return { ok: true, json: async () => ({ verification_id: '00000000-0000-0000-0000-000000000001' }) };
  } });
  assert.equal(result.verification_id, '00000000-0000-0000-0000-000000000001');
  const status = await ijinfoRequest('GET', `/verifications/${result.verification_id}`, null, { env, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8000/api/v1/verifications/00000000-0000-0000-0000-000000000001');
    assert.equal(options.body, undefined);
    assert.equal(options.headers['X-Signature'], crypto.createHmac('sha256', env.IJINFO_HMAC_SECRET).update(options.headers['X-Timestamp']).digest('hex'));
    return { ok: true, json: async () => ({ status: 'SUCCEEDED' }) };
  } });
  assert.equal(status.status, 'SUCCEEDED');
  const body = Buffer.from('{"status":"SUCCEEDED"}');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', env.IJINFO_HMAC_SECRET).update(timestamp).update(body).digest('hex');
  assert.equal(verifyIjinfoSignature(timestamp, body, signature, env), true);
  assert.equal(verifyIjinfoSignature(timestamp, body, '0'.repeat(64), env), false);
});
