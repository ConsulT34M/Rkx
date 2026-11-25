async function submitAuth(form, mode) {
  const fd = new FormData(form), payload = Object.fromEntries(fd.entries());
  if (mode === 'register') {
    for (const key of ['termsConsent', 'privacyConsent', 'outsourcingConsent']) payload[key] = fd.has(key);
    const password = payload.password || '';
    const missing = [];
    if (password.length < 8) missing.push('8자 이상');
    if (!/[A-Z]/.test(password)) missing.push('영문 대문자');
    if (!/[a-z]/.test(password)) missing.push('영문 소문자');
    if (!/[^A-Za-z0-9]/.test(password)) missing.push('특수기호');
    if (missing.length) { $('#authFeedback').textContent = `비밀번호 조건: ${missing.join(', ')}`; return; }
  }
  if (mode === 'login' && window.rkxCaptcha.isRequired()) {
    const captcha = window.rkxCaptcha.response();
    if (!captcha) { $('#authFeedback').textContent = '이미지의 문자를 입력해 주세요.'; return; }
    Object.assign(payload, captcha);
  }
  try {
    const result = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
    if (mode === 'register') {
      $('#authDialog').close();
      form.reset();
      window.rkxIdentity.open({ signup: true }).catch(error => toast(error.message));
      return;
    }
    state.user = result.user; lastSessionTouch = Date.now(); window.rkxCaptcha.hide(); $('#authDialog').close(); form.reset(); renderHeader(); renderIdentity();
    toast('로그인되었습니다.');
    if (state.user.role === 'admin') showView('admin');
    else if (state.user.role === 'partner') showView('partner');
    else if (state.view === 'consult') loadTickets();
    if (!$('#chatPanel').classList.contains('hidden')) loadChat();
  } catch (error) {
    if (mode === 'login') {
      if (payload.captchaId) window.rkxCaptcha.reset();
      if (error.captchaRequired) window.rkxCaptcha.show();
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
