window.rkxCaptcha = (() => {
  const panel = document.querySelector('#captchaChallenge');
  const message = document.querySelector('#captchaMessage');
  let siteKey = null;
  let widgetId = null;
  let required = false;
  let loading = null;

  function loadScript() {
    if (window.grecaptcha?.render) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CAPTCHA 연결 시간이 초과되었습니다.')), 10000);
      window.rkxRecaptchaReady = () => { clearTimeout(timer); resolve(); };
      const script = document.createElement('script');
      script.src = 'https://www.google.com/recaptcha/api.js?onload=rkxRecaptchaReady&render=explicit&hl=ko';
      script.async = true;
      script.defer = true;
      script.onerror = () => { clearTimeout(timer); reject(new Error('CAPTCHA 화면을 불러오지 못했습니다.')); };
      document.head.append(script);
    }).catch(error => { loading = null; throw error; });
    return loading;
  }

  function show() {
    required = true;
    panel.classList.remove('hidden');
    if (!siteKey) {
      message.textContent = 'CAPTCHA 키가 설정되지 않았습니다. 관리자에게 문의해 주세요.';
      return;
    }
    message.textContent = '로그인 실패가 2회 발생했습니다. 로봇 확인을 완료해 주세요.';
    loadScript().then(() => {
      if (required && document.querySelector('#authDialog').open && widgetId === null) {
        widgetId = window.grecaptcha.render('recaptchaWidget', {
          sitekey: siteKey,
          theme: 'light',
          size: window.innerWidth < 380 ? 'compact' : 'normal'
        });
      }
    }).catch(error => { message.textContent = error.message; });
  }

  function hide() {
    required = false;
    panel.classList.add('hidden');
    reset();
  }
  function reset() {
    if (widgetId !== null && window.grecaptcha?.reset) window.grecaptcha.reset(widgetId);
  }
  function response() {
    return required && widgetId !== null ? window.grecaptcha?.getResponse(widgetId) || '' : '';
  }
  function configure(key) {
    siteKey = typeof key === 'string' && key ? key : null;
    if (required) show();
  }
  return { configure, show, hide, reset, response, isRequired: () => required };
})();
