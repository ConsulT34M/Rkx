export const captchaNeeded = attempts => Number(attempts) >= 2;
const googleTestSecret = '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe';

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
  if (result.success !== true) return false;
  if (secret === googleTestSecret) {
    return ['localhost', '127.0.0.1'].includes(hostname) && result.hostname === 'testkey.google.com';
  }
  return result.hostname === hostname;
}
