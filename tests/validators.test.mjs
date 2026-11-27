import test from 'node:test';
import assert from 'node:assert/strict';
import { esm, validationError, assertIssue } from './helpers.mjs';

const { defineEnv, t, CODE } = esm;

function parseOne(validator, value, options) {
  return defineEnv({ VALUE: validator }, { VALUE: value }, options).VALUE;
}

function rejectOne(validator, value, code) {
  const error = validationError(() => defineEnv({ VALUE: validator }, { VALUE: value }));
  assertIssue(error, 'VALUE', code);
  return error;
}

test('str accepts an ordinary string unchanged', () => {
  assert.equal(parseOne(t.str(), 'hello'), 'hello');
});

test('str preserves whitespace when trim is false', () => {
  assert.equal(parseOne(t.str(), '  hello  '), '  hello  ');
});

test('str trims whitespace when trim is true', () => {
  assert.equal(parseOne(t.str({ trim: true }), '  hello  '), 'hello');
});

test('str accepts empty strings by default', () => {
  assert.equal(parseOne(t.str(), ''), '');
});

test('str allowEmpty false rejects an empty string', () => {
  rejectOne(t.str({ allowEmpty: false }), '', CODE.LENGTH);
});

test('str enforces minLength', () => {
  rejectOne(t.str({ minLength: 3 }), 'ab', CODE.LENGTH);
  assert.equal(parseOne(t.str({ minLength: 3 }), 'abc'), 'abc');
});

test('str enforces maxLength', () => {
  rejectOne(t.str({ maxLength: 3 }), 'abcd', CODE.LENGTH);
  assert.equal(parseOne(t.str({ maxLength: 3 }), 'abc'), 'abc');
});

test('str rejects impossible length ranges at schema construction', () => {
  assert.throws(() => t.str({ minLength: 4, maxLength: 3 }), /minLength/);
});

test('str accepts a matching pattern', () => {
  assert.equal(parseOne(t.str({ pattern: /^[a-z]+$/ }), 'abc'), 'abc');
});

test('str rejects a non-matching pattern', () => {
  rejectOne(t.str({ pattern: /^[a-z]+$/ }), 'ABC', CODE.PATTERN);
});

test('str global regex state does not leak between validations', () => {
  const validator = t.str({ pattern: /^a+$/g });
  assert.equal(parseOne(validator, 'aa'), 'aa');
  assert.equal(parseOne(validator, 'aa'), 'aa');
});

test('str pattern must be a RegExp', () => {
  assert.throws(() => t.str({ pattern: '^a$' }), /pattern/);
});

const boolAccepted = [
  ['true', true], ['false', false], ['1', true], ['0', false],
  ['yes', true], ['no', false], ['TRUE', true], ['False', false],
  ['YeS', true], ['NO', false]
];
for (const [input, expected] of boolAccepted) {
  test('bool accepts documented spelling ' + JSON.stringify(input), () => {
    assert.equal(parseOne(t.bool(), input), expected);
  });
}

const boolRejected = ['maybe', '2', 'on', 'off', 'enabled', 'disabled', '', ' true ', 'true ', ' true', 'y', 'n', 't', 'f', 'null', 'undefined'];
for (const input of boolRejected) {
  test('bool rejects non-strict spelling ' + JSON.stringify(input), () => {
    rejectOne(t.bool(), input, CODE.TYPE);
  });
}

