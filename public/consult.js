function setTicketType(type) {
  state.ticketType = type;
  state.ticketRequestId = null;
  $$('.consult-tabs button').forEach(button => button.classList.toggle('active', button.dataset.ticketType === type));
  const titles = { consultation: ['상담 접수', '내용을 남겨주시면 담당자가 확인합니다.'], phone: ['전화 상담 요청', '희망 연락 시간을 남기고 녹취 여부를 선택하세요.'] };
  $('#ticketIntro h2').textContent = titles[type][0]; $('#ticketIntro p').textContent = titles[type][1];
  $('#preferredTimeField').classList.toggle('hidden', type !== 'phone');
  $('#preferredTimeField input').required = type === 'phone';
  $('#recordingField').classList.toggle('hidden', type !== 'phone');
  $('#ticketForm .form-submit').textContent = type === 'phone' ? '전화 상담 신청하기' : '상담 접수하기';
  $('#ticketFeedback').textContent = '';
}
async function submitTicket(event) {
  event.preventDefault(); if (!state.user) return openAuth('login');
  const fd = new FormData(event.currentTarget);
  state.ticketRequestId ||= crypto.randomUUID();
  const payload = { requestId: state.ticketRequestId, type: state.ticketType, category: fd.get('category'), subject: fd.get('subject'), description: fd.get('description'), preferredTime: fd.get('preferredTime'), recordingConsent: fd.has('recordingConsent') };
  try {
    const result = await api('/api/tickets', { method: 'POST', body: JSON.stringify(payload) });
    event.currentTarget.reset(); state.ticketRequestId = null; $('#recordingToggle').setAttribute('aria-pressed', 'false'); $('#recordingToggle').textContent = '녹취 요청 안 함';
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
    target.innerHTML = tickets.length ? tickets.slice(0, 5).map(t => `<div class="ticket-mini"><strong>${escapeHtml(t.receipt_number)}</strong><span>${escapeHtml(t.subject)}</span><span>${ticketNames[t.type]} · ${categoryNames[t.category] || '기타 문의'} · ${statusNames[t.status]} · ${when(t.created_at)}</span></div>`).join('') : '아직 접수된 상담이 없습니다.';
  } catch (error) { target.textContent = error.message; }
}
async function loadPublicConfig() {
  try {
    const { partnerPhone, captchaAvailable } = await api('/api/public-config');
    window.rkxCaptcha.configure(captchaAvailable);
    if (partnerPhone) {
      state.partnerPhone = partnerPhone;
      $('#samplePhone').classList.add('hidden');
      $('#partnerPhoneLink').href = `tel:${partnerPhone}`;
      renderPhone();
      $('#partnerPhoneLink').classList.remove('hidden');
      $('#partnerPhoneUnavailable').classList.add('hidden');
    }
  } catch {}
}
