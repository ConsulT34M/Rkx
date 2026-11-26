let currentChatCase = null;
let chatReadOnly = false;
let chatRead = 0;
let pendingMessage = null;

function chatMessageId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Local HTTP on a LAN still provides getRandomValues.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function renderMessages(target, messages, mineRole = 'customer') {
  target.innerHTML = messages.length ? messages.map(m => `<div class="chat-bubble ${m.sender === mineRole ? 'mine' : ''}">${escapeHtml(m.body)}<small>${m.archived ? '이전 RKX 상담 · ' : ''}${m.sender === 'partner' ? '말결 상담원' : '고객'} · ${when(m.created_at)}</small></div>`).join('') : '<div class="chat-empty">첫 메시지를 남겨주세요.</div>';
  target.scrollTop = target.scrollHeight;
}
async function loadChat() {
  clearTimeout(state.chatTimer);
  if ($('#chatPanel').classList.contains('hidden')) return;
  const read = ++chatRead, userId = state.user?.id;
  if (!state.user || state.user.role !== 'customer') { $('#chatMessages').innerHTML = '<div class="chat-empty">고객 계정으로 로그인 후 채팅을 시작할 수 있습니다.</div>'; return; }
  try {
    let chat = await api('/api/chat');
    if (chat.caseId === null && read === chatRead && userId === state.user?.id) {
      await api('/api/chat/open', { method: 'POST', body: '{}' });
      chat = await api('/api/chat');
    }
    if (read !== chatRead || userId !== state.user?.id) return;
    currentChatCase = chat.caseId || null;
    chatReadOnly = chat.readOnly === true;
    $('#chatForm input').disabled = chatReadOnly;
    $('#chatForm button').textContent = chatReadOnly ? '새 상담' : '전송';
    const labels = { QUEUED: '상담원 연결 대기 중', IN_PROGRESS: '상담원 연결됨', CLOSED: '상담이 종료되었습니다' };
    $('#chatStatus').textContent = labels[chat.status] || '메시지를 남겨주세요';
    renderMessages($('#chatMessages'), chat.messages);
  } catch (error) {
    if (read === chatRead && userId === state.user?.id) $('#chatStatus').textContent = error.message;
  } finally {
    if (read === chatRead && userId === state.user?.id) state.chatTimer = setTimeout(loadChat, 5000);
  }
}
function openChat() {
  if (state.user && state.user.role !== 'customer') return toast('고객 계정에서 이용할 수 있습니다.');
  supportReset();
  $('#chatPanel').classList.remove('hidden'); $('#chatLauncher').classList.add('hidden');
  loadChat();
  if (!state.user) openAuth('login');
}
function closeChat() {
  ++chatRead;
  clearTimeout(state.chatTimer);
  $('#chatPanel').classList.add('hidden');
  if (!state.user || state.user.role === 'customer') $('#chatLauncher').classList.remove('hidden');
  currentChatCase = null;
  chatReadOnly = false;
  $('#chatForm input').disabled = false;
  $('#chatForm button').textContent = '전송';
  $('#chatStatus').textContent = '메시지를 남겨주세요';
  $('#chatMessages').replaceChildren();
  if (!state.user) { $('#chatForm').reset(); pendingMessage = null; }
}
async function submitChat(event) {
  event.preventDefault(); if (!state.user) return openAuth('login');
  const userId = state.user.id, input = event.currentTarget.elements.body, body = input.value.trim();
  const button = event.currentTarget.querySelector('button');
  if (button.disabled || (!chatReadOnly && !body)) return;
  button.disabled = true;
  try {
    if (chatReadOnly) {
      await api('/api/chat/open', { method: 'POST', body: JSON.stringify({ caseId: currentChatCase }) });
      return;
    }
    if (!pendingMessage || pendingMessage.body !== body || pendingMessage.userId !== userId ||
        (pendingMessage.caseId && currentChatCase && pendingMessage.caseId !== currentChatCase)) {
      pendingMessage = { userId, body, caseId: currentChatCase, clientMessageId: chatMessageId() };
    }
    const { caseId, clientMessageId } = pendingMessage;
    const result = await api('/api/chat', { method: 'POST', body: JSON.stringify({ body, caseId, clientMessageId }) });
    if (state.user?.id !== userId) return;
    pendingMessage = null;
    if (input.value.trim() === body) input.value = '';
    if (result.partnerStatus !== 'sent') toast(result.partnerStatus === 'failed' ? '말결 전송 실패 · 담당자 확인 필요' : '실제 연동 전 · 말결 테스트 화면에 저장됨');
  } catch (error) { if (state.user?.id === userId) toast(error.message); }
  finally {
    if (state.user?.id === userId) await loadChat();
    button.disabled = false;
  }
}
