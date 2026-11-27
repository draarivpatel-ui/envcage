import test from 'node:test';
import assert from 'node:assert/strict';
import util from 'node:util';
import { esm, validationError, assertIssue, assertNoText, validSecret } from './helpers.mjs';

const { defineEnv, t, CODE, SecretString, redact, redactString, redactObject, safeSnapshot } = esm;

function configWithSecret(secret = validSecret(), options) {
  return defineEnv({ TOKEN: t.secret(options) }, { TOKEN: secret });
}

test('secret validator returns a SecretString wrapper', () => {
  const config = configWithSecret();
  assert.ok(config.TOKEN instanceof SecretString);
});

test('SecretString reveal returns the exact raw secret explicitly', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  assert.equal(config.TOKEN.reveal(), secret);
});

test('SecretString string conversion is redacted', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  assert.equal(String(config.TOKEN), '[REDACTED]');
  assert.equal(`${config.TOKEN}`, '[REDACTED]');
  assert.equal(config.TOKEN + '', '[REDACTED]');
  assertNoText(String(config.TOKEN), secret);
});

test('SecretString valueOf and primitive conversion are redacted', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  assert.equal(config.TOKEN.valueOf(), '[REDACTED]');
  assert.equal(config.TOKEN + 'suffix', '[REDACTED]suffix');
});

test('SecretString toJSON is redacted', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  assert.equal(config.TOKEN.toJSON(), '[REDACTED]');
  assertNoText(JSON.stringify(config.TOKEN), secret);
});

test('JSON.stringify config never includes raw secret bytes', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const json = JSON.stringify(config);
  assert.equal(json, '{"TOKEN":"[REDACTED]"}');
  assertNoText(json, secret);
});

test('util.inspect secret uses the custom inspect mask', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  assert.equal(util.inspect(config.TOKEN), '[REDACTED]');
  assertNoText(util.inspect(config.TOKEN), secret);
});

test('util.inspect config never includes raw secret bytes', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const inspected = util.inspect(config, { depth: 10, showHidden: true });
  assertNoText(inspected, secret);
  assert.match(inspected, /\[REDACTED\]/);
});

test('SecretString objects are frozen', () => {
  const config = configWithSecret();
  assert.equal(Object.isFrozen(config.TOKEN), true);
  assert.throws(() => { config.TOKEN.extra = 'x'; }, TypeError);
});

test('secret minLength defaults to 16', () => {
  const error = validationError(() => configWithSecret('short-secret-12'));
  assertIssue(error, 'TOKEN', CODE.SECRET);
});

test('secret minLength is configurable', () => {
  const config = configWithSecret('abcd', { minLength: 4 });
  assert.equal(config.TOKEN.reveal(), 'abcd');
});

test('secret maxLength is enforced', () => {
  const error = validationError(() => configWithSecret(validSecret(), { minLength: 1, maxLength: 8 }));
  assertIssue(error, 'TOKEN', CODE.SECRET);
});

test('secret rejects leading whitespace', () => {
  const error = validationError(() => configWithSecret(' ' + validSecret()));
  assertIssue(error, 'TOKEN', CODE.SECRET);
});

test('secret rejects trailing whitespace', () => {
  const error = validationError(() => configWithSecret(validSecret() + ' '));
  assertIssue(error, 'TOKEN', CODE.SECRET);
});

test('secret rejects newline even though it is a line control', () => {
  const error = validationError(() => configWithSecret(validSecret() + '\nX'));
  assertIssue(error, 'TOKEN', CODE.CONTROL_CHARACTER);
});

const placeholders = [
  'changeme', 'CHANGE-ME', 'change_me', 'secret', 'SECRET', 'password',
  'todo', 'example', 'your-key-here', 'your_token_here', 'replace-me',
  'placeholder', 'redacted', '[redacted]'
];
for (const placeholder of placeholders) {
  test('secret rejects obvious placeholder ' + JSON.stringify(placeholder), () => {
    const error = validationError(() => defineEnv(
      { TOKEN: t.secret({ minLength: 1 }) },
      { TOKEN: placeholder }
    ));
    assertIssue(error, 'TOKEN', CODE.SECRET);
  });
}

for (const repeated of ['aaaaaaaaaaaaaaaa', 'xxxxxxxxxxxxxxxx', '0000000000000000', '----------------']) {
  test('secret rejects repeated single character input', () => {
    const error = validationError(() => defineEnv(
      { TOKEN: t.secret({ minLength: 1 }) },
      { TOKEN: repeated }
    ));
    assertIssue(error, 'TOKEN', CODE.SECRET);
  });
}

test('secret validation error message never echoes the raw secret', () => {
  const secret = validSecret();
  const error = validationError(() => defineEnv(
    { TOKEN: t.secret({ minLength: 100 }) },
    { TOKEN: secret }
  ));
  assertNoText(error.message, secret);
  assertNoText(JSON.stringify(error.issues), secret);
  assertNoText(JSON.stringify(error.toJSON()), secret);
});

