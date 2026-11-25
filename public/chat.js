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