const intAccepted = [
  ['0', 0], ['1', 1], ['-1', -1], ['+1', 1], ['00042', 42],
  [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  [String(-Number.MAX_SAFE_INTEGER), -Number.MAX_SAFE_INTEGER]
];
for (const [input, expected] of intAccepted) {
  test('int accepts decimal integer ' + JSON.stringify(input), () => {
    assert.equal(parseOne(t.int(), input), expected);
  });
}

const intRejected = [
  '', ' ', 'abc', '123abc', '1.0', '1.', '.1', '1e3', '1E3', 'NaN', 'Infinity',
  '-Infinity', ' 1', '1 ', '1\t', '++1', '--1', '+-1', '9007199254740992',
  '-9007199254740992'
];
for (const input of intRejected) {
  test('int rejects hostile integer input ' + JSON.stringify(input), () => {
    const error = validationError(() => defineEnv({ VALUE: t.int() }, { VALUE: input }));
    assert.ok([CODE.TYPE, CODE.RANGE, CODE.CONTROL_CHARACTER].includes(error.issues[0].code));
  });
}

test('int enforces min', () => {
  rejectOne(t.int({ min: 2 }), '1', CODE.RANGE);
  assert.equal(parseOne(t.int({ min: 2 }), '2'), 2);
});

test('int enforces max', () => {
  rejectOne(t.int({ max: 2 }), '3', CODE.RANGE);
  assert.equal(parseOne(t.int({ max: 2 }), '2'), 2);
});

test('int rejects impossible ranges at schema construction', () => {
  assert.throws(() => t.int({ min: 3, max: 2 }), /min/);
});

const numAccepted = [
  ['0', 0], ['1', 1], ['-1', -1], ['+1', 1], ['1.5', 1.5],
  ['-0.5', -0.5], ['.5', 0.5], ['000.500', 0.5]
];
for (const [input, expected] of numAccepted) {
  test('num accepts decimal number ' + JSON.stringify(input), () => {
    assert.equal(parseOne(t.num(), input), expected);
  });
}

const numRejected = [
  '', ' ', 'abc', '123abc', '1.', '.', '1e3', '1E-3', 'NaN', 'Infinity', '-Infinity',
  ' 1', '1 ', '++1', '--1', '0x10'
];
for (const input of numRejected) {
  test('num rejects hostile number input ' + JSON.stringify(input), () => {
    rejectOne(t.num(), input, CODE.TYPE);
  });
}

test('num enforces min and max', () => {
  rejectOne(t.num({ min: 1.5 }), '1.4', CODE.RANGE);
  rejectOne(t.num({ max: 1.5 }), '1.6', CODE.RANGE);
  assert.equal(parseOne(t.num({ min: 1.5, max: 1.5 }), '1.5'), 1.5);
});

test('num rejects non-finite range options', () => {
  assert.throws(() => t.num({ min: NaN }), /finite/);
  assert.throws(() => t.num({ max: Infinity }), /finite/);
});

const portAccepted = [
  ['1', 1], ['80', 80], ['443', 443], ['8080', 8080], ['65535', 65535], ['00080', 80]
];
for (const [input, expected] of portAccepted) {
  test('port accepts valid port ' + JSON.stringify(input), () => {
    assert.equal(parseOne(t.port(), input), expected);
  });
}

const portRejected = [
  '', ' ', '0', '65536', '-1', '+1', '1.0', '1e3', '8e0', 'NaN', 'Infinity',
  'abc', '80abc', ' 80', '80 ', '0x50'
];
for (const input of portRejected) {
  test('port rejects invalid port ' + JSON.stringify(input), () => {
    const error = validationError(() => defineEnv({ VALUE: t.port() }, { VALUE: input }));
    assert.ok([CODE.TYPE, CODE.RANGE].includes(error.issues[0].code));
  });
}

test('url accepts https and returns normalized form', () => {
  assert.equal(parseOne(t.url(), 'https://example.com'), 'https://example.com/');
});

test('url accepts http by default', () => {
  assert.equal(parseOne(t.url(), 'http://example.com/a'), 'http://example.com/a');
});

for (const input of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/plain,hello', 'ftp://example.com']) {
  test('url blocks disallowed protocol input ' + input.split(':')[0], () => {
    rejectOne(t.url(), input, CODE.URL);
  });
}

test('url allowedProtocols can restrict to a custom protocol', () => {
  assert.equal(parseOne(t.url({ allowedProtocols: ['custom'] }), 'custom://host/path'), 'custom://host/path');
});

test('url requireHttps rejects http', () => {
  rejectOne(t.url({ requireHttps: true }), 'http://example.com', CODE.URL);
});

test('url requireHttps accepts https', () => {
  assert.equal(parseOne(t.url({ requireHttps: true }), 'https://example.com'), 'https://example.com/');
});

test('url credentials are allowed only when not disallowed', () => {
  assert.equal(parseOne(t.url(), 'https://user:pass@example.com'), 'https://user:pass@example.com/');
  rejectOne(t.url({ disallowCredentials: true }), 'https://user:pass@example.com', CODE.URL);
});

test('url username alone counts as credentials', () => {
  rejectOne(t.url({ disallowCredentials: true }), 'https://user@example.com', CODE.URL);
});

test('url allowedHosts accepts exact lowercase host matches', () => {
  assert.equal(
    parseOne(t.url({ allowedHosts: ['example.com'] }), 'https://EXAMPLE.com/path'),
    'https://example.com/path'
  );
});

test('url allowedHosts rejects other hosts', () => {
  rejectOne(t.url({ allowedHosts: ['example.com'] }), 'https://evil.example.com', CODE.URL);
  rejectOne(t.url({ allowedHosts: ['example.com'] }), 'https://example.net', CODE.URL);
});

test('url rejects empty allowedHosts for every host', () => {
  rejectOne(t.url({ allowedHosts: [] }), 'https://example.com', CODE.URL);
});

for (const input of ['', 'notaurl', 'https://', ' https://example.com', 'https://example.com ', 'https://example.com/a b']) {
  test('url rejects malformed or whitespace input ' + JSON.stringify(input), () => {
    rejectOne(t.url(), input, CODE.URL);
  });
}

test('url allowedProtocols must be a non-empty array', () => {
  assert.throws(() => t.url({ allowedProtocols: 'https' }), /allowedProtocols/);
  assert.throws(() => t.url({ allowedProtocols: [] }), /allowedProtocols/);
});

test('url allowedHosts entries must be host names', () => {
  assert.throws(() => t.url({ allowedHosts: ['https://example.com'] }), /allowedHosts/);
  assert.throws(() => t.url({ allowedHosts: [''] }), /allowedHosts/);
});

test('enum accepts exact configured values', () => {
  assert.equal(parseOne(t.enum(['dev', 'prod']), 'dev'), 'dev');
  assert.equal(parseOne(t.enum(['dev', 'prod']), 'prod'), 'prod');
});

test('enum rejects unlisted values', () => {
  rejectOne(t.enum(['dev', 'prod']), 'staging', CODE.TYPE);
});

test('enum is case-sensitive by default', () => {
  rejectOne(t.enum(['prod']), 'PROD', CODE.TYPE);
});

test('enum case-insensitive mode returns canonical spelling', () => {
  assert.equal(parseOne(t.enum(['Prod'], { caseSensitive: false }), 'pRoD'), 'Prod');
});

test('enum rejects empty or invalid value arrays', () => {
  assert.throws(() => t.enum([]), /non-empty/);
  assert.throws(() => t.enum('prod'), /non-empty/);
  assert.throws(() => t.enum(['a', 1]), /strings/);
  assert.throws(() => t.enum(['a', 'a']), /unique/);
});

test('json parses objects arrays and scalars', () => {
  assert.deepEqual(parseOne(t.json(), '{"a":[1,true,null]}'), { a: [1, true, null] });
  assert.deepEqual(parseOne(t.json(), '[1,2]'), [1, 2]);
  assert.equal(parseOne(t.json(), '"text"'), 'text');
  assert.equal(parseOne(t.json(), '3'), 3);
  assert.equal(parseOne(t.json(), 'true'), true);
  assert.equal(parseOne(t.json(), 'null'), null);
});

test('json rejects invalid syntax', () => {
  rejectOne(t.json(), '{bad', CODE.JSON);
  rejectOne(t.json(), '{"a":}', CODE.JSON);
});

for (const key of ['__proto__', 'constructor', 'prototype']) {
  test('json rejects top-level reserved key ' + key, () => {
    rejectOne(t.json(), '{"' + key + '":1}', CODE.JSON);
  });
  test('json rejects nested reserved key ' + key, () => {
    rejectOne(t.json(), '{"safe":{"' + key + '":1}}', CODE.JSON);
  });
  test('json rejects reserved key inside arrays ' + key, () => {
    rejectOne(t.json(), '[{"' + key + '":1}]', CODE.JSON);
  });
}

test('json depth limit accepts root object at depth one', () => {
  assert.deepEqual(parseOne(t.json({ maxDepth: 1 }), '{"a":1}'), { a: 1 });
});

test('json depth limit rejects nested object beyond maxDepth', () => {
  rejectOne(t.json({ maxDepth: 1 }), '{"a":{"b":1}}', CODE.JSON);
});

test('json default maxDepth permits ordinary nesting', () => {
  const value = JSON.stringify({ a: { b: { c: [1, 2, { d: 3 }] } } });
  assert.deepEqual(parseOne(t.json(), value), { a: { b: { c: [1, 2, { d: 3 }] } } });
});

test('json default output rejects cyclic objects', () => {
  const value = { a: 1 };
  value.self = value;
  const error = validationError(() => defineEnv({ VALUE: t.json().default(value) }, {}));
  assertIssue(error, 'VALUE', CODE.JSON);
});

test('json default output rejects non-plain class objects', () => {
  class Box { constructor() { this.x = 1; } }
  const error = validationError(() => defineEnv({ VALUE: t.json().default(new Box()) }, {}));
  assertIssue(error, 'VALUE', CODE.JSON);
});

test('csv parses simple comma-separated items', () => {
  assert.deepEqual(parseOne(t.csv(), 'a,b,c'), ['a', 'b', 'c']);
});

test('csv trims items by default', () => {
  assert.deepEqual(parseOne(t.csv(), ' a , b ,c '), ['a', 'b', 'c']);
});

test('csv trim false preserves item whitespace', () => {
  assert.deepEqual(parseOne(t.csv({ trim: false }), ' a ,b '), [' a ', 'b ']);
});

test('csv rejects empty items by default', () => {
  rejectOne(t.csv(), 'a,,b', CODE.CSV);
  rejectOne(t.csv(), '', CODE.CSV);
});

test('csv allowEmpty permits empty items', () => {
  assert.deepEqual(parseOne(t.csv({ allowEmpty: true }), 'a,,b'), ['a', '', 'b']);
});

test('csv unique rejects duplicate items after trimming', () => {
  rejectOne(t.csv({ unique: true }), 'a, a ,b', CODE.CSV);
});

test('csv unique accepts distinct items', () => {
  assert.deepEqual(parseOne(t.csv({ unique: true }), 'a,b,c'), ['a', 'b', 'c']);
});

test('csv enforces minItems and maxItems', () => {
  rejectOne(t.csv({ minItems: 2 }), 'a', CODE.CSV);
  rejectOne(t.csv({ maxItems: 2 }), 'a,b,c', CODE.CSV);
  assert.deepEqual(parseOne(t.csv({ minItems: 2, maxItems: 2 }), 'a,b'), ['a', 'b']);
});

test('csv quotes have no special meaning', () => {
  assert.deepEqual(parseOne(t.csv(), '"a,b",c'), ['"a', 'b"', 'c']);
});

const durationAccepted = [
  ['0', 0], ['250', 250], ['250ms', 250], ['2s', 2000], ['1.5s', 1500],
  ['5m', 300000], ['1h', 3600000], ['1d', 86400000], ['1h 30m', 5400000],
  ['1d 2h 3m 4s 5ms', 93784005]
];
for (const [input, expected] of durationAccepted) {
  test('durationMs accepts valid duration ' + JSON.stringify(input), () => {
    assert.equal(parseOne(t.durationMs(), input), expected);
  });
}

const durationRejected = [
  '', ' ', 'abc', '1x', '-1s', '+1s', '1e3ms', '1.5ms', '1..5s', '1 s',
  '1s 1s', '1h   ', ' 1h', 'Infinity', 'NaN', '1.0001s'
];
for (const input of durationRejected) {
  test('durationMs rejects invalid duration ' + JSON.stringify(input), () => {
    const error = validationError(() => defineEnv({ VALUE: t.durationMs() }, { VALUE: input }));
    assert.ok([CODE.DURATION, CODE.RANGE, CODE.CONTROL_CHARACTER].includes(error.issues[0].code));
  });
}

test('durationMs enforces min and max', () => {
  rejectOne(t.durationMs({ min: 1000 }), '999ms', CODE.RANGE);
  rejectOne(t.durationMs({ max: 1000 }), '1001ms', CODE.RANGE);
  assert.equal(parseOne(t.durationMs({ min: 1000, max: 1000 }), '1s'), 1000);
});

test('durationMs rejects values above safe integer milliseconds', () => {
  rejectOne(t.durationMs(), '9007199254740992', CODE.RANGE);
});

test('bidirectional formatting controls are rejected in environment values', () => {
  rejectOne(t.str(), 'safe\u202Eevil', CODE.CONTROL_CHARACTER);
});

test('json default output rejects symbol keys', () => {
  const input = { plain: 1 };
  input[Symbol.for('hidden')] = 2;
  const error = validationError(() => defineEnv({ VALUE: t.json().default(input) }, {}));
  assertIssue(error, 'VALUE', CODE.JSON);
});

test('enum rejects empty string values at schema construction', () => {
  assert.throws(() => t.enum(['', 'prod']), /non-empty strings/);
});

test('str maxLength zero permits only empty strings', () => {
  assert.equal(parseOne(t.str({ maxLength: 0 }), ''), '');
  rejectOne(t.str({ maxLength: 0 }), 'a', CODE.LENGTH);
});

test('csv maxItems zero permits an empty typed default only', () => {
  const config = defineEnv({ VALUE: t.csv({ maxItems: 0 }).default([]) }, {});
  assert.deepEqual(config.VALUE, []);
  rejectOne(t.csv({ maxItems: 0 }), '', CODE.CSV);
});

test('durationMs rejects non-ASCII whitespace separators', () => {
  rejectOne(t.durationMs(), '1h\u00A030m', CODE.DURATION);
});

test('durationMs permits repeated ASCII spaces between valid segments', () => {
  assert.equal(parseOne(t.durationMs(), '1h  30m'), 5400000);
});

test('unicode format controls are rejected in environment values', () => {
  for (const char of ['\u200B', '\u200D', '\u2060', '\uFEFF']) {
    rejectOne(t.str(), 'safe' + char + 'evil', CODE.CONTROL_CHARACTER);
  }
});

test('json rejects duplicate object keys recursively', () => {
  for (const raw of [
    '{"a":1,"a":2}',
    '{"outer":{"a":1,"a":2}}',
    '[{"a":1,"a":2}]',
    '{"a":1,"\\u0061":2}',
    '{"":1,"":2}'
  ]) {
    rejectOne(t.json(), raw, CODE.JSON);
  }
});

test('json duplicate scanner accepts structural characters inside strings', () => {
  const input = { a: '}{["\\"', b: ['{},[]'] };
  assert.deepEqual(parseOne(t.json(), JSON.stringify(input)), input);
});

test('json depth limit is enforced before native parsing', () => {
  const raw = '['.repeat(1024) + '1' + ']'.repeat(1024);
  rejectOne(t.json({ maxDepth: 512 }), raw, CODE.JSON);
});

