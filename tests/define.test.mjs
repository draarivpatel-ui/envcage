import test from 'node:test';
import assert from 'node:assert/strict';
import { esm, validationError, directError, assertIssue, validSecret } from './helpers.mjs';

const { defineEnv, t, CODE, EnvCageError } = esm;

test('defineEnv parses a mixed schema into typed values', () => {
  const config = defineEnv({
    NAME: t.str(),
    DEBUG: t.bool(),
    WORKERS: t.int(),
    RATIO: t.num(),
    PORT: t.port(),
    ORIGIN: t.url(),
    MODE: t.enum(['dev', 'prod']),
    SETTINGS: t.json(),
    TAGS: t.csv(),
    TIMEOUT: t.durationMs()
  }, {
    NAME: 'service',
    DEBUG: 'yes',
    WORKERS: '4',
    RATIO: '2.5',
    PORT: '8080',
    ORIGIN: 'https://example.com/app',
    MODE: 'prod',
    SETTINGS: '{"a":1}',
    TAGS: 'one,two',
    TIMEOUT: '2s'
  });
  assert.equal(config.NAME, 'service');
  assert.equal(config.DEBUG, true);
  assert.equal(config.WORKERS, 4);
  assert.equal(config.RATIO, 2.5);
  assert.equal(config.PORT, 8080);
  assert.equal(config.ORIGIN, 'https://example.com/app');
  assert.equal(config.MODE, 'prod');
  assert.deepEqual(config.SETTINGS, { a: 1 });
  assert.deepEqual(config.TAGS, ['one', 'two']);
  assert.equal(config.TIMEOUT, 2000);
});

test('defineEnv returns a null-prototype object', () => {
  const config = defineEnv({ A: t.str() }, { A: 'x' });
  assert.equal(Object.getPrototypeOf(config), null);
});

test('defineEnv deeply freezes the top-level config', () => {
  const config = defineEnv({ A: t.str() }, { A: 'x' });
  assert.equal(Object.isFrozen(config), true);
  assert.throws(() => { config.A = 'changed'; }, TypeError);
});

test('defineEnv deeply freezes arrays inside the config', () => {
  const config = defineEnv({ TAGS: t.csv() }, { TAGS: 'a,b' });
  assert.equal(Object.isFrozen(config.TAGS), true);
  assert.throws(() => { config.TAGS.push('c'); }, TypeError);
});

test('defineEnv deeply freezes plain JSON objects', () => {
  const config = defineEnv({ DATA: t.json() }, { DATA: '{"nested":{"x":1}}' });
  assert.equal(Object.isFrozen(config.DATA), true);
  assert.equal(Object.isFrozen(config.DATA.nested), true);
});

test('defineEnv copies only schema keys and ignores unknown source values', () => {
  const config = defineEnv({ A: t.str() }, { A: 'x', UNKNOWN: 'not copied' });
  assert.equal('A' in config, true);
  assert.equal('UNKNOWN' in config, false);
});

test('missing required values are reported as missing issues', () => {
  const error = validationError(() => defineEnv({ REQUIRED: t.str() }, {}));
  assertIssue(error, 'REQUIRED', CODE.MISSING);
});

test('optional missing values are omitted', () => {
  const config = defineEnv({ MAYBE: t.str().optional() }, {});
  assert.equal('MAYBE' in config, false);
});

test('optional present values are parsed normally', () => {
  const config = defineEnv({ MAYBE: t.int().optional() }, { MAYBE: '7' });
  assert.equal(config.MAYBE, 7);
});

test('string defaults are parsed through the validator', () => {
  const config = defineEnv({ PORT: t.port().default('8080') }, {});
  assert.equal(config.PORT, 8080);
});

test('typed boolean defaults are accepted', () => {
  const config = defineEnv({ DEBUG: t.bool().default(true) }, {});
  assert.equal(config.DEBUG, true);
});

test('typed integer defaults are checked', () => {
  const error = validationError(() => defineEnv({ COUNT: t.int({ max: 4 }).default(9) }, {}));
  assertIssue(error, 'COUNT', CODE.RANGE);
});

test('typed duration defaults are accepted', () => {
  const config = defineEnv({ TIMEOUT: t.durationMs().default(1500) }, {});
  assert.equal(config.TIMEOUT, 1500);
});

test('json object defaults are validated and frozen', () => {
  const config = defineEnv({ DATA: t.json().default({ a: [1, true, null] }) }, {});
  assert.deepEqual(config.DATA, { a: [1, true, null] });
  assert.equal(Object.isFrozen(config.DATA), true);
});

test('csv array defaults are validated', () => {
  const config = defineEnv({ TAGS: t.csv({ unique: true }).default(['a', 'b']) }, {});
  assert.deepEqual(config.TAGS, ['a', 'b']);
});

