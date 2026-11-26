const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { user: null, view: 'home', ticketType: 'consultation', ticketRequestId: null, partnerChatUser: null, chatTimer: null, partnerPhone: null };
const ticketNames = { consultation: '상담', reentry: '재입장', phone: '전화 상담' };
const categoryNames = { market: '시세·시장 정보', account: '계정·로그인', service: '서비스 이용', other: '기타 문의' };
const statusNames = { received: '접수 완료', in_progress: '진행 중', completed: '상담 완료' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const won = value => Number.isFinite(Number(value)) ? `${new Intl.NumberFormat('ko-KR').format(Math.round(value))}원` : '—';
const percent = value => `${Number(value) >= 0 ? '+' : ''}${(Number(value) * 100).toFixed(2)}%`;
const when = value => new Date(value).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
let toastTimer;
let lastSessionTouch = Date.now();

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
const allowedViews = ['home', 'market', 'consult', 'process', 'privacy', 'terms', 'admin', 'partner'];
function resetTicketDraft() {
  $('#ticketForm').reset();
  setTicketType('consultation');
  $('#recordingToggle').setAttribute('aria-pressed', 'false');
  $('#recordingToggle').textContent = '녹취 요청 안 함';
}
function showView(view, { updateHistory = true } = {}) {
  if (!allowedViews.includes(view)) return;
  if (view === 'admin' && state.user?.role !== 'admin') return toast('관리자만 이용할 수 있습니다.');
  if (view === 'partner' && state.user?.role !== 'partner') return toast('수탁사 담당자만 이용할 수 있습니다.');
  if (state.view === 'consult' && view !== 'consult') resetTicketDraft();
  state.view = view;
  $$('.view').forEach(el => el.classList.toggle('active', el.id === `view-${view}`));
  $('.main-nav').classList.remove('open'); $('#menuButton').setAttribute('aria-expanded', 'false');
  if (updateHistory && location.hash !== `#${view}`) history.pushState({ view }, '', `#${view}`);
  scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'consult') loadTickets();
  if (view === 'market') window.marketUI.enter();
  if (view === 'admin') loadAdmin();
  if (view === 'partner') loadPartner();
}
function clearRegisterForm() {
  const form = $('#registerForm');
  form.reset();
  form.querySelectorAll('input').forEach(input => {
    if (input.type === 'checkbox' || input.type === 'radio') input.checked = false;
    else input.value = '';
  });
}
function openAuth(mode = 'login') {
  if (mode === 'login') $('#loginForm').reset();
  if (mode === 'register') clearRegisterForm();
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
  $('#identityStatus').textContent = state.user?.role === 'customer'
    ? ({ verified: '본인확인 완료', demo_verified: '실습 인증 완료', pending: '본인확인 진행 중', rejected: '본인확인 실패 · 다시 시도 가능', not_started: '본인확인 미진행' }[state.user.identity_status] || '본인확인 미진행')
    : '로그인 후 확인 가능';
  $('#openIdentityFromConsult').classList.toggle('hidden', state.user?.identity_status === 'verified');
}
async function refreshUser() {
  const previousUser = state.user;
  try { state.user = (await api('/api/auth/me')).user; } catch { state.user = null; }
  lastSessionTouch = Date.now();
  renderHeader(); renderIdentity();
  if (previousUser && !state.user) {
    closeChat();
    if (['admin', 'partner'].includes(state.view)) showView('home');
    toast('세션이 만료되었습니다. 다시 로그인해 주세요.');
  }
}
function touchSession() {
  if (!state.user || Date.now() - lastSessionTouch < 5 * 60 * 1000) return;
  lastSessionTouch = Date.now();
  refreshUser();
}
