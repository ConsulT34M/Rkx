import crypto from 'node:crypto';
import fs from 'node:fs';

const people = JSON.parse(fs.readFileSync(new URL('./samples/people.json', import.meta.url), 'utf8')).people;
const imageLimit = 5 * 1024 * 1024;

export const demoPeople = Object.freeze(people.map(person => Object.freeze({ ...person })));
export const demoPerson = demoPeople[0];
export const samplePersonByName = name => demoPeople.find(person => person.name === String(name || '').trim()) || null;
export const samplePersonByNo = number => demoPeople.find(person => person.person_no === Number(number)) || null;

export function publicDemoPerson(person = demoPerson) {
  return {
    personNo: person.person_no,
    name: person.name,
    phone: person.phone_number,
    rrn: person.rrn,
    issueDate: person.issue_date,
    sampleCard: `/api/identity/demo-card/${person.person_no}.svg`,
    sampleFace: `/api/identity/demo-face/${person.person_no}.svg`
  };
}

const cardTemplate = fs.readFileSync(new URL('./public/assets/demo-id-card.svg', import.meta.url), 'utf8');
const faceTemplate = fs.readFileSync(new URL('./public/assets/demo-person.svg', import.meta.url), 'utf8');
const xml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
export function demoCardSvg(person) {
  return cardTemplate.replaceAll('장민지', xml(person.name))
    .replace('660119-2******', `${person.rrn.slice(0, 6)}-${person.rrn[6]}******`)
    .replace('2021-05-25', xml(person.issue_date))
    .replace('IJ-info 샘플 인물 01', `IJ-info 샘플 인물 ${String(person.person_no).padStart(2, '0')}`);
}
export function demoFaceSvg(person) { return faceTemplate.replaceAll('장민지', xml(person.name)); }

export function partnerConfigured(env = process.env) {
  return Boolean(env.IJINFO_BASE_URL && env.IJINFO_API_KEY && env.IJINFO_HMAC_SECRET);
}

export function partnerPartiallyConfigured(env = process.env) {
  return ['IJINFO_BASE_URL', 'IJINFO_API_KEY', 'IJINFO_HMAC_SECRET'].some(key => Boolean(env[key])) && !partnerConfigured(env);
}

export function partnerBaseUrl(env = process.env) {
  const url = new URL(env.IJINFO_BASE_URL);
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || (env.NODE_ENV !== 'production' && local && url.protocol === 'http:'))) {
    throw new Error('IJINFO_BASE_URL은 HTTPS 또는 개발 환경의 로컬 HTTP 주소여야 합니다.');
  }
  return url.origin;
}

export function sampleMatches({ name, phone, rrn, issueDate }, person = demoPerson) {
  if (!person || person.mois_status !== '정상') return false;
  if (name !== undefined && String(name).trim() !== person.name) return false;
  if (phone !== undefined && String(phone).replace(/\D/g, '') !== person.phone_number) return false;
  if (rrn !== undefined && String(rrn).replace(/[\s-]/g, '') !== person.rrn) return false;
  if (issueDate !== undefined && issueDate !== person.issue_date) return false;
  return true;
}

export function parseDemoImage(dataUrl) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || '');
  if (!match || match[2].length > Math.ceil(imageLimit / 3) * 4 + 16) throw new Error('PNG 또는 JPEG 이미지(5MB 이하)를 선택해 주세요.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > imageLimit) throw new Error('이미지는 5MB 이하로 등록해 주세요.');
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if ((match[1] === 'png' && !png) || (match[1] === 'jpeg' && !jpeg)) throw new Error('이미지 형식을 확인해 주세요.');
  return { base64: match[2], filename: match[1] === 'png' ? 'sample.png' : 'capture.jpg' };
}

// CI는 더 이상 RKX가 만들지 않는다.
//
// 전에는 IJINFO_DEMO_CI_KEY_B64로 주민등록번호에서 CI를 계산해 IJ-info에 보냈다.
// 그러면 IJ-info의 X-01 대조(휴대폰 명의자 = 신분증 명의자)가 같은 키로 같은 번호를
// 두 번 계산해 비교하는 항등식이 되어 검사 구실을 하지 못한다.
//
// 이제 휴대폰 본인확인은 IJ-info가 하고(IA-23·IA-24), CI는 통신사가 발급해
// IJ-info 안에만 남는다. RKX는 CI를 보지 않는다.

export function inboxUrl(env = process.env) {
  // 이용자 휴대폰의 문자 수신함. 인증번호는 여기로만 간다 — RKX 서버는 볼 수 없다.
  return env.IJINFO_INBOX_URL || `${partnerBaseUrl(env)}/test-inbox/`;
}

export function verifyIjinfoSignature(timestamp, body, signature, env = process.env) {
  const secret = env.IJINFO_HMAC_SECRET || '';
  if (!secret || !/^\d{10}$/.test(timestamp || '') || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^[0-9a-f]{64}$/i.test(signature || '')) return false;
  const expected = crypto.createHmac('sha256', secret).update(timestamp).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.toLowerCase()));
}

export async function ijinfoRequest(method, endpoint, payload = null, { env = process.env, fetchImpl = fetch } = {}) {
  if (!partnerConfigured(env)) throw new Error('IJ-info 연동 설정이 없습니다.');
  const base = partnerBaseUrl(env);
  const body = payload === null ? '' : JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', env.IJINFO_HMAC_SECRET).update(timestamp).update(body).digest('hex');
  const response = await fetchImpl(`${base}/api/v1${endpoint}`, {
    method,
    headers: { 'X-Api-Key': env.IJINFO_API_KEY, 'X-Timestamp': timestamp, 'X-Signature': signature, 'Content-Type': 'application/json' },
    body: payload === null ? undefined : body,
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message || result.description || 'IJ-info 인증 요청에 실패했습니다.');
    error.status = response.status;
    error.reasonCode = result.reason_code;
    error.attemptsLeft = result.attempts_left;
    throw error;
  }
  return result;
}
