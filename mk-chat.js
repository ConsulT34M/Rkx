import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

export const isUuid = value => typeof value === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);

export class MkChatError extends Error {
  constructor(message = '말결 채팅에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', status = 502, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function mkRequest(base, ca, localDocker) {
  const transport = base.protocol === 'https:' ? https : http;
  return (path, headers, payload, { binary = false, timeout = 8000, support = false } = {}) => new Promise((resolve, reject) => {
    const request = transport.request(new URL(path, base), {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      ca, servername: localDocker ? 'localhost' : undefined,
      signal: AbortSignal.timeout(timeout)
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', () => reject(new MkChatError()));
      response.on('end', () => {
        const raw = Buffer.concat(chunks);
        const ok = response.statusCode >= 200 && response.statusCode < 300;
        let data = null;
        if (raw.length) {
          if (ok && binary) data = raw;
          else try { data = JSON.parse(raw.toString('utf8')); } catch { return reject(new MkChatError()); }
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const messages = {
            CASE_READ_ONLY: '종료된 상담입니다. 새 상담을 시작해 주세요.',
            REQUEST_KEY_CONFLICT: '이미 다른 내용으로 전송한 메시지입니다.',
            MESSAGE_REMOVED: '삭제된 메시지입니다.'
          };
          if (support && data?.message && data.code !== 'CLIENT_AUTH_REQUIRED') {
            return reject(new MkChatError(data.message, response.statusCode, data.code));
          }
          const message = messages[data?.code];
          return reject(new MkChatError(message, message ? 409 : 502, data?.code));
        }
        resolve({ data, status: response.statusCode, cookies: response.headers['set-cookie'] || [] });
      });
    });
    request.on('error', () => reject(new MkChatError()));
    request.end(payload === undefined || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
  });
}

export function createMkChat(pool, env = process.env) {
  const { MK_BASE_URL: address, MK_PARTNER_TOKEN: token } = env;
  if (!address && !token) return null;
  if (!address || !token) throw new Error('MK_BASE_URL과 MK_PARTNER_TOKEN을 함께 설정해 주세요.');
  const base = new URL(address);
  const localHttp = env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      !(base.protocol === 'https:' || (base.protocol === 'http:' && localHttp))) {
    throw new Error('MK_BASE_URL은 HTTPS 또는 개발용 로컬 HTTP 서버 주소여야 합니다.');
  }
  const localDocker = env.NODE_ENV !== 'production' && base.hostname === 'host.docker.internal' && Boolean(env.MK_CA_FILE);
  const request = mkRequest(base, env.MK_CA_FILE ? readFileSync(env.MK_CA_FILE) : undefined, localDocker);
  const partner = { Authorization: 'Bearer ' + token };
  const sessions = new Map();

  async function storedRoom(userId) {
    const [[room]] = await pool.execute('SELECT subject_ref,intake_id,case_id FROM mk_chat_rooms WHERE user_id=?', [userId]);
    return room;
  }

  async function identityFor(userId) {
    let room = await storedRoom(userId);
    if (!room) {
      await pool.execute('INSERT INTO mk_chat_rooms (user_id,subject_ref,intake_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE user_id=user_id',
        [userId, randomUUID(), randomUUID()]);
      room = await storedRoom(userId);
    }
    return room;
  }

  async function roomFor(userId) {
    const room = await identityFor(userId);
    if (room.case_id) return room;
    // Concurrent opens and retries after a lost response use the same MK intake ID.
    let data;
    try {
      ({ data } = await request('/cases', partner, {
        support_subject_ref: room.subject_ref, intake_request_id: room.intake_id, channel: 'WEB'
      }));
    } catch (error) {
      if (error.code !== 'TICKET_DELETED') throw error;
      await pool.execute('UPDATE mk_chat_rooms SET intake_id=? WHERE user_id=? AND intake_id=? AND case_id IS NULL',
        [randomUUID(), userId, room.intake_id]);
      throw new MkChatError('이전 상담이 삭제되었습니다. 다시 연결해 주세요.', 409);
    }
    return linkRoom(userId, room, data?.case_id);
  }

  async function linkRoom(userId, room, caseId) {
    if (!isUuid(caseId)) throw new MkChatError();
    const [saved] = await pool.execute('UPDATE mk_chat_rooms SET case_id=? WHERE user_id=? AND intake_id=?', [caseId, userId, room.intake_id]);
    if (!saved.affectedRows && (await storedRoom(userId))?.case_id !== caseId) {
      throw new MkChatError('상담방이 변경되었습니다. 다시 연결해 주세요.', 409);
    }
    return { ...room, case_id: caseId };
  }

  async function handoffChat(userId, chatId) {
    let room = await identityFor(userId);
    const submit = () => request('/partner/ai-chat/' + chatId + '/handoff',
      { ...partner, 'X-Support-Subject': room.subject_ref }, { intake_request_id: room.intake_id }, { support: true });
    let result;
    try {
      result = await submit();
    } catch (error) {
      if (error.code !== 'AI_HANDOFF_ROOM_CLOSED') throw error;
      await pool.execute('UPDATE mk_chat_rooms SET intake_id=?,case_id=NULL WHERE user_id=? AND intake_id=?',
        [randomUUID(), userId, room.intake_id]);
      room = await storedRoom(userId);
      result = await submit();
    }
    if (!isUuid(result.data?.case_id) || !isUuid(result.data.intake_request_id)) throw new MkChatError();
    // An old handoff retry must not switch the customer's current room back to a previous ticket.
    if (room.intake_id === result.data.intake_request_id) await linkRoom(userId, room, result.data.case_id);
    return result.data.case_id;
  }

  async function sessionFor(room) {
    const id = room.case_id;
    if (sessions.has(id)) return sessions.get(id);
    const pending = (async () => {
      const { data: grant } = await request('/cases/' + id + '/entry-codes', partner, { support_subject_ref: room.subject_ref });
      if (grant?.case_id !== id || !grant.entry_code) throw new MkChatError();
      const { data, cookies } = await request('/chat/sessions', {}, { entry_code: grant.entry_code });
      const cookie = cookies.map(line => line.split(';', 1)[0]).find(part => /^tm_chat=[\w-]+$/.test(part));
      const ttl = Date.parse(data?.expires_at) - Date.now();
      if (data?.case_id !== id || !cookie || !(ttl > 0)) throw new MkChatError();
      setTimeout(() => { if (sessions.get(id) === pending) sessions.delete(id); }, ttl).unref();
      return cookie;
    })();
    sessions.set(id, pending);
    try { return await pending; } catch (error) {
      if (sessions.get(id) === pending) sessions.delete(id);
      throw error;
    }
  }

  async function messages(room, payload) {
    const path = '/cases/' + room.case_id + '/messages';
    const call = async () => request(path, { Cookie: await sessionFor(room), 'X-Chat-Actor': 'customer' }, payload);
    try { return (await call()).data; } catch (error) {
      if (error.code !== 'CHAT_SESSION_REQUIRED') throw error;
      sessions.delete(room.case_id);
      return (await call()).data;
    }
  }

  async function history(room) {
    try {
      const data = await messages(room);
      if (!Array.isArray(data?.items)) throw new MkChatError();
      return {
        caseId: room.case_id, readOnly: data.read_only, status: data.status,
        messages: data.read_only ? [] : data.items.slice(-100).map(item => ({
          id: item.message_id, sender: item.author_role === 'AGENT' ? 'partner' : 'customer', body: item.body, created_at: item.sent_at
        }))
      };
    } catch (error) {
      if (!['CASE_NOT_FOUND', 'TICKET_DELETED'].includes(error.code)) throw error;
      return { caseId: room.case_id, readOnly: true, status: 'CLOSED', messages: [] };
    }
  }

  return {
    handoffChat,
    asset(path) { return request(path, {}, undefined, { binary: true }); },
    availability() { return request('/partner/ai-chat/availability', partner, undefined, { support: true }); },
    async support(userId, path, payload, headers = {}) {
      const room = await identityFor(userId);
      return request(path, { ...headers, ...partner, 'X-Support-Subject': room.subject_ref }, payload,
        { support: true, timeout: 24000 });
    },
    async read(userId) {
      const room = await storedRoom(userId);
      return room?.case_id ? history(room) : { caseId: null, readOnly: false, messages: [] };
    },
    async send(userId, caseId, clientMessageId, body) {
      const room = await roomFor(userId);
      if (caseId && caseId !== room.case_id) throw new MkChatError('상담방이 변경되었습니다. 대화를 다시 확인해 주세요.', 409);
      await messages(room, { client_message_id: clientMessageId, body });
    },
    async open(userId, closedId) {
      const room = await roomFor(userId);
      if (room.case_id !== closedId || !(await history(room)).readOnly) return room.case_id;
      await pool.execute('UPDATE mk_chat_rooms SET intake_id=?,case_id=NULL WHERE user_id=? AND case_id=?', [randomUUID(), userId, closedId]);
      sessions.delete(closedId);
      return (await roomFor(userId)).case_id;
    }
  };
}
