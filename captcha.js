export const captchaNeeded = attempts => Number(attempts) >= 2;

export const validCaptchaId = id => typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export const validCaptchaAnswer = answer => typeof answer === 'string' &&
  /^[A-Za-z0-9]{1,16}$/.test(answer);

export async function createCaptcha({ baseUrl, fetchImpl = fetch }) {
  const response = await fetchImpl(`${baseUrl}/captcha`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error('captcha-provider-unavailable');
  const challenge = await response.json();
  if (!validCaptchaId(challenge.id) || typeof challenge.img !== 'string' ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(challenge.img) || challenge.img.length > 200000) {
    throw new Error('captcha-provider-invalid-response');
  }
  return { id: challenge.id, img: challenge.img };
}

export async function verifyCaptchaAnswer({ baseUrl, id, answer, fetchImpl = fetch }) {
  if (!validCaptchaId(id) || !validCaptchaAnswer(answer)) return false;
  const response = await fetchImpl(`${baseUrl}/captcha`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ id, answer }),
    signal: AbortSignal.timeout(6000)
  });
  if (response.status === 400 || response.status === 404) return false;
  if (!response.ok) throw new Error('captcha-provider-unavailable');
  const result = await response.json();
  return result.message === 'Valid';
}
