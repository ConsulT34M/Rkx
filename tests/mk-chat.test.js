import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createMkChat } from '../mk-chat.js';

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
