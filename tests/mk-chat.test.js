import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createMkChat } from '../mk-chat.js';

test('RKX AI·음성 요청은 고객 식별자를 공유하고 상담원 티켓을 만들지 않는다', async t => {
  const subject = randomUUID(), voiceId = randomUUID();
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push({ path: req.url, owner: req.headers['x-support-subject'], auth: req.headers.authorization, body: Buffer.concat(chunks) });
    if (req.url.includes('/recording/')) { res.writeHead(204).end(); return; }
    res.end(req.url.endsWith('/ringback') ? Buffer.from([0, 255]) : '{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  let room;
  const pool = { execute: async (sql, args) => {
    if (sql.startsWith('INSERT INTO mk_chat_rooms')) room = { subject_ref: subject, intake_id: args[2], case_id: null };
    else assert.ok(sql.startsWith('SELECT subject_ref'));
    return [room ? [room] : []];
  } };
  const mk = createMkChat(pool, { MK_BASE_URL: 'http://127.0.0.1:' + server.address().port, MK_PARTNER_TOKEN: 'fixture' });
  await mk.support(11, '/partner/ai-chat', undefined);
  const pcm = Buffer.from([0, 255, 31, 72]);
  const path = '/inquiry/voice/sessions/' + voiceId + '/recording/0';
  assert.equal((await mk.support(11, path, pcm, { 'Content-Type': 'application/octet-stream' })).status, 204);
  assert.deepEqual((await mk.asset('/inquiry/voice/ringback')).data, Buffer.from([0, 255]));
  assert.deepEqual(calls.map(call => call.path), ['/partner/ai-chat', path, '/inquiry/voice/ringback']);
  assert.deepEqual(calls.map(call => call.owner), [subject, subject, undefined]);
  assert.deepEqual(calls.map(call => call.auth), ['Bearer fixture', 'Bearer fixture', undefined]);
  assert.deepEqual(calls[1].body, pcm);
});

test('MK 세션을 갱신해도 같은 방과 메시지 번호로 재전송한다', async t => {
  const room = { subject_ref: randomUUID(), intake_id: randomUUID(), case_id: randomUUID() };
  const calls = [];
  let grants = 0;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw && JSON.parse(raw);
    calls.push({ path: req.url, bearer: req.headers.authorization, cookie: req.headers.cookie, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/entry-codes')) {
      res.end(JSON.stringify({ case_id: room.case_id, entry_code: 'grant-' + ++grants }));
    } else if (req.url === '/chat/sessions') {
      res.setHeader('Set-Cookie', 'tm_chat=session-' + grants + '; Secure; HttpOnly; Path=/');
      res.end(JSON.stringify({ case_id: room.case_id, expires_at: new Date(Date.now() + 60000).toISOString() }));
    } else if (grants === 1) {
      res.statusCode = 401;
      res.end(JSON.stringify({ code: 'CHAT_SESSION_REQUIRED' }));
    } else {
      res.end(JSON.stringify({ message_id: '1' }));
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const pool = { execute: async () => [[room]] };
  const chat = createMkChat(pool, { MK_BASE_URL: 'http://127.0.0.1:' + server.address().port, MK_PARTNER_TOKEN: 'test-partner' });
  const messageId = randomUUID();
  await chat.send(1, room.case_id, messageId, '문의');

  const sends = calls.filter(call => call.path === '/cases/' + room.case_id + '/messages');
  assert.deepEqual(sends.map(call => call.cookie), ['tm_chat=session-1', 'tm_chat=session-2']);
  for (const call of sends) assert.deepEqual(call.body, { client_message_id: messageId, body: '문의' });
  for (const call of calls) {
    if (call.path.endsWith('/entry-codes')) {
      assert.equal(call.bearer, 'Bearer test-partner');
      assert.equal(call.body.support_subject_ref, room.subject_ref);
    } else {
      assert.equal(call.bearer, undefined);
    }
  }
});
