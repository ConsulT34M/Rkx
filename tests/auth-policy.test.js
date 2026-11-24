import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordIssues } from '../auth-policy.js';

test('registration password requires length, both letter cases, and a symbol', () => {
  assert.deepEqual(passwordIssues('Abcdefg!'), []);
  assert.deepEqual(passwordIssues('Abcdefg'), ['8자 이상', '특수기호']);
  assert.deepEqual(passwordIssues('abcdefgh!'), ['영문 대문자']);
  assert.deepEqual(passwordIssues('ABCDEFGH!'), ['영문 소문자']);
  assert.ok(passwordIssues('A'.repeat(129) + 'a!').includes('128자 이하'));
});
