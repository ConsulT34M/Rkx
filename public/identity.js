(() => {
  let root;
  let stage = 'intro';
  let mode = 'demo';
  let cardImage = null;
  let faceImage = null;
  let cameraStream = null;
  let cameraTarget = null;
  let signupFlow = false;
  const $ = selector => root.querySelector(selector);

  async function request(path, payload) {
    const response = await fetch(`${signupFlow ? '/api/signup/identity' : '/api/identity'}/${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '본인확인 요청에 실패했습니다.');
    return data;
  }

  function feedback(message = '') { $('#identityFeedback').textContent = message; }
  function show(next) {
    stage = next;
    feedback();
    root.classList.toggle('is-provider-step', next !== 'intro');
    if (next === 'intro') $('.identity-kicker').innerHTML = '<span class="identity-brand-rkx">R<span>K</span>X</span>';
    else $('.identity-kicker').innerHTML = '<img class="identity-provider-logo" src="/assets/ij-info-logo-transparent.png" alt="(주)인증정보평가 IJ-info">';
    $('.identity-phone').classList.toggle('is-lock-screen', next === 'phone_code');
    if (next === 'phone_code') {
      const now = new Date();
      $('#identityLockTime').textContent = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`;
      $('#identityLockDate').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
    }
    root.querySelectorAll('[data-identity-step]').forEach(section => { section.hidden = section.dataset.identityStep !== next; });
    root.querySelectorAll('[data-identity-phone-step]').forEach(section => { section.hidden = section.dataset.identityPhoneStep !== next; });
    const index = { intro: 0, phone: 0, phone_code: 0, id_card: 1, face: 2, completed: 3 }[next] ?? 0;
    root.querySelectorAll('[data-progress]').forEach((item, i) => item.classList.toggle('active', i <= index));
    $('#identityStepCount').textContent = `STEP ${String(index + 1).padStart(2, '0')} / 04 · 본인확인`;
    $('#identityProgressFill').style.width = `${(index + 1) * 25}%`;
    $('.identity-phone-scroll').scrollTop = 0;
  }

  async function loadTemplate() {
    if (root) return;
    const response = await fetch('/identity.html', { cache: 'no-store' });
    if (!response.ok) throw new Error('본인확인 화면을 불러올 수 없습니다.');
    const holder = document.createElement('div');
    holder.innerHTML = await response.text();
    document.body.append(...holder.children);
    root = document.querySelector('#identityDialog');
    root.addEventListener('close', stopCamera);
    $('#identityClose').addEventListener('click', close);
    $('#identityDone').addEventListener('click', close);
    const consentKeys = ['collect', 'uid', 'carrier_terms', 'biometric'];
    const consentInputs = consentKeys.map(key => $(`input[name="${key}"]`));
    const allConsent = $('#identityAllConsent');
    const syncAllConsent = () => {
      const checkedCount = consentInputs.filter(input => input.checked).length;
      allConsent.checked = checkedCount === consentInputs.length;
      allConsent.indeterminate = checkedCount > 0 && checkedCount < consentInputs.length;
    };
    allConsent.addEventListener('change', () => {
      consentInputs.forEach(input => { input.checked = allConsent.checked; });
      allConsent.indeterminate = false;
    });
    consentInputs.forEach(input => input.addEventListener('change', syncAllConsent));
    syncAllConsent();
    $('#identityBegin').addEventListener('click', run(async () => {
      const consents = Object.fromEntries(consentKeys.map((key, index) => [key, consentInputs[index].checked]));
      const result = await request('start', { consents });
      mode = result.mode;
      window.dispatchEvent(new Event('rkx-identity-progress'));
      show('phone');
    }));
    $('#identityPhoneForm').addEventListener('submit', run(async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const result = await request('phone/start', data);
      sessionStorage.setItem('rkx_demo_identity_code', result.demoCode);
      $('#identityDemoCode').textContent = result.demoCode;
      show('phone_code');
    }));
    $('#identityCodeForm').addEventListener('submit', run(async event => {
      event.preventDefault();
      const code = new FormData(event.currentTarget).get('code');
      const result = await request('phone/confirm', { code });
      sessionStorage.removeItem('rkx_demo_identity_code');
      mode = result.mode;
      show('id_card');
    }));
    $('#identityRestartCode').addEventListener('click', run(async () => {
      const { name, phone, rrn } = $('#identityPhoneForm').elements;
      if (!name.value || !phone.value || !rrn.value) {
        show('phone');
        throw new Error('성명과 주민등록번호, 휴대폰번호를 다시 입력해 주세요.');
      }
      const result = await request('phone/start', { name: name.value, phone: phone.value, rrn: rrn.value });
      sessionStorage.setItem('rkx_demo_identity_code', result.demoCode);
      $('#identityDemoCode').textContent = result.demoCode;
      feedback('인증번호를 다시 발급했습니다.');
    }));
    $('#identityCardForm').addEventListener('submit', run(async event => {
      event.preventDefault();
      if (!cardImage) throw new Error('웹캠으로 가상 신분증을 먼저 촬영해 주세요.');
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const result = await request('id-card', { ...data, image: cardImage });
      cardImage = null;
      mode = result.mode;
      show('face');
    }));
    $('#identitySubmitFace').addEventListener('click', run(async () => {
      if (!faceImage) throw new Error('웹캠으로 얼굴을 먼저 촬영해 주세요.');
      const result = await request('face', { image: faceImage });
      faceImage = null;
      $('#identityResultText').textContent = signupFlow
        ? '실습용 본인확인을 마쳐 RKX 계정이 생성되었습니다. 실제 신원 확인 결과는 아닙니다.'
        : result.mode === 'ijinfo'
          ? 'IJ-info의 실습용 판정이 완료되었습니다. 실제 인물의 생체인증 결과가 아닙니다.'
          : '샘플 인물의 로컬 모의 인증을 완료했습니다. 실제 신원 확인 결과가 아닙니다.';
      show('completed');
      if (signupFlow) window.dispatchEvent(new CustomEvent('rkx-signup-complete', { detail: { user: result.user } }));
      window.dispatchEvent(new Event('rkx-identity-complete'));
    }));
    root.querySelectorAll('[data-identity-camera]').forEach(button => button.addEventListener('click', run(() => startCamera(button.dataset.identityCamera))));
    document.querySelector('#identityCameraSelect').addEventListener('change', changeCamera);
    document.querySelector('#identityCameraDialog').addEventListener('close', () => { releaseCameraStream(); cameraTarget = null; });
    document.querySelector('#identityCancelCamera').addEventListener('click', stopCamera);
    document.querySelector('#identityTakePhoto').addEventListener('click', run(takePhoto));
  }

  function run(task) {
    return async event => {
      const button = event?.currentTarget?.matches?.('button') ? event.currentTarget : null;
      if (button) button.disabled = true;
      try { await task(event); } catch (error) { feedback(error.message); }
      finally { if (button) button.disabled = false; }
    };
  }

  function setImage(target, dataUrl) {
    if (target === 'id_card') cardImage = dataUrl;
    else faceImage = dataUrl;
    const preview = $(target === 'id_card' ? '#identityCardPreview' : '#identityFacePreview');
    const placeholder = $(target === 'id_card' ? '#identityCardPlaceholder' : '#identityFacePlaceholder');
    preview.src = dataUrl;
    preview.hidden = false;
    placeholder.hidden = true;
    feedback();
  }

  async function startCamera(target) {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) throw new Error('이 브라우저에서 카메라를 사용할 수 없습니다. localhost 또는 HTTPS로 열어 주세요.');
    stopCamera();
    cameraTarget = target;
    document.querySelector('#identityCameraView').dataset.target = target;
    try {
      // 첫 접근으로 권한을 받은 뒤 장치 이름을 읽는다. 미리보기는 선택한 카메라로만 연다.
      const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      permissionStream.getTracks().forEach(track => track.stop());
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      if (!cameras.length) throw new Error('연결된 카메라를 찾을 수 없습니다. ABKO 카메라의 USB 연결을 확인해 주세요.');

      const select = document.querySelector('#identityCameraSelect');
      select.replaceChildren(new Option('카메라를 선택하세요', ''), ...cameras.map((device, index) => new Option(device.label || `카메라 ${index + 1}`, device.deviceId)));
      document.querySelector('#identityCameraTitle').textContent = target === 'face' ? '얼굴 이미지 촬영' : '가상 증표 촬영';
      document.querySelector('#identityCameraDialog').showModal();
      const savedId = sessionStorage.getItem('rkx_camera_device_id');
      const preferred = cameras.find(device => /abko/i.test(device.label)) || cameras.find(device => device.deviceId === savedId);
      if (preferred) {
        select.value = preferred.deviceId;
        try {
          await switchCamera(preferred.deviceId);
          document.querySelector('#identityCameraStatus').textContent = `${preferred.label || '선택한 카메라'}로 촬영합니다.`;
        } catch {
          select.value = '';
          document.querySelector('#identityCameraStatus').textContent = '카메라를 시작할 수 없습니다. 목록에서 다시 선택해 주세요.';
        }
      } else {
        document.querySelector('#identityCameraStatus').textContent = 'ABKO 카메라가 자동으로 보이지 않으면 목록에서 외장 카메라를 선택해 주세요.';
      }
    } catch (error) {
      stopCamera();
      throw new Error(error.message.startsWith('연결된 카메라를') ? error.message : '카메라 권한과 ABKO 카메라 연결을 확인해 주세요.');
    }
  }

  async function switchCamera(deviceId) {
    releaseCameraStream();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
    if (!document.querySelector('#identityCameraDialog').open) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('촬영 창이 닫혔습니다.');
    }
    cameraStream = stream;
    const video = document.querySelector('#identityVideo');
    video.srcObject = stream;
    try {
      await video.play();
      document.querySelector('#identityTakePhoto').disabled = false;
    } catch (error) {
      releaseCameraStream();
      throw error;
    }
  }

  async function changeCamera(event) {
    const deviceId = event.currentTarget.value;
    if (!deviceId) {
      releaseCameraStream();
      document.querySelector('#identityCameraStatus').textContent = '촬영할 카메라를 선택해 주세요.';
      return;
    }
    const select = event.currentTarget;
    select.disabled = true;
    try {
      await switchCamera(deviceId);
      sessionStorage.setItem('rkx_camera_device_id', deviceId);
      document.querySelector('#identityCameraStatus').textContent = `${select.selectedOptions[0].textContent}로 촬영합니다.`;
    } catch {
      document.querySelector('#identityCameraStatus').textContent = '선택한 카메라를 시작할 수 없습니다. 연결 상태를 확인해 주세요.';
    } finally {
      select.disabled = false;
    }
  }

  async function takePhoto() {
    const video = document.querySelector('#identityVideo');
    if (!cameraStream || !video.videoWidth || !video.videoHeight) throw new Error('카메라 화면이 준비되지 않았습니다.');
    const canvas = document.createElement('canvas');
    const frameRatio = 4 / 3;
    const cropWidth = Math.min(video.videoWidth, video.videoHeight * frameRatio);
    const cropHeight = cropWidth / frameRatio;
    const cropX = (video.videoWidth - cropWidth) / 2;
    const cropY = (video.videoHeight - cropHeight) / 2;
    canvas.width = Math.round(Math.min(1280, cropWidth));
    canvas.height = Math.round(canvas.width / frameRatio);
    canvas.getContext('2d').drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    setImage(cameraTarget, canvas.toDataURL('image/jpeg', .86));
    stopCamera();
  }

  function releaseCameraStream() {
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = null;
    const video = document.querySelector('#identityVideo');
    if (video) video.srcObject = null;
    const takePhoto = document.querySelector('#identityTakePhoto');
    if (takePhoto) takePhoto.disabled = true;
  }

  function stopCamera() {
    releaseCameraStream();
    cameraTarget = null;
    const dialog = document.querySelector('#identityCameraDialog');
    if (dialog?.open) dialog.close();
  }

  function close() {
    stopCamera();
    cardImage = null;
    faceImage = null;
    if (root?.open) root.close();
  }

  async function open({ signup = false } = {}) {
    signupFlow = signup;
    await loadTemplate();
    try {
      const current = await request('status');
      $('#identityTitle').innerHTML = signupFlow ? '회원가입을 위한<br><em>본인확인</em>' : '계정 이용을 위한<br><em>본인확인</em>';
      $('#identityCompletionTitle').textContent = signupFlow ? '인증되어 회원가입이 완료되었습니다' : '본인확인이 완료되었습니다';
      mode = current.mode || 'demo';
      if (current.identityStatus === 'verified' || current.identityStatus === 'demo_verified') {
        $('#identityResultText').textContent = current.mode === 'ijinfo' ? 'IJ-info 실습용 판정이 완료되었습니다.' : '로컬 모의 인증이 완료되었습니다.';
        show('completed');
      } else if (current.stage === 'failed') {
        show('intro');
        feedback('이전 본인확인이 완료되지 않았습니다. 새로 시작해 주세요.');
      } else if (current.stage === 'phone_code') {
        const code = sessionStorage.getItem('rkx_demo_identity_code');
        if (code) { $('#identityDemoCode').textContent = code; show('phone_code'); }
        else { show('phone'); feedback('성명과 주민등록번호, 휴대폰번호를 다시 입력해 인증번호를 새로 받아 주세요.'); }
      } else show(current.stage || 'intro');
      root.showModal();
    } catch (error) { alert(error.message); }
  }

  window.rkxIdentity = { open, close };
})();
