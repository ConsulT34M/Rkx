import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createMkChat } from '../mk-chat.js';

test('고객이 종료된 방을 다시 조회하면 새 상담에 필요한 방 ID만 유지하고 대화는 비운다', async t => {
  const room = { case_id: randomUUID(), subject_ref: randomUUID() };
  const items = [{ message_id: '1', author_role: 'AGENT', body: '상담 답변', sent_at: '2026-01-01T00:00:00Z' }];
  let closed = false;
  const server = createServer((req, res) => {
    if (req.url === '/chat/sessions') {
      res.setHeader('Set-Cookie', 'tm_chat=fixture; HttpOnly');
      return res.end(JSON.stringify({ case_id: room.case_id, expires_at: new Date(Date.now() + 60000).toISOString() }));
    }
    if (req.url === '/cases/' + room.case_id + '/entry-codes') {
      return res.end(JSON.stringify({ case_id: room.case_id, entry_code: 'entry' }));
    }
    if (req.method === 'GET' && req.url === '/cases/' + room.case_id + '/messages') {
      return res.end(JSON.stringify({ items, status: closed ? 'CLOSED' : 'IN_PROGRESS', read_only: closed }));
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const pool = { execute: async sql => {
    assert.match(sql, /^SELECT /);
    return [[room]];
  } };
  const chat = createMkChat(pool, { MK_BASE_URL: 'http://127.0.0.1:' + server.address().port, MK_PARTNER_TOKEN: 'fixture' });
  assert.deepEqual((await chat.read(1)).messages.map(m => m.body), ['상담 답변']);
  closed = true;
  assert.deepEqual(await chat.read(1), { caseId: room.case_id, readOnly: true, status: 'CLOSED', messages: [] });
});

test('AI 전환은 실제 접수 방을 열고 이전 전환 재시도가 현재 방을 덮어쓰지 않는다', async t => {
  const first = randomUUID(), next = randomUUID(), subject = randomUUID(), oldIntake = randomUUID();
  const oldCase = randomUUID(), newCase = randomUUID();
  let room = { subject_ref: subject, intake_id: oldIntake, case_id: oldCase };
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const intake = JSON.parse(raw).intake_request_id;
    requests.push({ path: req.url, subject: req.headers['x-support-subject'], intake });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes(first)) return res.end(JSON.stringify({ case_id: oldCase, intake_request_id: oldIntake }));
    if (intake === oldIntake) return res.writeHead(409).end(JSON.stringify({ code: 'AI_HANDOFF_ROOM_CLOSED', message: '종결' }));
    res.end(JSON.stringify({ case_id: newCase, intake_request_id: intake }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const pool = { execute: async (sql, args) => {
    if (sql.startsWith('SELECT')) return [[{ ...room }]];
    if (args[2] !== room.intake_id) return [{ affectedRows: 0 }];
    if (sql.includes('SET intake_id=')) room = { ...room, intake_id: args[0], case_id: null };
    else room.case_id = args[0];
    return [{ affectedRows: 1 }];
  } };
  const mk = createMkChat(pool, { MK_BASE_URL: 'http://127.0.0.1:' + server.address().port, MK_PARTNER_TOKEN: 'fixture' });
  assert.equal(await mk.handoffChat(1, first), oldCase);
  assert.equal(await mk.handoffChat(1, next), newCase);
  assert.equal(await mk.handoffChat(1, first), oldCase);
  assert.equal(room.case_id, newCase);
  assert.deepEqual(requests.map(r => r.intake), [oldIntake, oldIntake, room.intake_id, room.intake_id]);
  assert.ok(requests.every(r => r.subject === subject && r.path.startsWith('/partner/ai-chat/')));
});

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
