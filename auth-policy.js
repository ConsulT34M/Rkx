export function passwordIssues(password) {
  if (typeof password !== 'string') return ['비밀번호를 입력해 주세요.'];
  const issues = [];
  if (password.length < 8) issues.push('8자 이상');
  if (password.length > 128) issues.push('128자 이하');
  if (!/[A-Z]/.test(password)) issues.push('영문 대문자');
  if (!/[a-z]/.test(password)) issues.push('영문 소문자');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('특수기호');
  return issues;
}