test('invalid defaults are aggregated rather than silently used', () => {
  const error = validationError(() => defineEnv({ PORT: t.port().default('70000') }, {}));
  assertIssue(error, 'PORT', CODE.RANGE);
  assert.match(error.issues[0].reason, /invalid default/);
});

test('all validation failures are aggregated in one error', () => {
  const error = validationError(() => defineEnv({
    MISSING: t.str(),
    PORT: t.port(),
    DEBUG: t.bool(),
    TOKEN: t.secret()
  }, {
    PORT: '99999',
    DEBUG: 'maybe',
    TOKEN: validSecret()
  }));
  assert.equal(error.issues.length, 3);
  assertIssue(error, 'MISSING', CODE.MISSING);
  assertIssue(error, 'PORT', CODE.RANGE);
  assertIssue(error, 'DEBUG', CODE.TYPE);
});

test('aggregate error message includes keys and reasons', () => {
  const error = validationError(() => defineEnv({ A: t.int(), B: t.bool() }, { A: 'x', B: 'x' }));
  assert.match(error.message, /A: integer value/);
  assert.match(error.message, /B: boolean value/);
});

test('aggregate error issues are frozen', () => {
  const error = validationError(() => defineEnv({ A: t.int() }, { A: 'x' }));
  assert.equal(Object.isFrozen(error.issues), true);
  assert.equal(Object.isFrozen(error.issues[0]), true);
});

test('EnvCageError exposes stable metadata and JSON shape', () => {
  const error = validationError(() => defineEnv({ A: t.int() }, { A: 'x' }));
  assert.equal(error.name, 'EnvCageError');
  assert.ok(error instanceof EnvCageError);
  const json = error.toJSON();
  assert.equal(json.name, 'EnvCageError');
  assert.equal(json.code, CODE.VALIDATION);
  assert.equal(json.issues.length, 1);
});

test('schema must be a plain object', () => {
  for (const schema of [null, [], 'x', 1]) {
    directError(() => defineEnv(schema, {}), CODE.SCHEMA);
  }
});

test('schema keys must be valid environment variable names', () => {
  for (const key of ['', '1A', 'A-B', 'A.B', 'A B']) {
    directError(() => defineEnv({ [key]: t.str() }, {}), CODE.SCHEMA);
  }
});

test('schema values must be envcage validators', () => {
  directError(() => defineEnv({ A: {} }, {}), CODE.SCHEMA);
  directError(() => defineEnv({ A: { parse: () => 'x' } }, {}), CODE.SCHEMA);
});

test('prototype pollution schema keys are rejected', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const schema = JSON.parse('{"' + key + '":null}');
    schema[key] = t.str();
    directError(() => defineEnv(schema, {}), CODE.PROTOTYPE_KEY);
  }
});

test('prototype pollution option keys are rejected', () => {
  const options = JSON.parse('{"__proto__":{"polluted":true},"maxValueLength":100}');
  directError(() => defineEnv({ A: t.str() }, { A: 'x' }, options), CODE.PROTOTYPE_KEY);
});

test('unknown defineEnv options are rejected', () => {
  const error = directError(() => defineEnv({ A: t.str() }, { A: 'x' }, { maxValueLen: 1 }), CODE.INVALID_INPUT);
  assert.equal(error.key, 'maxValueLen');
});

test('maxValueLength rejects oversized raw values', () => {
  const error = validationError(() => defineEnv(
    { A: t.str() },
    { A: 'abcdef' },
    { maxValueLength: 5 }
  ));
  assertIssue(error, 'A', CODE.LIMIT_EXCEEDED);
});

test('maxValueLength is also applied to string defaults', () => {
  const error = validationError(() => defineEnv(
    { A: t.str().default('abcdef') },
    {},
    { maxValueLength: 5 }
  ));
  assertIssue(error, 'A', CODE.LIMIT_EXCEEDED);
});

test('null bytes are rejected before validator parsing', () => {
  const error = validationError(() => defineEnv({ A: t.str() }, { A: 'ok\0bad' }));
  assertIssue(error, 'A', CODE.NULL_BYTE);
});

test('C0 control characters are rejected', () => {
  const error = validationError(() => defineEnv({ A: t.str() }, { A: 'ok\x07bad' }));
  assertIssue(error, 'A', CODE.CONTROL_CHARACTER);
});

test('C1 control characters are rejected', () => {
  const error = validationError(() => defineEnv({ A: t.str() }, { A: 'ok\x85bad' }));
  assertIssue(error, 'A', CODE.CONTROL_CHARACTER);
});

test('line feeds are rejected for single-line validators', () => {
  const error = validationError(() => defineEnv({ A: t.str() }, { A: 'one\ntwo' }));
  assertIssue(error, 'A', CODE.CONTROL_CHARACTER);
});

