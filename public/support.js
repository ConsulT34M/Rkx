const supportDock = $('#supportDock');
const supportMenu = $('#supportMenu');
const supportLauncher = $('#chatLauncher');
const aiPanel = $('#aiChatPanel');
const aiForm = $('#aiChatForm');
const voiceDialog = $('#voice-dialog');
let pendingChannel = null;
let supportView = 0;
let aiChatId = null;
let aiSnapshot = null;
let pendingAiMessage = null;
let menuPinned = false;
const voiceScripts = new Map();

function setSupportMenu(open) {
  supportMenu.hidden = !open;
  supportLauncher.setAttribute('aria-expanded', String(open));
  if (!open) { menuPinned = false; return; }
  if (state.user?.role !== 'customer') return;
  const userId = state.user.id;
  api('/api/support/availability').then(status => {
    if (state.user?.id !== userId) return;
    for (const [channel, enabled] of [['ai', status.chat_enabled], ['voice', status.voice_enabled]]) {
      const button = supportMenu.querySelector('[data-channel="' + channel + '"]');
      const reason = !enabled ? '운영 중지' : !status.configured ? '연결 미설정' : '';
      button.setAttribute('aria-disabled', String(Boolean(reason)));
      button.querySelector('small').textContent = reason;
    }
  }).catch(() => {}); // 선택한 채널에서 연결 오류를 표시한다.
}

function supportReset() {
  ++supportView;
  pendingChannel = null;
  aiChatId = null;
  aiSnapshot = null;
  $('#aiOutcomeActions').hidden = true;
  pendingAiMessage = null;
  setSupportMenu(false);
  aiPanel.classList.add('hidden');
  aiForm.reset();
  $('#aiMessages').replaceChildren();
  if (voiceDialog.open) voiceDialog.close();
  for (const button of supportMenu.querySelectorAll('[aria-disabled]')) {
    button.removeAttribute('aria-disabled');
    button.querySelector('small').textContent = '';
  }
}

function supportResume() {
  const channel = pendingChannel;
  pendingChannel = null;
  if (channel && state.user?.role === 'customer') selectSupport(channel);
}

function renderAiChat(chat) {
  aiSnapshot = chat;
  aiChatId = chat.chat_id || aiChatId || chatMessageId();
  const log = $('#aiMessages');
  log.replaceChildren();
  function bubble(label, value, mine) {
    const item = document.createElement('div');
    item.className = 'chat-bubble' + (mine ? ' mine' : '');
    const author = document.createElement('small');
    author.textContent = label;
    item.append(document.createTextNode(value), author);
    log.append(item);
  }
  bubble('AI 상담원', chat.greeting, false);
  for (const turn of chat.turns) {
    bubble('고객', turn.question, true);
    bubble('AI 상담원', turn.answer, false);
  }
  log.scrollTop = log.scrollHeight;
  $('#aiOutcomeActions').hidden = !chat.turns.length || chat.outcome === 'RESOLVED';
  $('#aiResolved').hidden = chat.outcome === 'HANDOFF';
  $('#aiHandoff').textContent = chat.outcome === 'HANDOFF' ? '상담원 채팅 열기' : '상담원 연결';
  $('#aiChatStatus').textContent = chat.outcome === 'RESOLVED' ? '해결로 기록했어요.' :
    chat.outcome === 'HANDOFF' ? '상담원 채팅으로 접수했어요.' : chat.enabled ? '' : 'AI 채팅 상담 운영이 중지되었습니다.';
  setAiBusy(false);
}

function setAiBusy(busy) {
  const disabled = busy || !aiSnapshot?.enabled || Boolean(aiSnapshot?.outcome);
  aiForm.elements.body.disabled = disabled;
  aiForm.querySelector('button').disabled = disabled;
  $('#aiResolved').disabled = busy;
  $('#aiHandoff').disabled = busy;
  $('#aiChatNew').disabled = busy;
}

async function openAiChat(fresh = false) {
  const view = ++supportView;
  aiChatId = null;
  aiSnapshot = null;
  pendingAiMessage = null;
  aiForm.reset();
  aiPanel.classList.remove('hidden');
  supportLauncher.classList.add('hidden');
  $('#aiMessages').replaceChildren();
  $('#aiOutcomeActions').hidden = true;
  setAiBusy(true);
  $('#aiChatStatus').textContent = '대화를 불러오는 중…';
  try {
    const chat = await api('/api/support/ai-chat' + (fresh ? '?new=1' : ''));
    if (view !== supportView) return;
    renderAiChat(chat);
    if (chat.enabled) aiForm.elements.body.focus();
  } catch (error) {
    if (view === supportView) $('#aiChatStatus').textContent = error.message;
  } finally {
    if (view === supportView) $('#aiChatNew').disabled = false;
  }
}

