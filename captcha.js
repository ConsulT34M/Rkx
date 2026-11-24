export const captchaNeeded = attempts => Number(attempts) >= 2;

export async function verifyCaptchaToken({ token, secret, hostname, fetchImpl = fetch }) {
  if (typeof token !== 'string' || !token || token.length > 4096 || !secret || !hostname) return false;
  const response = await fetchImpl('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token }),
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error('captcha-provider-unavailable');
  const result = await response.json();
  return result.success === true && result.hostname === hostname;
}