test('aggregate errors never echo raw secret values', () => {
  const secret = validSecret();
  const error = validationError(() => defineEnv({
    TOKEN: t.secret({ minLength: 100 }),
    PORT: t.port()
  }, {
    TOKEN: secret,
    PORT: 'bad'
  }));
  assertNoText(error.message, secret);
  assertNoText(JSON.stringify(error.issues), secret);
  assertNoText(error.stack, secret);
});

test('redactString replaces raw secret occurrences', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const output = redactString(config, 'before ' + secret + ' after ' + secret);
  assert.equal(output, 'before [REDACTED] after [REDACTED]');
});

test('redact replaces URL-encoded secret occurrences', () => {
  const secret = 'abc+def/ghi?=xyz123';
  const config = configWithSecret(secret);
  const encoded = 'abc%2Bdef%2Fghi%3F%3Dxyz123';
  const output = redact(config, 'encoded=' + encoded);
  assert.equal(output, 'encoded=[REDACTED]');
});

test('redact replaces lowercase percent hex encoded secret occurrences', () => {
  const secret = 'abc+def/ghi?=xyz123';
  const config = configWithSecret(secret);
  const encoded = 'abc%2bdef%2fghi%3f%3dxyz123';
  const output = redact(config, 'encoded=' + encoded);
  assert.equal(output, 'encoded=[REDACTED]');
});

test('redact replaces padded base64 secret occurrences', () => {
  const secret = 'abc+def/ghi?=xyz123';
  const config = configWithSecret(secret);
  const output = redact(config, 'token=YWJjK2RlZi9naGk/PXh5ejEyMw==');
  assert.equal(output, 'token=[REDACTED]');
});

test('redact replaces unpadded base64 secret occurrences', () => {
  const secret = 'abc+def/ghi?=xyz123';
  const config = configWithSecret(secret);
  const output = redact(config, 'token=YWJjK2RlZi9naGk/PXh5ejEyMw');
  assert.equal(output, 'token=[REDACTED]');
});

test('redact replaces base64url secret occurrences', () => {
  const secret = 'abc+def/ghi?=xyz123';
  const config = configWithSecret(secret);
  const output = redact(config, 'token=YWJjK2RlZi9naGk_PXh5ejEyMw==');
  assert.equal(output, 'token=[REDACTED]');
});

test('redact replaces unpadded base64url secret occurrences', () => {
  const secret = 'abc+def/ghi?=xyz123';
  const config = configWithSecret(secret);
  const output = redact(config, 'token=YWJjK2RlZi9naGk_PXh5ejEyMw');
  assert.equal(output, 'token=[REDACTED]');
});

test('redact handles unicode secrets in URL-encoded and base64 forms', () => {
  const secret = 'synthetic-secrét-+/123';
  const config = configWithSecret(secret);
  const encoded = encodeURIComponent(secret);
  const base64 = Buffer.from(secret, 'utf8').toString('base64');
  const output = redact(config, encoded + ' ' + base64);
  assert.equal(output, '[REDACTED] [REDACTED]');
});

test('short secrets redact raw text but do not require encoded forms', () => {
  const secret = 'abcd';
  const config = configWithSecret(secret, { minLength: 4 });
  const base64 = Buffer.from(secret, 'utf8').toString('base64');
  assert.equal(redact(config, secret), '[REDACTED]');
  assert.equal(redact(config, base64), base64);
});

test('redactObject clones string fields without mutating the original object', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const diagnostic = { message: 'token ' + secret, nested: ['x' + secret] };
  const copy = redactObject(config, diagnostic);
  assert.equal(copy.message, 'token [REDACTED]');
  assert.equal(copy.nested[0], 'x[REDACTED]');
  assert.equal(diagnostic.message, 'token ' + secret);
  assert.equal(diagnostic.nested[0], 'x' + secret);
});

test('redactObject replaces SecretString objects with the mask', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const copy = redactObject(config, { token: config.TOKEN });
  assert.equal(copy.token, '[REDACTED]');
});

test('redactObject redacts object keys containing a secret', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const copy = redactObject(config, { ['prefix-' + secret]: 'value' });
  assert.deepEqual(Object.keys(copy), ['prefix-[REDACTED]']);
});

test('redactObject handles arrays preserving order', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const copy = redactObject(config, [secret, 'clean', secret]);
  assert.deepEqual(copy, ['[REDACTED]', 'clean', '[REDACTED]']);
});

test('redactObject handles Map and Set diagnostic values', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const copy = redactObject(config, {
    map: new Map([[secret, secret]]),
    set: new Set([secret])
  });
  assert.deepEqual(Array.from(copy.map.keys()), ['[REDACTED]']);
  assert.deepEqual(Array.from(copy.map.values()), ['[REDACTED]']);
  assert.deepEqual(Array.from(copy.set), ['[REDACTED]']);
});

test('redactObject preserves cyclic structure without mutation or recursion failure', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const diagnostic = { secret };
  diagnostic.self = diagnostic;
  const copy = redactObject(config, diagnostic);
  assert.equal(copy.secret, '[REDACTED]');
  assert.equal(copy.self, copy);
  assert.equal(diagnostic.self, diagnostic);
});