aiForm.addEventListener('submit', async event => {
  event.preventDefault();
  const view = supportView, input = aiForm.elements.body;
  const body = input.value.trim();
  if (!body || !aiChatId || input.disabled) return;
  if (pendingAiMessage?.body !== body) pendingAiMessage = { chat_id: aiChatId, request_id: chatMessageId(), body };
  setAiBusy(true);
  $('#aiChatStatus').textContent = 'AI가 답변을 작성하고 있어요…';
  try {
    const chat = await api('/api/support/ai-chat/messages', { method: 'POST', body: pendingAiMessage });
    if (view !== supportView) return;
    pendingAiMessage = null;
    input.value = '';
    renderAiChat(chat);
  } catch (error) {
    if (view !== supportView) return;
    $('#aiChatStatus').textContent = error.message;
  } finally {
    if (view === supportView) {
      setAiBusy(false);
      input.focus();
    }
  }
});

async function finishAiChat(handoff) {
  if (!aiSnapshot?.chat_id) return;
  if (handoff && aiSnapshot.outcome === 'HANDOFF') return openChat();
  const view = supportView;
  setAiBusy(true);
  try {
    await api('/api/support/ai-chat/' + aiChatId + (handoff ? '/handoff' : '/resolve'), { method: 'POST', body: {} });
    if (view !== supportView) return;
    if (handoff) openChat();
    else renderAiChat({ ...aiSnapshot, outcome: 'RESOLVED' });
  } catch (error) {
    if (view === supportView) $('#aiChatStatus').textContent = error.message;
  } finally {
    if (view === supportView) setAiBusy(false);
  }
}
$('#aiResolved').addEventListener('click', () => finishAiChat(false));
$('#aiHandoff').addEventListener('click', () => finishAiChat(true));

function loadVoiceScript(name) {
  if (!voiceScripts.has(name)) {
    voiceScripts.set(name, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/api/support/assets/' + name;
      script.onload = resolve;
      script.onerror = () => { script.remove(); voiceScripts.delete(name); reject(new Error('말결 음성 상담에 연결할 수 없습니다.')); };
      document.head.append(script);
    }));
  }
  return voiceScripts.get(name);
}

async function selectSupport(channel) {
  setSupportMenu(false);
  if (!state.user) { pendingChannel = channel; openAuth('login'); return; }
  if (state.user.role !== 'customer') return toast('고객 계정에서 이용할 수 있습니다.');
  const choice = supportMenu.querySelector('[data-channel="' + channel + '"]');
  if (choice.getAttribute('aria-disabled') === 'true') return toast(choice.textContent.trim());
  closeChat();
  supportReset();
  if (channel === 'agent') return openChat();
  if (channel === 'ai') return openAiChat();
  const view = supportView;
  $('#voice-start').disabled = true;
  $('#voice-ticket').hidden = true;
  $('#voice-recording-state').hidden = true;
  $('#voice-consent').checked = false;
  $('#voice-state').textContent = '전화 상담을 준비하고 있어요…';
  voiceDialog.showModal();
  try {
    const status = await api('/api/support/availability');
    if (!status.voice_enabled || !status.configured) throw new Error('현재 AI 전화 상담을 이용할 수 없습니다.');
    await loadVoiceScript('voice-recording.js');
    await loadVoiceScript('voice.js');
    if (view !== supportView || !voiceDialog.open) return;
    $('#voice-state').textContent = '시작 버튼을 누르고 마이크 사용을 허용해 주세요.';
    $('#voice-start').disabled = false;
  } catch (error) {
    if (view === supportView && voiceDialog.open) $('#voice-state').textContent = error.message;
  }
}

function dismissAiChat() {
  supportReset();
  supportLauncher.classList.remove('hidden');
  supportLauncher.focus();
}
supportDock.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') setSupportMenu(true); });
supportDock.addEventListener('pointerleave', () => {
  if (!menuPinned && !supportMenu.contains(document.activeElement)) setSupportMenu(false);
});
supportDock.addEventListener('focusout', event => {
  if (!supportDock.contains(event.relatedTarget)) setSupportMenu(false);
});
supportLauncher.addEventListener('focus', () => { if (supportLauncher.matches(':focus-visible')) setSupportMenu(true); });
supportLauncher.addEventListener('click', () => { menuPinned = !menuPinned; setSupportMenu(menuPinned); });
supportLauncher.addEventListener('keydown', event => {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault(); setSupportMenu(true); supportMenu.querySelector('button').focus();
  }
});
document.addEventListener('pointerdown', event => { if (!supportMenu.hidden && !supportDock.contains(event.target)) setSupportMenu(false); });
supportMenu.addEventListener('click', event => {
  const choice = event.target.closest('[data-channel]');
  if (choice) selectSupport(choice.dataset.channel);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (!supportMenu.hidden) { supportLauncher.focus(); setSupportMenu(false); }
  else if (!aiPanel.classList.contains('hidden')) dismissAiChat();
});
$('#aiChatNew').addEventListener('click', () => openAiChat(true));
$('#aiChatClose').addEventListener('click', dismissAiChat);
$('#authDialog').addEventListener('close', () => { if (!state.user) pendingChannel = null; });