test('tabs are rejected for single-line validators', () => {
  const error = validationError(() => defineEnv({ A: t.str() }, { A: 'one\ttwo' }));
  assertIssue(error, 'A', CODE.CONTROL_CHARACTER);
});

test('str multiline option permits line breaks and tabs', () => {
  const config = defineEnv({ TEXT: t.str({ multiline: true }) }, { TEXT: 'one\ntwo\tthree' });
  assert.equal(config.TEXT, 'one\ntwo\tthree');
});

test('defineEnv allowMultiline permits line breaks globally', () => {
  const config = defineEnv(
    { TEXT: t.str() },
    { TEXT: 'one\ntwo' },
    { allowMultiline: true }
  );
  assert.equal(config.TEXT, 'one\ntwo');
});

test('non-string source values are rejected', () => {
  for (const value of [1, true, null, [], {}]) {
    const error = validationError(() => defineEnv({ A: t.str() }, { A: value }));
    assertIssue(error, 'A', CODE.TYPE);
  }
});

test('inherited source properties do not count as present', () => {
  const source = Object.create({ A: 'x' });
  const error = validationError(() => defineEnv({ A: t.str() }, source));
  assertIssue(error, 'A', CODE.MISSING);
});

test('throwing source getters become validation issues', () => {
  const source = {};
  Object.defineProperty(source, 'A', {
    enumerable: true,
    get() { throw new Error('hostile getter'); }
  });
  const error = validationError(() => defineEnv({ A: t.str() }, source));
  assertIssue(error, 'A', CODE.TYPE);
});

test('source must be an object', () => {
  for (const source of [null, 'env', 4]) {
    directError(() => defineEnv({ A: t.str() }, source), CODE.INVALID_INPUT);
  }
});

test('validator objects are immutable', () => {
  const validator = t.str();
  assert.equal(Object.isFrozen(validator), true);
  assert.throws(() => { validator.required = false; }, TypeError);
});

test('optional chaining returns a new immutable validator', () => {
  const base = t.str();
  const optional = base.optional();
  assert.notEqual(optional, base);
  assert.equal(base.required, true);
  assert.equal(optional.required, false);
  assert.equal(Object.isFrozen(optional), true);
});

test('default chaining returns a new immutable validator', () => {
  const base = t.int();
  const withDefault = base.default('4');
  assert.notEqual(withDefault, base);
  assert.equal(base.hasDefault, undefined);
  assert.equal(withDefault.hasDefault, true);
  assert.equal(Object.isFrozen(withDefault), true);
});

test('schema keys over 256 characters are rejected', () => {
  const key = 'A'.repeat(257);
  directError(() => defineEnv({ [key]: t.str() }, {}), CODE.SCHEMA);
});

test('factory unknown options are rejected at schema construction time', () => {
  directError(() => t.str({ minLen: 1 }), CODE.SCHEMA);
  directError(() => t.bool({ strict: true }), CODE.SCHEMA);
  directError(() => t.url({ requireHTTPs: true }), CODE.SCHEMA);
});

test('factory option objects must be plain objects', () => {
  for (const options of [null, [], 'x']) {
    directError(() => t.str(options), CODE.INVALID_INPUT);
  }
});

test('large schemas aggregate more than 20 issues without unbounded messages', () => {
  const schema = {};
  for (let index = 0; index < 30; index += 1) schema['KEY_' + index] = t.str();
  const error = validationError(() => defineEnv(schema, {}));
  assert.equal(error.issues.length, 30);
  assert.match(error.message, /and 10 more/);
});

test('json object defaults are cloned instead of freezing caller input', () => {
  const input = { nested: { x: 1 } };
  const config = defineEnv({ DATA: t.json().default(input) }, {});
  assert.deepEqual(config.DATA, input);
  assert.notEqual(config.DATA, input);
  assert.notEqual(config.DATA.nested, input.nested);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(config.DATA), true);
});

test('defineEnv option type errors use invalid input rather than schema errors', () => {
  directError(() => defineEnv({ A: t.str() }, { A: 'x' }, { maxValueLength: 1.5 }), CODE.INVALID_INPUT);
  directError(() => defineEnv({ A: t.str() }, { A: 'x' }, { allowMultiline: 'yes' }), CODE.INVALID_INPUT);
});

test('EnvCageError sanitizes malformed issue entries', () => {
  const error = new EnvCageError(CODE.VALIDATION, 'x', { issues: [null, 4, { reason: 'safe' }] });
  assert.equal(error.issues.length, 3);
  assert.equal(error.issues[0].key, null);
  assert.equal(error.issues[0].code, CODE.VALIDATION);
  assert.equal(error.issues[2].reason, 'safe');
});

