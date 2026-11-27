import test from 'node:test';
import assert from 'node:assert/strict';
import util from 'node:util';
import fc from 'fast-check';
import { CODE, EnvCageError, defineEnv, redactString, safeSnapshot, t } from '../src/index.mjs';

const SECRET_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&*+?^~';
const validSecretArbitrary = fc.string({
  unit: fc.constantFrom(...SECRET_ALPHABET),
  minLength: 14,
  maxLength: 46,
}).map((value) => 'A' + value + 'Z');

function secretConfig(secret) {
  return defineEnv({ TOKEN: t.secret() }, { TOKEN: secret });
}

test('valid generated secrets parse but never leak in string forms', () => {
  fc.assert(
    fc.property(validSecretArbitrary, fc.string({ maxLength: 60 }), fc.string({ maxLength: 60 }), (secret, before, after) => {
      const config = secretConfig(secret);
      assert.equal(config.TOKEN.reveal(), secret);

      const exposed = JSON.stringify(config) + util.inspect(config, { depth: 10, showHidden: true }) + JSON.stringify(safeSnapshot(config));
      assert.equal(exposed.includes(secret), false, 'config string forms exposed the raw secret');

      const redacted = redactString(config, before + secret + after);
      assert.equal(redacted.includes(secret), false, 'redactString left the raw secret in place');
      assert.ok(redacted.includes('[REDACTED]'));

      const encoded = encodeURIComponent(secret);
      const base64 = Buffer.from(secret, 'utf8').toString('base64');
      const base64url = Buffer.from(secret, 'utf8').toString('base64url');
      for (const form of [encoded, base64, base64url]) {
        const output = redactString(config, 'prefix ' + form + ' suffix');
        assert.equal(output.includes(form), false, 'redactString left an encoded secret form in place');
        assert.ok(output.includes('[REDACTED]'));
      }
    }),
    { seed: 20261127, numRuns: 120, endOnFailure: true },
  );
});

test('arbitrary environment strings either validate safely or fail closed without echoing input', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 20, maxLength: 80 }), (value) => {
      try {
        const config = defineEnv({ TOKEN: t.secret({ minLength: 1 }) }, { TOKEN: value });
        assert.equal(config.TOKEN.reveal(), value);
        assert.equal(JSON.stringify(config).includes(value), false);
        assert.equal(util.inspect(config, { depth: 10, showHidden: true }).includes(value), false);
      } catch (error) {
        assert.ok(error instanceof EnvCageError, 'unexpected non-envcage exception');
        assert.equal(error.code, CODE.VALIDATION);
        const serialized = error.message + '\n' + error.stack + '\n' + JSON.stringify(error.issues) + '\n' + JSON.stringify(error.toJSON());
        assert.equal(serialized.includes(value), false, 'validation failure echoed the raw environment value');
      }
    }),
    { seed: 20261128, numRuns: 200, endOnFailure: true },
  );
});
