const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { user: null, view: 'home', ticketType: 'consultation', partnerChatUser: null, chatTimer: null, partnerPhone: null };
const ticketNames = { consultation: '상담', reentry: '재입장', phone: '전화 상담' };
const statusNames = { received: '접수 완료', in_progress: '진행 중', completed: '상담 완료' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const won = value => Number.isFinite(Number(value)) ? `${new Intl.NumberFormat('ko-KR').format(Math.round(value))}원` : '—';
const percent = value => `${Number(value) >= 0 ? '+' : ''}${(Number(value) * 100).toFixed(2)}%`;
const when = value => new Date(value).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
let toastTimer;

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || '요청에 실패했습니다.'), { status: response.status, captchaRequired: data.captchaRequired === true });
  return data;
}
function showView(view) {
  if (view === 'admin' && state.user?.role !== 'admin') return toast('관리자만 이용할 수 있습니다.');
  if (view === 'partner' && state.user?.role !== 'partner') return toast('수탁사 담당자만 이용할 수 있습니다.');
  state.view = view;
  $$('.view').forEach(el => el.classList.toggle('active', el.id === `view-${view}`));
  $('.main-nav').classList.remove('open'); $('#menuButton').setAttribute('aria-expanded', 'false');
  history.replaceState({}, '', `#${view}`); scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'consult') loadTickets();
  if (view === 'market') window.marketUI.enter();
  if (view === 'admin') loadAdmin();
  if (view === 'partner') loadPartner();
}
function openAuth(mode = 'login') {
  $$('.auth-tabs button').forEach(button => button.classList.toggle('active', button.dataset.auth === mode));
  $('#loginForm').classList.toggle('hidden', mode !== 'login');
  $('#registerForm').classList.toggle('hidden', mode !== 'register');
  $('#authFeedback').textContent = '';
  if (!$('#authDialog').open) $('#authDialog').showModal();
  if (mode === 'login' && window.rkxCaptcha.isRequired()) window.rkxCaptcha.show();
}
function renderHeader() {
  const target = $('#headerActions');
  if (!state.user) target.innerHTML = '<button class="text-button" data-modal="login">로그인</button><button class="button button-dark small" data-modal="register">회원가입</button>';
  else target.innerHTML = `<span class="welcome-name">${escapeHtml(state.user.name)}님</span>${state.user.role === 'admin' ? '<button class="text-button" data-view="admin">관리자</button>' : ''}${state.user.role === 'partner' ? '<button class="text-button" data-view="partner">말결 화면</button>' : ''}<button class="text-button" id="logoutButton">로그아웃</button>`;
  $('#chatLauncher').classList.toggle('hidden', !!state.user && state.user.role !== 'customer');
  renderPhone();
}
function renderPhone() {
  if (!state.partnerPhone) return;
  $('#partnerPhoneLink').textContent = state.user?.role === 'customer' ? `녹취 안내 확인 후 ${state.partnerPhone} 연결` : '로그인 후 전화 연결';
}
function renderIdentity() {
  $('#identityStatus').textContent = state.user?.role === 'customer' ? '본인확인 완료' : '가입 시 본인확인 진행';
}
async function refreshUser() {
  try { state.user = (await api('/api/auth/me')).user; } catch { state.user = null; }
  renderHeader(); renderIdentity();
}
async function submitAuth(form, mode) {
  const fd = new FormData(form), payload = Object.fromEntries(fd.entries());
  if (mode === 'register') for (const key of ['termsConsent', 'privacyConsent', 'outsourcingConsent']) payload[key] = fd.has(key);
  if (mode === 'login' && window.rkxCaptcha.isRequired()) {
    payload.captchaToken = window.rkxCaptcha.response();
    if (!payload.captchaToken) { $('#authFeedback').textContent = '로봇 확인을 완료해 주세요.'; return; }
  }
  try {
    const result = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
    if (mode === 'register') {
      $('#authFeedback').textContent = '본인확인 화면으로 이동합니다. 완료 결과를 받으면 계정이 생성됩니다.';
      location.assign(result.verificationUrl);
      return;
    }
    state.user = result.user; window.rkxCaptcha.hide(); $('#authDialog').close(); form.reset(); renderHeader(); renderIdentity();
    toast('로그인되었습니다.');
    if (state.user.role === 'admin') showView('admin');
    else if (state.user.role === 'partner') showView('partner');
    else if (state.view === 'consult') loadTickets();
    if (!$('#chatPanel').classList.contains('hidden')) loadChat();
  } catch (error) {
    if (mode === 'login') {
      if (payload.captchaToken) window.rkxCaptcha.reset();
      if (error.captchaRequired) window.rkxCaptcha.show();
      else if (error.status === 423) window.rkxCaptcha.hide();
    }
    $('#authFeedback').textContent = error.message;
  }
}
async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
  state.user = null; state.partnerChatUser = null; renderHeader(); renderIdentity(); closeChat(); showView('home');
  $('#chatMessages').innerHTML = '<div class="chat-empty">로그인 후 상담원과 채팅을 시작할 수 있습니다.</div>';
  toast('로그아웃되었습니다.');
}
function setTicketType(type) {
  state.ticketType = type;
  $$('.consult-tabs button').forEach(button => button.classList.toggle('active', button.dataset.ticketType === type));
  const titles = { consultation: ['상담 접수', '내용을 남겨주시면 담당자가 확인합니다.'], reentry: ['상담 재입장', '이전 상담을 이어서 진행할 내용을 남겨주세요.'], phone: ['전화 상담 요청', '희망 연락 시간을 남기고 녹취 여부를 선택하세요.'] };
  $('#ticketIntro h2').textContent = titles[type][0]; $('#ticketIntro p').textContent = titles[type][1];
  $('#preferredTimeField').classList.toggle('hidden', type !== 'phone');
  $('#preferredTimeField input').required = type === 'phone';
  $('#recordingField').classList.toggle('hidden', type !== 'phone');
  $('#ticketForm .form-submit').textContent = type === 'phone' ? '전화 상담 신청하기' : type === 'reentry' ? '재입장 신청하기' : '상담 접수하기';
  $('#ticketFeedback').textContent = '';
}
async function submitTicket(event) {
  event.preventDefault(); if (!state.user) return openAuth('login');
  const fd = new FormData(event.currentTarget);
  const payload = { type: state.ticketType, subject: fd.get('subject'), description: fd.get('description'), preferredTime: fd.get('preferredTime'), recordingConsent: fd.has('recordingConsent') };
  try {
    const result = await api('/api/tickets', { method: 'POST', body: JSON.stringify(payload) });
    event.currentTarget.reset(); $('#recordingToggle').setAttribute('aria-pressed', 'false'); $('#recordingToggle').textContent = '녹취 요청 안 함';
    const delivery = result.partnerStatus === 'sent' ? '말결 접수 채널로 전달되었습니다.' : result.partnerStatus === 'failed' ? '말결 전송 실패 · 담당자 확인이 필요합니다.' : '말결 실제 전송은 미설정이며 테스트 화면에 저장되었습니다.';
    $('#ticketFeedback').textContent = `접수번호 ${result.receiptNumber} · ${delivery}`;
    loadTickets(); toast('상담이 접수되었습니다.');
  } catch (error) { $('#ticketFeedback').textContent = error.message; }
}
async function loadTickets() {
  const target = $('#myTickets');
  if (!state.user || state.user.role !== 'customer') { target.textContent = '고객 계정으로 로그인하면 상담 내역이 표시됩니다.'; return; }
  try {
    const { tickets } = await api('/api/tickets');
    target.innerHTML = tickets.length ? tickets.slice(0, 5).map(t => `<div class="ticket-mini"><strong>${escapeHtml(t.receipt_number)}</strong><span>${escapeHtml(t.subject)}</span><span>${ticketNames[t.type]} · ${statusNames[t.status]} · ${when(t.created_at)}</span></div>`).join('') : '아직 접수된 상담이 없습니다.';
  } catch (error) { target.textContent = error.message; }
}
async function loadPublicConfig() {
  try {
    const { partnerPhone, recaptchaSiteKey } = await api('/api/public-config');
    window.rkxCaptcha.configure(recaptchaSiteKey);
    if (partnerPhone) {
      state.partnerPhone = partnerPhone;
      $('#partnerPhoneLink').href = `tel:${partnerPhone}`;
      renderPhone();
      $('#partnerPhoneLink').classList.remove('hidden');
      $('#partnerPhoneUnavailable').classList.add('hidden');
    }
  } catch {}
}
function renderMessages(target, messages, mineRole = 'customer') {
  target.innerHTML = messages.length ? messages.map(m => `<div class="chat-bubble ${m.sender === mineRole ? 'mine' : ''}">${escapeHtml(m.body)}<small>${m.sender === 'partner' ? '말결 상담원' : '고객'} · ${when(m.created_at)}</small></div>`).join('') : '<div class="chat-empty">첫 메시지를 남겨주세요.</div>';
  target.scrollTop = target.scrollHeight;
}
async function loadChat() {
  if ($('#chatPanel').classList.contains('hidden')) return;
  if (!state.user || state.user.role !== 'customer') { $('#chatMessages').innerHTML = '<div class="chat-empty">고객 계정으로 로그인 후 채팅을 시작할 수 있습니다.</div>'; return; }
  try { const { messages } = await api('/api/chat'); renderMessages($('#chatMessages'), messages); } catch (error) { toast(error.message); }
}
function openChat() {
  if (state.user && state.user.role !== 'customer') return toast('고객 계정에서 이용할 수 있습니다.');
  $('#chatPanel').classList.remove('hidden'); $('#chatLauncher').classList.add('hidden');
  loadChat(); clearInterval(state.chatTimer); state.chatTimer = setInterval(loadChat, 5000);
  if (!state.user) openAuth('login');
}
function closeChat() { $('#chatPanel').classList.add('hidden'); if (!state.user || state.user.role === 'customer') $('#chatLauncher').classList.remove('hidden'); clearInterval(state.chatTimer); }
async function submitChat(event) {
  event.preventDefault(); if (!state.user) return openAuth('login');
  const input = event.currentTarget.elements.body, body = input.value.trim(); if (!body) return;
  try {
    const result = await api('/api/chat', { method: 'POST', body: JSON.stringify({ body }) });
    input.value = ''; loadChat();
    if (result.partnerStatus !== 'sent') toast(result.partnerStatus === 'failed' ? '말결 전송 실패 · 담당자 확인 필요' : '실제 연동 전 · 말결 테스트 화면에 저장됨');
  } catch (error) { toast(error.message); }
}
async function loadAdmin() {
  if (state.user?.role !== 'admin') return;
  try {
    const data = await api('/api/admin/overview');
    $('#adminContent').innerHTML = `<div class="admin-stats"><div class="admin-stat"><span>가입 고객</span><strong>${data.users.total || 0}</strong></div><div class="admin-stat"><span>접수 상담</span><strong>${data.tickets.received || 0}</strong></div><div class="admin-stat"><span>가입 신청</span><strong>${data.signups.length}</strong></div></div><div class="admin-toolbar"><span>조회·다운로드는 접속 기록으로 남습니다.</span><a class="button button-outline small" href="/api/admin/export">마스킹 목록 다운로드</a></div><div class="admin-layout"><div class="admin-card"><h2>가입 신청 · 본인확인 결과</h2>${data.signups.length ? data.signups.map(s => `<div class="admin-ticket"><strong>신청 #${s.id} · ${escapeHtml(s.name)}</strong><small>${escapeHtml(s.email)} · ${escapeHtml(s.status)} · ${when(s.created_at)}</small></div>`).join('') : '<p>가입 신청이 없습니다.</p>'}</div><div class="admin-card"><h2>상담 접수 상태</h2>${data.recent.length ? data.recent.map(t => `<div class="admin-ticket"><strong>${escapeHtml(t.receipt_number)}</strong><small>${escapeHtml(t.customer_key || '')} · ${ticketNames[t.type]} · ${statusNames[t.status]} · ${escapeHtml(t.assignment_kind || '미배정')} · ${when(t.created_at)}</small></div>`).join('') : '<p>접수된 상담이 없습니다.</p>'}</div></div><div class="admin-layout admin-lower"><div class="admin-card"><h2>회원 기본정보 · 마스킹</h2>${data.members.length ? data.members.map(m => `<div class="admin-ticket"><strong>${escapeHtml(m.customer_key || '')} · ${escapeHtml(m.name)}</strong><small>${escapeHtml(m.email)} · ${escapeHtml(m.phone)} · ${escapeHtml(m.identity_status)} · ${when(m.created_at)}</small></div>`).join('') : '<p>가입 고객이 없습니다.</p>'}</div><div class="admin-card"><h2>내 접근 기록</h2>${data.accessLogs.map(l => `<div class="admin-ticket"><strong>${escapeHtml(l.action)} · ${escapeHtml(l.target_type)}</strong><small>${when(l.created_at)}</small></div>`).join('')}</div></div>`;
  } catch (error) { $('#adminContent').textContent = error.message; }
}
async function loadPartner() {
  if (state.user?.role !== 'partner') return;
  try {
    const data = await api('/api/partner/overview');
    $('#partnerContent').innerHTML = `<div class="admin-layout"><div class="admin-card"><h2>상담 접수 · 배정</h2>${data.tickets.length ? data.tickets.map(t => `<div class="partner-ticket"><div class="partner-ticket-head"><strong>${escapeHtml(t.receipt_number)}</strong><small>${when(t.created_at)}</small></div><p><b>${ticketNames[t.type]}</b> · 고객키 ${escapeHtml(t.customer_key || '')} · ${escapeHtml(t.name)}${t.phone ? ` · 연락처 ${escapeHtml(t.phone)}` : ''}</p><h3>${escapeHtml(t.subject)}</h3><p>${escapeHtml(t.description)}</p>${t.preferred_time ? `<p>희망 시간: ${escapeHtml(t.preferred_time)}</p>` : ''}<div class="partner-controls"><select data-partner-ticket="${t.id}" aria-label="상담 상태"><option value="received" ${t.status === 'received' ? 'selected' : ''}>접수</option><option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>진행</option><option value="completed" ${t.status === 'completed' ? 'selected' : ''}>완료</option></select><select data-partner-assignment="${t.id}" aria-label="상담 담당"><option value="">미배정</option><option value="ai" ${t.assignment_kind === 'ai' ? 'selected' : ''}>AI</option><option value="counselor" ${t.assignment_kind === 'counselor' ? 'selected' : ''}>상담원</option></select></div>${t.type === 'phone' ? `<div class="recording-box"><strong>모의 녹취</strong><small>${t.recording_consent ? '고객 녹취 요청·동의 확인됨' : '녹취 미동의 · 등록 불가'}</small><input type="file" accept="audio/wav,audio/webm,audio/mpeg,audio/mp4" data-recording-file="${t.id}" ${t.recording_consent ? '' : 'disabled'}><button class="side-link" data-upload-recording="${t.id}" ${t.recording_consent ? '' : 'disabled'}>모의 녹취 등록</button><button class="side-link" data-recordings="${t.id}">녹취·파기 이력 보기</button><div id="recordings-${t.id}"></div></div>` : ''}</div>`).join('') : '<p>접수된 상담이 없습니다.</p>'}</div><div class="admin-card"><h2>고객 채팅</h2>${data.chats.length ? data.chats.map(c => `<button class="chat-customer" data-partner-chat-user="${c.id}">${escapeHtml(c.name)}<small>${escapeHtml(c.customer_key)} · ${when(c.last_at)}</small></button>`).join('') : '<p>채팅 내역이 없습니다.</p>'}<div id="partnerChatBox"></div></div></div>`;
    if (state.partnerChatUser) openPartnerChat(state.partnerChatUser);
  } catch (error) { $('#partnerContent').textContent = error.message; }
}
async function openPartnerChat(userId) {
  state.partnerChatUser = userId;
  try {
    const { messages } = await api(`/api/partner/chat/${userId}`);
    $('#partnerChatBox').innerHTML = '<div class="admin-chat-thread" id="partnerChatThread"></div><form class="admin-chat-form" id="partnerChatForm"><input name="body" maxlength="2000" required placeholder="상담 답변 입력" aria-label="말결 답변"><button type="submit">전송</button></form>';
    renderMessages($('#partnerChatThread'), messages, 'partner');
  } catch (error) { toast(error.message); }
}
async function loadPartnerRecordings(ticketId) {
  const target = $(`#recordings-${ticketId}`);
  try {
    const { recordings, events } = await api(`/api/partner/recordings/${ticketId}`);
    target.innerHTML = recordings.length ? recordings.map(r => `<div class="recording-entry"><strong>녹취 #${r.id}</strong><small>보관 만료 ${when(r.retention_until)} · ${r.deleted_at ? `파기 ${when(r.deleted_at)}` : '보관 중'}</small>${r.deleted_at ? '' : `<audio controls preload="none" src="/api/partner/recordings/${r.id}/audio"></audio>`}</div>`).join('') + `<div class="recording-events">${events.map(e => `${escapeHtml(e.action)} · ${when(e.occurred_at)}`).join('<br>')}</div>` : '<p>등록된 모의 녹취가 없습니다.</p>';
  } catch (error) { target.textContent = error.message; }
}
async function uploadRecording(ticketId) {
  const file = $(`[data-recording-file="${ticketId}"]`).files[0];
  if (!file) return toast('모의 녹취 오디오 파일을 선택해 주세요.');
  if (file.size > 10 * 1024 * 1024) return toast('10MB 이하 파일만 등록할 수 있습니다.');
  try {
    const response = await fetch(`/api/partner/recordings/${ticketId}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '등록에 실패했습니다.');
    toast('모의 녹취가 등록되었습니다.'); loadPartnerRecordings(ticketId);
  } catch (error) { toast(error.message); }
}

document.addEventListener('click', event => {
  const view = event.target.closest('[data-view]'); if (view) { event.preventDefault(); showView(view.dataset.view); return; }
  const modal = event.target.closest('[data-modal]'); if (modal) { openAuth(modal.dataset.modal); return; }
  const authTab = event.target.closest('[data-auth]'); if (authTab) { openAuth(authTab.dataset.auth); return; }
  const ticketTab = event.target.closest('[data-ticket-type]'); if (ticketTab) { setTicketType(ticketTab.dataset.ticketType); return; }
  if (event.target.closest('#logoutButton')) return logout();
  const chatUser = event.target.closest('[data-partner-chat-user]'); if (chatUser) return openPartnerChat(chatUser.dataset.partnerChatUser);
  const upload = event.target.closest('[data-upload-recording]'); if (upload) return uploadRecording(upload.dataset.uploadRecording);
  const recordings = event.target.closest('[data-recordings]'); if (recordings) return loadPartnerRecordings(recordings.dataset.recordings);
  if (event.target.closest('#partnerPhoneLink') && state.user?.role !== 'customer') { event.preventDefault(); openAuth('login'); }
});
document.addEventListener('change', async event => {
  const statusSelect = event.target.closest('[data-partner-ticket]'), assignmentSelect = event.target.closest('[data-partner-assignment]');
  if (!statusSelect && !assignmentSelect) return;
  const id = statusSelect?.dataset.partnerTicket || assignmentSelect.dataset.partnerAssignment;
  const status = $(`[data-partner-ticket="${id}"]`).value;
  const assignmentKind = $(`[data-partner-assignment="${id}"]`).value || null;
  try { await api(`/api/partner/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ status, assignmentKind }) }); toast('상담 상태가 변경되었습니다.'); }
  catch (error) { toast(error.message); loadPartner(); }
});
document.addEventListener('submit', async event => {
  if (event.target.id !== 'partnerChatForm') return;
  event.preventDefault(); const input = event.target.elements.body;
  try { await api(`/api/partner/chat/${state.partnerChatUser}`, { method: 'POST', body: JSON.stringify({ body: input.value }) }); input.value = ''; openPartnerChat(state.partnerChatUser); }
  catch (error) { toast(error.message); }
});
$('#menuButton').addEventListener('click', () => { const open = $('.main-nav').classList.toggle('open'); $('#menuButton').setAttribute('aria-expanded', String(open)); });
$('#loginForm').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, 'login'); });
$('#registerForm').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, 'register'); });
$('#closeAuth').addEventListener('click', () => $('#authDialog').close());
$('#openPolicyFromAuth').addEventListener('click', () => { $('#authDialog').close(); showView('privacy'); });
$('#openTermsFromAuth').addEventListener('click', () => { $('#authDialog').close(); showView('terms'); });
$('#ticketForm').addEventListener('submit', submitTicket);
$('#openChatFromConsult').addEventListener('click', openChat);
$('#chatLauncher').addEventListener('click', openChat);
$('#closeChat').addEventListener('click', closeChat);
$('#chatForm').addEventListener('submit', submitChat);
$('#recordingToggle').addEventListener('click', () => {
  const checkbox = $('#recordingField input'); checkbox.checked = !checkbox.checked;
  $('#recordingToggle').setAttribute('aria-pressed', String(checkbox.checked));
  $('#recordingToggle').textContent = checkbox.checked ? '녹취 요청함' : '녹취 요청 안 함';
});
window.addEventListener('hashchange', () => { const view = location.hash.slice(1); if (['home','market','consult','process','privacy','terms','admin','partner'].includes(view)) showView(view); });
refreshUser().then(() => { const initial = location.hash.slice(1); if (['market','consult','process','privacy','terms','admin','partner'].includes(initial)) showView(initial); });
loadPublicConfig(); window.marketUI.init();
