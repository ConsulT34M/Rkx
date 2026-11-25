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

