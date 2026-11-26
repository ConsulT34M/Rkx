document.addEventListener('click', event => {
  if (event.target.closest('[data-chat-open]')) { event.preventDefault(); openChat(); return; }
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
document.addEventListener('pointerdown', touchSession, { passive: true });
document.addEventListener('keydown', touchSession);
$('#loginForm').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, 'login'); });
$('#registerForm').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, 'register'); });
$('#closeAuth').addEventListener('click', () => $('#authDialog').close());
$('#authDialog').addEventListener('close', () => { $('#loginForm').reset(); clearRegisterForm(); $('#authFeedback').textContent = ''; });
$('#openPolicyFromAuth').addEventListener('click', () => { $('#authDialog').close(); showView('privacy'); });
$('#openTermsFromAuth').addEventListener('click', () => { $('#authDialog').close(); showView('terms'); });
$('#ticketForm').addEventListener('submit', submitTicket);
$('#ticketForm').addEventListener('input', () => { state.ticketRequestId = null; });
$('#ticketForm').addEventListener('change', () => { state.ticketRequestId = null; });
$$('[data-admin-search]').forEach(form => form.addEventListener('submit', searchAdmin));
$('#openChatFromConsult').addEventListener('click', openChat);
$('#openIdentityFromConsult').addEventListener('click', () => state.user ? window.rkxIdentity.open() : openAuth('login'));
window.addEventListener('rkx-signup-complete', event => {
  state.user = event.detail.user;
  lastSessionTouch = Date.now();
  renderHeader(); renderIdentity();
  toast('본인확인이 완료되어 계정이 생성되었습니다.');
});
window.addEventListener('rkx-identity-complete', refreshUser);
window.addEventListener('rkx-identity-progress', refreshUser);
$('#chatLauncher').addEventListener('click', openChat);
$('#closeChat').addEventListener('click', closeChat);
$('#chatForm').addEventListener('submit', submitChat);
$('#recordingToggle').addEventListener('click', () => {
  const checkbox = $('#recordingField input'); checkbox.checked = !checkbox.checked;
  $('#recordingToggle').setAttribute('aria-pressed', String(checkbox.checked));
  $('#recordingToggle').textContent = checkbox.checked ? '녹취 요청함' : '녹취 요청 안 함';
});
function syncViewFromHistory() {
  const view = location.hash.slice(1) || 'home';
  if (view !== state.view) showView(view, { updateHistory: false });
}
window.addEventListener('popstate', syncViewFromHistory);
window.addEventListener('hashchange', syncViewFromHistory);
window.addEventListener('pageshow', () => { $('#loginForm').reset(); clearRegisterForm(); });
refreshUser().then(() => { const initial = location.hash.slice(1); if (allowedViews.includes(initial)) showView(initial, { updateHistory: false }); });
loadPublicConfig(); window.marketUI.init();
