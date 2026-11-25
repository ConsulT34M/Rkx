window.rkxCaptcha = (() => {
  const storageKey = 'rkx-captcha-required';
  const panel = document.querySelector('#captchaChallenge');
  const message = document.querySelector('#captchaMessage');
  const image = document.querySelector('#captchaImage');
  const answer = document.querySelector('#captchaAnswer');
  const audio = document.querySelector('#captchaAudio');
  let available = false;
  let challengeId = null;
  let issuedAt = 0;
  let required = sessionStorage.getItem(storageKey) === '1';
  let generation = 0;
  let pending = null;

  function clearChallenge() {
    challengeId = null;
    issuedAt = 0;
    image.removeAttribute('src');
    image.classList.add('hidden');
    answer.value = '';
    audio.pause();
    audio.removeAttribute('src');
    audio.classList.add('hidden');
  }

  function loadChallenge() {
    if (pending) return pending;
    const current = ++generation;
    clearChallenge();
    message.textContent = '인증 이미지를 불러오는 중입니다.';
    pending = (async () => {
      try {
        const response = await fetch('/api/captcha', { credentials: 'same-origin', cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '인증 이미지를 불러오지 못했습니다.');
        if (current !== generation || !required) return;
        challengeId = data.id;
        issuedAt = Date.now();
        image.src = data.img;
        image.classList.remove('hidden');
        message.textContent = '이미지의 문자를 입력해 주세요. 60초 동안 유효합니다.';
      } catch (error) {
        if (current === generation && required) message.textContent = error.message;
      }
    })().finally(() => { if (current === generation) pending = null; });
    return pending;
  }

  function show() {
    required = true;
    sessionStorage.setItem(storageKey, '1');
    panel.classList.remove('hidden');
    if (!available) {
      message.textContent = 'CAPTCHA API가 설정되지 않았습니다. 관리자에게 문의해 주세요.';
      return;
    }
    if (challengeId && Date.now() - issuedAt >= 55000) reset();
    else if (!challengeId && !pending) loadChallenge();
  }

  function hide() {
    required = false;
    sessionStorage.removeItem(storageKey);
    panel.classList.add('hidden');
    generation++;
    pending = null;
    clearChallenge();
  }
  function reset() {
    generation++;
    pending = null;
    clearChallenge();
    if (required && available) loadChallenge();
  }
  function response() {
    const value = answer.value.trim();
    return required && challengeId && value ? { captchaId: challengeId, captchaAnswer: value } : null;
  }
  function configure(isAvailable) {
    available = isAvailable === true;
    if (required) show();
  }
  document.querySelector('#captchaRefresh').addEventListener('click', reset);
  document.querySelector('#captchaAudioButton').addEventListener('click', () => {
    if (!challengeId) return;
    audio.src = `/api/captcha/audio/${challengeId}`;
    audio.classList.remove('hidden');
  });
  return { configure, show, hide, reset, response, isRequired: () => required };
})();