test('redact copies Error objects with redacted message and stack', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const original = new Error('failed with ' + secret);
  const copy = redact(config, original);
  assert.ok(copy instanceof Error);
  assert.equal(copy.message, 'failed with [REDACTED]');
  assertNoText(copy.stack, secret);
  assert.equal(original.message, 'failed with ' + secret);
});

test('redact copies Error cause recursively', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const original = new Error('outer', { cause: { detail: secret } });
  const copy = redact(config, original);
  assert.equal(copy.cause.detail, '[REDACTED]');
  assert.equal(original.cause.detail, secret);
});

test('redact leaves numbers booleans null and undefined unchanged', () => {
  const config = configWithSecret();
  assert.equal(redact(config, 4), 4);
  assert.equal(redact(config, true), true);
  assert.equal(redact(config, null), null);
  assert.equal(redact(config, undefined), undefined);
});

test('safeSnapshot replaces secret wrappers with redacted strings', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const snapshot = safeSnapshot(config);
  assert.equal(snapshot.TOKEN, '[REDACTED]');
  assertNoText(JSON.stringify(snapshot), secret);
});

test('safeSnapshot is deeply frozen', () => {
  const config = defineEnv({
    TOKEN: t.secret(),
    TAGS: t.csv(),
    DATA: t.json()
  }, {
    TOKEN: validSecret(),
    TAGS: 'a,b',
    DATA: '{"nested":{"x":1}}'
  });
  const snapshot = safeSnapshot(config);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.TAGS), true);
  assert.equal(Object.isFrozen(snapshot.DATA), true);
  assert.equal(Object.isFrozen(snapshot.DATA.nested), true);
});

test('safeSnapshot does not mutate the live config', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  safeSnapshot(config);
  assert.equal(config.TOKEN.reveal(), secret);
  assert.ok(config.TOKEN instanceof SecretString);
});

test('safeSnapshot requires an object input', () => {
  assert.throws(() => safeSnapshot('not object'), /config must be an object/);
});

test('redactString requires a string input', () => {
  const config = configWithSecret();
  assert.throws(() => redactString(config, 4), /text must be a string/);
});

test('multiple secrets are all registered and redacted', () => {
  const first = validSecret('a1');
  const second = validSecret('z9');
  const config = defineEnv({
    FIRST: t.secret(),
    SECOND: t.secret()
  }, {
    FIRST: first,
    SECOND: second
  });
  const output = redact(config, first + ' and ' + second);
  assert.equal(output, '[REDACTED] and [REDACTED]');
});

test('overlapping secrets redact the longest form first', () => {
  const short = 'abcdefgh';
  const long = 'abcdefghijkl';
  const config = defineEnv({
    SHORT: t.secret({ minLength: 8 }),
    LONG: t.secret({ minLength: 8 })
  }, {
    SHORT: short,
    LONG: long
  });
  assert.equal(redact(config, long), '[REDACTED]');
});

test('secret default values are registered for redaction', () => {
  const secret = validSecret('default');
  const config = defineEnv({ TOKEN: t.secret().default(secret) }, {});
  assert.equal(redact(config, secret), '[REDACTED]');
});

test('secret defaults provided as SecretString are accepted', () => {
  const secret = validSecret('wrapped');
  const config = configWithSecret(secret);
  const second = defineEnv({ TOKEN: t.secret().default(config.TOKEN) }, {});
  assert.equal(second.TOKEN.reveal(), secret);
});

test('SecretString constructor rejects empty or non-string input', () => {
  assert.throws(() => new SecretString(''), /non-empty/);
  assert.throws(() => new SecretString(4), /non-empty/);
});

test('redactObject cannot pollute object prototypes through hostile keys', () => {
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1}}');
  const copy = redactObject({}, hostile);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(copy, '__proto__'), true);
  assert.equal(copy.__proto__.polluted, true);
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
});

test('redact handles lone surrogate secrets without throwing', () => {
  const secret = 'abcde\uD800fghi';
  const config = configWithSecret(secret, { minLength: 8 });
  const output = redact(config, 'value ' + secret);
  assert.equal(output, 'value [REDACTED]');
});

test('redact copies Error name and code defensively', () => {
  const secret = validSecret();
  const config = configWithSecret(secret);
  const original = new Error('outer');
  original.name = 'Name' + secret;
  original.code = 'code-' + secret;
  const copy = redact(config, original);
  assertNoText(copy.name, secret);
  assertNoText(copy.code, secret);
  assert.equal(original.name, 'Name' + secret);
});

test('redact lowercase URL hex support preserves unescaped letter case', () => {
  const secret = 'ABC+def/ghi?=xyz123';
  const config = configWithSecret(secret);
  const lowerHex = 'ABC%2bdef%2fghi%3f%3dxyz123';
  assert.equal(redact(config, lowerHex), '[REDACTED]');
});

