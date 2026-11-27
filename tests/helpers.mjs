import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as esm from '../src/index.mjs';

const require = createRequire(import.meta.url);
const cjs = require('../cjs/index.cjs');

export { esm, cjs };

export function defineWith(module, schema, source, options) {
  return module.defineEnv(schema, source, options);
}

export function getError(fn) {
  let error;
  assert.throws(fn, (thrown) => {
    error = thrown;
    return true;
  });
  assert.ok(error instanceof Error, 'thrown value must be an Error');
  return error;
}

export function validationError(fn) {
  const error = getError(fn);
  assert.equal(error.name, 'EnvCageError');
  assert.equal(error.code, esm.CODE.VALIDATION);
  assert.ok(Array.isArray(error.issues));
  return error;
}

export function directError(fn, code) {
  const error = getError(fn);
  assert.equal(error.name, 'EnvCageError');
  if (code) assert.equal(error.code, code);
  return error;
}

export function assertIssue(error, key, code) {
  const issue = error.issues.find((item) => item.key === key);
  assert.ok(issue, 'missing issue for ' + key);
  if (code) assert.equal(issue.code, code);
  return issue;
}

export function assertNoText(haystack, needle) {
  assert.equal(
    String(haystack).includes(needle),
    false,
    'output must not contain the sensitive or hostile raw text'
  );
}

export function validSecret(prefix = 'k9X') {
  return prefix + '-synthetic-42Zx-7qwerty';
}
