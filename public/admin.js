async function loadAdmin() {
  if (state.user?.role !== 'admin') return;
  try {
    const data = await api('/api/admin/overview');
    $('#adminContent').innerHTML = `<div class="admin-stats"><div class="admin-stat"><span>가입 고객</span><strong>${data.users.total || 0}</strong></div><div class="admin-stat"><span>접수 상담</span><strong>${data.tickets.received || 0}</strong></div><div class="admin-stat"><span>가입 신청</span><strong>${data.signups.length}</strong></div></div><div class="admin-toolbar"><span>조회·다운로드는 접속 기록으로 남습니다.</span><a class="button button-outline small" href="/api/admin/export">마스킹 목록 다운로드</a></div><div class="admin-layout"><div class="admin-card"><h2>가입 신청 · 본인확인 결과</h2>${data.signups.length ? data.signups.map(s => `<div class="admin-ticket"><strong>신청 #${s.id} · ${escapeHtml(s.name)}</strong><small>${escapeHtml(s.email)} · ${escapeHtml(s.status)} · ${when(s.created_at)}</small></div>`).join('') : '<p>가입 신청이 없습니다.</p>'}</div><div class="admin-card"><h2>상담 접수 상태</h2>${data.recent.length ? data.recent.map(t => `<div class="admin-ticket"><strong>${escapeHtml(t.receipt_number)}</strong><small>${escapeHtml(t.customer_key || '')} · ${ticketNames[t.type]} · ${statusNames[t.status]} · ${escapeHtml(t.assignment_kind || '미배정')} · ${when(t.created_at)}</small></div>`).join('') : '<p>접수된 상담이 없습니다.</p>'}</div></div><div class="admin-layout admin-lower"><div class="admin-card"><h2>회원 기본정보 · 마스킹</h2>${data.members.length ? data.members.map(m => `<div class="admin-ticket"><strong>${escapeHtml(m.customer_key || '')} · ${escapeHtml(m.name)}</strong><small>${escapeHtml(m.email)} · ${escapeHtml(m.phone)} · ${escapeHtml(m.identity_status)} · ${when(m.created_at)}</small></div>`).join('') : '<p>가입 고객이 없습니다.</p>'}</div><div class="admin-card"><h2>내 접근 기록</h2>${data.accessLogs.map(l => `<div class="admin-ticket"><strong>${escapeHtml(l.action)} · ${escapeHtml(l.target_type)}</strong><small>${when(l.created_at)}</small></div>`).join('')}</div></div>`;
  } catch (error) { $('#adminContent').textContent = error.message; }
}
async function searchAdmin(event) {
  event.preventDefault();
  const form = event.currentTarget, kind = form.dataset.adminSearch, key = form.elements.key.value.trim();
  const target = $('#adminSearchResult');
  target.className = 'admin-search-result';
  target.textContent = '조회 중입니다.';
  try {
    const { record } = await api(`/api/admin/search?kind=${encodeURIComponent(kind)}&key=${encodeURIComponent(key)}`);
    if (!record) { target.textContent = '일치하는 결과가 없습니다.'; return; }
    if (kind === 'member') target.innerHTML = `<strong>회원 ${escapeHtml(record.customer_key)}</strong>${escapeHtml(record.name)} · ${escapeHtml(record.email)} · ${escapeHtml(record.phone)}<br>본인확인 ${escapeHtml(record.identity_status)} · 가입 ${when(record.created_at)}`;
    else if (kind === 'signup') target.innerHTML = `<strong>가입 신청 #${escapeHtml(record.id)}</strong>${escapeHtml(record.name)} · ${escapeHtml(record.email)}<br>${escapeHtml(record.status)} · 신청 ${when(record.created_at)}${record.completed_at ? ` · 처리 ${when(record.completed_at)}` : ''}`;
    else target.innerHTML = `<strong>상담 ${escapeHtml(record.receipt_number)}</strong>회원 ${escapeHtml(record.customer_key)} · ${ticketNames[record.type] || '상담'} · ${categoryNames[record.category] || '기타 문의'}<br>${statusNames[record.status] || escapeHtml(record.status)} · ${record.partner_reference ? `수탁사 상담번호 ${escapeHtml(record.partner_reference)}` : '접수 확인 대기'} · ${when(record.created_at)}`;
  } catch (error) { target.textContent = error.message; }
}
